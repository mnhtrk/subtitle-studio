use serde::{Deserialize, Serialize};
use crate::project::{SubtitleSegment, GlossaryEntry};
use keyring::Entry;
use crate::project::glossary::apply_glossary;
use tokio::sync::mpsc;
use tauri::Emitter;
use std::collections::{HashMap};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use crate::postprocessing;

const WHISPER_MAX_FILE_BYTES: u64 = 24 * 1024 * 1024;
/// Целевой размер одного куска при разбиении большого файла (18мб)
const WHISPER_CHUNK_TARGET_BYTES: u64 = 18 * 1024 * 1024;

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

    let api_key = get_api_key()?;

    let (progress_tx, mut progress_rx) = mpsc::channel::<ProgressEvent>(10);

    let app_handle_clone = app_handle.clone();
    let operation_id = format!("transcribe_{}", uuid::Uuid::new_v4());
    
    tokio::spawn(async move {
        while let Some(event) = progress_rx.recv().await {
            let _ = app_handle_clone.emit("ai_progress", ProgressPayload {
                operation_id: operation_id.clone(),
                event,
            });
        }
    });
    
    let _ = progress_tx.send(ProgressEvent::Started { 
        total_steps: 4, 
        description: "Подготовка файла".to_string() 
    }).await;

    let _ = progress_tx.send(ProgressEvent::InProgress {
        step: 1,
        progress: 0.15,
        description: "Подготовка аудио".to_string()
    }).await;

    let file_metadata = std::fs::metadata(&file_path)
        .map_err(|e| format!("Ошибка чтения файла: {}", e))?;
    let file_size_bytes = file_metadata.len();

    let language_code = language.clone().unwrap_or_else(|| "en".to_string());
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
    let whisper_prompt: Option<String> = match (base_prompt, glossary_prompt) {
        (Some(base), Some(glossary_block)) => Some(format!("{}\n\n{}", base, glossary_block)),
        (Some(base), None) => Some(base),
        (None, Some(glossary_block)) => Some(glossary_block),
        (None, None) => None,
    };

    println!(
        "[transcribe_audio] whisper prompt assembled from user prompt + {} glossary original terms",
        missing_glossary_originals.len()
    );

    let client = reqwest::Client::new();

    let raw_segments: Vec<SubtitleSegment> = if file_size_bytes <= WHISPER_MAX_FILE_BYTES {
        // Одиночный запрос: файл умещается в лимит Whisper.
        let _ = progress_tx.send(ProgressEvent::InProgress {
            step: 2,
            progress: 0.45,
            description: "Отправка в OpenAI".to_string()
        }).await;

        let file_data = std::fs::read(&file_path)
            .map_err(|e| format!("Ошибка чтения файла: {}", e))?;

        let segments = whisper_call(
            &client,
            &api_key,
            file_data,
            &language_code,
            whisper_prompt.as_deref(),
            "single",
        ).await?;

        let _ = progress_tx.send(ProgressEvent::InProgress {
            step: 3,
            progress: 0.85,
            description: "Обработка результата".to_string()
        }).await;

        segments
    } else {
        let duration = crate::commands::audio::media_duration_seconds(Path::new(&file_path))
            .await
            .map_err(|e| format!("Не удалось получить длительность аудио: {}", e))?;
        if duration <= 0.0 {
            return Err("Файл аудио имеет нулевую длительность".to_string());
        }

        let chunk_count = ((file_size_bytes + WHISPER_CHUNK_TARGET_BYTES - 1)
            / WHISPER_CHUNK_TARGET_BYTES) as usize;
        let chunk_count = chunk_count.max(2);
        let chunk_seconds = (duration / chunk_count as f64).max(1.0);

        println!(
            "Аудио ~{:.1} МБ, {:.1} c — режем на {} кусков по ~{:.1} c",
            file_size_bytes as f64 / (1024.0 * 1024.0),
            duration,
            chunk_count,
            chunk_seconds
        );

        let temp_dir = std::env::temp_dir()
            .join(format!("whisper_chunks_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Не удалось создать временную папку: {}", e))?;

        let mut all_segments: Vec<SubtitleSegment> = Vec::new();

        for i in 0..chunk_count {
            let chunk_start = (i as f64) * chunk_seconds;
            let chunk_path: PathBuf = temp_dir.join(format!("chunk_{:03}.mp3", i));

            let progress = 0.15 + (i as f64 / chunk_count as f64) * 0.70;
            let _ = progress_tx.send(ProgressEvent::InProgress {
                step: 2,
                progress,
                description: format!(
                    "Транскрибация: кусок {} из {}",
                    i + 1,
                    chunk_count
                ),
            }).await;

            extract_audio_chunk(
                Path::new(&file_path),
                &chunk_path,
                chunk_start,
                chunk_seconds,
            ).await?;

            let chunk_data = std::fs::read(&chunk_path)
                .map_err(|e| format!("Ошибка чтения куска {}: {}", i + 1, e))?;
            println!(
                "  🎧 кусок {}/{}: {:.1} МБ",
                i + 1,
                chunk_count,
                chunk_data.len() as f64 / (1024.0 * 1024.0)
            );

            let chunk_segments = whisper_call(
                &client,
                &api_key,
                chunk_data,
                &language_code,
                whisper_prompt.as_deref(),
                &format!("chunk {}/{}", i + 1, chunk_count),
            ).await?;

            for mut seg in chunk_segments {
                seg.start += chunk_start;
                seg.end += chunk_start;
                seg.duration = (seg.end - seg.start).max(0.0);
                all_segments.push(seg);
            }
        }

        let _ = std::fs::remove_dir_all(&temp_dir);

        let _ = progress_tx.send(ProgressEvent::InProgress {
            step: 3,
            progress: 0.9,
            description: "Обработка результата".to_string()
        }).await;

        for (i, seg) in all_segments.iter_mut().enumerate() {
            seg.id = (i + 1) as u32;
        }
        all_segments
    };

    let segments = sanitize_whisper_segments(raw_segments);

    let language_for_postprocessing = language.clone();
    let postprocessed_result = postprocessing::postprocess_transcription(
        segments,
        postprocessing::PostProcessingOptions {
            fix_punctuation: true,
            fix_names: true,
            target_language: language_for_postprocessing.unwrap_or_else(|| language_code.clone()),
            style_prompt: Some("Профессиональные субтитры для видео".to_string()),
            name_hints: whisper_prompt.clone(),
            glossary: glossary_entries,
        },
        &api_key,
    ).await?;

    let final_segments = postprocessed_result.corrected_segments;

    let _auto_glossary = if final_segments.len() > 5 {
        match auto_generate_glossary_from_segments(&final_segments, "ru", &api_key).await {
            Ok(glossary) => {
                println!("Автоматический глоссарий создан: {} терминов", glossary.len());
                Some(glossary)
            }
            Err(e) => {
                println!("Ошибка генерации глоссария: {}", e);
                None
            }
        }
    } else {
        None
    };

    let _ = progress_tx.send(ProgressEvent::Completed {
        result_count: final_segments.len()
    }).await;
    
    println!("Транскрибация завершена: {} сегментов", final_segments.len());
    Ok(final_segments)
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

/// Сегментов за один запрос: иначе ответ упирается в лимит completion-токенов и JSON обрезается (EOF while parsing).
const TRANSLATION_CHUNK_SIZE: usize = 40;
const TRANSLATION_MAX_TOKENS: u32 = 16384;

async fn translate_segments_chunk(
    client: &reqwest::Client,
    api_key: &str,
    prompt: &str,
    chunk: &[SubtitleSegment],
    log_label: &str,
) -> Result<Vec<crate::types::TranslationResult>, String> {
    let segments_text = serde_json::json!({
        "segments": chunk.iter().map(|s| {
            serde_json::json!({
                "id": s.id,
                "text": s.text,
                "start": s.start,
                "end": s.end
            })
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
    
    let glossary_text = if !glossary.is_empty() {
        let entries = glossary
            .iter()
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
            .collect::<Vec<_>>()
            .join("\n");
        format!(
            "ГЛОССАРИЙ (обязательно соблюдать при переводе):\n{}\n\n",
            entries
        )
    } else {
        String::new()
    };
    
    let prompt = format!(
        "Ты профессиональный переводчик субтитров. Переведи текст на {}.\n\n\
        {}\
        СТИЛЬ ПЕРЕВОДА: {}\n\n\
        Требования к переводу:\n\
        • Сохраняй естественность речи на целевом языке\n\
        • Учитывай контекст диалога\n\
        • Соблюдай глоссарий терминов (если указан)\n\
        • Имена персонажей, прозвища, названия мест, организаций и другие имена собственные ПЕРЕВОДИ/ЛОКАЛИЗУЙ на целевой язык, а не оставляй автоматически в исходном написании\n\
        • Если в глоссарии есть конкретная форма имени/термина, используй строго её (это приоритет над общим правилом)\n\
        • Оставляй исходное написание только когда это осознанно необходимо по нормам языка/контекста (например, устоявшийся бренд без перевода)\n\
        • Длина перевода должна быть сопоставима с оригиналом для синхронизации с видео\n\n\
        Пример ожидаемого поведения: \"My name is Dipper.\" -> \"Меня зовут Диппер.\"\n\n\
        Верни JSON-объект с ключом \"translations\": массив объектов \
        {{\"id\": число, \"translated_text\": \"текст\"}} — по одному объекту на каждый сегмент из запроса.",
        target_language,
        glossary_text,
        style_prompt
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
                println!("ℹПрименён глоссарий к сегменту #{}: \"{}\" → \"{}\"", 
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

/// Один запрос к Whisper API (verbose_json) для уже подготовленного буфера mp3
/// Возвращает сырые сегменты без дедупликации и со start/end относительно
/// начала переданного буфера.
async fn whisper_call(
    client: &reqwest::Client,
    api_key: &str,
    file_data: Vec<u8>,
    language_code: &str,
    prompt: Option<&str>,
    log_label: &str,
) -> Result<Vec<SubtitleSegment>, String> {
    use reqwest::multipart;

    let file_size_bytes = file_data.len();

    let file_part = multipart::Part::bytes(file_data)
        .file_name("audio.mp3")
        .mime_str("audio/mpeg")
        .map_err(|e| e.to_string())?;

    let mut form = multipart::Form::new()
        .text("model", "whisper-1")
        .text("language", language_code.to_string())
        .text("temperature", "0")
        .text("response_format", "verbose_json")
        .text("timestamp_granularities[]", "segment")
        .text("timestamp_granularities[]", "word")
        .part("file", file_part);

    if let Some(p) = prompt {
        if !p.trim().is_empty() {
            form = form.text("prompt", p.to_string());
        }
    }

    log_debug_block(
        &format!("whisper [{log_label}]: запрос"),
        &format!(
            "model: whisper-1\n\
language: {language_code}\n\
temperature: 0\n\
response_format: verbose_json\n\
timestamp_granularities: segment, word\n\
file: ({file_size_bytes} байт)\n\
\n\
prompt (опционально):\n{}",
            prompt.unwrap_or("(не задан)")
        ),
    );

    let res = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса к OpenAI: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let error_text = res.text().await.unwrap_or_else(|_| "Неизвестная ошибка".to_string());
        return Err(format!("OpenAI ошибка ({}): {}", status, error_text));
    }

    let response: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let response_pretty = serde_json::to_string_pretty(&response).unwrap_or_else(|e| e.to_string());
    log_debug_block(
        &format!("whisper [{log_label}]: ответ API (verbose_json)"),
        &response_pretty,
    );

    parse_whisper_response(response)
}

/// Извлекает фрагмент аудио в новый mp3-файл через ffmpeg (-c copy
/// без перекодирования — быстро) start_seconds ставится перед `-i`
/// (input seek), что для CBR mp3 даёт точный и быстрый разрез.
async fn extract_audio_chunk(
    input_path: &Path,
    output_path: &Path,
    start_seconds: f64,
    duration_seconds: f64,
) -> Result<(), String> {
    use tokio::process::Command;

    let status = Command::new("ffmpeg")
        .arg("-y")
        .arg("-loglevel")
        .arg("error")
        .arg("-ss")
        .arg(format!("{:.3}", start_seconds))
        .arg("-t")
        .arg(format!("{:.3}", duration_seconds))
        .arg("-i")
        .arg(input_path)
        .arg("-c")
        .arg("copy")
        .arg(output_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| format!("Ошибка запуска ffmpeg: {}", e))?;

    if !status.success() {
        return Err(format!(
            "ffmpeg не смог извлечь кусок аудио (start={:.3}, duration={:.3})",
            start_seconds, duration_seconds
        ));
    }

    if !output_path.exists() {
        return Err("ffmpeg не создал файл куска аудио".to_string());
    }

    Ok(())
}

/// Whisper иногда повторяет один и тот же текст в нескольких подряд идущих сегментах
/// (особенно при тишине / хвостах) — режем дубликаты по нормализованному ключу.
fn whisper_segment_dedup_key(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn sanitize_whisper_segments(segments: Vec<SubtitleSegment>) -> Vec<SubtitleSegment> {
    if segments.len() < 2 {
        return segments;
    }
    let mut out: Vec<SubtitleSegment> = Vec::with_capacity(segments.len());
    let mut prev_key: Option<String> = None;
    for seg in segments {
        let key = whisper_segment_dedup_key(&seg.text);
        if key.is_empty() {
            out.push(seg);
            prev_key = Some(key);
            continue;
        }
        if prev_key.as_deref() == Some(key.as_str()) {
            continue;
        }
        prev_key = Some(key);
        out.push(seg);
    }
    for (i, seg) in out.iter_mut().enumerate() {
        seg.id = (i + 1) as u32;
    }
    out
}

fn parse_whisper_response(response: serde_json::Value) -> Result<Vec<SubtitleSegment>, String> {
    let segments = response["segments"]
        .as_array()
        .ok_or("Нет сегментов в ответе".to_string())?;
    
    let result: Vec<SubtitleSegment> = segments
        .iter()
        .enumerate()
        .map(|(i, seg)| {
            let id = (i + 1) as u32;
            let mut start = json_seconds(&seg["start"]);
            let mut end = json_seconds(&seg["end"]);
            let text = seg["text"].as_str().unwrap_or("").trim().to_string();

            if let Some(words) = seg["words"].as_array() {
                if let (Some(first), Some(last)) = (words.first(), words.last()) {
                    let ws = json_seconds(&first["start"]);
                    let we = json_seconds(&last["end"]);
                    if we > ws {
                        start = ws;
                        end = we;
                    }
                }
            }

            let duration = (end - start).max(0.0);
            
            SubtitleSegment {
                id,
                start,
                end,
                duration,
                text,
                translation: None,
                flags: None,
            }
        })
        .collect();
    
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
    // translated_text — это валидный ответ модели, а не ошибка.
    // Пустоты будут заменены оригиналом в translate_batch.
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