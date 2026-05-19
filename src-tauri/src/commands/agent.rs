use serde::{Deserialize, Serialize};
use crate::project::{SubtitleSegment, GlossaryEntry};
use crate::agent::dialogue_history::{DialogueHistory, AgentMessage, DialogueContext};
use std::sync::Mutex;
use lazy_static::lazy_static;

// Глобальное хранилище истории диалогов
lazy_static! {
    static ref DIALOGUE_HISTORY: Mutex<Option<DialogueHistory>> = Mutex::new(None);
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentRequest {
    pub message: String,
    pub context: AgentContext,
    pub session_id: String, // Уникальный идентификатор сессии
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentContext {
    pub project_id: Option<String>,
    pub current_segments: Option<Vec<SubtitleSegment>>,
    pub current_glossary: Option<Vec<GlossaryEntry>>,
    pub target_language: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentResponse {
    pub message: String,
    pub action: Option<AgentAction>,
    pub suggestions: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum AgentAction {
    EditSegments { segments: Vec<SubtitleSegment> },
    UpdateGlossary { entries: Vec<GlossaryEntry> },
    GenerateText { text: String },
    ExplainIssue { issue: String, solution: String },
}

#[tauri::command]
pub async fn chat_with_agent(
    request: AgentRequest,
    _app_handle: tauri::AppHandle,
) -> Result<AgentResponse, String> {
    {
        let mut history_guard = DIALOGUE_HISTORY.lock().map_err(|_| "Ошибка блокировки истории диалогов".to_string())?;
        if history_guard.is_none() {
            *history_guard = Some(DialogueHistory::new());
        }
    }
    
    let session_id = request.session_id.clone();
    
    {
        let mut history_guard = DIALOGUE_HISTORY.lock().map_err(|_| "Ошибка блокировки истории диалогов".to_string())?;
        let history = history_guard.as_mut().unwrap();
        
        let dialogue_context = history.get_or_create_session(&session_id);
        
        dialogue_context.project_id = request.context.project_id.clone();
        dialogue_context.current_segments = request.context.current_segments.clone();
        dialogue_context.current_glossary = request.context.current_glossary.clone();
        dialogue_context.target_language = request.context.target_language.clone();
        
        let user_message = AgentMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: "user".to_string(),
            content: request.message.clone(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        };
        
        history.add_message(&session_id, user_message);
    }
    
    let api_key = get_api_key()?;
    
    let dialogue_context = {
        let history_guard = DIALOGUE_HISTORY.lock().map_err(|_| "Ошибка блокировки истории диалогов".to_string())?;
        let history = history_guard.as_ref().unwrap();
        let session = history.get_session(&session_id).unwrap_or_else(|| {
            DialogueContext {
                project_id: None,
                current_segments: None,
                current_glossary: None,
                target_language: None,
                conversation_history: Vec::new(),
            }
        });
        session
    };
    
    let user_intent = classify_user_intent_with_context(
        &request.message, 
        &dialogue_context.conversation_history
    ).await?;
    
    let response = match user_intent {
        UserIntent::EditRequest => handle_edit_request(&request, &dialogue_context, &api_key).await,
        UserIntent::TranslationRequest => handle_translation_request(&request, &dialogue_context, &api_key).await,
        UserIntent::QualityCheck => handle_quality_check(&request, &dialogue_context, &api_key).await,
        UserIntent::GeneralQuestion => handle_general_question(&request, &dialogue_context, &api_key).await,
        UserIntent::GlossaryRequest => handle_glossary_request(&request, &dialogue_context, &api_key).await,
    };
    
    if let Ok(ref agent_response) = response {
        let agent_message = AgentMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: "assistant".to_string(),
            content: agent_response.message.clone(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        };
        
        let mut history_guard = DIALOGUE_HISTORY.lock().map_err(|_| "Ошибка блокировки истории диалогов".to_string())?;
        let history = history_guard.as_mut().unwrap();
        history.add_message(&session_id, agent_message);
    }
    
    response
}

#[derive(Debug)]
enum UserIntent {
    EditRequest,
    TranslationRequest,
    QualityCheck,
    GeneralQuestion,
    GlossaryRequest,
}

async fn classify_user_intent_with_context(
    message: &str, 
    history: &[AgentMessage]
) -> Result<UserIntent, String> {
    let lower_msg = message.to_lowercase();
    
    // Проверяем явные индикаторы редактирования
    if lower_msg.contains("измени") || lower_msg.contains("редактируй") || lower_msg.contains("исправь") ||
       lower_msg.contains("заменить") || lower_msg.contains("поправить") {
        return Ok(UserIntent::EditRequest);
    }
    
    // Проверяем явные индикаторы перевода
    if lower_msg.contains("переведи") || lower_msg.contains("перевод") || lower_msg.contains("на русский") {
        return Ok(UserIntent::TranslationRequest);
    }
    
    // Проверяем явные индикаторы качества
    if lower_msg.contains("качество") || lower_msg.contains("ошибки") || lower_msg.contains("проблемы") ||
       lower_msg.contains("проверь") || lower_msg.contains("анализ") {
        return Ok(UserIntent::QualityCheck);
    }
    
    // Проверяем явные индикаторы глоссария
    if lower_msg.contains("глоссари") || lower_msg.contains("термин") || lower_msg.contains("словарь") ||
       lower_msg.contains("слово") {
        return Ok(UserIntent::GlossaryRequest);
    }
    
    // Анализируем контекст диалога
    if !history.is_empty() {
        // Если предыдущее сообщение было о конкретном сегменте, вероятно нужно редактирование
        let last_user_messages: Vec<&AgentMessage> = history
            .iter()
            .filter(|m| m.role == "user")
            .collect();
            
        if let Some(last_message) = last_user_messages.last() {
            if last_message.content.contains("сегмент") || last_message.content.contains("реплика") {
                return Ok(UserIntent::EditRequest);
            }
        }
    }
    
    // По умолчанию считаем общим вопросом
    Ok(UserIntent::GeneralQuestion)
}

async fn handle_edit_request(
    request: &AgentRequest, 
    context: &DialogueContext,
    api_key: &str
) -> Result<AgentResponse, String> {
    if let Some(segments) = &context.current_segments {
        let segments_text = segments.iter()
            .map(|s| format!("{}. [{}-{}] {}", s.id, s.start, s.end, s.text))
            .collect::<Vec<_>>()
            .join("\n");
        
        let prompt = format!(
            "Ты помощник Subtitle Studio. Пользователь хочет отредактировать субтитры.
            Текущие сегменты:
            {}
            
            Запрос пользователя: {}
            
            ВНИМАНИЕ: Верни ТОЛЬКО исправленные сегменты в формате JSON массива объектов {{\"id\": number, \"text\": string}}.
            НЕ добавляй никаких дополнительных комментариев, объяснений или текста вне JSON.
            Пример правильного ответа: [{{\"id\": 1, \"text\": \"Исправленный текст\"}}, {{\"id\": 2, \"text\": \"Другой исправленный текст\"}}]",
            segments_text,
            request.message
        );
        
        let json_response = call_openai_for_json(prompt, api_key).await?;
        
        // Парсим JSON и создаем действие
        let edited_segments: Vec<EditedSegment> = serde_json::from_str(&json_response)
            .map_err(|e| format!("Ошибка парсинга JSON от агента: {}", e))?;
        
        let mut updated_segments = segments.clone();
        for edited in edited_segments {
            if let Some(segment) = updated_segments.iter_mut().find(|s| s.id == edited.id) {
                segment.text = edited.text;
            }
        }
        
        Ok(AgentResponse {
            message: "Сегменты успешно отредактированы!".to_string(),
            action: Some(AgentAction::EditSegments { segments: updated_segments }),
            suggestions: None,
        })
    } else {
        Ok(AgentResponse {
            message: "Нет сегментов для редактирования".to_string(),
            action: None,
            suggestions: None,
        })
    }
}

async fn handle_translation_request(
    request: &AgentRequest, 
    context: &DialogueContext,
    api_key: &str
) -> Result<AgentResponse, String> {
    if let Some(segments) = &context.current_segments {
        let segments_text = segments.iter()
            .map(|s| format!("{}. {}", s.id, s.text))
            .collect::<Vec<_>>()
            .join("\n");
        
        let target_lang = context.target_language.as_deref().unwrap_or("ru");
        
        let prompt = format!(
            "Ты помощник Subtitle Studio. Пользователь хочет улучшить перевод субтитров на {}.
            Оригинальные сегменты:
            {}
            
            Запрос: {}
            
            ВНИМАНИЕ: Верни ТОЛЬКО улучшенный перевод в формате JSON массива объектов {{\"id\": number, \"translated_text\": string}}.
            НЕ добавляй никаких дополнительных комментариев или текста вне JSON.",
            target_lang,
            segments_text,
            request.message
        );
        
        let json_response = call_openai_for_json(prompt, api_key).await?;
        
        let translated_segments: Vec<TranslatedSegment> = serde_json::from_str(&json_response)
            .map_err(|e| format!("Ошибка парсинга JSON перевода: {}", e))?;
        
        let mut updated_segments = segments.clone();
        for translated in translated_segments {
            if let Some(segment) = updated_segments.iter_mut().find(|s| s.id == translated.id) {
                segment.translation = Some(translated.translated_text);
            }
        }
        
        Ok(AgentResponse {
            message: "Перевод успешно обновлен!".to_string(),
            action: Some(AgentAction::EditSegments { segments: updated_segments }),
            suggestions: None,
        })
    } else {
        Ok(AgentResponse {
            message: "Нет сегментов для перевода".to_string(),
            action: None,
            suggestions: None,
        })
    }
}

async fn handle_quality_check(
    request: &AgentRequest, 
    context: &DialogueContext,
    api_key: &str
) -> Result<AgentResponse, String> {
    if let Some(segments) = &context.current_segments {
        let segments_text = segments.iter()
            .map(|s| format!("{}. {} → {}", s.id, s.text, s.translation.as_deref().unwrap_or("")))
            .collect::<Vec<_>>()
            .join("\n");
        
        let prompt = format!(
            "Ты помощник Subtitle Studio. Проанализируй качество перевода субтитров:
            {}
            
            Запрос пользователя: {}
            
            ВНИМАНИЕ: Верни ТОЛЬКО результат анализа в формате JSON {{\"issue\": string, \"solution\": string}}.
            НЕ добавляй никаких дополнительных комментариев или текста вне JSON.",
            segments_text,
            request.message
        );
        
        let json_response = call_openai_for_json(prompt, api_key).await?;
        
        let quality_issue: QualityIssue = serde_json::from_str(&json_response)
            .map_err(|e| format!("Ошибка парсинга JSON анализа качества: {}", e))?;
        
        Ok(AgentResponse {
            message: format!("Обнаружена проблема: {}", quality_issue.issue),
            action: Some(AgentAction::ExplainIssue { 
                issue: quality_issue.issue, 
                solution: quality_issue.solution 
            }),
            suggestions: None,
        })
    } else {
        Ok(AgentResponse {
            message: "Нет сегментов для анализа качества".to_string(),
            action: None,
            suggestions: None,
        })
    }
}

async fn handle_glossary_request(
    request: &AgentRequest, 
    context: &DialogueContext,
    api_key: &str
) -> Result<AgentResponse, String> {
    let prompt = format!(
        "Ты помощник Subtitle Studio. Пользователь хочет работать с глоссарием терминов.
        Текущий глоссарий: {:?}
        Запрос: {}
        
        ВНИМАНИЕ: Верни ТОЛЬКО предложения по улучшению в формате JSON {{\"suggestions\": [string]}}.
        НЕ добавляй никаких дополнительных комментариев или текста вне JSON.",
        context.current_glossary,
        request.message
    );
    
    let json_response = call_openai_for_json(prompt, api_key).await?;
    
    let glossary_suggestions: GlossarySuggestions = serde_json::from_str(&json_response)
        .map_err(|e| format!("Ошибка парсинга JSON предложений глоссария: {}", e))?;
    
    Ok(AgentResponse {
        message: "Получены предложения по улучшению глоссария".to_string(),
        action: None,
        suggestions: Some(glossary_suggestions.suggestions),
    })
}

async fn handle_general_question(
    request: &AgentRequest, 
    context: &DialogueContext,
    api_key: &str
) -> Result<AgentResponse, String> {
    let prompt = format!(
        "Ты помощник Subtitle Studio - профессионального инструмента для создания субтитров.
        Ответь на вопрос пользователя, давая полезные советы по работе с субтитрами.
        
        Контекст проекта: {:?}
        Вопрос: {}
        
        Ответ должен быть кратким и по делу.",
        context,
        request.message
    );
    
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": "gpt-4o-mini",
            "messages": [
                { "role": "system", "content": "Ты помощник Subtitle Studio. Отвечай кратко и по делу." },
                { "role": "user", "content": prompt }
            ],
            "temperature": 0.7,
            "max_tokens": 500
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
    let message = response["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    
    Ok(AgentResponse {
        message,
        action: None,
        suggestions: None,
    })
}

#[derive(Debug, Serialize, Deserialize)]
struct EditedSegment {
    id: u32,
    text: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct TranslatedSegment {
    id: u32,
    translated_text: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct QualityIssue {
    issue: String,
    solution: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GlossarySuggestions {
    suggestions: Vec<String>,
}

async fn call_openai_for_json(prompt: String, api_key: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": "gpt-4o-mini",
            "messages": [
                { "role": "system", "content": "Ты помощник Subtitle Studio. Всегда отвечай ТОЛЬКО валидным JSON без дополнительного текста." },
                { "role": "user", "content": prompt }
            ],
            "temperature": 0.3,
            "max_tokens": 1000
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
    let message_content = response["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    
    // Извлекаем JSON из возможного текста
    extract_json_from_text(&message_content)
}

fn extract_json_from_text(text: &str) -> Result<String, String> {
    // Ищем первую открывающую и последнюю закрывающую скобку
    if let Some(start) = text.find('[') {
        if let Some(end) = text.rfind(']') {
            if end > start {
                let json_str = &text[start..=end];
                // Проверяем валидность JSON
                if serde_json::from_str::<serde_json::Value>(json_str).is_ok() {
                    return Ok(json_str.to_string());
                }
            }
        }
    }
    
    if let Some(start) = text.find('{') {
        if let Some(end) = text.rfind('}') {
            if end > start {
                let json_str = &text[start..=end];
                if serde_json::from_str::<serde_json::Value>(json_str).is_ok() {
                    return Ok(json_str.to_string());
                }
            }
        }
    }
    
    Err(format!("Не удалось извлечь валидный JSON из ответа: {}", text))
}

// Вспомогательная функция для получения API ключа
fn get_api_key() -> Result<String, String> {
    let entry = keyring::Entry::new("subtitle-studio", "openai-api-key")
        .map_err(|e| e.to_string())?;
    
    entry.get_password()
        .map_err(|e| format!("Ключ не найден или ошибка доступа: {}", e))
}