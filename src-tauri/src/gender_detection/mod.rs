use std::path::Path;
use std::process::Stdio;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};

use crate::commands::ai_cancel::{self, SidecarPidGuard};

use crate::project::{SpeakerGender, SubtitleSegment};

/// Точные границы субтитра (без расширения — иначе в клип попадает соседняя реплика).
fn exact_clip_range(seg_start: f64, seg_end: f64, audio_duration: f64) -> (f64, f64) {
    let start = seg_start.max(0.0);
    let end = if audio_duration > 0.0 {
        seg_end.min(audio_duration)
    } else {
        seg_end
    };
    (start, end.max(start + 0.001))
}

// пол по репликам через python sidecar (один запрос = один субтитр, его start/end)
pub async fn assign_speaker_genders(
    audio_path: &Path,
    segments: &mut [SubtitleSegment],
) -> Result<(), String> {
    if segments.is_empty() {
        return Ok(());
    }

    let paths = crate::ml_sidecar::resolve_script("classify.py")?;
    println!(
        "[gender] sidecar python={:?} script={:?}",
        paths.python_exe, paths.script_path
    );
    println!("[gender] режим: ровно тайминги субтитра на реплику, без расширения клипа");

    let mut child = Command::new(&paths.python_exe)
        .arg(&paths.script_path)
        .current_dir(&paths.work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .spawn()
        .map_err(|e| format!("Не удалось запустить gender sidecar: {}", e))?;

    let _pid_guard = SidecarPidGuard::new(&child);

    let mut stdin = child.stdin.take().ok_or("нет stdin у sidecar")?;
    let stdout = child.stdout.take().ok_or("нет stdout у sidecar")?;
    let stderr = child.stderr.take().ok_or("нет stderr у sidecar")?;

    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.is_empty() {
                eprintln!("[gender-py-stderr] {}", line);
            }
        }
    });

    let mut reader = BufReader::new(stdout).lines();

    let init_cmd = json!({
        "cmd": "init",
        "audio_path": audio_path.to_string_lossy(),
    });
    send_cmd(&mut stdin, init_cmd).await?;

    let mut audio_duration = 0.0_f64;
    let t_init = std::time::Instant::now();
    loop {
        ai_cancel::check_ai_operation_cancelled()?;
        let line = ai_cancel::read_sidecar_line(&mut reader, &mut child).await?;
        let event = match parse_event(&line) {
            Some(v) => v,
            None => continue,
        };
        match event.get("type").and_then(|x| x.as_str()) {
            Some("log") => {
                if let Some(msg) = event.get("msg").and_then(|x| x.as_str()) {
                    println!("[gender-py] {}", msg);
                }
            }
            Some("ready") => {
                audio_duration = event
                    .get("duration")
                    .and_then(|x| x.as_f64())
                    .unwrap_or(0.0);
                let device = event
                    .get("device")
                    .and_then(|x| x.as_str())
                    .unwrap_or("?");
                println!(
                    "[gender] sidecar готов за {:.2}s, audio_duration={:.3}s, device={}",
                    t_init.elapsed().as_secs_f32(),
                    audio_duration,
                    device,
                );
                break;
            }
            Some("error") => {
                let err = event
                    .get("error")
                    .and_then(|x| x.as_str())
                    .unwrap_or("неизвестная ошибка");
                let _ = child.kill().await;
                return Err(format!("sidecar init error: {}", err));
            }
            _ => {}
        }
    }

    if audio_duration <= 0.0 {
        audio_duration = segments.iter().map(|s| s.end).fold(0.0_f64, f64::max);
    }

    let total = segments.len();
    let t_classify = std::time::Instant::now();
    let mut male = 0usize;
    let mut female = 0usize;
    let mut unknown = 0usize;
    let mut total_inf_ms = 0.0f64;

    for seg in segments.iter_mut() {
        ai_cancel::check_ai_operation_cancelled()?;
        let (clip_start, clip_end) = exact_clip_range(seg.start, seg.end, audio_duration);
        let req = json!({
            "cmd": "classify",
            "id": seg.id,
            "start": clip_start,
            "end": clip_end,
        });
        send_cmd(&mut stdin, req).await?;

        loop {
            ai_cancel::check_ai_operation_cancelled()?;
            let line = ai_cancel::read_sidecar_line(&mut reader, &mut child).await?;
            let event = match parse_event(&line) {
                Some(v) => v,
                None => continue,
            };
            match event.get("type").and_then(|x| x.as_str()) {
                Some("log") => {
                    if let Some(msg) = event.get("msg").and_then(|x| x.as_str()) {
                        println!("[gender-py] {}", msg);
                    }
                }
                Some("result") => {
                    let gender_str = event
                        .get("gender")
                        .and_then(|x| x.as_str())
                        .unwrap_or("unknown");
                    let scores = event.get("scores").cloned().unwrap_or(json!({}));
                    let duration_ms = event
                        .get("duration_ms")
                        .and_then(|x| x.as_f64())
                        .unwrap_or(0.0);
                    let reason = event.get("reason").and_then(|x| x.as_str()).unwrap_or("");
                    total_inf_ms += duration_ms;

                    let g = match gender_str {
                        "male" => SpeakerGender::Male,
                        "female" => SpeakerGender::Female,
                        _ => SpeakerGender::Unknown,
                    };
                    seg.speaker_gender = Some(g);
                    match g {
                        SpeakerGender::Male => male += 1,
                        SpeakerGender::Female => female += 1,
                        SpeakerGender::Unknown => unknown += 1,
                    }

                    let reason_part = if reason.is_empty() {
                        String::new()
                    } else {
                        format!(" ({})", reason)
                    };
                    println!(
                        "[gender] #{} clip {:.3}-{:.3} -> {} scores={} inf={:.1}ms{}",
                        seg.id, clip_start, clip_end, gender_str, scores, duration_ms, reason_part,
                    );
                    break;
                }
                Some("error") => {
                    let err = event
                        .get("error")
                        .and_then(|x| x.as_str())
                        .unwrap_or("неизвестная ошибка");
                    eprintln!("[gender] error для #{}: {}", seg.id, err);
                    seg.speaker_gender = Some(SpeakerGender::Unknown);
                    unknown += 1;
                    break;
                }
                _ => {}
            }
        }
    }

    let _ = send_cmd(&mut stdin, json!({"cmd": "quit"})).await;
    drop(stdin);
    let _ = child.wait().await;

    let avg = if total > 0 {
        total_inf_ms / total as f64
    } else {
        0.0
    };
    println!(
        "[gender] обработано {} сегментов за {:.2}s (avg inf {:.1}ms/seg; male={} female={} unknown={})",
        total,
        t_classify.elapsed().as_secs_f32(),
        avg,
        male,
        female,
        unknown,
    );

    Ok(())
}

fn parse_event(line: &str) -> Option<Value> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    match serde_json::from_str::<Value>(trimmed) {
        Ok(v) => Some(v),
        Err(_) => {
            eprintln!("[gender-py-raw] {}", trimmed);
            None
        }
    }
}

async fn send_cmd(stdin: &mut ChildStdin, value: Value) -> Result<(), String> {
    let line = value.to_string() + "\n";
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("Ошибка записи в sidecar: {}", e))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Ошибка flush sidecar: {}", e))?;
    Ok(())
}
