use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::fs;
use std::time::UNIX_EPOCH;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WaveformData {
    pub peaks: Vec<f32>,
    pub sample_rate: u32,
    pub duration: f64,
}

fn file_mtime(path: &Path) -> Option<std::time::SystemTime> {
    fs::metadata(path).ok()?.modified().ok()
}

#[tauri::command]
pub async fn get_cached_waveform(
    media_path: String,
    cache_json_path: String,
    cache_png_path: String,
) -> Result<Option<WaveformData>, String> {
    let media = Path::new(&media_path);
    let json = Path::new(&cache_json_path);
    let png = Path::new(&cache_png_path);
    if !media.exists() || !json.exists() || !png.exists() {
        return Ok(None);
    }
    let Some(media_m) = file_mtime(media) else {
        return Ok(None);
    };
    if let Some(jm) = file_mtime(json) {
        if media_m > jm {
            return Ok(None);
        }
    }
    if let Some(pm) = file_mtime(png) {
        if media_m > pm {
            return Ok(None);
        }
    }
    let content = fs::read_to_string(json).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string()).map(Some)
}

#[tauri::command]
pub async fn generate_waveform(
    audio_path: String,
    output_path: String,
    resolution: Option<u32>, // Количество точек на секунду
    _app_handle: tauri::AppHandle,
) -> Result<WaveformData, String> {
    println!("Генерация волновой формы для: {}", audio_path);
    
    let audio_path_buf = Path::new(&audio_path);
    if !audio_path_buf.exists() {
        return Err(format!("Аудиофайл не найден: {}", audio_path));
    }
    
    // ffmpeg?
    let ffmpeg_available = is_ffmpeg_available().await;
    if !ffmpeg_available {
        return Err("FFmpeg не установлен в системе".to_string());
    }
    
    let resolution = resolution.unwrap_or(50);
    
    // волна
    let waveform_data = generate_waveform_with_ffmpeg(audio_path_buf, resolution).await?;
    
    // json для ui
    let json_data = serde_json::to_string(&waveform_data).map_err(|e| e.to_string())?;
    fs::write(&output_path, json_data).map_err(|e| e.to_string())?;
    
    println!("Волновая форма сохранена: {}", output_path);
    Ok(waveform_data)
}

async fn generate_waveform_with_ffmpeg(
    audio_path: &Path,
    resolution: u32,
) -> Result<WaveformData, String> {
    use std::process::Stdio;
    use tokio::process::Command;
    
    // duration ffprobe
    let duration = get_audio_duration(audio_path).await?;
    
    // Рассчитываем общее количество точек
    let total_points = (duration * resolution as f64) as usize;
    let mut peaks = Vec::with_capacity(total_points);
    
    // ffmpeg для извлечения амплитуды
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-i")
        .arg(audio_path)
        .arg("-vn") // Без видео
        .arg("-acodec")
        .arg("pcm_s16le") // PCM 16-bit
        .arg("-f")
        .arg("s16le") // Raw samples
        .arg("-ac")
        .arg("1") // Моно
        .arg("-ar")
        .arg("44100") // Частота дискретизации
        .arg("-")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    
    let mut child = cmd.spawn().map_err(|e| format!("Ошибка запуска FFmpeg: {}", e))?;
    let stdout = child.stdout.take().unwrap();
    
    // Читаем сырые аудио данные и вычисляем пики
    let mut buffer = vec![0u8; 4096];
    let mut audio_data = Vec::new();
    
    use tokio::io::AsyncReadExt;
    let mut reader = tokio::io::BufReader::new(stdout);
    
    while let Ok(n) = reader.read(&mut buffer).await {
        if n == 0 { break; }
        audio_data.extend_from_slice(&buffer[..n]);
    }

    drop(reader);
    let status = child.wait().await.map_err(|e| format!("ffmpeg wait: {}", e))?;
    if !status.success() {
        return Err("ffmpeg: ошибка декодирования аудио (проверьте кодек)".to_string());
    }
    
    // Конвертируем байты в 16-битные сэмплы
    let samples: Vec<i16> = audio_data
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    
    // Вычисляем пики для каждой временной точки
    let samples_per_point = (samples.len() as f64 / total_points as f64).max(1.0) as usize;
    
    for i in 0..total_points {
        let start_idx = i * samples_per_point;
        let end_idx = (start_idx + samples_per_point).min(samples.len());
        
        if start_idx >= samples.len() {
            peaks.push(0.0);
            continue;
        }
        
        let slice = &samples[start_idx..end_idx];
        let max_abs = slice.iter()
            .map(|&sample| sample.unsigned_abs() as f32)
            .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap_or(0.0);
        
        // 0..1
        let normalized = max_abs / 32767.0;
        peaks.push(normalized);
    }
    
    Ok(WaveformData {
        peaks,
        sample_rate: resolution,
        duration,
    })
}

// png волны (ffmpeg showwavespic)
#[tauri::command]
pub async fn generate_waveform_png(
    media_path: String,
    output_png_path: String,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<(), String> {
    use tokio::process::Command;

    let media = Path::new(&media_path);
    if !media.exists() {
        return Err(format!("Медиафайл не найден: {}", media_path));
    }

    let w = width.unwrap_or(4096).clamp(640, 8192);
    let h = height.unwrap_or(256).clamp(64, 1024);

    if let Some(parent) = Path::new(&output_png_path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    /* boost перед showwavespic */
    let filter = format!(
        "[0:a]volume=10dB,showwavespic=s={}x{}:colors=0xADFF2F|0x121212",
        w, h
    );

    let output = Command::new("ffmpeg")
        .arg("-y")
        .arg("-i")
        .arg(media_path)
        .arg("-filter_complex")
        .arg(&filter)
        .arg("-frames:v")
        .arg("1")
        .arg(&output_png_path)
        .output()
        .await
        .map_err(|e| format!("Запуск ffmpeg: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg showwavespic: {}", err.trim()));
    }

    println!("✅ waveform PNG: {}", output_png_path);
    Ok(())
}

/// Быстрый кадр для превью при перемотке (ffmpeg -ss перед -i).
#[tauri::command]
pub async fn extract_video_preview_frame(
    app: tauri::AppHandle,
    video_path: String,
    time_secs: f64,
) -> Result<String, String> {
    use tauri::Manager;
    use tokio::process::Command;

    if !is_ffmpeg_available().await {
        return Err("ffmpeg не найден".to_string());
    }

    let media = Path::new(&video_path);
    if !media.exists() {
        return Err(format!("Файл не найден: {}", video_path));
    }

    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("cache dir: {}", e))?;
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let out = cache.join("video_preview_scratch.jpg");
    let t = time_secs.max(0.0);

    let status = Command::new("ffmpeg")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-ss")
        .arg(format!("{:.3}", t))
        .arg("-i")
        .arg(&video_path)
        .arg("-frames:v")
        .arg("1")
        .arg("-q:v")
        .arg("4")
        .arg("-vf")
        .arg("scale=-2:480")
        .arg("-an")
        .arg(&out)
        .output()
        .await
        .map_err(|e| format!("ffmpeg preview: {}", e))?;

    if !status.status.success() {
        let err = String::from_utf8_lossy(&status.stderr);
        return Err(format!("ffmpeg preview: {}", err.trim()));
    }

    Ok(out.to_string_lossy().to_string())
}

fn playback_proxy_cache_key(source: &Path) -> Result<(u64, u64), String> {
    let meta = fs::metadata(source).map_err(|e| e.to_string())?;
    let modified = meta
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let mut hasher = DefaultHasher::new();
    source.to_string_lossy().hash(&mut hasher);
    modified.hash(&mut hasher);
    Ok((hasher.finish(), modified))
}

/// MP4 с moov в начале — WebView быстрее перематывает длинные файлы.
#[tauri::command]
pub async fn ensure_faststart_playback_proxy(
    app: tauri::AppHandle,
    video_path: String,
) -> Result<String, String> {
    use tauri::Manager;
    use tokio::process::Command;

    let source = Path::new(&video_path);
    if !source.exists() {
        return Err(format!("Файл не найден: {}", video_path));
    }

    let (hash, _modified) = playback_proxy_cache_key(source)?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("cache dir: {}", e))?
        .join("playback_proxy");
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let proxy = cache.join(format!("{:016x}.mp4", hash));

    if proxy.exists() {
        if let (Ok(src_m), Ok(proxy_m)) = (fs::metadata(source), fs::metadata(&proxy)) {
            if let (Ok(sm), Ok(pm)) = (src_m.modified(), proxy_m.modified()) {
                if pm >= sm {
                    return Ok(proxy.to_string_lossy().to_string());
                }
            }
        }
    }

    if !is_ffmpeg_available().await {
        return Ok(video_path);
    }

    let status = Command::new("ffmpeg")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-i")
        .arg(&video_path)
        .arg("-c")
        .arg("copy")
        .arg("-movflags")
        .arg("+faststart")
        .arg(&proxy)
        .output()
        .await
        .map_err(|e| format!("ffmpeg faststart: {}", e))?;

    if status.status.success() && proxy.exists() {
        return Ok(proxy.to_string_lossy().to_string());
    }

    Ok(video_path)
}

// ffprobe duration
#[tauri::command]
pub async fn probe_media_duration(media_path: String) -> Result<f64, String> {
    let p = Path::new(&media_path);
    if !p.exists() {
        return Err(format!("Файл не найден: {}", media_path));
    }
    get_audio_duration(p).await
}

pub async fn media_duration_seconds(path: &Path) -> Result<f64, String> {
    get_audio_duration(path).await
}

async fn get_audio_duration(audio_path: &Path) -> Result<f64, String> {
    if !audio_path.exists() {
        return Err(format!("Файл не найден: {}", audio_path.display()));
    }

    match probe_duration_seconds(audio_path, None, "format=duration").await {
        Ok(d) if d.is_finite() && d > 0.0 => return Ok(d),
        Ok(_) | Err(_) => {}
    }

    probe_duration_seconds(audio_path, Some("a:0"), "stream=duration").await
}

async fn probe_duration_seconds(
    audio_path: &Path,
    select_stream: Option<&str>,
    show_entries: &str,
) -> Result<f64, String> {
    use std::process::Stdio;
    use tokio::process::Command;

    let mut cmd = Command::new("ffprobe");
    cmd.arg("-v").arg("error");
    if let Some(stream) = select_stream {
        cmd.arg("-select_streams").arg(stream);
    }
    cmd.arg("-show_entries")
        .arg(show_entries)
        .arg("-of")
        .arg("csv=p=0")
        .arg(audio_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Ошибка ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "ffprobe не смог прочитать длительность {}: {}",
            audio_path.display(),
            stderr.trim()
        ));
    }

    parse_ffprobe_duration(&String::from_utf8_lossy(&output.stdout))
}

fn parse_ffprobe_duration(raw: &str) -> Result<f64, String> {
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.eq_ignore_ascii_case("N/A") {
            continue;
        }
        let value = line
            .strip_prefix("duration=")
            .unwrap_or(line)
            .trim();
        if let Ok(duration) = value.parse::<f64>() {
            if duration.is_finite() && duration >= 0.0 {
                return Ok(duration);
            }
        }
    }
    Err(format!(
        "Ошибка парсинга длительности: не найдено число в выводе ffprobe: {:?}",
        raw.trim()
    ))
}

#[cfg(test)]
mod duration_tests {
    use super::parse_ffprobe_duration;

    #[test]
    fn parses_plain_seconds() {
        assert_eq!(parse_ffprobe_duration("123.45\n").unwrap(), 123.45);
    }

    #[test]
    fn parses_duration_prefix() {
        assert_eq!(parse_ffprobe_duration("duration=9.5").unwrap(), 9.5);
    }
}

async fn is_ffmpeg_available() -> bool {
    use std::process::Stdio;
    use tokio::process::Command;
    
    let output = Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await;
    
    match output {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}