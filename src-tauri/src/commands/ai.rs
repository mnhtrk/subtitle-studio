use std::path::Path;
use crate::cache::Cache;
use crate::project::{SubtitleSegment, GlossaryEntry};
use crate::types::TranslationResult;  // ← Импорт из общего модуля
use keyring::Entry;
use crate::project::glossary::apply_glossary;

const KEYRING_SERVICE: &str = "subtitle-studio";
const KEYRING_USER: &str = "openai-api-key";

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
    _app_handle: tauri::AppHandle,  // ← Префикс _ для неиспользуемого параметра
    cache: tauri::State<'_, Cache>,
) -> Result<Vec<SubtitleSegment>, String> {
    println!("📝 Транскрибация файла: {}", file_path);
    
    let file_path_buf = Path::new(&file_path);
    let file_hash = Cache::calculate_file_hash(file_path_buf)?;
    
    if let Some(cached) = cache.get_transcription(&file_hash).await? {
        println!("✅ Найдено в кэше ({} сегментов)", cached.len());
        return Ok(cached);
    }

    let api_key = get_api_key()?;
    
    let client = reqwest::Client::new();
    
    use reqwest::multipart;
    
    let file_data = std::fs::read(&file_path)
        .map_err(|e| format!("Ошибка чтения файла: {}", e))?;
    
    let file_part = multipart::Part::bytes(file_data)
        .file_name("audio.mp3")
        .mime_str("audio/mpeg")
        .map_err(|e| e.to_string())?;
    
    let form = multipart::Form::new()
        .text("model", "whisper-1")
        .text("language", language.unwrap_or("en".to_string()))
        .text("response_format", "verbose_json")
        .part("file", file_part);

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

    let response: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let segments = parse_whisper_response(response)?;
    
    cache.set_transcription(&file_hash, &segments).await?;
    
    println!("✅ Транскрибация завершена: {} сегментов", segments.len());
    Ok(segments)
}

#[tauri::command]
pub async fn translate_batch(
    segments: Vec<SubtitleSegment>,
    target_language: String,
    glossary: Vec<GlossaryEntry>,
    style_prompt: String,
    _app_handle: tauri::AppHandle,  // ← Префикс _ для неиспользуемого параметра
    cache: tauri::State<'_, Cache>,
) -> Result<Vec<TranslationResult>, String> {
    println!("🔄 Перевод {} сегментов на {}...", segments.len(), target_language);
    
    let cache_key = Cache::generate_translation_cache_key(
        &segments,
        &glossary,
        &target_language,
        &style_prompt,
    )?;
    
    if let Some(cached) = cache.get_translation(&cache_key).await? {
        println!("✅ Найдено в кэше");
        return Ok(cached);
    }

    let api_key = get_api_key()?;
    
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

    let response: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut translations = parse_translation_response(response)?;
    
    if !glossary.is_empty() {
        for translation in &mut translations {
            if let Some(segment) = segments.iter().find(|s| s.id == translation.id) {
                translation.translated_text = apply_glossary(&translation.translated_text, &glossary);
            }
        }
    }
    
    cache.set_translation(&cache_key, &translations).await?;
    
    println!("✅ Перевод завершён: {} сегментов", translations.len());
    Ok(translations)
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
) -> Result<Vec<TranslationResult>, String> {
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
            
            TranslationResult { id, translated_text }
        })
        .collect();
    
    Ok(results)
}