use serde::{Deserialize, Serialize};
use crate::project::{SubtitleSegment, GlossaryEntry};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentContext {
    pub project_id: Option<String>,
    pub current_segments: Option<Vec<SubtitleSegment>>,
    pub current_glossary: Option<Vec<GlossaryEntry>>,
    pub target_language: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentRequest {
    pub message: String,
    pub context: AgentContext,
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
    // Получаем API ключ
    let api_key = get_api_key()?;
    
    // Определяем тип запроса пользователя
    let user_intent = classify_user_intent(&request.message).await?;
    
    match user_intent {
        UserIntent::EditRequest => handle_edit_request(&request, &api_key).await,
        UserIntent::TranslationRequest => handle_translation_request(&request, &api_key).await,
        UserIntent::QualityCheck => handle_quality_check(&request, &api_key).await,
        UserIntent::GeneralQuestion => handle_general_question(&request, &api_key).await,
        UserIntent::GlossaryRequest => handle_glossary_request(&request, &api_key).await,
    }
}

#[derive(Debug)]
enum UserIntent {
    EditRequest,
    TranslationRequest,
    QualityCheck,
    GeneralQuestion,
    GlossaryRequest,
}

async fn classify_user_intent(message: &str) -> Result<UserIntent, String> {
    let lower_msg = message.to_lowercase();
    
    if lower_msg.contains("измени") || lower_msg.contains("редактируй") || lower_msg.contains("исправь") {
        Ok(UserIntent::EditRequest)
    } else if lower_msg.contains("переведи") || lower_msg.contains("перевод") {
        Ok(UserIntent::TranslationRequest)
    } else if lower_msg.contains("качество") || lower_msg.contains("ошибки") || lower_msg.contains("проблемы") {
        Ok(UserIntent::QualityCheck)
    } else if lower_msg.contains("глоссари") || lower_msg.contains("термин") || lower_msg.contains("словарь") {
        Ok(UserIntent::GlossaryRequest)
    } else {
        Ok(UserIntent::GeneralQuestion)
    }
}

async fn handle_edit_request(request: &AgentRequest, api_key: &str) -> Result<AgentResponse, String> {
    if let Some(segments) = &request.context.current_segments {
        let segments_text = segments.iter()
            .map(|s| format!("{}. [{}-{}] {}", s.id, s.start, s.end, s.text))
            .collect::<Vec<_>>()
            .join("\n");
        
        let prompt = format!(
            "Пользователь хочет отредактировать субтитры. Вот текущие сегменты:
            {}
            
            Запрос пользователя: {}
            
            Предложи улучшенную версию субтитров, сохраняя временные метки.
            Верни ответ в формате JSON: {{\"message\": \"объяснение\", \"action\": {{\"EditSegments\": {{\"segments\": [...]}}}}}}",
            segments_text,
            request.message
        );
        
        call_openai_agent(prompt, api_key).await
    } else {
        Ok(AgentResponse {
            message: "Нет сегментов для редактирования".to_string(),
            action: None,
            suggestions: None,
        })
    }
}

async fn handle_translation_request(request: &AgentRequest, api_key: &str) -> Result<AgentResponse, String> {
    if let Some(segments) = &request.context.current_segments {
        let segments_text = segments.iter()
            .map(|s| format!("{}. {}", s.id, s.text))
            .collect::<Vec<_>>()
            .join("\n");
        
        let target_lang = request.context.target_language.as_deref().unwrap_or("ru");
        
        let prompt = format!(
            "Пользователь хочет перевести или улучшить перевод субтитров на {}.
            Оригинальные сегменты:
            {}
            
            Запрос: {}
            
            Верни улучшенный перевод в формате JSON с объяснением изменений.",
            target_lang,
            segments_text,
            request.message
        );
        
        call_openai_agent(prompt, api_key).await
    } else {
        Ok(AgentResponse {
            message: "Нет сегментов для перевода".to_string(),
            action: None,
            suggestions: None,
        })
    }
}

async fn handle_quality_check(request: &AgentRequest, api_key: &str) -> Result<AgentResponse, String> {
    if let Some(segments) = &request.context.current_segments {
        let segments_text = segments.iter()
            .map(|s| format!("{}. {} → {}", s.id, s.text, s.translation.as_deref().unwrap_or("")))
            .collect::<Vec<_>>()
            .join("\n");
        
        let prompt = format!(
            "Проанализируй качество перевода субтитров:
            {}
            
            Запрос пользователя: {}
            
            Укажи конкретные проблемы и предложи решения.",
            segments_text,
            request.message
        );
        
        call_openai_agent(prompt, api_key).await
    } else {
        Ok(AgentResponse {
            message: "Нет сегментов для анализа качества".to_string(),
            action: None,
            suggestions: None,
        })
    }
}

async fn handle_glossary_request(request: &AgentRequest, api_key: &str) -> Result<AgentResponse, String> {
    let prompt = format!(
        "Пользователь хочет работать с глоссарием терминов.
        Текущий глоссарий: {:?}
        Запрос: {}
        
        Предложи улучшения или новые термины.",
        request.context.current_glossary,
        request.message
    );
    
    call_openai_agent(prompt, api_key).await
}

async fn handle_general_question(request: &AgentRequest, api_key: &str) -> Result<AgentResponse, String> {
    let prompt = format!(
        "Ты помощник Subtitle Studio - профессионального инструмента для создания субтитров.
        Ответь на вопрос пользователя, давая полезные советы по работе с субтитрами.
        
        Вопрос: {}
        
        Контекст проекта: {:?}",
        request.message,
        request.context
    );
    
    call_openai_agent(prompt, api_key).await
}

async fn call_openai_agent(prompt: String, api_key: &str) -> Result<AgentResponse, String> {
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
    let message = response["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    
    let action = None; 
    let suggestions = None;
    
    Ok(AgentResponse {
        message,
        action,
        suggestions,
    })
}

// Вспомогательная функция для получения API ключа (копия из ai.rs)
fn get_api_key() -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| e.to_string())?;
    
    entry.get_password()
        .map_err(|e| format!("Ключ не найден или ошибка доступа: {}", e))
}

const KEYRING_SERVICE: &str = "subtitle-studio";
const KEYRING_USER: &str = "openai-api-key";