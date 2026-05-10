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
    let api_key = get_api_key()?;

    let user_intent = classify_user_intent(&request.message).await?;
    println!(
        "[agent] intent: {:?} | message: {:?}",
        user_intent,
        request.message.chars().take(120).collect::<String>()
    );

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
    let lower = message.to_lowercase();

    /* Любой глагол редактирования: измени, замени, исправь, поменяй, перепиши,
       редактируй, обнови, удали, убери, добавь, вставь, приведи к, переименуй... */
    let edit_markers: &[&str] = &[
        "измени", "замени", "поменя", "перепиш", "перепис",
        "редактируй", "редактир", "исправ", "обнови", "обновл",
        "удали", "убери", "вырежи", "вычерк",
        "добавь", "вставь", "впиши",
        "приведи к", "переименуй", "переимен",
        "найди и замени", "найти и замени",
        "rename", "replace", "change ", "fix ", "remove ", "delete ", "edit ",
    ];
    if edit_markers.iter().any(|m| lower.contains(m)) {
        return Ok(UserIntent::EditRequest);
    }

    if lower.contains("переведи") || lower.contains("перевод") || lower.contains("translate") {
        return Ok(UserIntent::TranslationRequest);
    }

    if lower.contains("качество") || lower.contains("ошибк") || lower.contains("проблем") {
        return Ok(UserIntent::QualityCheck);
    }

    if lower.contains("глоссари") || lower.contains("термин") || lower.contains("словар") {
        return Ok(UserIntent::GlossaryRequest);
    }

    Ok(UserIntent::GeneralQuestion)
}

async fn handle_edit_request(request: &AgentRequest, api_key: &str) -> Result<AgentResponse, String> {
    let Some(segments) = &request.context.current_segments else {
        return Ok(AgentResponse {
            message: "Нет сегментов для редактирования".to_string(),
            action: None,
            suggestions: None,
        });
    };

    if let Some((from, to)) = parse_simple_replace_request(&request.message) {
        let updated = apply_simple_replace(segments, &from, &to);
        if !updated.is_empty() {
            return Ok(AgentResponse {
                message: format!("Заменил «{}» на «{}» во всех найденных репликах.", from, to),
                action: Some(AgentAction::EditSegments { segments: updated }),
                suggestions: None,
            });
        }
    }

    let segments_json = serde_json::to_string(
        &segments.iter().map(|s| serde_json::json!({
            "id": s.id,
            "start": s.start,
            "end": s.end,
            "text": s.text,
            "translation": s.translation,
        })).collect::<Vec<_>>()
    ).map_err(|e| e.to_string())?;

    let target_lang = request.context.target_language.as_deref().unwrap_or("ru");

    let prompt = format!(
        "Ты редактируешь субтитры в проекте Subtitle Studio.\n\
         Целевой язык перевода (target language) проекта: {target_lang}.\n\n\
         У каждого сегмента есть поле text (оригинал на исходном языке) и translation (перевод на {target_lang}).\n\
         Анализируй и исправляй ОБА поля: text и translation.\n\
         Если ошибка/термин/имя встречается в оригинале, исправь text. Если встречается в переводе, исправь translation.\n\
         Если правка относится ко всей серии или ко всем репликам, применяй её ко всем подходящим сегментам в обоих полях.\n\n\
         Текущие сегменты (JSON-массив): {segments_json}\n\n\
         Запрос пользователя: {user_msg}\n\n\
         Верни СТРОГО валидный JSON-объект следующего вида:\n\
         {{\n  \"message\": \"короткое объяснение, что именно изменено\",\n  \
         \"edits\": [ {{ \"id\": <число>, \"text\": \"новый text или null\", \"translation\": \"новый translation или null\" }} ]\n}}\n\n\
         Правила:\n\
         - Включай в \"edits\" ТОЛЬКО реально изменённые сегменты.\n\
         - Поле, которое не менялось, ставь в null или опускай.\n\
         - Значения должны быть полным новым текстом (не дельтой).\n\
         - id сегментов сохраняй как есть. Не возвращай ничего, кроме JSON-объекта.",
        target_lang = target_lang,
        segments_json = segments_json,
        user_msg = request.message
    );

    call_openai_agent_edit(prompt, api_key, segments).await
}

fn parse_simple_replace_request(message: &str) -> Option<(String, String)> {
    let lower = message.to_lowercase();
    let markers = [
        "замени",
        "заменить",
        "измени",
        "изменить",
        "поменяй",
        "поменять",
        "исправь",
        "исправить",
        "replace",
        "change",
    ];

    let marker = markers
        .iter()
        .filter_map(|m| lower.find(m).map(|idx| (idx, *m)))
        .min_by_key(|(idx, _)| *idx)?;

    let after_marker = message.get(marker.0 + marker.1.len()..)?.trim();
    let after_marker = trim_replace_scope_words(after_marker);
    let lower_after = after_marker.to_lowercase();
    let sep_idx = lower_after.find(" на ").or_else(|| lower_after.find(" to "))?;

    let from = clean_replace_term(&after_marker[..sep_idx]);
    let to_sep_len = if lower_after[sep_idx..].starts_with(" на ") { 4 } else { 4 };
    let to = clean_replace_term(&after_marker[sep_idx + to_sep_len..]);

    if from.is_empty() || to.is_empty() || from.eq_ignore_ascii_case(&to) {
        return None;
    }

    Some((from, to))
}

fn trim_replace_scope_words(value: &str) -> &str {
    let mut out = value.trim();
    loop {
        let lower = out.to_lowercase();
        let next = lower
            .strip_prefix("везде ")
            .or_else(|| lower.strip_prefix("во всех репликах "))
            .or_else(|| lower.strip_prefix("во всей серии "))
            .or_else(|| lower.strip_prefix("слово "))
            .or_else(|| lower.strip_prefix("термин "));

        let Some(stripped_lower) = next else {
            break;
        };

        let consumed = lower.len() - stripped_lower.len();
        out = out.get(consumed..).unwrap_or(out).trim();
    }
    out
}

fn clean_replace_term(value: &str) -> String {
    value
        .trim()
        .trim_matches(|c: char| {
            c.is_whitespace()
                || matches!(c, '"' | '\'' | '«' | '»' | '`' | '.' | ',' | ':' | ';')
        })
        .to_string()
}

fn apply_simple_replace(
    segments: &[SubtitleSegment],
    from: &str,
    to: &str,
) -> Vec<SubtitleSegment> {
    segments
        .iter()
        .filter_map(|segment| {
            let new_text = replace_case_insensitive(&segment.text, from, to);
            let new_translation = segment
                .translation
                .as_ref()
                .map(|translation| replace_case_insensitive(translation, from, to));

            let text_changed = new_text != segment.text;
            let translation_changed = new_translation.as_ref() != segment.translation.as_ref();

            if !text_changed && !translation_changed {
                return None;
            }

            let mut next = segment.clone();
            next.text = new_text;
            next.translation = new_translation;
            Some(next)
        })
        .collect()
}

fn replace_case_insensitive(text: &str, from: &str, to: &str) -> String {
    if from.is_empty() {
        return text.to_string();
    }

    let lower_text = text.to_lowercase();
    let lower_from = from.to_lowercase();
    let mut result = String::with_capacity(text.len());
    let mut search_start = 0usize;

    while let Some(rel_idx) = lower_text[search_start..].find(&lower_from) {
        let start = search_start + rel_idx;
        let end = start + lower_from.len();
        if !text.is_char_boundary(start) || !text.is_char_boundary(end) {
            break;
        }

        result.push_str(&text[search_start..start]);
        result.push_str(to);
        search_start = end;
    }

    result.push_str(&text[search_start..]);
    result
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

async fn call_openai_agent_edit(
    prompt: String,
    api_key: &str,
    current_segments: &[SubtitleSegment],
) -> Result<AgentResponse, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": "gpt-5.4-mini",
            "messages": [
                { "role": "system", "content": "Ты помощник Subtitle Studio. Возвращаешь ТОЛЬКО валидный JSON-объект без какого-либо обрамления." },
                { "role": "user", "content": prompt }
            ],
            "temperature": 0.2,
            "max_completion_tokens": 16000,
            "response_format": { "type": "json_object" }
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
    let raw = response["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();

    let finish_reason = response["choices"][0]["finish_reason"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let truncated = finish_reason == "length";

    // Если ответ обрезан (finish_reason == "length"), пытаемся «дозакрыть»
    // оборванный JSON: отбросить хвостовой неполный объект внутри edits
    // и закрыть массив + внешний объект.
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(parse_err) => {
            if let Some(repaired) = try_repair_truncated_edits_json(&raw) {
                serde_json::from_str::<serde_json::Value>(&repaired).map_err(|e| {
                    format!(
                        "Не удалось разобрать JSON от модели даже после ремонта: {} (ответ: {})",
                        e, raw
                    )
                })?
            } else if truncated {
                return Err(format!(
                    "Ответ агента обрезан по лимиту токенов. Сократите запрос (например, попросите править меньшую часть серии). Подробности парсинга: {}",
                    parse_err
                ));
            } else {
                return Err(format!(
                    "Не удалось разобрать JSON от модели: {} (ответ: {})",
                    parse_err, raw
                ));
            }
        }
    };

    let message = parsed.get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("Готово.")
        .to_string();

    let edits = parsed.get("edits").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    let mut updated: Vec<SubtitleSegment> = Vec::new();
    for edit in edits {
        let Some(id) = edit.get("id").and_then(|v| v.as_u64()) else { continue };
        let id = id as u32;
        let Some(orig) = current_segments.iter().find(|s| s.id == id) else { continue };

        let new_text = edit.get("text").and_then(|v| v.as_str()).map(|s| s.to_string()).unwrap_or_else(|| orig.text.clone());
        let new_translation = match edit.get("translation") {
            Some(serde_json::Value::Null) | None => orig.translation.clone(),
            Some(serde_json::Value::String(s)) => Some(s.clone()),
            Some(other) => Some(other.to_string()),
        };

        let mut next = orig.clone();
        next.text = new_text;
        next.translation = new_translation;
        updated.push(next);
    }

    let action = if updated.is_empty() { None } else {
        Some(AgentAction::EditSegments { segments: updated })
    };

    Ok(AgentResponse {
        message,
        action,
        suggestions: None,
    })
}

async fn call_openai_agent(prompt: String, api_key: &str) -> Result<AgentResponse, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": "gpt-5.4-mini",
            "messages": [
                {
                    "role": "system",
                    "content": "Ты помощник Subtitle Studio. \
                                Отвечай ВСЕГДА простым человекочитаемым русским текстом. \
                                ЗАПРЕЩЕНО оборачивать ответ в JSON, в любые код-блоки (```...```) \
                                или возвращать структурированный объект. \
                                Если у пользователя несколько вариантов перевода — перечисляй \
                                их обычными буллетами «• …» или нумерованным списком. \
                                Пиши кратко и по делу."
                },
                { "role": "user", "content": prompt }
            ],
            "temperature": 0.7,
            "max_completion_tokens": 4000
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
    let raw = response["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();

    let message = humanize_general_message(&raw);

    Ok(AgentResponse {
        message,
        action: None,
        suggestions: None,
    })
}

/// Чистит ответ модели для общего чата:
/// - снимает обрамление в виде ```json ... ``` / ``` ... ```;
/// - если внутри всё-таки JSON — раскладывает известные поля
///   (message / answer / recommended_translation / alternatives / explanation)
///   в человекочитаемый текст;
/// - иначе возвращает текст как есть.
fn humanize_general_message(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // Снимаем код-фенсы любого вида.
    let unfenced = strip_code_fences(trimmed);

    // Пробуем парсить как JSON.
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(unfenced) else {
        return unfenced.to_string();
    };

    let mut parts: Vec<String> = Vec::new();

    let head = parsed
        .get("message")
        .or_else(|| parsed.get("answer"))
        .or_else(|| parsed.get("text"))
        .or_else(|| parsed.get("explanation_short"))
        .and_then(|v| v.as_str());
    if let Some(s) = head {
        let trimmed_head = s.trim();
        if !trimmed_head.is_empty() {
            parts.push(trimmed_head.to_string());
        }
    }

    if let Some(rec) = parsed
        .get("recommended_translation")
        .or_else(|| parsed.get("recommended"))
        .and_then(|v| v.as_str())
    {
        let r = rec.trim();
        if !r.is_empty() {
            parts.push(format!("Рекомендованный вариант: {}", r));
        }
    }

    if let Some(alts) = parsed
        .get("alternatives")
        .or_else(|| parsed.get("variants"))
        .or_else(|| parsed.get("options"))
        .and_then(|v| v.as_array())
    {
        let lines: Vec<String> = alts
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| format!("• {}", s.trim()))
            .filter(|s| s != "• ")
            .collect();
        if !lines.is_empty() {
            parts.push(format!("Варианты:\n{}", lines.join("\n")));
        }
    }

    if let Some(expl) = parsed
        .get("explanation")
        .or_else(|| parsed.get("reason"))
        .or_else(|| parsed.get("rationale"))
        .and_then(|v| v.as_str())
    {
        let e = expl.trim();
        if !e.is_empty() {
            parts.push(format!("Пояснение: {}", e));
        }
    }

    if parts.is_empty() {
        // Не узнали ни одного знакомого поля — отдаём как есть, но без фенсов.
        return unfenced.to_string();
    }

    parts.join("\n\n")
}

fn strip_code_fences(s: &str) -> &str {
    let s = s.trim();
    if !s.starts_with("```") {
        return s;
    }
    let without_open = s
        .trim_start_matches("```json")
        .trim_start_matches("```JSON")
        .trim_start_matches("```")
        .trim_start_matches('\n');
    without_open.trim_end_matches("```").trim()
}

/// Лучше-чем-ничего починка обрезанного JSON-ответа для edit-запросов.
/// Ожидается структура {"message": "...", "edits": [ {...}, {...}, ... ]}
/// При обрезке посередине последнего объекта в `edits` отрезаем хвост до
/// последней корректной запятой между объектами и закрываем массив + объект.
fn try_repair_truncated_edits_json(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let edits_start = trimmed.find("\"edits\"")?;
    let array_start = trimmed[edits_start..].find('[')? + edits_start;

    // Идём по строке, считая глубину фигурных скобок только внутри массива
    // edits, и запоминаем позицию за последним полностью закрытым объектом.
    let bytes = trimmed.as_bytes();
    let mut i = array_start + 1;
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escaped = false;
    let mut last_complete_end: Option<usize> = None;

    while i < bytes.len() {
        let c = bytes[i] as char;
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        match c {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    last_complete_end = Some(i + 1);
                }
            }
            ']' if depth == 0 => {
                // Массив уже корректно закрыт — JSON, видимо, цел или почти цел.
                return None;
            }
            _ => {}
        }
        i += 1;
    }

    let cut_to = last_complete_end?;
    let head = &trimmed[..cut_to];
    Some(format!("{}]}}", head))
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