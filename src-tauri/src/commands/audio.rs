use std::path::Path;
use std::fs;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WaveformData {
    pub peaks: Vec<f32>,
    pub sample_rate: u32,
    pub duration: f64,
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
    
    // Проверяем доступность FFmpeg
    let ffmpeg_available = is_ffmpeg_available().await;
    if !ffmpeg_available {
        return Err("FFmpeg не установлен в системе".to_string());
    }
    
    let resolution = resolution.unwrap_or(50);
    
    //извлечение аудио данных и генерации вейвформы
    let waveform_data = generate_waveform_with_ffmpeg(audio_path_buf, resolution).await?;
    
    // Сохраняем данные в JSON файл для фронтенда
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
    
    // Получаем длительность аудио через ffprobe
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
            .map(|&sample| sample.abs() as f32)
            .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap_or(0.0);
        
        // Нормализуем значение от 0.0 до 1.0
        let normalized = max_abs / 32767.0;
        peaks.push(normalized);
    }
    
    Ok(WaveformData {
        peaks,
        sample_rate: resolution,
        duration,
    })
}

/// Полноширинная картинка вейвформы зеленая
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

    /* Усиление перед showwavespic, тихие участки не плоские. */
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

/// Длительность медиа через ffprobe для таймкода плеера и импорта.
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
    use std::process::Stdio;
    use tokio::process::Command;
    
    let mut cmd = Command::new("ffprobe");
    cmd.arg("-v")
        .arg("quiet")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=nw=1")
        .arg(audio_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    
    let output = cmd.output().await.map_err(|e| format!("Ошибка ffprobe: {}", e))?;
    
    if output.status.success() {
        let duration_str = String::from_utf8_lossy(&output.stdout);
        let duration = duration_str.trim().parse::<f64>()
            .map_err(|e| format!("Ошибка парсинга длительности: {}", e))?;
        Ok(duration)
    } else {
        Err("Не удалось получить длительность аудио".to_string())
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