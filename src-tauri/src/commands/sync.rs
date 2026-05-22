use tauri::Manager;
use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::project::SubtitleSegment;

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncOptions {
    pub max_drift: f64,
    pub auto_correct: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncResult {
    pub corrected_segments: Vec<SubtitleSegment>,
    pub drift_detected: f64,
    pub corrections_applied: u32,
}

#[tauri::command]
pub async fn sync_subtitles_with_video(
    video_path: String,
    segments: Vec<SubtitleSegment>,
    options: Option<SyncOptions>,
    app_handle: tauri::AppHandle,
) -> Result<SyncResult, String> {
    println!("Синхронизация субтитров с видео: {}", video_path);
    
    let video_path_buf = Path::new(&video_path);
    if !video_path_buf.exists() {
        return Err(format!("Видео файл не найден: {}", video_path));
    }
    
    let options = options.unwrap_or(SyncOptions {
        max_drift: 2.0,
        auto_correct: true,
    });
    
    // аудио из видео
    let audio_path = extract_audio_for_sync(video_path_buf, &app_handle).await?;
    
    // ищем речь
    let speech_timestamps = detect_speech_timestamps(&audio_path).await?;
    
    // дрейф
    let drift = calculate_drift(&segments, &speech_timestamps)?;
    
    let mut corrected_segments = segments.clone();
    let mut corrections_applied = 0u32;
    
    if drift.abs() > options.max_drift {
        if options.auto_correct {
            // сдвиг таймкодов
            corrected_segments = apply_drift_correction(segments, drift);
            corrections_applied = corrected_segments.len() as u32;
            println!("Применена коррекция дрейфа: {} сек", drift);
        } else {
            println!("Обнаружен дрейф: {} сек (превышает лимит {} сек)", 
                    drift, options.max_drift);
        }
    }
    
    // tmp wav удалить
    let _ = std::fs::remove_file(&audio_path);
    
    Ok(SyncResult {
        corrected_segments,
        drift_detected: drift,
        corrections_applied,
    })
}

async fn extract_audio_for_sync(
    video_path: &Path,
    app_handle: &tauri::AppHandle,
) -> Result<String, String> {
    use std::process::Stdio;
    use tokio::process::Command;
    
    // tmp wav
    let temp_dir = app_handle.path().temp_dir()
        .map_err(|e| e.to_string())?;
    
    let audio_path = temp_dir.join("sync_temp_audio.wav");
    let audio_path_str = audio_path.to_string_lossy().to_string();
    
    // ffmpeg extract
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-i")
        .arg(video_path)
        .arg("-vn")
        .arg("-acodec")
        .arg("pcm_s16le")
        .arg("-ar")
        .arg("16000")
        .arg("-ac")
        .arg("1")
        .arg(&audio_path_str)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    
    let output = cmd.output().await
        .map_err(|e| format!("Ошибка FFmpeg при извлечении аудио: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg ошибка: {}", stderr));
    }
    
    Ok(audio_path_str)
}

async fn detect_speech_timestamps(audio_path: &str) -> Result<Vec<(f64, f64)>, String> {

    
    use std::fs::File;
    use std::io::Read;
    
    let mut file = File::open(audio_path)
        .map_err(|e| format!("Ошибка открытия аудиофайла: {}", e))?;
    
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .map_err(|e| format!("Ошибка чтения аудиофайла: {}", e))?;
    
    // громкость > порог = речь
    const SAMPLE_RATE: u32 = 16000;
    const BYTES_PER_SAMPLE: usize = 2; // 16-bit
    
    let samples: Vec<i16> = buffer
        .chunks_exact(BYTES_PER_SAMPLE)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    
    let threshold = 500i16;
    let min_silence = SAMPLE_RATE as usize / 2; // 0.5с тишины между кусками
    
    let mut speech_segments = Vec::new();
    let mut in_speech = false;
    let mut start_sample = 0;
    let mut silence_count = 0usize;
    
    let threshold_u = threshold as u16;
    for (i, &sample) in samples.iter().enumerate() {
        if sample.unsigned_abs() > threshold_u {
            if !in_speech {
                in_speech = true;
                start_sample = i;
                silence_count = 0;
            }
        } else {
            if in_speech {
                silence_count += 1;
                if silence_count >= min_silence {
                    in_speech = false;
                    let end_sample = i.saturating_sub(silence_count);
                    if end_sample > start_sample {
                        let start_time = start_sample as f64 / SAMPLE_RATE as f64;
                        let end_time = end_sample as f64 / SAMPLE_RATE as f64;
                        speech_segments.push((start_time, end_time));
                    }
                }
            }
        }
    }
    
    // закрыть хвост
    if in_speech {
        let end_sample = samples.len();
        if end_sample > start_sample {
            let start_time = start_sample as f64 / SAMPLE_RATE as f64;
            let end_time = end_sample as f64 / SAMPLE_RATE as f64;
            speech_segments.push((start_time, end_time));
        }
    }
    
    Ok(speech_segments)
}

fn calculate_drift(
    subtitle_segments: &[SubtitleSegment],
    speech_timestamps: &[(f64, f64)],
) -> Result<f64, String> {
    if subtitle_segments.is_empty() || speech_timestamps.is_empty() {
        return Ok(0.0);
    }
    
    // первый/последний матч
    let first_subtitle = subtitle_segments[0].start;
    let last_subtitle = subtitle_segments.last().unwrap().end;
    
    let first_speech = speech_timestamps[0].0;
    let last_speech = speech_timestamps.last().unwrap().1;
    
    // средний сдвиг start/end
    let start_drift = first_subtitle - first_speech;
    let end_drift = last_subtitle - last_speech;
    
    let average_drift = (start_drift + end_drift) / 2.0;
    
    Ok(average_drift)
}

fn apply_drift_correction(
    segments: Vec<SubtitleSegment>,
    drift: f64,
) -> Vec<SubtitleSegment> {
    segments.into_iter().map(|mut seg| {
        seg.start -= drift;
        seg.end -= drift;
        seg.duration = seg.end - seg.start;
        // start >= 0
        if seg.start < 0.0 {
            seg.start = 0.0;
            seg.duration = seg.end;
        }
        seg
    }).collect()
}