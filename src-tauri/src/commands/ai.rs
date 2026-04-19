use serde::{Deserialize, Serialize};
use std::path::Path;
use crate::cache::Cache;
use crate::project::{SubtitleSegment, GlossaryEntry};
use keyring::Entry;
use crate::project::glossary::apply_glossary;
use tokio::sync::mpsc;
use tauri::Emitter;
use std::collections::HashSet;
use std::sync::OnceLock;

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
    prompt: Option<String>,
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
        .text("timestamp_granularities[]", "segment")
        .text("timestamp_granularities[]", "word")
        .part("file", file_part);

    let form = if let Some(prompt_text) = prompt {
        if prompt_text.trim().is_empty() {
            form
        } else {
            println!("🧠 Используется кастомный whisper prompt");
            form.text("prompt", prompt_text)
        }
    } else {
        form
    };

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

fn json_seconds(v: &serde_json::Value) -> f64 {
    v.as_f64()
        .or_else(|| v.as_u64().map(|n| n as f64))
        .or_else(|| v.as_i64().map(|n| n as f64))
        .unwrap_or(0.0)
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

    // 1) Пробуем извлечь напрямую/по известным ключам или рекурсивно в глубину
    if let Some(candidate_array) = find_translation_array(&parsed) {
        let mut results = parse_translation_items(candidate_array);
        if !results.is_empty() {
            results.sort_by_key(|item| item.id);
            return Ok(results);
        }
    }

    // 2) Fallback: объект формата { "1": "text", "2": "text" } где угодно во вложенности
    if let Some(map_obj) = find_id_text_map_object(&parsed) {
        let mut results = map_obj
            .iter()
            .filter_map(|(key, value)| {
                let id = key.parse::<u32>().ok()?;
                let translated_text = value.as_str()?.trim().to_string();
                if translated_text.is_empty() {
                    return None;
                }
                Some(crate::types::TranslationResult { id, translated_text })
            })
            .collect::<Vec<_>>();

        if !results.is_empty() {
            results.sort_by_key(|item| item.id);
            return Ok(results);
        }
    }

    Err(format!(
        "Не удалось распознать формат перевода от OpenAI. Ответ: {}",
        normalized_content.chars().take(400).collect::<String>()
    ))
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
            let id = item.get("id").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
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

            if id == 0 || translated_text.is_empty() {
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GlossaryTerm {
    pub source: String,
    pub target: String,
    pub frequency: u32,
    pub confidence: f64,
    #[serde(default)]
    pub category: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AutoGlossaryOptions {
    pub min_frequency: u32,
    pub max_terms: u32,
    pub target_language: String,
    /// Промпт пользователя из мастера (персонажи, сеттинг) — учитывать при составлении глоссария.
    #[serde(default)]
    pub context_prompt: Option<String>,
}

fn build_subtitle_corpus(segments: &[SubtitleSegment], max_chars: usize) -> String {
    let lines: Vec<String> = segments
        .iter()
        .map(|s| s.text.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let mut text = lines.join("\n");
    let n = text.chars().count();
    if n > max_chars {
        text = text.chars().take(max_chars).collect::<String>();
        text.push_str("\n\n[... text truncated for model limit ...]");
    }
    text
}

/// Токены, которые не должны попадать в глоссарий (частые служебные слова EN/FR и т.д.).
fn trivial_token_set() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| {
        [
            "a", "an", "the", "and", "or", "but", "if", "in", "on", "at", "to", "of", "for",
            "as", "by", "from", "with", "into", "over", "after", "before", "not", "no", "yes",
            "is", "are", "was", "were", "be", "been", "being", "am", "it", "its", "this", "that",
            "these", "those", "he", "she", "they", "we", "you", "i", "my", "your", "his", "her",
            "our", "their", "me", "him", "them", "who", "what", "when", "where", "why", "how",
            "all", "any", "some", "such", "so", "very", "just", "can", "could", "would", "should",
            "will", "shall", "may", "might", "must", "do", "does", "did", "done", "have", "has",
            "had", "get", "got", "go", "went", "come", "came", "see", "saw", "know", "knew",
            "think", "thought", "say", "said", "tell", "told", "ask", "give", "take", "make",
            "made", "want", "need", "like", "look", "use", "try", "let", "put", "seem", "feel",
            "le", "la", "les", "un", "une", "des", "du", "de", "et", "ou", "mais", "donc", "car",
            "ce", "cet", "cette", "ces", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
            "notre", "nos", "votre", "vos", "leur", "leurs", "que", "qui", "quoi", "dont", "est",
            "sont", "été", "ai", "as", "a", "avons", "avez", "ont", "pas", "plus", "moins", "très",
            "bien", "bon", "bonne", "bons", "bonnes", "mal", "oui", "non", "avec", "sans", "sous",
            "sur", "dans", "pour", "par", "vers", "chez", "entre", "après", "avant", "pendant",
            "tout", "toute", "tous", "toutes", "rien", "personne", "aucun", "aucune", "même",
            "aussi", "alors", "ainsi", "comme", "là", "ici", "voilà", "être", "avoir", "faire",
            "dit", "dis", "peut", "peux", "pourrait", "doit", "veut", "vont", "va", "vas", "allons",
            "allez", "suis", "es", "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles",
            "réussite", "success",
        ]
        .into_iter()
        .collect()
    })
}

fn should_drop_glossary_candidate(source: &str, target: &str) -> bool {
    let s = source.trim();
    let t = target.trim();
    if s.len() < 2 || t.is_empty() {
        return true;
    }
    let lower = s.to_lowercase();
    if trivial_token_set().contains(lower.as_str()) {
        return true;
    }
    // короткое совпадение без смены смысла (частый шум)
    if s.eq_ignore_ascii_case(t) && s.chars().count() < 4 {
        return true;
    }
    false
}

#[tauri::command]
pub async fn auto_generate_glossary(
    segments: Vec<SubtitleSegment>,
    options: Option<AutoGlossaryOptions>,
    _app_handle: tauri::AppHandle,
) -> Result<Vec<GlossaryTerm>, String> {
    println!("📚 Автоматическое создание глоссария из {} сегментов", segments.len());

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
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

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
            "model": "gpt-4o-mini",
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_content }
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.2,
            "max_tokens": 8192
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

    glossary_terms.retain(|t| !should_drop_glossary_candidate(&t.source, &t.target));
    if glossary_terms.len() > max_terms as usize {
        glossary_terms.truncate(max_terms as usize);
    }

    println!("✅ Создан глоссарий из {} терминов", glossary_terms.len());
    Ok(glossary_terms)
}

fn parse_glossary_response(response: serde_json::Value) -> Result<Vec<GlossaryTerm>, String> {
    let content = response["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Нет контента в ответе".to_string())?;
    
    let parsed: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("Ошибка парсинга JSON: {}", e))?;
    
    let arr_ref = parsed
        .as_array()
        .or_else(|| parsed.get("terms").and_then(|v| v.as_array()))
        .or_else(|| parsed.get("glossary").and_then(|v| v.as_array()))
        .or_else(|| parsed.get("entries").and_then(|v| v.as_array()));
    
    let terms: Vec<GlossaryTerm> = arr_ref
        .ok_or("Ожидается массив терминов или объект с ключом terms/glossary/entries".to_string())?
        .iter()
        .map(|item| {
            let source = item["source"].as_str().unwrap_or("").to_string();
            let target = item["target"].as_str().unwrap_or("").to_string();
            let confidence = item["confidence"].as_f64().unwrap_or(0.5);
            let category = item["category"].as_str().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

            GlossaryTerm {
                source,
                target,
                frequency: 0,
                confidence,
                category,
            }
        })
        .collect();
    
    Ok(terms)
}

const KEYRING_SERVICE: &str = "subtitle-studio";
const KEYRING_USER: &str = "openai-api-key";