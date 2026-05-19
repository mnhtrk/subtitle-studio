use serde::{Deserialize, Serialize};
use crate::project::{SubtitleSegment, GlossaryEntry};
use keyring::Entry;
use crate::project::glossary::apply_glossary;
use tokio::sync::mpsc;
use tauri::Emitter;
use std::collections::{HashMap};
use std::path::Path;
use crate::postprocessing;
use crate::audio_preprocessing;
use crate::audio_preprocessing::SpeechSegment;
use crate::gender_detection;

const DEBUG_LOG_MAX_CHARS: usize = 24_000;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiKeyValidation {
    pub is_valid: bool,
    pub error_message: Option<String>,
    pub model_access: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AutoGlossaryOptions {
    pub min_frequency: u32,
    pub max_terms: u32,
    pub target_language: String,
    #[serde(default, alias = "contextPrompt")]
    pub context_prompt: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GlossaryTerm {
    pub source: String,
    pub target: String,
    pub frequency: u32,
    pub confidence: f64,
    pub category: Option<String>,
}

#[tauri::command]
pub async fn validate_api_key(key: String) -> Result<ApiKeyValidation, String> {
    if key.trim().is_empty() {
        return Ok(ApiKeyValidation {
            is_valid: false,
            error_message: Some("API ключ не может быть пустым".to_string()),
            model_access: vec![],
        });
    }
    
    if !key.starts_with("sk-") && !key.starts_with("sk-proj-") {
        return Ok(ApiKeyValidation {
            is_valid: false,
            error_message: Some("Неверный формат API ключа. Ключ должен начинаться с 'sk-'".to_string()),
            model_access: vec![],
        });
    }
    
    // Проверяем api ключ
    let client = reqwest::Client::new();
    let res = client
        .get("https://api.openai.com/v1/models")
        .bearer_auth(&key)
        .send()
        .await;
    
    match res {
        Ok(response) => {
            if response.status().is_success() {
                // Получаем список доступных моделей
                let models: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
                let available_models: Vec<String> = models["data"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|model| model["id"].as_str())
                    .map(|s| s.to_string())
                    .collect();
                
                let required_models = ["whisper-1", "gpt-5.4-mini"];
                let has_required = required_models.iter().all(|model| {
                    available_models.iter().any(|m| m.contains(model))
                });
                
                if has_required {
                    Ok(ApiKeyValidation {
                        is_valid: true,
                        error_message: None,
                        model_access: available_models,
                    })
                } else {
                    Ok(ApiKeyValidation {
                        is_valid: false,
                        error_message: Some("Ключ действителен, но недоступны необходимые модели (whisper-1, gpt-5.4-mini)".to_string()),
                        model_access: available_models,
                    })
                }
            } else {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_else(|_| "Неизвестная ошибка".to_string());
                Ok(ApiKeyValidation {
                    is_valid: false,
                    error_message: Some(format!("OpenAI ошибка ({}): {}", status, error_text)),
                    model_access: vec![],
                })
            }
        }
        Err(err) => {
            Ok(ApiKeyValidation {
                is_valid: false,
                error_message: Some(format!("Ошибка подключения к OpenAI: {}", err)),
                model_access: vec![],
            })
        }
    }
}

fn log_debug_block(title: &str, body: &str) {
    let count = body.chars().count();
    let shown: String = body.chars().take(DEBUG_LOG_MAX_CHARS).collect();
    println!("\n========== {title} ==========");
    println!("{shown}");
    if count > DEBUG_LOG_MAX_CHARS {
        println!(
            "[… усечено вывода: показано ~{DEBUG_LOG_MAX_CHARS} символов из {count}]"
        );
    }
}

#[tauri::command]
pub async fn save_api_key(key: String) -> Result<(), String> {
    let validation = validate_api_key(key.clone()).await?;
    
    if !validation.is_valid {
        return Err(validation.error_message.unwrap_or("Неизвестная ошибка валидации".to_string()));
    }
    
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Ошибка инициализации хранилища: {}", e))?;
    
    entry.set_password(&key)
        .map_err(|e| format!("Ошибка сохранения ключа: {}", e))?;
    
    println!("🔑 API ключ сохранён в системном хранилище");
    Ok(())
}

#[tauri::command]
pub async fn get_api_key_status() -> Result<bool, String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| e.to_string())?;
    
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

fn get_api_key() -> Result<String, String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| e.to_string())?;
    
    entry.get_password()
        .map_err(|e| format!("Ключ не найден или ошибка доступа: {}", e))
}

#[tauri::command]
pub async fn transcribe_audio(
    file_path: String,
    language: Option<String>,
    prompt: Option<String>,
    glossary: Option<Vec<GlossaryEntry>>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<SubtitleSegment>, String> {
    println!("📝 Транскрибация файла: {}", file_path);
    
    let file_path_buf = Path::new(&file_path);

    let glossary_entries = glossary.unwrap_or_default();
    let mut glossary_originals: Vec<String> = Vec::new();
    for entry in &glossary_entries {
        let source = entry.source.trim();
        if source.is_empty() {
            continue;
        }
        if !glossary_originals
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(source))
        {
            glossary_originals.push(source.to_string());
        }
    }

    let base_prompt = prompt
        .as_ref()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .map(|p| p.to_string());
    let base_prompt_lower = base_prompt
        .as_deref()
        .unwrap_or("")
        .to_lowercase();
    let missing_glossary_originals: Vec<String> = glossary_originals
        .into_iter()
        .filter(|source| !base_prompt_lower.contains(&source.to_lowercase()))
        .collect();
    let glossary_prompt = if missing_glossary_originals.is_empty() {
        None
    } else {
        Some(format!(
            "Important names/terms to keep exactly:\n{}",
            missing_glossary_originals.join(", ")
        ))
    };
    let whisper_prompt: Option<String> = match (base_prompt.clone(), glossary_prompt) {
        (Some(base), Some(glossary_block)) => Some(format!("{}\n\n{}", base, glossary_block)),
        (Some(base), None) => Some(base),
        (None, Some(glossary_block)) => Some(glossary_block),
        (None, None) => None,
    };

    // Получаем API-ключ
    let api_key = get_api_key()?;
    
    // Создаём канал для отправки прогресса
    let (progress_tx, mut progress_rx) = mpsc::channel::<ProgressEvent>(10);
    
    // Клонируем app_handle для отправки событий
    let app_handle_clone = app_handle.clone();
    let operation_id = format!("transcribe_{}", uuid::Uuid::new_v4());
    
    // Запускаем отправку прогресса в фоне
    tokio::spawn(async move {
        while let Some(event) = progress_rx.recv().await {
            let _ = app_handle_clone.emit("ai_progress", ProgressPayload {
                operation_id: operation_id.clone(),
                event,
            });
        }
    });
    
    // Отправляем начальное событие
    let _ = progress_tx.send(ProgressEvent::Started { 
        total_steps: 5, 
        description: "Анализ аудио".to_string() 
    }).await;

    // Анализируем аудио для обнаружения сегментов с речью
    let _ = progress_tx.send(ProgressEvent::InProgress { 
        step: 1, 
        progress: 0.2, 
        description: "Обнаружение речи в аудио".to_string() 
    }).await;
    
    let preprocessing_result = audio_preprocessing::detect_speech_segments(file_path_buf)
        .await?;
    
    println!(
        "🎧 Обнаружено {} VAD-сегментов с речью",
        preprocessing_result.speech_segments.len()
    );

    if let Some(ref p) = whisper_prompt {
        let chars = p.chars().count();
        let preview: String = p.chars().take(240).collect();
        println!(
            "[whisper] prompt для API ({} симв.): {}{}",
            chars,
            preview,
            if chars > 240 { "…" } else { "" }
        );
    } else {
        println!("[whisper] prompt для API: (нет)");
    }
    println!(
        "[whisper] язык: {}",
        language.as_deref().unwrap_or("en (по умолчанию)")
    );
    
    if preprocessing_result.speech_segments.is_empty() {
        return Err("В аудио не обнаружено речи (WebRTC VAD)".to_string());
    }

    let segments = transcribe_segmented_audio(
        file_path_buf,
        &preprocessing_result.speech_segments,
        &language,
        whisper_prompt.as_deref(),
        &api_key,
        &progress_tx,
    )
    .await?;

    let language_for_postprocessing = language.clone();

    // Постобработка транскрибации
    let _ = progress_tx.send(ProgressEvent::InProgress { 
        step: 4, 
        progress: 0.8, 
        description: "Постобработка результата".to_string() 
    }).await;
    
    println!(
        "[postprocess] GPT-коррекция {} сегмент(ов), язык={}",
        segments.len(),
        language_for_postprocessing.as_deref().unwrap_or("en")
    );
    let postprocessed_result = postprocessing::postprocess_transcription(
        segments,
        postprocessing::PostProcessingOptions {
            fix_punctuation: true,
            fix_names: true,
            target_language: language_for_postprocessing.unwrap_or_else(|| "en".to_string()),
            style_prompt: Some("Профессиональные субтитры для видео".to_string()),
            name_hints: whisper_prompt,
            glossary: glossary_entries,
        },
        &api_key,
    ).await?;

    let mut final_segments = stitch_subtitle_timeline(postprocessed_result.corrected_segments);

    let _ = progress_tx
        .send(ProgressEvent::InProgress {
            step: 4,
            progress: 0.78,
            description: "Определение пола говорящего".to_string(),
        })
        .await;
    println!(
        "[gender] определение пола для {} сегмент(ов)…",
        final_segments.len()
    );
    gender_detection::assign_speaker_genders(file_path_buf, &mut final_segments).await?;
    println!("[gender] готово");

    // Автоматическая генерация глоссария
    let _auto_glossary = if final_segments.len() > 5 {
        match auto_generate_glossary_from_segments(&final_segments, "ru", &api_key).await {
            Ok(glossary) => {
                println!("✅ Автоматический глоссарий создан: {} терминов", glossary.len());
                Some(glossary)
            }
            Err(e) => {
                println!("⚠️ Ошибка генерации глоссария: {}", e);
                None
            }
        }
    } else {
        None
    };
    
    // Отправляем завершение
    let _ = progress_tx.send(ProgressEvent::Completed { 
        result_count: final_segments.len() 
    }).await;
    
    println!("✅ Транскрибация завершена: {} сегментов", final_segments.len());
    Ok(final_segments)
}

/// Максимальная длина одного запроса Whisper (короче = быстрее ответ, меньше риск таймаута/OOM)
const WHISPER_CHUNK_MAX_SEC: f64 = 180.0;
/// Не склеивать VAD-интервалы, если между ними больше этой паузы (тишина в вырезке ломает тайминг)
const WHISPER_MERGE_MAX_GAP_SEC: f64 = 0.5;

/// Склеиваем только соседние куски речи без длинной паузы между ними.
/// Пример: (2–5 с) и (8–10 с) → два чанка, не один (2–10 с).
fn build_whisper_work_chunks(segments: &[SpeechSegment]) -> Vec<SpeechSegment> {
    if segments.is_empty() {
        return Vec::new();
    }
    let mut merged: Vec<SpeechSegment> = Vec::new();
    let mut chunk_start = segments[0].start_time;
    let mut chunk_end = segments[0].end_time;

    for seg in segments.iter().skip(1) {
        let gap = seg.start_time - chunk_end;
        let span_if_extended = seg.end_time - chunk_start;
        if gap <= WHISPER_MERGE_MAX_GAP_SEC && span_if_extended <= WHISPER_CHUNK_MAX_SEC {
            chunk_end = seg.end_time;
        } else {
            merged.push(SpeechSegment {
                start_time: chunk_start,
                end_time: chunk_end,
                duration: chunk_end - chunk_start,
            });
            chunk_start = seg.start_time;
            chunk_end = seg.end_time;
        }
    }
    merged.push(SpeechSegment {
        start_time: chunk_start,
        end_time: chunk_end,
        duration: chunk_end - chunk_start,
    });
    merged
}

/// Голубой offset: начало речи VAD в полном аудио. Красный: секунды от 0 внутри mp3-чанка (Whisper).
/// Глобально: `timeline_offset_sec + red_sec` (= `extract_start_sec + whisper_file_sec`, если 0 mp3 = offset).
fn map_whisper_times_to_original_timeline(
    segments: &mut [SubtitleSegment],
    timeline_offset_sec: f64,
    speech_end_sec: f64,
    extract_start_sec: f64,
    chunk_label: &str,
) {
    if segments.is_empty() {
        return;
    }

    let file_zero_in_original = extract_start_sec;
    let lead_in_file = (timeline_offset_sec - file_zero_in_original).max(0.0);

    for (idx, seg) in segments.iter_mut().enumerate() {
        let whisper_file_start = seg.start;
        let whisper_file_end = seg.end;

        let red_start = (whisper_file_start - lead_in_file).max(0.0);
        let red_end = (whisper_file_end - lead_in_file).max(red_start + 0.01);

        let global_start = timeline_offset_sec + red_start;
        let global_end = timeline_offset_sec + red_end;

        let global_start = global_start.min(speech_end_sec);
        let mut global_end = global_end.min(speech_end_sec);
        if global_end <= global_start {
            global_end = (global_start + MIN_SUBTITLE_DURATION).min(speech_end_sec);
        }

        if idx == 0 {
            println!(
                "[whisper] {}: offset(голубой)={:.2}s, mp3_0={:.2}s, субт. красн. {:.2}–{:.2} → глоб. {:.2}–{:.2}s",
                chunk_label,
                timeline_offset_sec,
                file_zero_in_original,
                red_start,
                red_end,
                global_start,
                global_end
            );
        }

        seg.start = global_start.max(0.0);
        seg.end = global_end;
        seg.duration = (seg.end - seg.start).max(0.0);
    }
}

async fn transcribe_segmented_audio(
    file_path: &Path,
    speech_segments: &[SpeechSegment],
    language: &Option<String>,
    whisper_prompt: Option<&str>,
    api_key: &str,
    progress_tx: &mpsc::Sender<ProgressEvent>,
) -> Result<Vec<SubtitleSegment>, String> {
    let whisper_chunks = build_whisper_work_chunks(speech_segments);
    let total_duration = crate::commands::audio::media_duration_seconds(file_path).await?;
    println!(
        "[whisper] VAD {} сегм. → {} чанк(ов) для API (макс. {:.0} с на запрос)",
        speech_segments.len(),
        whisper_chunks.len(),
        WHISPER_CHUNK_MAX_SEC
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .map_err(|e| format!("HTTP-клиент: {}", e))?;

    let mut all_segments = Vec::new();
    let total_segments = whisper_chunks.len();
    
    for (i, segment) in whisper_chunks.iter().enumerate() {
        // Обновляем прогресс
        let _ = progress_tx.send(ProgressEvent::InProgress { 
            step: 2 + (i as u32),
            progress: 0.2 + (0.5 * i as f64 / total_segments as f64),
            description: format!("Транскрибация сегмента {}/{}", i + 1, total_segments)
        }).await;
        
        // Создаем временный файл для сегмента
        let temp_dir_result = tempfile::tempdir();
        let temp_dir = match temp_dir_result {
            Ok(dir) => dir,
            Err(e) => return Err(format!("Ошибка создания временной директории: {}", e)),
        };
        
        let segment_path = temp_dir.path().join(format!("segment_{}.mp3", i));

        let speech_start = segment.start_time;
        let speech_end = segment.end_time;
        let (extract_start, extract_end) =
            audio_preprocessing::whisper_extract_range(speech_start, speech_end, total_duration);

        println!(
            "[whisper] чанк {}/{}: offset(голубой) {:.2}–{:.2} с, mp3 0..{:.2} с (={:.2}–{:.2} в оригинале), ffmpeg…",
            i + 1,
            total_segments,
            speech_start,
            speech_end,
            extract_end - extract_start,
            extract_start,
            extract_end
        );

        let extract_started = std::time::Instant::now();
        extract_audio_segment(file_path, &segment_path, extract_start, extract_end).await?;
        println!(
            "[whisper] ffmpeg готов за {:.1} с",
            extract_started.elapsed().as_secs_f64()
        );
        
        let metadata_result = std::fs::metadata(&segment_path);
        let metadata = match metadata_result {
            Ok(meta) => meta,
            Err(e) => return Err(format!("Ошибка получения метаданных сегмента: {}", e)),
        };
        
        if metadata.len() == 0 {
            println!("[whisper] чанк {} пустой после ffmpeg, пропуск", i + 1);
            continue;
        }

        println!("[whisper] файл чанка: {} КБ", metadata.len() / 1024);
        
        let file_data_result = std::fs::read(&segment_path);
        let file_data = match file_data_result {
            Ok(data) => data,
            Err(e) => return Err(format!("Ошибка чтения сегмента: {}", e)),
        };
        
        use reqwest::multipart;
        
        let file_part_result = multipart::Part::bytes(file_data)
            .file_name("audio.mp3")
            .mime_str("audio/mpeg");
            
        let file_part = match file_part_result {
            Ok(part) => part,
            Err(e) => return Err(format!("Ошибка создания multipart части: {}", e)),
        };
        
        let chunk_audio_sec = extract_end - extract_start;
        let mut form = multipart::Form::new()
            .text("model", "whisper-1")
            .text("language", language.clone().unwrap_or("en".to_string()))
            .text("response_format", "verbose_json")
            .part("file", file_part);

        if let Some(prompt) = whisper_prompt {
            if !prompt.trim().is_empty() {
                form = form.text("prompt", prompt.to_string());
            }
        }

        let lang = language.clone().unwrap_or_else(|| "en".to_string());
        println!(
            "[whisper] запрос OpenAI Whisper (~{:.0} с аудио, language={}, prompt={})…",
            chunk_audio_sec,
            lang,
            whisper_prompt.map(|p| !p.trim().is_empty()).unwrap_or(false)
        );

        let api_started = std::time::Instant::now();
        let res = client
            .post("https://api.openai.com/v1/audio/transcriptions")
            .bearer_auth(api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| {
                format!(
                    "Ошибка запроса к OpenAI (чанк {}/{}): {}",
                    i + 1,
                    total_segments,
                    e
                )
            })?;

        if !res.status().is_success() {
            let status = res.status();
            let error_text = res.text().await.unwrap_or_else(|_| "Неизвестная ошибка".to_string());
            return Err(format!(
                "OpenAI ошибка (чанк {}/{}, {}): {}",
                i + 1,
                total_segments,
                status,
                error_text
            ));
        }

        println!(
            "[whisper] чанк {}/{}: загрузка ответа… (прошло {:.0} с)",
            i + 1,
            total_segments,
            api_started.elapsed().as_secs_f64()
        );
        let body = res
            .bytes()
            .await
            .map_err(|e| format!("Не удалось прочитать ответ Whisper: {}", e))?;
        println!(
            "[whisper] чанк {}/{}: ответ {} КБ, разбор JSON…",
            i + 1,
            total_segments,
            body.len() / 1024
        );
        let response: serde_json::Value =
            serde_json::from_slice(&body).map_err(|e| format!("JSON Whisper: {}", e))?;
        let mut segments = parse_whisper_response(response)?;
        println!(
            "[whisper] чанк {}/{}: готово за {:.1} с, {} субтитр(ов)",
            i + 1,
            total_segments,
            api_started.elapsed().as_secs_f64(),
            segments.len()
        );
        
        let chunk_label = format!("чанк {}/{}", i + 1, total_segments);
        map_whisper_times_to_original_timeline(
            &mut segments,
            speech_start,
            speech_end,
            extract_start,
            &chunk_label,
        );

        all_segments.extend(segments);
    }

    all_segments.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    all_segments = stitch_subtitle_timeline(all_segments);

    println!(
        "[whisper] после склейки {} чанков: {} субтитр(ов) (таймкоды Whisper, без повторного разбиения)",
        total_segments,
        all_segments.len()
    );

    Ok(all_segments)
}

/// Только убираем наложения; не сдвигаем таймкоды вперёд (иначе субтитр «убегает» от речи)
fn stitch_subtitle_timeline(mut segments: Vec<SubtitleSegment>) -> Vec<SubtitleSegment> {
    if segments.len() < 2 {
        for (i, seg) in segments.iter_mut().enumerate() {
            seg.id = (i + 1) as u32;
        }
        return segments;
    }
    segments.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    for i in 1..segments.len() {
        if segments[i].start < segments[i - 1].end - 0.001 {
            let overlap = segments[i - 1].end - segments[i].start;
            segments[i - 1].end = (segments[i - 1].end - overlap * 0.5).max(segments[i - 1].start + 0.05);
            segments[i].start = segments[i - 1].end;
        }
        if segments[i].end <= segments[i].start {
            segments[i].end = segments[i].start + MIN_SUBTITLE_DURATION;
        }
    }
    for (i, seg) in segments.iter_mut().enumerate() {
        seg.id = (i + 1) as u32;
        seg.duration = (seg.end - seg.start).max(0.0);
    }
    segments
}

async fn extract_audio_segment(
    input_path: &Path,
    output_path: &Path,
    start_time: f64,
    end_time: f64,
) -> Result<(), String> {
    use std::process::Stdio;
    use tokio::process::Command;

    let safe_start = start_time.max(0.0);
    let duration = (end_time - safe_start).max(0.05);

    // -ss после -i: точнее таймкоды (медленнее, но без «раннего» старта из-за keyframe)
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-i")
        .arg(input_path)
        .arg("-ss")
        .arg(format!("{:.3}", safe_start))
        .arg("-t")
        .arg(format!("{:.3}", duration))
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-acodec")
        .arg("libmp3lame")
        .arg("-b:a")
        .arg("64k")
        .arg("-y")
        .arg(output_path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Ошибка FFmpeg при извлечении сегмента: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "FFmpeg сегмент {:.3}–{:.3}: {}",
            safe_start,
            end_time,
            stderr.trim()
        ))
    }
}

async fn auto_generate_glossary_from_segments(
    segments: &[SubtitleSegment],
    target_language: &str,
    api_key: &str,
) -> Result<Vec<GlossaryTerm>, String> {
    use std::collections::HashMap;
    
    let mut word_frequencies = HashMap::new();
    
    for segment in segments {
        let words: Vec<&str> = segment.text
            .split_whitespace()
            .map(|w| w.trim_matches(|c: char| !c.is_alphabetic()))
            .filter(|w| !w.is_empty() && w.len() > 2)
            .collect();
        
        for word in words {
            *word_frequencies.entry(word.to_lowercase()).or_insert(0) += 1;
        }
    }
    
    let frequent_words: Vec<(String, u32)> = word_frequencies
        .into_iter()
        .filter(|(_, freq)| *freq >= 2)
        .collect();
    
    if frequent_words.is_empty() {
        return Ok(Vec::new());
    }
    
    let selected_words: Vec<String> = frequent_words
        .into_iter()
        .take(20) // Максимум 20 терминов
        .map(|(word, _)| word)
        .collect();
    
    if selected_words.is_empty() {
        return Ok(Vec::new());
    }
    
    // промпт для GPT
    let terms_list = selected_words.join(", ");
    let prompt = format!(
        "Ты эксперт по переводу. Ниже список терминов, которые встречаются в субтитрах.
        Предложи точные переводы этих терминов на язык '{}'.
        Верни ответ в формате JSON: массив объектов {{\"source\": \"термин\", \"target\": \"перевод\", \"confidence\": число_от_0_до_1}}",
        target_language
    );
    
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": "gpt-5.4-mini",
            "messages": [
                { "role": "system", "content": prompt },
                { "role": "user", "content": terms_list }
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.3,
            "max_completion_tokens": 2000
        }))
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса к OpenAI: {}", e))?;
    
    if !res.status().is_success() {
        let status = res.status();
        let error_text = res.text().await.unwrap_or_else(|_| "Неизвестная ошибка".to_string());
        return Err(format!("OpenAI ошибка ({}): {}", status, error_text));
    }
    
    let response: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    parse_glossary_response(response)
}

/// Сегментов за один запрос: иначе JSON обрезается (EOF while parsing)
const TRANSLATION_CHUNK_SIZE: usize = 40;
const TRANSLATION_MAX_TOKENS: u32 = 16384;

fn language_needs_speaker_gender(lang: &str) -> bool {
    let l = lang.trim().to_lowercase();
    matches!(
        l.as_str(),
        "ru" | "uk" | "pl" | "cs" | "sk" | "be" | "sr" | "hr" | "bg"
    ) || l.starts_with("ru-")
        || l.starts_with("uk-")
        || l.starts_with("pl-")
}

fn speaker_gender_translation_rules(target_language: &str) -> String {
    if !language_needs_speaker_gender(target_language) {
        return String::new();
    }
    "Пол говорящего (поле speaker_gender в JSON каждого сегмента):\n\
     - male/female/unknown по тональности голоса в этой реплике\n\
     - Для форм от первого лица говорящего (я ...) согласуй род с speaker_gender: female - женский, male - мужской\n\
     - При unknown не угадывай род говорящего\n\
     - Пол персонажей в тексте или в глоссарии (о ком говорят) учитывай отдельно, не подменяй speaker_gender\n\n"
        .to_string()
}

async fn translate_segments_chunk(
    client: &reqwest::Client,
    api_key: &str,
    prompt: &str,
    chunk: &[SubtitleSegment],
    log_label: &str,
) -> Result<Vec<crate::types::TranslationResult>, String> {
    let segments_text = serde_json::json!({
        "segments": chunk.iter().map(|s| {
            let mut obj = serde_json::json!({
                "id": s.id,
                "text": s.text,
                "start": s.start,
                "end": s.end
            });
            if let Some(g) = &s.speaker_gender {
                obj["speaker_gender"] = serde_json::json!(g.as_str());
            }
            obj
        }).collect::<Vec<_>>()
    });

    let user_content = serde_json::to_string(&segments_text).map_err(|e| e.to_string())?;

    log_debug_block(
        &format!("перевод [{log_label}]: запрос"),
        &format!(
            "model: gpt-5.4-mini\n\
            temperature: 0.3\n\
            max_completion_tokens: {TRANSLATION_MAX_TOKENS}\n\
            response_format: json_object\n\
            \n\
            --- system ---\n\
            {prompt}\n\
            \n\
            --- user (JSON, {} симв.) ---\n\
            {user_content}",
            user_content.len()
        ),
    );

    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": "gpt-5.4-mini",
            "messages": [
                { "role": "system", "content": prompt },
                { "role": "user", "content": user_content }
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.3,
            "max_completion_tokens": TRANSLATION_MAX_TOKENS
        }))
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса к OpenAI: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let error_text = res.text().await.unwrap_or_else(|_| "Неизвестная ошибка".to_string());
        return Err(format!("OpenAI ошибка ({}): {}", status, error_text));
    }

    let response: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let pretty = serde_json::to_string_pretty(&response).unwrap_or_else(|e| e.to_string());
    log_debug_block(
        &format!("перевод [{log_label}]: ответ OpenAI"),
        &pretty,
    );
    parse_translation_response(response)
}

#[tauri::command]
pub async fn translate_batch(
    segments: Vec<SubtitleSegment>,
    target_language: String,
    glossary: Vec<GlossaryEntry>,
    style_prompt: String,
    app_handle: tauri::AppHandle,
) -> Result<Vec<crate::types::TranslationResult>, String> {
    println!("Перевод {} сегментов на {}...", segments.len(), target_language);

    let api_key = get_api_key()?;

    let (progress_tx, mut progress_rx) = mpsc::channel::<ProgressEvent>(10);
    let app_handle_clone = app_handle.clone();
    let operation_id = format!("translate_{}", uuid::Uuid::new_v4());
    
    tokio::spawn(async move {
        while let Some(event) = progress_rx.recv().await {
            let _ = app_handle_clone.emit("ai_progress", ProgressPayload {
                operation_id: operation_id.clone(),
                event,
            });
        }
    });
    
    let _ = progress_tx.send(ProgressEvent::Started { 
        total_steps: 3, 
        description: "Подготовка перевода".to_string() 
    }).await;

    // Формируем промпт
    let _ = progress_tx.send(ProgressEvent::InProgress { 
        step: 1, 
        progress: 0.33, 
        description: "Генерация промпта".to_string() 
    }).await;
    
    let glossary_lines: Vec<String> = glossary
        .iter()
        .filter(|e| !e.source.trim().is_empty() && !e.target.trim().is_empty())
        .map(|e| {
                let mut notes = Vec::new();
                if let Some(description) = e.description.as_ref().map(|v| v.trim()).filter(|v| !v.is_empty()) {
                    notes.push(description.to_string());
                }
                if let Some(context) = e.context.as_ref().map(|v| v.trim()).filter(|v| !v.is_empty()) {
                    notes.push(format!("Meaning/Context: {}", context));
                }
                let notes_text = if notes.is_empty() {
                    String::new()
                } else {
                    format!(" — {}", notes.join("; "))
                };
            format!("• \"{}\" → \"{}\"{}", e.source, e.target, notes_text)
        })
        .collect();

    let glossary_text = if glossary_lines.is_empty() {
        String::new()
    } else {
        format!(
            "ГЛОССАРИЙ (обязательно соблюдать при переводе):\n{}\n\n",
            glossary_lines.join("\n")
        )
    };
    
    let gender_hint = speaker_gender_translation_rules(&target_language);

    let mandatory_lines: Vec<String> = glossary
        .iter()
        .filter(|e| !e.source.trim().is_empty() && !e.target.trim().is_empty())
        .filter(|e| {
            e.description
                .as_deref()
                .map(|d| d.to_lowercase().contains("user prompt"))
                .unwrap_or(false)
        })
        .map(|e| format!("• \"{}\" → \"{}\" (обязательно)", e.source.trim(), e.target.trim()))
        .collect();
    let mandatory_block = if mandatory_lines.is_empty() {
        String::new()
    } else {
        format!(
            "ОБЯЗАТЕЛЬНЫЕ ПЕРЕВОДЫ ИЗ ИНСТРУКЦИИ ПОЛЬЗОВАТЕЛЯ:\n{}\n\n",
            mandatory_lines.join("\n")
        )
    };

    let prompt = format!(
        "Ты профессиональный переводчик субтитров. Переведи текст на {target_language}.\n\n\
        {mandatory_block}\
        {glossary_text}\
        СТИЛЬ ПЕРЕВОДА: {style_prompt}\n\n\
        {gender_hint}\
        Требования к переводу:\n\
        - Сохраняй естественность речи на целевом языке\n\
        - Учитывай контекст диалога\n\
        - Соблюдай глоссарий терминов (если указан); в глоссарии может быть пол персонажей, о которых идет речь в третьем лице\n\
        - Имена персонажей, прозвища, названия мест и другие имена собственные локализуй на целевой язык, если это уместно\n\
        - Если в глоссарии есть конкретная форма имени/термина, используй строго её\n\
        - Длина перевода должна быть сопоставима с оригиналом для синхронизации с видео\n\n\
        Пример: \"My name is Dipper.\" -> \"Меня зовут Диппер.\"\n\n\
        Верни JSON-объект с ключом \"translations\": массив объектов \
        {{\"id\": число, \"translated_text\": \"текст\"}} по одному на каждый сегмент из запроса.",
        target_language = target_language,
        mandatory_block = mandatory_block,
        glossary_text = glossary_text,
        style_prompt = style_prompt,
        gender_hint = gender_hint,
    );

    let client = reqwest::Client::new();
    let chunks: Vec<&[SubtitleSegment]> = segments.chunks(TRANSLATION_CHUNK_SIZE).collect();
    let total_chunks = chunks.len().max(1);

    let mut merged_by_id: HashMap<u32, String> = HashMap::new();

    for (i, chunk) in chunks.iter().enumerate() {
        let progress = 0.55 + (i as f64 / total_chunks as f64) * 0.30;
        let _ = progress_tx
            .send(ProgressEvent::InProgress {
                step: 2,
                progress,
                description: format!("Перевод: пакет {} из {}", i + 1, total_chunks),
            })
            .await;

        let batch = translate_segments_chunk(
            &client,
            &api_key,
            &prompt,
            chunk,
            &format!(
                "основной {} из {}, id {}–{}",
                i + 1,
                total_chunks,
                chunk.first().map(|s| s.id).unwrap_or(0),
                chunk.last().map(|s| s.id).unwrap_or(0)
            ),
        )
        .await?;
        for t in batch {
            merged_by_id.entry(t.id).or_insert(t.translated_text);
        }
    }

    const RETRY_CHUNK_WAVES: &[usize] = &[14, 12, 10, 8, 6, 4, 3, 2, 1];

    for (wave_idx, &chunk_sz) in RETRY_CHUNK_WAVES.iter().enumerate() {
        let missing: Vec<SubtitleSegment> = segments
            .iter()
            .filter(|s| !merged_by_id.contains_key(&s.id))
            .cloned()
            .collect();
        if missing.is_empty() {
            break;
        }

        println!(
            "[translate] добор волна {} (≤{} сегм. в пакете): без перевода ещё {} сегм.",
            wave_idx + 1,
            chunk_sz,
            missing.len()
        );

        let before_ct = merged_by_id.len();
        let actual_sz = chunk_sz.max(1).min(missing.len());
        let sub_total = (missing.len() + actual_sz - 1) / actual_sz;

        for (j, subchunk) in missing.chunks(actual_sz).enumerate() {
            let batch = translate_segments_chunk(
                &client,
                &api_key,
                &prompt,
                subchunk,
                &format!(
                    "добор волна{} подпакет {}/{} id {}–{}",
                    wave_idx + 1,
                    j + 1,
                    sub_total,
                    subchunk.first().map(|s| s.id).unwrap_or(0),
                    subchunk.last().map(|s| s.id).unwrap_or(0)
                ),
            )
            .await?;
            for t in batch {
                merged_by_id.entry(t.id).or_insert(t.translated_text);
            }
        }

        if actual_sz == 1 && merged_by_id.len() == before_ct {
            println!(
                "[translate] одиночные запросы не добавили строк — остаток будет с оригиналом"
            );
            break;
        }
    }

    for s in &segments {
        let needs_fallback = match merged_by_id.get(&s.id) {
            Some(t) => t.trim().is_empty() && !s.text.trim().is_empty(),
            None => true,
        };
        if needs_fallback {
            eprintln!(
                "[translate] id={}: нет/пустой перевод от API, подставлен оригинал субтитра",
                s.id
            );
            merged_by_id.insert(s.id, s.text.clone());
        }
    }

    // Обрабатываем результат
    let _ = progress_tx.send(ProgressEvent::InProgress { 
        step: 3, 
        progress: 0.9, 
        description: "Обработка перевода".to_string() 
    }).await;

    let mut translations: Vec<crate::types::TranslationResult> = Vec::with_capacity(segments.len());
    for s in &segments {
        let translated_text = merged_by_id
            .get(&s.id)
            .expect("после добора и подстановки все id должны быть в map")
            .clone();
        translations.push(crate::types::TranslationResult {
            id: s.id,
            translated_text,
        });
    }

    // Применяем глоссарий
    if !glossary.is_empty() {
    for translation in &mut translations {
        if let Some(segment) = segments.iter().find(|s| s.id == translation.id) {
            // Применяем глоссарий к оригиналу и переводу
            let original_with_glossary = apply_glossary(&segment.text, &glossary);
            translation.translated_text = apply_glossary(&translation.translated_text, &glossary);
            
            // Логируем изменения для отладки
            if original_with_glossary != segment.text {
                println!(
                    "[translate] глоссарий сегмент #{}: \"{}\" -> \"{}\"",
                    segment.id, segment.text, original_with_glossary);
            }
        }
    }
}
    
    let _ = progress_tx.send(ProgressEvent::Completed {
        result_count: translations.len()
    }).await;
    
    println!("Перевод завершён: {} сегментов", translations.len());
    Ok(translations)
}

// Вспомогательные структуры для прогресса
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProgressPayload {
    pub operation_id: String,
    pub event: ProgressEvent,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ProgressEvent {
    Started { total_steps: u32, description: String },
    InProgress { step: u32, progress: f64, description: String },
    Completed { result_count: usize },
    Error { message: String },
}

fn json_seconds(v: &serde_json::Value) -> f64 {
    v.as_f64()
        .or_else(|| v.as_u64().map(|n| n as f64))
        .or_else(|| v.as_i64().map(|n| n as f64))
        .unwrap_or(0.0)
}

/// ~2 строки субтитров (Netflix-style ориентир)
const MAX_SUBTITLE_CHARS: usize = 84;
const TARGET_SUBTITLE_CHARS: usize = 42;
const MIN_SUBTITLE_DURATION: f64 = 0.5;
const MAX_SUBTITLE_DURATION: f64 = 6.0;

fn make_subtitle_segment(text: String, start: f64, end: f64) -> SubtitleSegment {
    let end = end.max(start + MIN_SUBTITLE_DURATION);
    SubtitleSegment {
        id: 0,
        start,
        end,
        duration: end - start,
        text,
        translation: None,
        speaker_gender: None,
        flags: None,
    }
}

pub fn reflow_subtitle_segments(segments: Vec<SubtitleSegment>) -> Vec<SubtitleSegment> {
    let mut out: Vec<SubtitleSegment> = Vec::new();
    for seg in segments {
        if seg.text.trim().is_empty() {
            continue;
        }
        out.extend(split_long_subtitle_segment(seg));
    }
    for (i, seg) in out.iter_mut().enumerate() {
        seg.id = (i + 1) as u32;
        seg.duration = (seg.end - seg.start).max(0.0);
    }
    out
}

fn split_long_subtitle_segment(seg: SubtitleSegment) -> Vec<SubtitleSegment> {
    let text = seg.text.trim().to_string();
    let char_count = text.chars().count();
    // Длину по времени не режем — только по символам, иначе таймкоды Whisper сжимаются
    if char_count <= MAX_SUBTITLE_CHARS {
        return vec![seg];
    }
    if text.contains('\n') {
        return split_on_newlines(seg, &text);
    }
    split_by_punctuation_proportional(text, seg.start, seg.end)
}

fn split_on_newlines(seg: SubtitleSegment, text: &str) -> Vec<SubtitleSegment> {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if lines.len() <= 1 {
        return split_by_punctuation_proportional(text.to_string(), seg.start, seg.end);
    }
    let total_chars: usize = lines.iter().map(|l| l.chars().count()).sum();
    let duration = (seg.end - seg.start).max(MIN_SUBTITLE_DURATION);
    let mut cursor = seg.start;
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let share = line.chars().count() as f64 / total_chars.max(1) as f64;
        let piece_dur = duration * share;
        let end = if i + 1 == lines.len() {
            seg.end
        } else {
            (cursor + piece_dur).min(seg.end)
        };
        out.push(make_subtitle_segment(line.to_string(), cursor, end));
        cursor = end;
    }
    out
}

fn split_by_punctuation_proportional(text: String, start: f64, end: f64) -> Vec<SubtitleSegment> {
    let duration = (end - start).max(MIN_SUBTITLE_DURATION);
    let mut parts: Vec<String> = Vec::new();
    let mut rest = text.trim().to_string();

    while !rest.is_empty() {
        if rest.chars().count() <= MAX_SUBTITLE_CHARS {
            parts.push(rest);
            break;
        }
        let window: String = rest.chars().take(TARGET_SUBTITLE_CHARS + 24).collect();
        let breakpoints = [", ", "; ", " oppure ", " e ", ". ", "! ", "? ", " - "];
        let mut split_at: Option<usize> = None;
        for bp in breakpoints {
            if let Some(pos) = window.rfind(bp) {
                if pos >= 8 {
                    split_at = Some(pos + bp.len());
                    break;
                }
            }
        }
        let byte_split = split_at.unwrap_or_else(|| {
            rest.char_indices()
                .nth(TARGET_SUBTITLE_CHARS)
                .map(|(i, _)| i)
                .unwrap_or(rest.len())
        });
        let (head, tail) = rest.split_at(byte_split);
        let head = head.trim().to_string();
        if head.is_empty() {
            break;
        }
        parts.push(head);
        rest = tail.trim().to_string();
    }

    if parts.len() <= 1 {
        return vec![make_subtitle_segment(text, start, end)];
    }

    let total_chars: usize = parts.iter().map(|p| p.chars().count()).sum();
    let mut cursor = start;
    let mut out = Vec::new();
    for (i, part) in parts.iter().enumerate() {
        let share = part.chars().count() as f64 / total_chars.max(1) as f64;
        let piece_dur = duration * share;
        let piece_end = if i + 1 == parts.len() {
            end
        } else {
            (cursor + piece_dur).min(end)
        };
        out.push(make_subtitle_segment(part.clone(), cursor, piece_end));
        cursor = piece_end;
    }
    out
}

fn split_segment_with_whisper_words(
    _text: String,
    words: &[serde_json::Value],
    start: f64,
    end: f64,
) -> Option<Vec<SubtitleSegment>> {
    let mut chunks: Vec<Vec<(String, f64, f64)>> = Vec::new();
    let mut current: Vec<(String, f64, f64)> = Vec::new();
    let mut current_chars = 0usize;

    for w in words {
        let word = w["word"].as_str().unwrap_or("").trim();
        if word.is_empty() {
            continue;
        }
        let ws = json_seconds(&w["start"]);
        let we = json_seconds(&w["end"]);
        let extra = if current.is_empty() { 0 } else { 1 };
        let wlen = word.chars().count() + extra;

        if !current.is_empty() && current_chars + wlen > TARGET_SUBTITLE_CHARS {
            chunks.push(current);
            current = Vec::new();
            current_chars = 0;
        }
        current.push((word.to_string(), ws, we));
        current_chars += wlen;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    if chunks.len() <= 1 {
        return None;
    }

    Some(
        chunks
            .into_iter()
            .map(|chunk| {
                let text = chunk
                    .iter()
                    .map(|(w, _, _)| w.as_str())
                    .collect::<Vec<_>>()
                    .join(" ");
                let s = chunk.first().map(|(_, s, _)| *s).unwrap_or(start);
                let e = chunk.last().map(|(_, _, e)| *e).unwrap_or(end);
                make_subtitle_segment(text, s, e)
            })
            .collect(),
    )
}

fn parse_whisper_response(response: serde_json::Value) -> Result<Vec<SubtitleSegment>, String> {
    let segments = response["segments"]
        .as_array()
        .ok_or("Нет сегментов в ответе".to_string())?;

    let mut result: Vec<SubtitleSegment> = Vec::new();

    for seg in segments {
        let mut start = json_seconds(&seg["start"]);
        let mut end = json_seconds(&seg["end"]);
        let text = seg["text"].as_str().unwrap_or("").trim().to_string();
        if text.is_empty() {
            continue;
        }

        let words = seg["words"].as_array();
        if let Some(words) = words {
            if let (Some(first), Some(last)) = (words.first(), words.last()) {
                let ws = json_seconds(&first["start"]);
                let we = json_seconds(&last["end"]);
                if we > ws {
                    start = ws;
                    end = we;
                }
            }
        }

        let char_count = text.chars().count();
        if char_count > MAX_SUBTITLE_CHARS {
            if let Some(words) = words {
                if let Some(parts) = split_segment_with_whisper_words(text.clone(), words, start, end) {
                    result.extend(parts);
                    continue;
                }
            }
            result.extend(split_by_punctuation_proportional(text, start, end));
        } else {
            result.push(make_subtitle_segment(text, start, end));
        }
    }

    Ok(result)
}

fn parse_translation_response(
    response: serde_json::Value,
) -> Result<Vec<crate::types::TranslationResult>, String> {
    let content = response["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Нет контента в ответе".to_string())?;

    let normalized_content = normalize_json_text(content);
    let parsed: serde_json::Value = serde_json::from_str(&normalized_content)
        .map_err(|e| format!("Ошибка парсинга JSON: {}", e))?;

    // Если структура ответа правильная (массив переводов либо id->text карта),
    // отдаём то, что распарсилось, даже если внутри попались пустые
    // Пустой translated_text допустим; подставим оригинал в translate_batch
    // Пустоты будут заменены оригиналом в translate_batch
    if let Some(candidate_array) = find_translation_array(&parsed) {
        let mut results = parse_translation_items(candidate_array);
        results.sort_by_key(|item| item.id);
        return Ok(results);
    }

    if let Some(map_obj) = find_id_text_map_object(&parsed) {
        let mut results = map_obj
            .iter()
            .filter_map(|(key, value)| {
                let id = key.parse::<u32>().ok()?;
                let translated_text = value.as_str()?.trim().to_string();
                Some(crate::types::TranslationResult { id, translated_text })
            })
            .collect::<Vec<_>>();
        results.sort_by_key(|item| item.id);
        return Ok(results);
    }

    Err(format!(
        "Не удалось распознать формат перевода от OpenAI. Ответ: {}",
        normalized_content.chars().take(400).collect::<String>()
    ))
}

fn json_u32_from_value(v: &serde_json::Value) -> Option<u32> {
    if let Some(n) = v.as_u64() {
        return u32::try_from(n).ok();
    }
    if let Some(n) = v.as_i64() {
        return u32::try_from(n).ok();
    }
    v.as_str().and_then(|s| s.trim().parse().ok())
}

fn normalize_json_text(content: &str) -> String {
    let trimmed = content.trim();
    if trimmed.starts_with("```") {
        let without_fence = trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();
        without_fence.to_string()
    } else {
        trimmed.to_string()
    }
}

fn parse_translation_items(items: &[serde_json::Value]) -> Vec<crate::types::TranslationResult> {
    items
        .iter()
        .filter_map(|item| {
            let id = item.get("id").and_then(json_u32_from_value).unwrap_or(0);
            let translated_text = item
                .get("translated_text")
                .or_else(|| item.get("translatedText"))
                .or_else(|| item.get("translation"))
                .or_else(|| item.get("translated"))
                .or_else(|| item.get("text"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();

            if id == 0 {
                None
            } else {
                Some(crate::types::TranslationResult { id, translated_text })
            }
        })
        .collect()
}

fn find_translation_array(value: &serde_json::Value) -> Option<&Vec<serde_json::Value>> {
    if let Some(arr) = value.as_array() {
        return Some(arr);
    }

    if let Some(obj) = value.as_object() {
        let priority_keys = ["translations", "results", "items", "data", "output", "response"];
        for key in priority_keys {
            if let Some(v) = obj.get(key) {
                if let Some(arr) = v.as_array() {
                    return Some(arr);
                }
                if let Some(found) = find_translation_array(v) {
                    return Some(found);
                }
            }
        }

        for v in obj.values() {
            if let Some(found) = find_translation_array(v) {
                return Some(found);
            }
        }
    }

    None
}

fn find_id_text_map_object(
    value: &serde_json::Value,
) -> Option<&serde_json::Map<String, serde_json::Value>> {
    if let Some(obj) = value.as_object() {
        let maybe_map = obj
            .iter()
            .all(|(k, v)| k.parse::<u32>().is_ok() && v.as_str().is_some());
        if maybe_map && !obj.is_empty() {
            return Some(obj);
        }

        for v in obj.values() {
            if let Some(found) = find_id_text_map_object(v) {
                return Some(found);
            }
        }
    }
    None
}

#[tauri::command]
pub async fn auto_generate_glossary(
    segments: Vec<SubtitleSegment>,
    options: Option<AutoGlossaryOptions>,
    _app_handle: tauri::AppHandle,
) -> Result<Vec<GlossaryTerm>, String> {
    println!("Автоматическое создание глоссария из {} сегментов", segments.len());

    if segments.is_empty() {
        return Ok(Vec::new());
    }

    let options = options.unwrap_or(AutoGlossaryOptions {
        min_frequency: 2,
        max_terms: 50,
        target_language: "ru".to_string(),
        context_prompt: None,
    });
    let _ = options.min_frequency;

    let corpus = build_subtitle_corpus(&segments, 48_000);
    if corpus.trim().is_empty() {
        return Ok(Vec::new());
    }

    let api_key = get_api_key()?;

    let max_terms = options.max_terms.clamp(5, 80);
    let target_lang = options.target_language.trim();

    let creator_notes = options
        .context_prompt
        .as_deref()
        .map(str::trim)
        .filter(|notes| !notes.is_empty());

    let notes_instruction = if creator_notes.is_some() {
        "\n\nIf the user message includes a \"Creator / translator notes\" section above the subtitle text, treat names, spellings, factions, and lore listed there as authoritative. Prefer those exact spellings in \"source\" when they also appear (or clearly correspond) in the subtitle transcript. Merge hints from notes with terms found in the subtitles."
    } else {
        ""
    };

    let system_prompt = format!(
        "You are a senior subtitle localization lead. You receive the FULL source subtitle text of a film or series (possibly multi-line).\n\
        Task: read the entire text and build a glossary for translators.\n\
        INCLUDE only entries that must stay consistent across episodes:\n\
        - character names, nicknames, royal/titles as names\n\
        - place names, cities, realms, planets, buildings when named\n\
        - factions, organizations, teams, governments\n\
        - in-universe proper nouns: spells, artifacts, ships, brands in the story\n\
        - recurring unique phrases that are titles or fixed expressions IN THIS WORK\n\
        EXCLUDE completely:\n\
        - common vocabulary (articles, pronouns, prepositions, auxiliaries)\n\
        - generic adjectives/adverbs (good, very, not, this, that) unless they are a named title\n\
        - ordinary verbs unless they name a specific in-world concept\n\
        - isolated frequent words; prefer multi-word names when relevant\n\
        If you are unsure whether something is a proper term for this show, omit it.\n\
        For each term, \"source\" must appear verbatim (or canonical capitalization) as in the text when possible.\n\
        \"target\" must be the correct translation into the language identified by ISO 639-1 code: {}.\n\
        \"target\" must be localized, not a blind copy of \"source\"; for names, provide natural localization/transliteration for the target language.\n\
        If \"target\" would be identical to \"source\" without a strong reason, choose a localized form.\n\
        \"category\" is one of: character | location | organization | concept | title | other.\n\
        \"confidence\" is 0.0-1.0 (how sure this is a glossary-worthy term for THIS material).\n\
        Return a single JSON object: {{\"terms\":[{{\"source\":\"...\",\"target\":\"...\",\"confidence\":0.9,\"category\":\"character\"}},...]}}.\n\
        At most {} terms, sorted by importance for consistency (most important first).{}",
        target_lang,
        max_terms,
        notes_instruction
    );

    let user_content = if let Some(notes) = creator_notes {
        format!(
            "Creator / translator notes (from the subtitling wizard — names, setting, MUST-HAVE terms):\n\n{}\n\n---\n\nSource subtitle text (original language of dialogue):\n\n{}",
            notes,
            corpus
        )
    } else {
        format!(
            "Source subtitle text (original language of dialogue):\n\n{}",
            corpus
        )
    };

    let client = reqwest::Client::new();
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(&api_key)
        .json(&serde_json::json!({
            "model": "gpt-5.4-mini",
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_content }
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.2,
            "max_completion_tokens": 8192
        }))
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса к OpenAI: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let error_text = res.text().await.unwrap_or_else(|_| "Неизвестная ошибка".to_string());
        return Err(format!("OpenAI ошибка ({}): {}", status, error_text));
    }

    let response: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut glossary_terms = parse_glossary_response(response)?;

    let untranslated: Vec<GlossaryTerm> = glossary_terms
        .iter()
        .filter(|t| looks_untranslated_term(&t.source, &t.target))
        .cloned()
        .collect();
    if !untranslated.is_empty() {
        println!(
            "[auto_glossary] до-локализация {} терминов с одинаковыми source/target",
            untranslated.len()
        );
        match localize_untranslated_glossary_terms(&client, &api_key, target_lang, &untranslated).await {
            Ok(fixes) => {
                for term in &mut glossary_terms {
                    if let Some(new_target) = fixes.get(&term.source) {
                        if !new_target.trim().is_empty() {
                            term.target = new_target.trim().to_string();
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[auto_glossary] пропущена до-локализация терминов: {}", e);
            }
        }
    }

    glossary_terms.retain(|t| !should_drop_glossary_candidate(&t.source, &t.target));
    if glossary_terms.len() > max_terms as usize {
        glossary_terms.truncate(max_terms as usize);
    }

    println!("Создан глоссарий из {} терминов", glossary_terms.len());
    Ok(glossary_terms)
}

fn parse_glossary_response(response: serde_json::Value) -> Result<Vec<GlossaryTerm>, String> {
    let content = response["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Нет контента в ответе".to_string())?;
    
    let parsed: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("Ошибка парсинга JSON: {}", e))?;

    let terms_value = parsed
        .as_array()
        .or_else(|| parsed.get("terms").and_then(|v| v.as_array()))
        .or_else(|| parsed.get("glossary").and_then(|v| v.as_array()))
        .or_else(|| parsed.get("entries").and_then(|v| v.as_array()))
        .ok_or_else(|| {
            format!(
                "Ожидается массив терминов или объект с ключом terms/glossary/entries. Ответ: {}",
                content.chars().take(600).collect::<String>()
            )
        })?;

    let terms = terms_value
        .iter()
        .filter_map(|item| {
            let source = item["source"].as_str().unwrap_or("").trim().to_string();
            let target = item["target"].as_str().unwrap_or("").trim().to_string();
            if source.is_empty() || target.is_empty() {
                return None;
            }
            let confidence = item["confidence"].as_f64().unwrap_or(0.5);
            let category = item["category"].as_str().map(|s| s.to_string());

            Some(GlossaryTerm {
                source,
                target,
                frequency: 0,
                confidence,
                category,
            })
        })
        .collect();
    
    Ok(terms)
}

fn build_subtitle_corpus(segments: &[SubtitleSegment], _sample_rate: u32) -> String {
    segments
        .iter()
        .map(|s| s.text.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn looks_untranslated_term(source: &str, target: &str) -> bool {
    source.eq_ignore_ascii_case(target) || 
    source.chars().all(|c| c.is_ascii_alphabetic()) && 
    target.chars().all(|c| c.is_ascii_alphabetic()) &&
    source.len() > 3
}

async fn localize_untranslated_glossary_terms(
    client: &reqwest::Client,
    api_key: &str,
    target_lang: &str,
    terms: &[GlossaryTerm],
) -> Result<std::collections::HashMap<String, String>, String> {
    if terms.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    
    let terms_list = terms
        .iter()
        .map(|t| format!("\"{}\"", t.source))
        .collect::<Vec<_>>()
        .join(", ");
    
    let prompt = format!(
        "You are a professional translator. Translate these terms from English to {}.
        Return ONLY a JSON object with {{\"term\": \"translation\"}} pairs.
        Do not include any explanations or additional text.",
        target_lang
    );
    
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": "gpt-5.4-mini",
            "messages": [
                { "role": "system", "content": prompt },
                { "role": "user", "content": terms_list }
            ],
            "temperature": 0.3,
            "max_completion_tokens": 2000
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    if !res.status().is_success() {
        return Err("Failed to localize untranslated terms".to_string());
    }
    
    let response: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let content = response["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("{}");
    
    let translations: std::collections::HashMap<String, String> = 
        serde_json::from_str(content).unwrap_or_default();
    
    Ok(translations)
}

fn should_drop_glossary_candidate(source: &str, target: &str) -> bool {
    let source_lower = source.to_lowercase();
    let target_lower = target.to_lowercase();
    
    // Слишком короткие термины
    if source.len() < 3 {
        return true;
    }
    
    // Общие слова, которые не должны быть в глоссарии
    let common_words = [
        "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
        "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do",
        "does", "did", "will", "would", "could", "should", "may", "might", "must",
        "can", "this", "that", "these", "those", "i", "you", "he", "she", "it", "we",
        "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our",
        "their", "mine", "yours", "hers", "ours", "theirs"
    ];
    
    common_words.iter().any(|&word| 
        source_lower == word || target_lower == word
    )
}

const KEYRING_SERVICE: &str = "subtitle-studio";
const KEYRING_USER: &str = "openai-api-key";