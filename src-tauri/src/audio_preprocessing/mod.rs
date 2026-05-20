use std::path::Path;
use serde::{Deserialize, Serialize};
use webrtc_vad::{SampleRate, Vad, VadMode};
use crate::commands::audio::media_duration_seconds;

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

const FRAME_SAMPLES: usize = 480;
const SAMPLE_RATE: f64 = 16_000.0;
const MERGE_GAP_SEC: f64 = 0.35;
const MIN_SEGMENT_SEC: f64 = 0.25;

/// Вырезка для Whisper: секунда 0 в mp3 = `speech_start` в полном аудио (голубой offset на схеме).
/// Без padding — иначе красные метки Whisper не совпадают с голубым таймлайном.
pub fn whisper_extract_range(
    speech_start: f64,
    speech_end: f64,
    total_duration: f64,
) -> (f64, f64) {
    let extract_start = speech_start.max(0.0);
    let extract_end = speech_end.min(total_duration).max(extract_start + 0.05);
    (extract_start, extract_end)
}

pub async fn detect_speech_segments(audio_path: &Path) -> Result<AudioPreprocessingResult, String> {
    let total_audio_duration = media_duration_seconds(audio_path).await?;
    let pcm_samples = decode_pcm_16k_mono(audio_path).await?;
    let raw_segments = detect_speech_with_vad(&pcm_samples, total_audio_duration)?;
    let speech_segments = finalize_segments(raw_segments, total_audio_duration);

    let total_speech_duration: f64 = speech_segments.iter().map(|s| s.duration).sum();
    let silence_ratio = if total_audio_duration > 0.0 {
        (total_audio_duration - total_speech_duration) / total_audio_duration
    } else {
        0.0
    };

    println!(
        "[vad] речь: {} сегм., {:.1}s / {:.1}s аудио (тишина/не-речь {:.0}%)",
        speech_segments.len(),
        total_speech_duration,
        total_audio_duration,
        silence_ratio * 100.0
    );

    Ok(AudioPreprocessingResult {
        speech_segments,
        total_speech_duration,
        total_audio_duration,
        silence_ratio,
    })
}

pub async fn decode_pcm_16k_mono(audio_path: &Path) -> Result<Vec<i16>, String> {
    use std::process::Stdio;
    use tokio::io::AsyncReadExt;
    use tokio::process::Command;

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-i")
        .arg(audio_path)
        .arg("-vn")
        .arg("-acodec")
        .arg("pcm_s16le")
        .arg("-f")
        .arg("s16le")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Ошибка запуска FFmpeg для VAD: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "FFmpeg не вернул stdout".to_string())?;

    let mut reader = tokio::io::BufReader::new(stdout);
    let mut audio_data = Vec::new();
    let mut buffer = [0u8; 8192];

    while let Ok(n) = reader.read(&mut buffer).await {
        if n == 0 {
            break;
        }
        audio_data.extend_from_slice(&buffer[..n]);
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Ошибка ожидания FFmpeg: {}", e))?;

    if !status.success() {
        return Err(
            "FFmpeg: не удалось декодировать аудио для VAD (проверьте кодек и наличие ffmpeg)"
                .to_string(),
        );
    }

    let samples: Vec<i16> = audio_data
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();

    if samples.is_empty() {
        return Err("Декодированное аудио пустое".to_string());
    }

    Ok(samples)
}

fn detect_speech_with_vad(
    samples: &[i16],
    total_duration: f64,
) -> Result<Vec<(f64, f64)>, String> {
    let mut vad = Vad::new_with_rate_and_mode(SampleRate::Rate16kHz, VadMode::Quality);

    let frame_duration_sec = FRAME_SAMPLES as f64 / SAMPLE_RATE;
    let mut intervals: Vec<(f64, f64)> = Vec::new();
    let mut voice_start: Option<f64> = None;
    let mut frame_index = 0usize;

    let mut frame_buffer = vec![0i16; FRAME_SAMPLES];

    for chunk in samples.chunks(FRAME_SAMPLES) {
        let frame_start = frame_index as f64 * frame_duration_sec;

        frame_buffer.fill(0);
        frame_buffer[..chunk.len()].copy_from_slice(chunk);

        let is_voice = vad
            .is_voice_segment(&frame_buffer)
            .map_err(|_| "Некорректная длина кадра WebRTC VAD".to_string())?;

        if is_voice {
            if voice_start.is_none() {
                voice_start = Some(frame_start);
            }
        } else if let Some(start) = voice_start.take() {
            let end = frame_start + frame_duration_sec;
            if end > start {
                intervals.push((start, end));
            }
        }

        frame_index += 1;
    }

    if let Some(start) = voice_start.take() {
        let end = total_duration.max(frame_index as f64 * frame_duration_sec);
        if end > start {
            intervals.push((start, end));
        }
    }

    Ok(intervals)
}

fn finalize_segments(mut intervals: Vec<(f64, f64)>, total_duration: f64) -> Vec<SpeechSegment> {
    if intervals.is_empty() {
        return Vec::new();
    }

    intervals.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    let mut merged: Vec<(f64, f64)> = Vec::new();
    for (start, end) in intervals {
        if let Some(last) = merged.last_mut() {
            if start <= last.1 + MERGE_GAP_SEC {
                last.1 = last.1.max(end);
                continue;
            }
        }
        merged.push((start, end));
    }

    merged
        .into_iter()
        .map(|(start, end)| {
            let end = end.min(total_duration);
            let start = start.min(end);
            let duration = (end - start).max(0.0);
            SpeechSegment {
                start_time: start,
                end_time: end,
                duration,
            }
        })
        .filter(|s| s.duration >= MIN_SEGMENT_SEC)
        .collect()
}

/// Порог тишины для ffmpeg silencedetect (не WebRTC VAD).
const SILENCE_NOISE_DB: &str = "-35dB";
/// Минимальная длительность тишины, чтобы вырезать (сек).
const SILENCE_MIN_DURATION_SEC: f64 = 0.45;
/// Минимальная длина участка с речью для отправки в Whisper.
const MIN_NON_SILENT_SEC: f64 = 0.35;

/// Участки аудио без длинной тишины — для транскрипции (таймкоды в исходной шкале).
pub async fn detect_non_silent_intervals(
    audio_path: &Path,
    total_duration: f64,
) -> Result<Vec<(f64, f64)>, String> {
    if total_duration <= 0.05 {
        return Ok(Vec::new());
    }

    let silence = run_ffmpeg_silencedetect(audio_path).await?;
    let audible = invert_silence_to_audible(&silence, total_duration);

    println!(
        "[silence] дорожка {:.1} с: {} интервал(ов) тишины, {} участк(ов) с речью",
        total_duration,
        silence.len(),
        audible.len()
    );
    for (i, (s, e)) in audible.iter().enumerate() {
        println!(
            "[silence]   речь {}: {:.2}–{:.2} с ({:.2} с)",
            i + 1,
            s,
            e,
            e - s
        );
    }

    Ok(audible)
}

async fn run_ffmpeg_silencedetect(audio_path: &Path) -> Result<Vec<(f64, f64)>, String> {
    use std::process::Stdio;
    use tokio::process::Command;

    let filter = format!(
        "silencedetect=noise={}:d={}",
        SILENCE_NOISE_DB, SILENCE_MIN_DURATION_SEC
    );

    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-i",
            audio_path.to_str().ok_or("Некорректный путь к аудио")?,
            "-af",
            &filter,
            "-f",
            "null",
            "-",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("ffmpeg silencedetect: {}", e))?;

    if !output.status.success() && output.stderr.is_empty() {
        return Err("ffmpeg silencedetect завершился с ошибкой".to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(parse_silence_intervals(&stderr))
}

fn parse_silence_intervals(stderr: &str) -> Vec<(f64, f64)> {
    let mut intervals = Vec::new();
    let mut pending_start: Option<f64> = None;

    for line in stderr.lines() {
        if let Some(rest) = line.trim().strip_prefix("silence_start:") {
            if let Ok(t) = rest.trim().parse::<f64>() {
                pending_start = Some(t);
            }
        } else if let Some(rest) = line.trim().strip_prefix("silence_end:") {
            let parts: Vec<&str> = rest.split('|').collect();
            if let Ok(end) = parts[0].trim().parse::<f64>() {
                if let Some(start) = pending_start.take() {
                    if end > start {
                        intervals.push((start, end));
                    }
                }
            }
        }
    }

    intervals.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    intervals
}

fn invert_silence_to_audible(silence: &[(f64, f64)], total_duration: f64) -> Vec<(f64, f64)> {
    let mut audible = Vec::new();
    let mut cursor = 0.0_f64;

    for &(s_start, s_end) in silence {
        if s_start > cursor + MIN_NON_SILENT_SEC {
            audible.push((cursor, s_start.min(total_duration)));
        }
        cursor = s_end.max(cursor);
    }

    if cursor < total_duration - MIN_NON_SILENT_SEC {
        audible.push((cursor, total_duration));
    }

    audible
        .into_iter()
        .filter(|(s, e)| *e - *s >= MIN_NON_SILENT_SEC)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finalize_merges_close_segments() {
        let segments = finalize_segments(vec![(0.0, 1.0), (1.2, 2.0)], 10.0);
        assert_eq!(segments.len(), 1);
        assert!(segments[0].start_time <= 0.0);
        assert!(segments[0].end_time >= 2.0);
    }

    #[test]
    fn invert_silence_finds_gaps() {
        let silence = vec![(2.0, 5.0), (10.0, 12.0)];
        let audible = invert_silence_to_audible(&silence, 20.0);
        assert_eq!(audible.len(), 3);
        assert!((audible[0].0 - 0.0).abs() < 0.01);
        assert!((audible[0].1 - 2.0).abs() < 0.01);
        assert!((audible[1].0 - 5.0).abs() < 0.01);
        assert!((audible[1].1 - 10.0).abs() < 0.01);
    }
}
