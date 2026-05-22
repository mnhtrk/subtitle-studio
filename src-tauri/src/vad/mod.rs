use std::path::Path;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{ChildStdin, ChildStdout, Command};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SpeechSegment {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct VadParams {
    pub speech_pad_ms: u32,
    pub min_silence_duration_ms: u32,
    pub min_speech_duration_ms: u32,
    pub threshold: f32,
}

impl Default for VadParams {
    // threshold ниже = раньше старт речи; speech_pad и min_silence — запас по краям и меньше ранних обрывов
    fn default() -> Self {
        Self {
            speech_pad_ms: 400,
            min_silence_duration_ms: 1200,
            min_speech_duration_ms: 250,
            threshold: 0.25,
        }
    }
}

/// Склеивает соседние VAD-куски, если пауза между ними короче max_gap_sec (речь в паузе не теряется).
pub fn merge_nearby_speech_segments(
    segments: &[SpeechSegment],
    max_gap_sec: f64,
) -> Vec<SpeechSegment> {
    if segments.is_empty() {
        return Vec::new();
    }
    let mut sorted: Vec<SpeechSegment> = segments.to_vec();
    sorted.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));

    let mut out: Vec<SpeechSegment> = Vec::with_capacity(sorted.len());
    out.push(sorted[0]);
    for seg in sorted.into_iter().skip(1) {
        let last = out.last_mut().expect("out non-empty");
        if seg.start - last.end <= max_gap_sec {
            last.end = last.end.max(seg.end);
        } else {
            out.push(seg);
        }
    }
    out
}

/// Запас до/после Silero без пересечения соседних кусков (иначе Whisper дублирует начало реплики).
pub fn expand_speech_margins(
    segments: &[SpeechSegment],
    pre_sec: f64,
    post_sec: f64,
    min_gap_sec: f64,
) -> Vec<SpeechSegment> {
    if segments.is_empty() {
        return Vec::new();
    }
    let n = segments.len();
    let mut out: Vec<SpeechSegment> = Vec::with_capacity(n);
    for i in 0..n {
        let s = segments[i];
        let mut start = (s.start - pre_sec).max(0.0);
        if i > 0 {
            start = start.max(out[i - 1].end + min_gap_sec);
        }
        let mut end = s.end + post_sec;
        if i + 1 < n {
            let cap = segments[i + 1].start - min_gap_sec;
            if cap > s.end {
                end = end.min(cap);
            } else {
                end = s.end.max(start + 0.05);
            }
        }
        end = end.max(start + 0.05);
        out.push(SpeechSegment { start, end });
    }
    out
}

/// Логирует пересечения диапазонов, уходящих в Whisper (должно быть пусто после expand_speech_margins).
pub fn log_vad_whisper_overlap(segments: &[SpeechSegment]) {
    for w in segments.windows(2) {
        let overlap = w[0].end - w[1].start;
        if overlap > 0.001 {
            eprintln!(
                "[vad] ПЕРЕСЕЧЕНИЕ кусков Whisper: [{:.3}..{:.3}] и [{:.3}..{:.3}] overlap {:.3}s",
                w[0].start, w[0].end, w[1].start, w[1].end, overlap
            );
        }
    }
}

pub async fn detect_speech_segments(
    audio_path: &Path,
    params: VadParams,
) -> Result<Vec<SpeechSegment>, String> {
    let paths = crate::ml_sidecar::resolve_script("vad.py")?;
    println!(
        "[vad] sidecar python={:?} script={:?}",
        paths.python_exe, paths.script_path
    );

    let mut child = Command::new(&paths.python_exe)
        .arg(&paths.script_path)
        .current_dir(&paths.work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .spawn()
        .map_err(|e| format!("Не удалось запустить VAD sidecar: {}", e))?;

    let mut stdin = child.stdin.take().ok_or("нет stdin у VAD sidecar")?;
    let stdout = child.stdout.take().ok_or("нет stdout у VAD sidecar")?;
    let stderr = child.stderr.take().ok_or("нет stderr у VAD sidecar")?;

    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.is_empty() {
                eprintln!("[vad-py-stderr] {}", line);
            }
        }
    });

    let mut reader = BufReader::new(stdout).lines();

    // ждем пока silero подгрузится
    let t_init = std::time::Instant::now();
    loop {
        let line = read_line(&mut reader).await?;
        let event = match parse_event(&line) {
            Some(v) => v,
            None => continue,
        };
        match event.get("type").and_then(|x| x.as_str()) {
            Some("log") => {
                if let Some(msg) = event.get("msg").and_then(|x| x.as_str()) {
                    println!("[vad-py] {}", msg);
                }
            }
            Some("ready") => {
                println!(
                    "[vad] sidecar готов за {:.2}s",
                    t_init.elapsed().as_secs_f32(),
                );
                break;
            }
            Some("error") => {
                let err = event
                    .get("error")
                    .and_then(|x| x.as_str())
                    .unwrap_or("неизвестная ошибка");
                let _ = child.kill().await;
                return Err(format!("VAD sidecar init error: {}", err));
            }
            _ => {}
        }
    }

    let req = json!({
        "cmd": "detect",
        "audio_path": audio_path.to_string_lossy(),
        "speech_pad_ms": params.speech_pad_ms,
        "min_silence_duration_ms": params.min_silence_duration_ms,
        "min_speech_duration_ms": params.min_speech_duration_ms,
        "threshold": params.threshold,
    });
    send_cmd(&mut stdin, req).await?;

    let t_detect = std::time::Instant::now();
    let segments: Vec<SpeechSegment>;
    loop {
        let line = read_line(&mut reader).await?;
        let event = match parse_event(&line) {
            Some(v) => v,
            None => continue,
        };
        match event.get("type").and_then(|x| x.as_str()) {
            Some("log") => {
                if let Some(msg) = event.get("msg").and_then(|x| x.as_str()) {
                    println!("[vad-py] {}", msg);
                }
            }
            Some("result") => {
                let arr = event.get("segments").and_then(|x| x.as_array());
                let mut parsed: Vec<SpeechSegment> = Vec::new();
                if let Some(arr) = arr {
                    for item in arr {
                        let s = item.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let e = item.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        if e > s {
                            parsed.push(SpeechSegment { start: s, end: e });
                        }
                    }
                }
                let total: f64 = parsed.iter().map(|s| s.end - s.start).sum();
                let dur = event
                    .get("duration_sec")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                println!(
                    "[vad] получено {} сегментов, речь {:.2}s/{:.2}s ({:.1}%) за {:.2}s",
                    parsed.len(),
                    total,
                    dur,
                    if dur > 0.0 { total / dur * 100.0 } else { 0.0 },
                    t_detect.elapsed().as_secs_f32(),
                );
                segments = parsed;
                break;
            }
            Some("error") => {
                let err = event
                    .get("error")
                    .and_then(|x| x.as_str())
                    .unwrap_or("неизвестная ошибка");
                let _ = child.kill().await;
                return Err(format!("VAD detect error: {}", err));
            }
            _ => {}
        }
    }

    let _ = send_cmd(&mut stdin, json!({"cmd": "quit"})).await;
    drop(stdin);
    let _ = child.wait().await;

    log_speech_segments(&segments);

    Ok(segments)
}

pub fn format_timestamp_hms(seconds: f64) -> String {
    let total = seconds.max(0.0).floor() as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    format!("{:02}:{:02}:{:02}", h, m, s)
}

pub fn log_speech_segments(segments: &[SpeechSegment]) {
    if segments.is_empty() {
        println!("[vad] куски с речью (Silero): не найдено");
        return;
    }
    let total_speech: f64 = segments.iter().map(|s| s.end - s.start).sum();
    println!(
        "[vad] куски с речью (Silero), {} шт., суммарно {}:",
        segments.len(),
        format_timestamp_hms(total_speech),
    );
    for (i, seg) in segments.iter().enumerate() {
        println!(
            "  кусок с речью {} [{} - {}]",
            i + 1,
            format_timestamp_hms(seg.start),
            format_timestamp_hms(seg.end),
        );
    }
}

fn parse_event(line: &str) -> Option<Value> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    match serde_json::from_str::<Value>(trimmed) {
        Ok(v) => Some(v),
        Err(_) => {
            eprintln!("[vad-py-raw] {}", trimmed);
            None
        }
    }
}

async fn send_cmd(stdin: &mut ChildStdin, value: Value) -> Result<(), String> {
    let line = value.to_string() + "\n";
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("Ошибка записи в VAD sidecar: {}", e))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Ошибка flush VAD sidecar: {}", e))?;
    Ok(())
}

async fn read_line(reader: &mut Lines<BufReader<ChildStdout>>) -> Result<String, String> {
    reader
        .next_line()
        .await
        .map_err(|e| format!("Ошибка чтения VAD sidecar: {}", e))?
        .ok_or_else(|| "VAD sidecar закрылся неожиданно".to_string())
}

pub async fn extract_segment_audio(
    source: &Path,
    output: &Path,
    start_seconds: f64,
    duration_seconds: f64,
) -> Result<(), String> {
    use std::process::Stdio;
    use tokio::process::Command;

    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let status = Command::new("ffmpeg")
        .arg("-y")
        .arg("-loglevel")
        .arg("error")
        .arg("-ss")
        .arg(format!("{:.3}", start_seconds.max(0.0)))
        .arg("-t")
        .arg(format!("{:.3}", duration_seconds.max(0.05)))
        .arg("-i")
        .arg(source)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-acodec")
        .arg("libmp3lame")
        .arg("-b:a")
        .arg("64k")
        .arg(output)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()
        .await
        .map_err(|e| format!("ffmpeg extract: {}", e))?;

    if status.success() && output.exists() {
        Ok(())
    } else {
        Err(format!(
            "ffmpeg не вырезал фрагмент [{:.3}..{:.3}]",
            start_seconds,
            start_seconds + duration_seconds
        ))
    }
}
