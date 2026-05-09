use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PostProcessingOptions {
    pub fix_punctuation: bool,
    pub fix_names: bool,
    pub target_language: String,
    pub style_prompt: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PostProcessingResult {
    pub corrected_segments: Vec<crate::project::SubtitleSegment>,
    pub corrections_applied: u32,
    pub processing_time_ms: u64,
}

pub async fn postprocess_transcription(
    segments: Vec<crate::project::SubtitleSegment>,
    options: PostProcessingOptions,
    api_key: &str,
) -> Result<PostProcessingResult, String> {
    let start_time = std::time::Instant::now();
    let mut corrected_segments = segments.clone();
    let mut corrections_applied = 0u32;
    
    // Исправление пунктуации
    if options.fix_punctuation {
        corrected_segments = fix_punctuation(corrected_segments).await?;
        corrections_applied += 1; // Упрощённый подсчёт
    }
    
    // Исправление имён и стиля
    if options.fix_names {
        corrected_segments = fix_names_and_style(
            corrected_segments, 
            &options.target_language, 
            options.style_prompt.as_deref(),
            api_key
        ).await?;
        corrections_applied += 1;
    }
    
    let processing_time = start_time.elapsed().as_millis() as u64;
    
    Ok(PostProcessingResult {
        corrected_segments,
        corrections_applied,
        processing_time_ms: processing_time,
    })
}

async fn fix_punctuation(
    segments: Vec<crate::project::SubtitleSegment>,
) -> Result<Vec<crate::project::SubtitleSegment>, String> {
    // Простая эвристика для добавления точек
    let mut corrected = Vec::new();
    
    // Создаём копию для проверки продолжения
    let original_segments = segments.clone();
    
    for (i, mut segment) in segments.into_iter().enumerate() {
        let mut text = segment.text.trim().to_string();
        
        // Добавляем точку в конце, если её нет и это не вопрос/восклицание
        if !text.is_empty() 
            && !text.ends_with('.') 
            && !text.ends_with('?') 
            && !text.ends_with('!')
            && !text.ends_with(',')
            && !text.ends_with(':')
            && !text.ends_with(';') {
            
            // Проверяем, является ли следующий сегмент продолжением
            let is_continuation = if i + 1 < original_segments.len() {
                let next_text = original_segments[i + 1].text.trim();
                next_text.chars().next().map_or(false, |c| c.is_lowercase())
            } else {
                false
            };
            
            if !is_continuation {
                text.push('.');
                segment.text = text;
            }
        }
        
        corrected.push(segment);
    }
    
    Ok(corrected)
}

async fn fix_names_and_style(
    segments: Vec<crate::project::SubtitleSegment>,
    _target_language: &str,
    style_prompt: Option<&str>,
    api_key: &str,
) -> Result<Vec<crate::project::SubtitleSegment>, String> {
    // Сохраняем длину заранее, чтобы избежать ошибки перемещения
    let original_segments_len = segments.len();
    
    // Объединяем все сегменты в один текст для обработки
    let full_text = segments
        .iter()
        .map(|s| s.text.clone())
        .collect::<Vec<_>>()
        .join(" ");
    
    if full_text.trim().is_empty() {
        return Ok(segments);
    }
    
    let style_context = style_prompt.unwrap_or("Профессиональные субтитры для видео");
    
    let prompt = format!(
        "Ты профессиональный редактор субтитров. Исправь следующий текст:
        - Добавь правильную пунктуацию (точки, запятые, вопросы, восклицания)
        - Исправь имена собственные (они должны начинаться с заглавной буквы)
        - Убедись, что текст соответствует стилю: {}
        - Сохрани смысл и структуру оригинала
        - Верни исправленный текст без дополнительных комментариев
        
        Текст для исправления:
        {}",
        style_context,
        full_text
    );
    
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": "gpt-4o-mini",
            "messages": [
                { "role": "system", "content": "Ты профессиональный редактор субтитров." },
                { "role": "user", "content": prompt }
            ],
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
    let corrected_text = response["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    
    if corrected_text.is_empty() {
        return Ok(segments);
    }
    
    let corrected_sentences: Vec<&str> = corrected_text
        .split(|c| c == '.' || c == '?' || c == '!')
        .filter(|s| !s.trim().is_empty())
        .collect();
    
    let mut result_segments = Vec::new();
    let mut sentence_index = 0;
    
    for (i, mut segment) in segments.into_iter().enumerate() {
        if sentence_index < corrected_sentences.len() {
            let mut corrected_sentence = corrected_sentences[sentence_index].trim().to_string();
            
            // Добавляем обратно знак препинания
            if i < original_segments_len - 1 {
                if segment.text.contains('?') {
                    corrected_sentence.push('?');
                } else if segment.text.contains('!') {
                    corrected_sentence.push('!');
                } else {
                    corrected_sentence.push('.');
                }
            }
            
            segment.text = corrected_sentence;
            result_segments.push(segment);
            sentence_index += 1;
        } else {
            result_segments.push(segment);
        }
    }
    
    Ok(result_segments)
}