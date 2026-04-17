use serde::{Deserialize, Serialize};
use std::path::Path;
use crate::cache::Cache;
use crate::project::{SubtitleSegment, GlossaryEntry};
use keyring::Entry;
use crate::project::glossary::apply_glossary;
use tokio::sync::mpsc;
use tauri::Emitter;
use std::collections::HashMap;

#[tauri::command]
pub async fn save_api_key(key: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("API ключ не может быть пустым".to_string());
    }
    
    if !key.starts_with("sk-") && !key.starts_with("sk-proj-") {
        return Err("Неверный формат API ключа. Ключ должен начинаться с 'sk-'".to_string());
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
    app_handle: tauri::AppHandle,
    cache: tauri::State<'_, Cache>,
) -> Result<Vec<SubtitleSegment>, String> {
    println!("📝 Транскрибация файла: {}", file_path);
    
    let file_path_buf = Path::new(&file_path);
    let file_hash = Cache::calculate_file_hash(file_path_buf)?;
    
    // Проверяем кэш
    if let Some(cached) = cache.get_transcription(&file_hash).await? {
        println!("✅ Найдено в кэше ({} сегментов)", cached.len());
        return Ok(cached);
    }

    // Получаем API-ключ
    let api_key = get_api_key()?;
    
    // Создаём канал для отправки прогресса
    let (progress_tx, mut progress_rx) = mpsc::channel::<ProgressEvent>(10);
    
    // Клонируем app_handle для отправки событий
    let app_handle_clone = app_handle.clone();
    let operation_id = format!("transcribe_{}", file_hash);
    
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
        total_steps: 4, 
        description: "Подготовка файла".to_string() 
    }).await;

    // Читаем файл
    let _ = progress_tx.send(ProgressEvent::InProgress { 
        step: 1, 
        progress: 0.25, 
        description: "Чтение аудиофайла".to_string() 
    }).await;
    
    let file_data = std::fs::read(&file_path)
        .map_err(|e| format!("Ошибка чтения файла: {}", e))?;

    // Подготавливаем запрос
    let _ = progress_tx.send(ProgressEvent::InProgress { 
        step: 2, 
        progress: 0.5, 
        description: "Отправка в OpenAI".to_string() 
    }).await;
    
    let client = reqwest::Client::new();
    
    use reqwest::multipart;
    
    let file_part = multipart::Part::bytes(file_data)
        .file_name("audio.mp3")
        .mime_str("audio/mpeg")
        .map_err(|e| e.to_string())?;
    
    let form = multipart::Form::new()
        .text("model", "whisper-1")
        .text("language", language.unwrap_or("en".to_string()))
        .text("response_format", "verbose_json")
        .part("file", file_part);

    // Отправляем запрос БЕЗ обработки ошибок сети (пока упрощаем)
    let _ = progress_tx.send(ProgressEvent::InProgress { 
        step: 3, 
        progress: 0.75, 
        description: "Ожидание ответа от OpenAI".to_string() 
    }).await;
    
    let res = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .bearer_auth(&api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса к OpenAI: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let error_text = res.text().await.unwrap_or_else(|_| "Неизвестная ошибка".to_string());
        return Err(format!("OpenAI ошибка ({}): {}", status, error_text));
    }

    // Парсим ответ
    let _ = progress_tx.send(ProgressEvent::InProgress { 
        step: 4, 
        progress: 0.9, 
        description: "Обработка результата".to_string() 
    }).await;
    
    let response: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let segments = parse_whisper_response(response)?;
    
    // Сохраняем в кэш
    cache.set_transcription(&file_hash, &segments).await?;
    
    // Отправляем завершение
    let _ = progress_tx.send(ProgressEvent::Completed { 
        result_count: segments.len() 
    }).await;
    
    println!("✅ Транскрибация завершена: {} сегментов", segments.len());
    Ok(segments)
}

#[tauri::command]
pub async fn translate_batch(
    segments: Vec<SubtitleSegment>,
    target_language: String,
    glossary: Vec<GlossaryEntry>,
    style_prompt: String,
    app_handle: tauri::AppHandle,
    cache: tauri::State<'_, Cache>,
) -> Result<Vec<crate::types::TranslationResult>, String> {
    println!("🔄 Перевод {} сегментов на {}...", segments.len(), target_language);
    
    let cache_key = Cache::generate_translation_cache_key(
        &segments,
        &glossary,
        &target_language,
        &style_prompt,
    )?;
    
    // Проверяем кэш
    if let Some(cached) = cache.get_translation(&cache_key).await? {
        println!("✅ Найдено в кэше");
        return Ok(cached);
    }

    let api_key = get_api_key()?;
    
    // Создаём канал для прогресса
    let (progress_tx, mut progress_rx) = mpsc::channel::<ProgressEvent>(10);
    let app_handle_clone = app_handle.clone();
    let operation_id = format!("translate_{}", cache_key);
    
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
            .map(|e| format!("• \"{}\" → \"{}\"{}", 
                e.source, 
                e.target,
                e.description.as_ref().map(|d| format!(" — {}", d)).unwrap_or_default()
            ))
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
        • Длина перевода должна быть сопоставима с оригиналом для синхронизации с видео\n\n\
        Верни ответ в формате JSON: массив объектов {{\"id\": число, \"translated_text\": \"текст\"}}",
        target_language,
        glossary_text,
        style_prompt
    );

    // Отправляем запрос
    let _ = progress_tx.send(ProgressEvent::InProgress { 
        step: 2, 
        progress: 0.66, 
        description: "Запрос к GPT-4".to_string() 
    }).await;
    
    let segments_text = serde_json::json!({
        "segments": segments.iter().map(|s| {
            serde_json::json!({
                "id": s.id,
                "text": s.text,
                "start": s.start,
                "end": s.end
            })
        }).collect::<Vec<_>>()
    });

    let client = reqwest::Client::new();
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(&api_key)
        .json(&serde_json::json!({
            "model": "gpt-4o-mini",
            "messages": [
                { "role": "system", "content": prompt },
                { "role": "user", "content": serde_json::to_string(&segments_text).unwrap() }
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.3,
            "max_tokens": 4000
        }))
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса к OpenAI: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let error_text = res.text().await.unwrap_or_else(|_| "Неизвестная ошибка".to_string());
        return Err(format!("OpenAI ошибка ({}): {}", status, error_text));
    }

    // Обрабатываем результат
    let _ = progress_tx.send(ProgressEvent::InProgress { 
        step: 3, 
        progress: 0.9, 
        description: "Обработка перевода".to_string() 
    }).await;
    
    let response: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut translations = parse_translation_response(response)?;
    
    // Применяем глоссарий
    if !glossary.is_empty() {
        for translation in &mut translations {
            if segments.iter().any(|s| s.id == translation.id) {
                translation.translated_text = apply_glossary(&translation.translated_text, &glossary);
            }
        }
    }
    
    cache.set_translation(&cache_key, &translations).await?;
    
    let _ = progress_tx.send(ProgressEvent::Completed { 
        result_count: translations.len() 
    }).await;
    
    println!("✅ Перевод завершён: {} сегментов", translations.len());
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

fn parse_whisper_response(response: serde_json::Value) -> Result<Vec<SubtitleSegment>, String> {
    let segments = response["segments"]
        .as_array()
        .ok_or("Нет сегментов в ответе".to_string())?;
    
    let result: Vec<SubtitleSegment> = segments
        .iter()
        .enumerate()
        .map(|(i, seg)| {
            let id = (i + 1) as u32;
            let start = seg["start"].as_f64().unwrap_or(0.0);
            let end = seg["end"].as_f64().unwrap_or(0.0);
            let text = seg["text"].as_str().unwrap_or("").trim().to_string();
            
            SubtitleSegment {
                id,
                start,
                end,
                duration: end - start,
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
    
    let parsed: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("Ошибка парсинга JSON: {}", e))?;
    
    let results = parsed.as_array()
        .ok_or("Ожидается массив в ответе".to_string())?
        .iter()
        .map(|item| {
            let id = item["id"].as_u64().unwrap_or(0) as u32;
            let translated_text = item["translated_text"]
                .as_str()
                .unwrap_or("")
                .trim()
                .to_string();
            
            crate::types::TranslationResult { id, translated_text }
        })
        .collect();
    
    Ok(results)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GlossaryTerm {
    pub source: String,
    pub target: String,
    pub frequency: u32,
    pub confidence: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AutoGlossaryOptions {
    pub min_frequency: u32,
    pub max_terms: u32,
    pub target_language: String,
}

#[tauri::command]
pub async fn auto_generate_glossary(
    segments: Vec<SubtitleSegment>,
    options: Option<AutoGlossaryOptions>,
    _app_handle: tauri::AppHandle,
) -> Result<Vec<GlossaryTerm>, String> {
    println!("📚 Автоматическое создание глоссария из {} сегментов", segments.len());
    
    let options = options.unwrap_or(AutoGlossaryOptions {
        min_frequency: 2,
        max_terms: 50,
        target_language: "ru".to_string(),
    });
    
    // Извлекаем все слова из оригинальных сегментов
    let mut word_frequencies = HashMap::new();
    
    for segment in &segments {
        let words: Vec<&str> = segment.text
            .split_whitespace()
            .map(|w| w.trim_matches(|c: char| !c.is_alphabetic()))
            .filter(|w| !w.is_empty() && w.len() > 2)
            .collect();
        
        for word in words {
            *word_frequencies.entry(word.to_lowercase()).or_insert(0) += 1;
        }
    }
    
    // Фильтруем по частоте
    let frequent_words: Vec<(String, u32)> = word_frequencies
        .into_iter()
        .filter(|(_, freq)| *freq >= options.min_frequency)
        .collect();
    
    if frequent_words.is_empty() {
        println!("ℹ️ Не найдено слов с достаточной частотой");
        return Ok(Vec::new());
    }
    
    // Ограничиваем количество терминов
    let selected_words: Vec<String> = frequent_words
        .into_iter()
        .take(options.max_terms as usize)
        .map(|(word, _)| word)
        .collect();
    
    println!("🔤 Найдено {} потенциальных терминов", selected_words.len());
    
    // Получаем API ключ
    let api_key = get_api_key()?;
    
    // Формируем промпт для GPT
    let terms_list = selected_words.join(", ");
    let prompt = format!(
        "Ты эксперт по переводу. Ниже список терминов, которые встречаются в субтитрах.
        Предложи точные переводы этих терминов на язык '{}'.
        Верни ответ в формате JSON: массив объектов {{\"source\": \"термин\", \"target\": \"перевод\", \"confidence\": число_от_0_до_1}}",
        options.target_language
    );
    
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(&api_key)
        .json(&serde_json::json!({
            "model": "gpt-4o-mini",
            "messages": [
                { "role": "system", "content": prompt },
                { "role": "user", "content": terms_list }
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.3,
            "max_tokens": 2000
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
    let glossary_terms = parse_glossary_response(response)?;
    
    println!("✅ Создан глоссарий из {} терминов", glossary_terms.len());
    Ok(glossary_terms)
}

fn parse_glossary_response(response: serde_json::Value) -> Result<Vec<GlossaryTerm>, String> {
    let content = response["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Нет контента в ответе".to_string())?;
    
    let parsed: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("Ошибка парсинга JSON: {}", e))?;
    
    let terms = parsed.as_array()
        .ok_or("Ожидается массив в ответе".to_string())?
        .iter()
        .map(|item| {
            let source = item["source"].as_str().unwrap_or("").to_string();
            let target = item["target"].as_str().unwrap_or("").to_string();
            let confidence = item["confidence"].as_f64().unwrap_or(0.5);
            
            GlossaryTerm {
                source,
                target,
                frequency: 0, // Будет заполнено позже
                confidence,
            }
        })
        .collect();
    
    Ok(terms)
}

const KEYRING_SERVICE: &str = "subtitle-studio";
const KEYRING_USER: &str = "openai-api-key";