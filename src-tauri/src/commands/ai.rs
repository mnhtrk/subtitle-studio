use serde::{Deserialize, Serialize};
use crate::project::{SubtitleSegment, GlossaryEntry};
use keyring::Entry;
use crate::project::glossary::apply_glossary;
use tokio::sync::mpsc;
use tauri::Emitter;
use std::collections::{HashMap};
use std::path::Path;
use crate::gender_detection;
use crate::speaker_gender_rules::{
    dialogue_context_translation_rules, normalize_target_language_iso,
    segment_speaker_gender_str, speaker_gender_translation_rules,
};
use crate::postprocessing;
use crate::commands::ai_cancel;
use crate::vad;

const DEBUG_LOG_MAX_CHARS: usize = 24_000;
// лимит whisper ~25mb, чуть меньше на всякий
const WHISPER_MAX_FILE_BYTES: u64 = 24 * 1024 * 1024;
// кусок при нарезке жирного файла
const WHISPER_CHUNK_TARGET_BYTES: u64 = 18 * 1024 * 1024;

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
    
    // проверка ключа
    let client = reqwest::Client::new();
    let res = client
        .get("https://api.openai.com/v1/models")
        .bearer_auth(&key)
        .send()
        .await;
    
    match res {
        Ok(response) => {
            if response.status().is_success() {
                // какие модели доступны
                let models: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
                let available_models: Vec<String> = models["data"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|model| model["id"].as_str())
                    .map(|s| s.to_string())
                    .collect();
                
                let required_models = ["whisper-1", "gpt-5.4"];
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
                        error_message: Some(
                            "Ключ действителен, но недоступны необходимые модели (whisper-1, gpt-5.4)"
                                .to_string(),
                        ),
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
            "[усечено: показано ~{DEBUG_LOG_MAX_CHARS} символов из {count}]"
        );
    }
}

fn format_subtitle_time(seconds: f64) -> String {
    let total = seconds.max(0.0);
    let m = (total as u64) / 60;
    let s = total % 60.0;
    format!("{m:02}:{s:05.2}")
}

fn format_segments_for_debug(segments: &[SubtitleSegment]) -> String {
    let mut lines: Vec<String> = Vec::with_capacity(segments.len() + 1);
    lines.push(format!(
        "  {:>3}  {:>11}  {:>7}  {}",
        "id", "time", "gender", "text"
    ));
    lines.push("  ---  -----------  -------  ----".to_string());
    for s in segments {
        let gender = segment_speaker_gender_str(s);
        lines.push(format!(
            "  {:>3}  {}-{}  {:>7}  {}",
            s.id,
            format_subtitle_time(s.start),
            format_subtitle_time(s.end),
            gender,
            s.text
        ));
    }
    lines.join("\n")
}

fn format_translation_response_for_debug(response: &serde_json::Value) -> String {
    let content = response["choices"][0]["message"]["content"].as_str();
    let Some(raw) = content else {
        return "(нет content в ответе)".to_string();
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(raw) else {
        return format!("(не JSON)\n{raw}");
    };
    let Some(arr) = find_translation_array(&parsed) else {
        return serde_json::to_string_pretty(&parsed).unwrap_or_else(|_| raw.to_string());
    };
    let mut lines = vec!["  id  translation".to_string(), "  ---  -----------".to_string()];
    for item in arr {
        let id = item.get("id").map(|v| v.to_string()).unwrap_or_else(|| "?".into());
        let text = item
            .get("translated_text")
            .or_else(|| item.get("translation"))
            .or_else(|| item.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let one_line: String = text.lines().collect::<Vec<_>>().join(" ");
        lines.push(format!("  {id:>3}  {one_line}"));
    }
    lines.join("\n")
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
pub fn cancel_ai_operation() {
    ai_cancel::request_ai_operation_cancel();
}

#[tauri::command]
pub async fn transcribe_audio(
    file_path: String,
    language: Option<String>,
    prompt: Option<String>,
    glossary: Option<Vec<GlossaryEntry>>,
    skip_vad: Option<bool>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<SubtitleSegment>, String> {
    println!("📝 Транскрибация файла: {}", file_path);
    ai_cancel::reset_ai_operation_cancel();

    let api_key = get_api_key()?;
    let language_code = normalize_whisper_language(&language)?;

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

    let _ = progress_tx
        .send(ProgressEvent::Started {
            total_steps: 4,
            description: "Подготовка файла".to_string(),
        })
        .await;

    let _ = progress_tx
        .send(ProgressEvent::InProgress {
            step: 1,
            progress: 0.15,
            description: "Подготовка аудио".to_string(),
        })
        .await;

    let file_metadata = std::fs::metadata(&file_path)
        .map_err(|e| format!("Ошибка чтения файла: {}", e))?;
    let _file_size_bytes = file_metadata.len();

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
    let base_prompt_lower = base_prompt.as_deref().unwrap_or("").to_lowercase();
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
    // anchor в конце промпта - whisper копирует пунктуацию
    let style_anchor = whisper_style_anchor(&language_code);
    let mut prompt_parts: Vec<String> = Vec::new();
    if let Some(base) = base_prompt {
        prompt_parts.push(base);
    }
    if let Some(glossary_block) = glossary_prompt {
        prompt_parts.push(glossary_block);
    }
    prompt_parts.push(style_anchor);
    let whisper_prompt: Option<String> = Some(prompt_parts.join("\n\n"));

    println!(
        "[transcribe_audio] whisper prompt: user + {} glossary terms + style anchor, language={}",
        missing_glossary_originals.len(),
        language_code
    );

    let audio_path = Path::new(&file_path);
    let client = reqwest::Client::new();

    let raw_segments = if skip_vad.unwrap_or(false) {
        println!("[transcribe_audio] VAD выкл (ручной отрывок)");
        let _ = progress_tx
            .send(ProgressEvent::InProgress {
                step: 2,
                progress: 0.35,
                description: "Whisper".to_string(),
            })
            .await;
        transcribe_whisper_direct(
            &client,
            &api_key,
            audio_path,
            &language_code,
            whisper_prompt.as_deref(),
            &progress_tx,
        )
        .await?
    } else {
        let _ = progress_tx
            .send(ProgressEvent::InProgress {
                step: 1,
                progress: 0.25,
                description: "VAD: поиск речи".to_string(),
            })
            .await;

        ai_cancel::check_ai_operation_cancelled()?;
        let raw_vad =
            vad::detect_speech_segments(audio_path, vad::VadParams::default()).await?;
        ai_cancel::check_ai_operation_cancelled()?;
        const VAD_MARGIN_PRE_SEC: f64 = 0.15;
        const VAD_MARGIN_POST_SEC: f64 = 2.0;
        const VAD_CHUNK_GAP_SEC: f64 = 0.08;
        let merged = vad::merge_nearby_speech_segments(&raw_vad, 0.45);
        let speech_segments = vad::expand_speech_margins(
            &merged,
            VAD_MARGIN_PRE_SEC,
            VAD_MARGIN_POST_SEC,
            VAD_CHUNK_GAP_SEC,
        );
        vad::log_vad_whisper_overlap(&speech_segments);
        if raw_vad.len() != speech_segments.len() {
            println!(
                "[vad] после merge+margin: {} → {} кусков речи",
                raw_vad.len(),
                speech_segments.len()
            );
        }

        if speech_segments.is_empty() {
            return Err(
                "VAD: речь не найдена (порог в vad/mod.rs VadParams::threshold)".into(),
            );
        }

        transcribe_vad_speech_segments(
            &client,
            &api_key,
            audio_path,
            &speech_segments,
            &language_code,
            whisper_prompt.as_deref(),
            &progress_tx,
        )
        .await?
    };

    ai_cancel::check_ai_operation_cancelled()?;

    let _ = progress_tx
        .send(ProgressEvent::InProgress {
            step: 3,
            progress: 0.85,
            description: "Обработка результата".to_string(),
        })
        .await;

    let segments = apply_subtitle_timing_postprocess(sanitize_whisper_segments(raw_segments));

    ai_cancel::check_ai_operation_cancelled()?;

    let postprocessed_result = postprocessing::postprocess_transcription(
        segments,
        postprocessing::PostProcessingOptions {
            fix_punctuation: true,
            fix_names: true,
            target_language: language
                .clone()
                .unwrap_or_else(|| language_code.clone()),
            style_prompt: Some("Профессиональные субтитры для видео".to_string()),
            name_hints: whisper_prompt.clone(),
            glossary: glossary_entries,
        },
        &api_key,
    )
    .await?;

    ai_cancel::check_ai_operation_cancelled()?;

    let mut final_segments = postprocessed_result.corrected_segments;

    let file_path_buf = Path::new(&file_path);
    let _ = progress_tx
        .send(ProgressEvent::InProgress {
            step: 4,
            progress: 0.92,
            description: "Определение пола говорящих".to_string(),
        })
        .await;
    match gender_detection::assign_speaker_genders(file_path_buf, &mut final_segments).await {
        Err(e) if ai_cancel::is_cancelled_error(&e) => return Err(e),
        Err(e) => println!("[gender] пропущено: {}", e),
        Ok(()) => {}
    }

    ai_cancel::check_ai_operation_cancelled()?;

    let _auto_glossary = if final_segments.len() > 5 {
        ai_cancel::check_ai_operation_cancelled()?;
        match auto_generate_glossary_from_segments(&final_segments, "ru", &api_key).await {
            Ok(glossary) => {
                println!("[glossary] автоглоссарий: {} терминов", glossary.len());
                Some(glossary)
            }
            Err(e) if ai_cancel::is_cancelled_error(&e) => return Err(e),
            Err(e) => {
                println!("[glossary] ошибка генерации: {}", e);
                None
            }
        }
    } else {
        None
    };

    let _ = progress_tx
        .send(ProgressEvent::Completed {
            result_count: final_segments.len(),
        })
        .await;

    println!("[transcribe] завершено: {} сегментов", final_segments.len());
    Ok(final_segments)
}

fn build_gpt4o_transcription_prompt(
    prompt: Option<String>,
    glossary: Option<Vec<GlossaryEntry>>,
) -> Option<String> {
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
    let base_prompt_lower = base_prompt.as_deref().unwrap_or("").to_lowercase();
    let missing: Vec<String> = glossary_originals
        .into_iter()
        .filter(|source| !base_prompt_lower.contains(&source.to_lowercase()))
        .collect();
    let glossary_prompt = if missing.is_empty() {
        None
    } else {
        Some(format!(
            "Important names/terms to keep exactly:\n{}",
            missing.join(", ")
        ))
    };

    let mut parts: Vec<String> = Vec::new();
    if let Some(base) = base_prompt {
        parts.push(base);
    }
    if let Some(glossary_block) = glossary_prompt {
        parts.push(glossary_block);
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

// gpt-4o transcribe на кусок аудио, без таймкодов
#[tauri::command]
pub async fn transcribe_audio_gpt4o(
    file_path: String,
    language: Option<String>,
    prompt: Option<String>,
    glossary: Option<Vec<GlossaryEntry>>,
) -> Result<String, String> {
    println!("📝 GPT-4o Transcribe: {}", file_path);
    ai_cancel::reset_ai_operation_cancel();
    ai_cancel::check_ai_operation_cancelled()?;

    let api_key = get_api_key()?;
    let language_code = normalize_whisper_language(&language)?;
    let gpt4o_prompt = build_gpt4o_transcription_prompt(prompt, glossary);

    let file_data = std::fs::read(&file_path).map_err(|e| format!("Ошибка чтения файла: {}", e))?;
    if file_data.is_empty() {
        return Err("Аудиофайл пуст".into());
    }

    let client = reqwest::Client::new();
    gpt4o_transcribe_call(
        &client,
        &api_key,
        file_data,
        &language_code,
        gpt4o_prompt.as_deref(),
        "range",
    )
    .await
}

fn whisper_style_anchor(language_code: &str) -> String {
    let lang = language_code.trim().to_lowercase();
    match lang.as_str() {
        "ru" => "Привет, друг. Как дела сегодня? Я в порядке, спасибо! Давай начнём.".to_string(),
        "uk" => "Привіт, друже. Як справи сьогодні? Все добре, дякую! Почнемо.".to_string(),
        "be" => "Прывітанне, дружа. Як справы сёння? Усё добра, дзякуй! Пачнём.".to_string(),
        "pl" => "Cześć, przyjacielu. Jak się dzisiaj masz? Wszystko dobrze, dziękuję! Zaczynajmy.".to_string(),
        "cs" => "Ahoj, příteli. Jak se dnes máš? Dobře, díky! Začneme.".to_string(),
        "sk" => "Ahoj, priateľu. Ako sa dnes máš? Dobre, vďaka! Začnime.".to_string(),
        "de" => "Hallo, Freund. Wie geht es dir heute? Mir geht es gut, danke! Lass uns anfangen.".to_string(),
        "fr" => "Bonjour, ami. Comment vas-tu aujourd'hui ? Je vais bien, merci ! Commençons.".to_string(),
        "es" => "Hola, amigo. ¿Cómo estás hoy? Estoy bien, gracias. ¡Empecemos!".to_string(),
        "it" => "Ciao, amico. Come stai oggi? Sto bene, grazie. Iniziamo!".to_string(),
        "pt" => "Olá, amigo. Como vai você hoje? Estou bem, obrigado. Vamos começar!".to_string(),
        "nl" => "Hallo, vriend. Hoe gaat het vandaag? Goed, bedankt! Laten we beginnen.".to_string(),
        "tr" => "Merhaba, dostum. Bugün nasılsın? İyiyim, teşekkürler. Başlayalım!".to_string(),
        // english дефолт для anchor
        _ => "Hello, friend. How are you today? I'm fine, thanks. Let's begin.".to_string(),
    }
}

// язык -> iso; en по умолчанию нельзя, русский тогда в кашу
fn normalize_whisper_language(language: &Option<String>) -> Result<String, String> {
    let raw = language
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            "Не указан язык исходной записи. Выберите язык (например Russian / ru) перед транскрипцией."
                .to_string()
        })?;

    let lower = raw.to_lowercase();
    let iso = match lower.as_str() {
        "en" | "english" | "английский" => "en",
        "ru" | "russian" | "русский" => "ru",
        "es" | "spanish" | "испанский" => "es",
        "fr" | "french" | "французский" => "fr",
        "de" | "german" | "немецкий" => "de",
        "it" | "italian" | "итальянский" => "it",
        "pt" | "portuguese" | "португальский" => "pt",
        "zh" | "chinese" | "китайский" => "zh",
        "ja" | "japanese" | "японский" => "ja",
        "ko" | "korean" | "корейский" => "ko",
        "ar" | "arabic" | "арабский" => "ar",
        "hi" | "hindi" | "хинди" => "hi",
        "tr" | "turkish" | "турецкий" => "tr",
        "pl" | "polish" | "польский" => "pl",
        "uk" | "ukrainian" | "украинский" => "uk",
        code if code.len() == 2 && code.chars().all(|c| c.is_ascii_lowercase()) => code,
        _ => {
            return Err(format!(
                "Не удалось распознать код языка «{}». Используйте ru, en, Russian, English и т.п.",
                raw
            ));
        }
    };
    Ok(iso.to_string())
}

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
        let error_text = res
            .text()
            .await
            .unwrap_or_else(|_| "Неизвестная ошибка".to_string());
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

// gpt-4o transcribe, в ответе только текст
async fn gpt4o_transcribe_call(
    client: &reqwest::Client,
    api_key: &str,
    file_data: Vec<u8>,
    language_code: &str,
    prompt: Option<&str>,
    log_label: &str,
) -> Result<String, String> {
    use reqwest::multipart;

    let file_size_bytes = file_data.len();

    let file_part = multipart::Part::bytes(file_data)
        .file_name("segment.mp3")
        .mime_str("audio/mpeg")
        .map_err(|e| e.to_string())?;

    let mut form = multipart::Form::new()
        .text("model", "gpt-4o-transcribe")
        .text("language", language_code.to_string())
        .text("response_format", "json")
        .part("file", file_part);

    if let Some(p) = prompt {
        if !p.trim().is_empty() {
            form = form.text("prompt", p.to_string());
        }
    }

    log_debug_block(
        &format!("gpt-4o-transcribe [{log_label}]: запрос"),
        &format!(
            "model: gpt-4o-transcribe\n\
language: {language_code}\n\
response_format: json\n\
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
        let error_text = res
            .text()
            .await
            .unwrap_or_else(|_| "Неизвестная ошибка".to_string());
        return Err(format!("OpenAI gpt-4o-transcribe ({}): {}", status, error_text));
    }

    let response: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let response_pretty = serde_json::to_string_pretty(&response).unwrap_or_else(|e| e.to_string());
    log_debug_block(
        &format!("gpt-4o-transcribe [{log_label}]: ответ API"),
        &response_pretty,
    );

    if let Some(text) = response.get("text").and_then(|v| v.as_str()) {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err("gpt-4o-transcribe вернул пустой текст".into());
        }
        return Ok(trimmed.to_string());
    }

    if let Some(text) = response.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    Err("gpt-4o-transcribe: не удалось извлечь текст из ответа".into())
}

fn shift_segment_times(segments: &mut [SubtitleSegment], offset_seconds: f64) {
    for seg in segments.iter_mut() {
        seg.start += offset_seconds;
        seg.end += offset_seconds;
        seg.duration = (seg.end - seg.start).max(0.05);
    }
}

// retranscribe: весь файл в whisper, vad выкл
async fn transcribe_whisper_direct(
    client: &reqwest::Client,
    api_key: &str,
    file_path: &Path,
    language_code: &str,
    whisper_prompt: Option<&str>,
    progress_tx: &mpsc::Sender<ProgressEvent>,
) -> Result<Vec<SubtitleSegment>, String> {
    let file_size = std::fs::metadata(file_path)
        .map_err(|e| format!("metadata: {}", e))?
        .len();

    if file_size <= WHISPER_MAX_FILE_BYTES {
        let data = std::fs::read(file_path).map_err(|e| e.to_string())?;
        return whisper_call(
            client,
            api_key,
            data,
            language_code,
            whisper_prompt,
            "direct",
        )
        .await;
    }

    let duration = crate::commands::audio::media_duration_seconds(file_path)
        .await
        .map_err(|e| format!("длительность аудио: {}", e))?;
    if duration <= 0.0 {
        return Err("нулевая длительность аудио".into());
    }

    let chunk_count =
        ((file_size + WHISPER_CHUNK_TARGET_BYTES - 1) / WHISPER_CHUNK_TARGET_BYTES) as usize;
    let chunk_count = chunk_count.max(2);
    let chunk_seconds = (duration / chunk_count as f64).max(1.0);

    println!(
        "[whisper] direct: {:.1} MB, {} кусков по ~{:.1}s",
        file_size as f64 / (1024.0 * 1024.0),
        chunk_count,
        chunk_seconds
    );

    let temp_dir = std::env::temp_dir().join(format!("whisper_chunks_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let mut all_segments: Vec<SubtitleSegment> = Vec::new();

    for i in 0..chunk_count {
        ai_cancel::check_ai_operation_cancelled()?;
        let chunk_start = (i as f64) * chunk_seconds;
        let chunk_path = temp_dir.join(format!("chunk_{:03}.mp3", i));

        let progress = 0.35 + (i as f64 / chunk_count as f64) * 0.45;
        let _ = progress_tx
            .send(ProgressEvent::InProgress {
                step: 2,
                progress,
                description: format!("Whisper: {} / {}", i + 1, chunk_count),
            })
            .await;

        extract_audio_chunk(file_path, &chunk_path, chunk_start, chunk_seconds).await?;

        let chunk_data = std::fs::read(&chunk_path)
            .map_err(|e| format!("чтение куска {}: {}", i + 1, e))?;

        let chunk_segments = whisper_call(
            client,
            api_key,
            chunk_data,
            language_code,
            whisper_prompt,
            &format!("direct {}/{}", i + 1, chunk_count),
        )
        .await?;

        for mut seg in chunk_segments {
            seg.start += chunk_start;
            seg.end += chunk_start;
            seg.duration = (seg.end - seg.start).max(0.05);
            all_segments.push(seg);
        }
    }

    let _ = std::fs::remove_dir_all(&temp_dir);

    for (i, seg) in all_segments.iter_mut().enumerate() {
        seg.id = (i + 1) as u32;
    }

    Ok(all_segments)
}

async fn extract_audio_chunk(
    input_path: &Path,
    output_path: &Path,
    start_seconds: f64,
    duration_seconds: f64,
) -> Result<(), String> {
    use std::process::Stdio;
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
        .map_err(|e| format!("ffmpeg: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "ffmpeg: не вырезал {:.3}+{:.3}",
            start_seconds, duration_seconds
        ))
    }
}

// vad кусок -> whisper, таймкоды + speech.start
async fn transcribe_vad_speech_segments(
    client: &reqwest::Client,
    api_key: &str,
    original_path: &Path,
    speech_segments: &[vad::SpeechSegment],
    language_code: &str,
    whisper_prompt: Option<&str>,
    progress_tx: &mpsc::Sender<ProgressEvent>,
) -> Result<Vec<SubtitleSegment>, String> {
    let total = speech_segments.len();
    let temp_dir = std::env::temp_dir().join(format!("vad_whisper_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("temp dir: {}", e))?;

    let mut all_segments: Vec<SubtitleSegment> = Vec::new();

    println!(
        "[whisper] режим VAD: {} кусков речи → {} запросов API (без склейки)",
        total, total
    );

    for (i, speech) in speech_segments.iter().enumerate() {
        ai_cancel::check_ai_operation_cancelled()?;
        let chunk_index = i + 1;
        let timeline_start = speech.start;
        let duration = (speech.end - speech.start).max(0.05);

        let progress = 0.30 + (i as f64 / total as f64) * 0.55;
        let _ = progress_tx
            .send(ProgressEvent::InProgress {
                step: 2,
                progress,
                description: format!("Whisper: кусок {} из {}", chunk_index, total),
            })
            .await;

        println!(
            "[whisper] VAD-кусок {} из {} [{} - {}] ({:.1}s)",
            chunk_index,
            total,
            vad::format_timestamp_hms(timeline_start),
            vad::format_timestamp_hms(speech.end),
            duration,
        );

        let chunk_path = temp_dir.join(format!("vad_{:04}.mp3", i));
        vad::extract_segment_audio(original_path, &chunk_path, timeline_start, duration).await?;

        let file_data = std::fs::read(&chunk_path)
            .map_err(|e| format!("чтение VAD-куска {}: {}", chunk_index, e))?;
        let file_size = file_data.len() as u64;

        if file_size <= WHISPER_MAX_FILE_BYTES {
            let label = format!("vad {}/{}", chunk_index, total);
            let mut segs = whisper_call(
                client,
                api_key,
                file_data,
                language_code,
                whisper_prompt,
                &label,
            )
            .await?;
            shift_segment_times(&mut segs, timeline_start);
            println!(
                "[whisper] VAD-кусок {}: {} субтитр(ов)",
                chunk_index,
                segs.len()
            );
            all_segments.extend(segs);
        } else {
            let sub_count = ((file_size + WHISPER_CHUNK_TARGET_BYTES - 1)
                / WHISPER_CHUNK_TARGET_BYTES) as usize;
            let sub_count = sub_count.max(2);
            let sub_seconds = duration / sub_count as f64;
            println!(
                "[whisper] VAD-кусок {} большой ({:.1} MB) — {} подкусков",
                chunk_index,
                file_size as f64 / (1024.0 * 1024.0),
                sub_count
            );
            for j in 0..sub_count {
                ai_cancel::check_ai_operation_cancelled()?;
                let local_start = j as f64 * sub_seconds;
                let sub_path = temp_dir.join(format!("vad_{:04}_sub{:03}.mp3", i, j));
                vad::extract_segment_audio(
                    original_path,
                    &sub_path,
                    timeline_start + local_start,
                    sub_seconds,
                )
                .await?;
                let sub_data = std::fs::read(&sub_path)
                    .map_err(|e| format!("чтение подкуска {}: {}", j + 1, e))?;
                let label = format!(
                    "vad {}/{} sub {}/{}",
                    chunk_index,
                    total,
                    j + 1,
                    sub_count
                );
                let mut segs = whisper_call(
                    client,
                    api_key,
                    sub_data,
                    language_code,
                    whisper_prompt,
                    &label,
                )
                .await?;
                shift_segment_times(&mut segs, timeline_start + local_start);
                all_segments.extend(segs);
                let _ = std::fs::remove_file(&sub_path);
            }
        }

        let _ = std::fs::remove_file(&chunk_path);
    }

    let _ = std::fs::remove_dir_all(&temp_dir);

    for (idx, seg) in all_segments.iter_mut().enumerate() {
        seg.id = (idx + 1) as u32;
    }

    println!(
        "[whisper] итого {} субтитр(ов) из {} VAD-кусков",
        all_segments.len(),
        total
    );

    Ok(all_segments)
}

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
        .take(20) // макс 20 слов
        .map(|(word, _)| word)
        .collect();
    
    if selected_words.is_empty() {
        return Ok(Vec::new());
    }

    ai_cancel::check_ai_operation_cancelled()?;

    // промпт глоссария
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
            "model": CHAT_COMPLETION_MODEL,
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

// не слишком много сегментов за раз, json режется
const TRANSLATION_CHUNK_SIZE: usize = 40;
const TRANSLATION_MAX_TOKENS: u32 = 16384;
const CHAT_COMPLETION_MODEL: &str = "gpt-5.4";

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
            obj["speaker_gender"] = serde_json::json!(segment_speaker_gender_str(s));
            obj
        }).collect::<Vec<_>>()
    });

    let user_content = serde_json::to_string(&segments_text).map_err(|e| e.to_string())?;

    let segments_debug = format_segments_for_debug(chunk);
    log_debug_block(
        &format!("перевод [{log_label}]: запрос"),
        &format!(
            "model: {CHAT_COMPLETION_MODEL}\n\
temperature: 0.3\n\
max_completion_tokens: {TRANSLATION_MAX_TOKENS}\n\
response_format: json_object\n\
сегментов в пакете: {}\n\
\n\
--- system ---\n\
{prompt}\n\
\n\
--- user: сегменты (в API уходит JSON) ---\n\
{segments_debug}",
            chunk.len(),
        ),
    );

    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": CHAT_COMPLETION_MODEL,
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
    log_debug_block(
        &format!("перевод [{log_label}]: ответ"),
        &format_translation_response_for_debug(&response),
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
    ai_cancel::reset_ai_operation_cancel();

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

    // собираем промпт
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
    
    let target_iso = normalize_target_language_iso(&target_language);
    let dialogue_hint = dialogue_context_translation_rules(&target_language);
    let gender_hint = speaker_gender_translation_rules(&target_language);
    if gender_hint.is_empty() {
        println!(
            "[translate] диалог+род: только базовый контекст (target={:?}, iso={:?})",
            target_language, target_iso
        );
    } else {
        println!(
            "[translate] диалог+род: полный блок (target={}, iso={})",
            target_language,
            target_iso.as_deref().unwrap_or("?")
        );
    }

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
        {dialogue_hint}\
        Требования к переводу:\n\
        {gender_hint}\
        - Сохраняй естественность речи на целевом языке\n\
        - Субтитры обычно для дубляжа: перевод произносят вслух за время реплики — не удлиняй без нужды\n\
        - Ориентир длины: поле text в JSON (исходник); перевод не длиннее оригинала, если смысл сохраняется\n\
        - Не добавляй лишние вступления и не дроби одну короткую фразу на два вопроса; одна мысль в источнике → одна компактная фраза\n\
        - Предпочитай короткие синонимы; лишние слова убирай, но не жертвуй смыслом и грамматикой\n\
        - Соблюдай глоссарий терминов (если указан); в глоссарии может быть пол персонажей, о которых идет речь в третьем лице\n\
        - Имена персонажей, прозвища, названия мест и другие имена собственные локализуй на целевой язык, если это уместно\n\
        - Если в глоссарии есть конкретная форма имени/термина, используй строго её\n\n\
        Пример локализации имени: \"My name is Alex.\" -> \"Меня зовут Алекс.\"\n\n\
        Верни JSON-объект с ключом \"translations\": массив объектов \
        {{\"id\": число, \"translated_text\": \"текст\"}} по одному на каждый сегмент из запроса.",
        target_language = target_language,
        mandatory_block = mandatory_block,
        glossary_text = glossary_text,
        style_prompt = style_prompt,
        dialogue_hint = dialogue_hint,
        gender_hint = gender_hint,
    );

    let client = reqwest::Client::new();
    let chunks: Vec<&[SubtitleSegment]> = segments.chunks(TRANSLATION_CHUNK_SIZE).collect();
    let total_chunks = chunks.len().max(1);

    let mut merged_by_id: HashMap<u32, String> = HashMap::new();

    for (i, chunk) in chunks.iter().enumerate() {
        ai_cancel::check_ai_operation_cancelled()?;
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
        ai_cancel::check_ai_operation_cancelled()?;
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
            ai_cancel::check_ai_operation_cancelled()?;
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

    // в ответ
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

    // глоссарий поверх перевода
    if !glossary.is_empty() {
    for translation in &mut translations {
        if let Some(segment) = segments.iter().find(|s| s.id == translation.id) {
            let original_with_glossary = apply_glossary(&segment.text, &glossary);
            translation.translated_text = apply_glossary(&translation.translated_text, &glossary);
            
            // дебаг если что поменялось
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

// прогресс в ui
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

#[derive(Clone)]
struct WhisperWord {
    text: String,
    start: f64,
    end: f64,
}

fn parse_word_entry(w: &serde_json::Value) -> Option<WhisperWord> {
    let text = w["word"].as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    let start = json_seconds(&w["start"]);
    let end = json_seconds(&w["end"]);
    if end <= start {
        return None;
    }
    Some(WhisperWord {
        text: text.to_string(),
        start,
        end,
    })
}

fn parse_whisper_words(response: &serde_json::Value) -> Vec<WhisperWord> {
    response["words"]
        .as_array()
        .map(|arr| arr.iter().filter_map(parse_word_entry).collect())
        .unwrap_or_default()
}

fn parse_segment_words(seg: &serde_json::Value) -> Vec<WhisperWord> {
    seg["words"]
        .as_array()
        .map(|arr| arr.iter().filter_map(parse_word_entry).collect())
        .unwrap_or_default()
}

// mr. dr. и тп - точка не конец фразы
const SENTENCE_END_EXCEPTIONS: &[&str] = &[
    "mr", "mrs", "ms", "dr", "sr", "jr", "st", "prof", "capt", "lt",
    "vs", "etc", "vol", "no", "fig",
];

// режем сегмент whisper по . ! ? (тайминги из words)
fn split_segment_into_sentences(
    seg_text: &str,
    words: &[WhisperWord],
) -> Option<Vec<(String, f64, f64)>> {
    if words.is_empty() || seg_text.is_empty() {
        return None;
    }

    let lower_text = seg_text.to_lowercase();
    // lower_text другой длины (ß и тп) - не трогать, уйдет в fallback
    if lower_text.len() != seg_text.len() {
        return None;
    }

    let mut positions: Vec<(usize, usize)> = Vec::with_capacity(words.len());
    let mut cursor = 0usize;
    for word in words {
        let needle = word.text.to_lowercase();
        if needle.is_empty() {
            continue;
        }
        let area = &lower_text[cursor..];
        match area.find(&needle) {
            Some(rel) => {
                let start = cursor + rel;
                let end = start + needle.len();
                positions.push((start, end));
                cursor = end;
            }
            None => return None,
        }
    }
    if positions.is_empty() {
        return None;
    }

    let is_terminal = |c: char| matches!(c, '.' | '!' | '?' | '…');
    let is_closer = |c: char| matches!(c, '»' | '”' | '’' | ')' | ']' | '}');

    let mut out: Vec<(String, f64, f64)> = Vec::new();
    let mut sent_start_text = 0usize;
    let mut sent_start_word = 0usize;

    for i in 0..positions.len() {
        let (_word_start, word_end) = positions[i];
        let next_start = if i + 1 < positions.len() {
            positions[i + 1].0
        } else {
            seg_text.len()
        };
        let between = &seg_text[word_end..next_start];

        let Some(terminal_rel) = between.find(is_terminal) else {
            continue;
        };

        // mr dr vs - точку не считаем концом
        let lw = words[i].text.to_lowercase();
        let stem: String = lw.chars().filter(|c| c.is_alphabetic()).collect();
        if SENTENCE_END_EXCEPTIONS.contains(&stem.as_str()) {
            continue;
        }

        // после точки еще ) ] » ок, кавычки не трогаем
        let mut sentence_end = word_end + terminal_rel;
        let first = seg_text[sentence_end..].chars().next().unwrap();
        sentence_end += first.len_utf8();
        while sentence_end < seg_text.len() {
            let next = seg_text[sentence_end..].chars().next().unwrap();
            if is_terminal(next) || is_closer(next) {
                sentence_end += next.len_utf8();
            } else {
                break;
            }
        }

        let sentence_text = seg_text[sent_start_text..sentence_end].trim().to_string();
        if !sentence_text.is_empty()
            && sentence_text.chars().any(|c| c.is_alphanumeric())
        {
            let start = words[sent_start_word].start;
            let end = words[i].end;
            out.push((sentence_text, start, end));
        }
        sent_start_text = sentence_end;
        sent_start_word = i + 1;
    }

    if sent_start_word < positions.len() {
        let sentence_text = seg_text[sent_start_text..].trim().to_string();
        if !sentence_text.is_empty()
            && sentence_text.chars().any(|c| c.is_alphanumeric())
        {
            let start = words[sent_start_word].start;
            let end = words.last().unwrap().end;
            out.push((sentence_text, start, end));
        }
    }

    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

const MIN_SUBTITLE_DURATION: f64 = 0.05;
/// Минимальное время на экране (короткие реплики из одного слова).
const MIN_SUBTITLE_DISPLAY_SEC: f64 = 1.25;
/// Небольшой хвост после последнего слова Whisper.
const SUBTITLE_END_PAD_SEC: f64 = 0.30;
/// Ориентир скорости чтения (символов/с) для длинных строк.
const SUBTITLE_CHARS_PER_SEC: f64 = 17.0;
const SUBTITLE_MIN_GAP_SEC: f64 = 0.05;

fn subtitle_min_display_duration(text: &str) -> f64 {
    let chars = text.chars().filter(|c| !c.is_whitespace()).count();
    let by_reading = if chars == 0 {
        MIN_SUBTITLE_DISPLAY_SEC
    } else {
        (chars as f64 / SUBTITLE_CHARS_PER_SEC).max(MIN_SUBTITLE_DISPLAY_SEC)
    };
    by_reading
}

/// Удлиняет короткие субтитры и убирает пересечения таймингов после Whisper.
fn apply_subtitle_timing_postprocess(mut segments: Vec<SubtitleSegment>) -> Vec<SubtitleSegment> {
    if segments.is_empty() {
        return segments;
    }
    segments.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let n = segments.len();
    for i in 0..n {
        let min_dur = subtitle_min_display_duration(&segments[i].text);
        let mut desired_end = segments[i].start + min_dur + SUBTITLE_END_PAD_SEC;
        desired_end = desired_end.max(segments[i].end);
        let cap = if i + 1 < n {
            segments[i + 1].start - SUBTITLE_MIN_GAP_SEC
        } else {
            f64::INFINITY
        };
        if desired_end > cap {
            desired_end = cap.max(segments[i].start + MIN_SUBTITLE_DURATION);
        }
        segments[i].end = desired_end.max(segments[i].start + MIN_SUBTITLE_DURATION);
        segments[i].duration = segments[i].end - segments[i].start;
    }

    fix_overlapping_subtitles(&mut segments);

    for (idx, seg) in segments.iter_mut().enumerate() {
        seg.id = (idx + 1) as u32;
    }
    segments
}

fn fix_overlapping_subtitles(segments: &mut [SubtitleSegment]) {
    if segments.len() < 2 {
        return;
    }
    for i in 0..segments.len() - 1 {
        let next_start = segments[i + 1].start;
        let min_end = segments[i].start + MIN_SUBTITLE_DURATION;
        if segments[i].end > next_start - SUBTITLE_MIN_GAP_SEC {
            let new_end = (next_start - SUBTITLE_MIN_GAP_SEC).max(min_end);
            if (segments[i].end - new_end).abs() > 0.001 {
                println!(
                    "[timing] overlap: сегмент #{} end {:.3} → {:.3} (след. start {:.3})",
                    segments[i].id,
                    segments[i].end,
                    new_end,
                    next_start
                );
            }
            segments[i].end = new_end;
            segments[i].duration = segments[i].end - segments[i].start;
        }
    }
}

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

fn parse_whisper_response(response: serde_json::Value) -> Result<Vec<SubtitleSegment>, String> {
    let segments = response["segments"]
        .as_array()
        .ok_or("Нет сегментов в ответе Whisper".to_string())?;

    let all_words = parse_whisper_words(&response);
    let mut result: Vec<SubtitleSegment> = Vec::new();

    for seg in segments {
        let seg_start = json_seconds(&seg["start"]);
        let seg_end = json_seconds(&seg["end"]);
        let seg_text = seg["text"].as_str().unwrap_or("").trim().to_string();
        if seg_text.is_empty() || seg_end <= seg_start {
            continue;
        }

        let nested = parse_segment_words(seg);
        let words: Vec<WhisperWord> = if !nested.is_empty() {
            nested
        } else {
            all_words
                .iter()
                .filter(|w| w.end > seg_start && w.start < seg_end)
                .cloned()
                .collect()
        };

        if words.is_empty() {
            result.push(make_subtitle_segment(seg_text, seg_start, seg_end));
            continue;
        }

        match split_segment_into_sentences(&seg_text, &words) {
            Some(sentences) if sentences.len() > 1 => {
                println!(
                    "[whisper] сегмент [{:.3}..{:.3}] разрезан на {} предложений ({} слов)",
                    seg_start,
                    seg_end,
                    sentences.len(),
                    words.len(),
                );
                for (text, start, end) in sentences {
                    result.push(make_subtitle_segment(text, start, end));
                }
            }
            Some(_sentences) => {
                // одно предложение - текст как есть, тайминги по словам
                let start = words.first().map(|w| w.start).unwrap_or(seg_start);
                let end = words.last().map(|w| w.end).unwrap_or(seg_end);
                result.push(make_subtitle_segment(seg_text, start, end));
            }
            None => {
                // words не сматчились с текстом - целиком, не ломать
                println!(
                    "[whisper] alignment fallback: words={} не сматчились с текстом (сегмент [{:.3}..{:.3}])",
                    words.len(),
                    seg_start,
                    seg_end,
                );
                let start = words.first().map(|w| w.start).unwrap_or(seg_start);
                let end = words.last().map(|w| w.end).unwrap_or(seg_end);
                result.push(make_subtitle_segment(seg_text, start, end));
            }
        }
    }

    for (i, seg) in result.iter_mut().enumerate() {
        seg.id = (i + 1) as u32;
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

    // json норм - отдаем; пустые строки потом в translate_batch
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
            "model": CHAT_COMPLETION_MODEL,
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
            "model": CHAT_COMPLETION_MODEL,
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
    
    // слишком короткие слова
    if source.len() < 3 {
        return true;
    }
    
    // стоп-слова в глоссарий не надо
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