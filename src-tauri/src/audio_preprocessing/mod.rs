use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpeechSegment {
    pub start_time: f64,
    pub end_time: f64,
    pub duration: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AudioPreprocessingResult {
    pub speech_segments: Vec<SpeechSegment>,
    pub total_speech_duration: f64,
    pub total_audio_duration: f64,
    pub silence_ratio: f64,
}

pub async fn detect_speech_segments(audio_path: &Path) -> Result<AudioPreprocessingResult, String> {
    let segments = detect_speech_with_ffmpeg(audio_path).await?;
    
    let total_audio_duration = get_audio_duration(audio_path).await?;
    let total_speech_duration: f64 = segments.iter().map(|s| s.duration).sum();
    let silence_ratio = if total_audio_duration > 0.0 {
        (total_audio_duration - total_speech_duration) / total_audio_duration
    } else {
        0.0
    };
    
    Ok(AudioPreprocessingResult {
        speech_segments: segments,
        total_speech_duration,
        total_audio_duration,
        silence_ratio,
    })
}

async fn detect_speech_with_ffmpeg(audio_path: &Path) -> Result<Vec<SpeechSegment>, String> {
    use std::process::Stdio;
    use tokio::process::Command;
    
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-i")
        .arg(audio_path)
        .arg("-af")
        .arg("silencedetect=noise=-30dB:d=0.5")
        .arg("-f")
        .arg("null")
        .arg("-")
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    
    let output = cmd.output().await
        .map_err(|e| format!("Ошибка FFmpeg при анализе аудио: {}", e))?;
    
    if !output.status.success() {
        return Err("FFmpeg завершился с ошибкой".to_string());
    }
    
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_silence_detection_output(&stderr)
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
    
    let output = cmd.output().await
        .map_err(|e| format!("Ошибка ffprobe: {}", e))?;
    
    if output.status.success() {
        let duration_str = String::from_utf8_lossy(&output.stdout);
        duration_str.trim().parse::<f64>()
            .map_err(|e| format!("Ошибка парсинга длительности: {}", e))
    } else {
        Err("Не удалось получить длительность аудио".to_string())
    }
}

fn parse_silence_detection_output(stderr: &str) -> Result<Vec<SpeechSegment>, String> {
    let mut silence_starts = Vec::new();
    let mut silence_ends = Vec::new();
    
    for line in stderr.lines() {
        if line.contains("silence_start") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(time_str) = parts.last() {
                if let Ok(time) = time_str.parse::<f64>() {
                    silence_starts.push(time);
                }
            }
        } else if line.contains("silence_end") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            for (i, part) in parts.iter().enumerate() {
                if *part == "silence_end:" && i + 1 < parts.len() {
                    if let Ok(time) = parts[i + 1].parse::<f64>() {
                        silence_ends.push(time);
                        break;
                    }
                }
            }
        }
    }
    
    let mut speech_segments = Vec::new();
    let mut current_start = 0.0;
    
    for (i, &silence_start) in silence_starts.iter().enumerate() {
        if silence_start > current_start {
            let speech_end = silence_start;
            speech_segments.push(SpeechSegment {
                start_time: current_start,
                end_time: speech_end,
                duration: speech_end - current_start,
            });
        }
        
        if i < silence_ends.len() {
            current_start = silence_ends[i];
        }
    }
    
    let audio_duration = 3600.0; 
    if current_start < audio_duration {
        speech_segments.push(SpeechSegment {
            start_time: current_start,
            end_time: audio_duration,
            duration: audio_duration - current_start,
        });
    }
    
    speech_segments.retain(|s| s.duration >= 0.5);
    
    Ok(speech_segments)
}