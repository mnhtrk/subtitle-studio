use serde::{Deserialize, Serialize};
use crate::project::{SubtitleSegment, GlossaryEntry};
use crate::agent::dialogue_history::{DialogueHistory, AgentMessage, ConversationTurn, DialogueContext};
use std::sync::Mutex;
use lazy_static::lazy_static;
use regex::Regex;

const AGENT_MODEL: &str = "gpt-5.4-mini";
const MAX_SEGMENTS_IN_PROMPT: usize = 200;
const MAX_HISTORY_TURNS: usize = 30;

lazy_static! {
    static ref DIALOGUE_HISTORY: Mutex<Option<DialogueHistory>> = Mutex::new(None);
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentRequest {
    pub message: String,
    pub context: AgentContext,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub conversation_history: Vec<ConversationTurn>,
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
    #[serde(default)]
    pub actions: Vec<AgentAction>,
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
        let mut history_guard = DIALOGUE_HISTORY
            .lock()
            .map_err(|_| "Ошибка блокировки истории диалогов".to_string())?;
        if history_guard.is_none() {
            *history_guard = Some(DialogueHistory::new());
        }
    }

    let session_id = if request.session_id.trim().is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        request.session_id.clone()
    };

    {
        let mut history_guard = DIALOGUE_HISTORY
            .lock()
            .map_err(|_| "Ошибка блокировки истории диалогов".to_string())?;
        let history = history_guard.as_mut().unwrap();
        history.sync_context(
            &session_id,
            request.context.project_id.clone(),
            request.context.current_segments.clone(),
            request.context.current_glossary.clone(),
            request.context.target_language.clone(),
            &request.conversation_history,
        );
    }

    let api_key = get_api_key()?;

    let dialogue_context = {
        let history_guard = DIALOGUE_HISTORY
            .lock()
            .map_err(|_| "Ошибка блокировки истории диалогов".to_string())?;
        let history = history_guard.as_ref().unwrap();
        history.get_session(&session_id).unwrap_or_else(|| DialogueContext {
            project_id: None,
            current_segments: None,
            current_glossary: None,
            target_language: None,
            conversation_history: Vec::new(),
        })
    };

    {
        let mut history_guard = DIALOGUE_HISTORY
            .lock()
            .map_err(|_| "Ошибка блокировки истории диалогов".to_string())?;
        let history = history_guard.as_mut().unwrap();
        history.add_message(
            &session_id,
            AgentMessage {
                id: uuid::Uuid::new_v4().to_string(),
                role: "user".to_string(),
                content: request.message.clone(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
        );
    }

    let response = run_agent_turn(&request, &dialogue_context, &api_key).await;

    if let Ok(ref agent_response) = response {
        let mut history_guard = DIALOGUE_HISTORY
            .lock()
            .map_err(|_| "Ошибка блокировки истории диалогов".to_string())?;
        let history = history_guard.as_mut().unwrap();
        history.add_message(
            &session_id,
            AgentMessage {
                id: uuid::Uuid::new_v4().to_string(),
                role: "assistant".to_string(),
                content: agent_response.message.clone(),
                timestamp: chrono::Utc::now().to_rfc3339(),
            },
        );
    }

    response
}

async fn run_agent_turn(
    request: &AgentRequest,
    context: &DialogueContext,
    api_key: &str,
) -> Result<AgentResponse, String> {
    let system_prompt = build_system_prompt(context);
    let mut messages = vec![serde_json::json!({
        "role": "system",
        "content": system_prompt
    })];

    let turns_to_send: Vec<ConversationTurn> = if !request.conversation_history.is_empty() {
        request.conversation_history.clone()
    } else {
        context
            .conversation_history
            .iter()
            .take(context.conversation_history.len().saturating_sub(1))
            .map(|m| ConversationTurn {
                role: m.role.clone(),
                content: m.content.clone(),
            })
            .collect()
    };

    let start = turns_to_send.len().saturating_sub(MAX_HISTORY_TURNS);
    for turn in &turns_to_send[start..] {
        push_turn(&mut messages, turn);
    }

    messages.push(serde_json::json!({
        "role": "user",
        "content": request.message
    }));

    call_agent_model(messages, api_key, context, &request.message).await
}

fn push_turn(messages: &mut Vec<serde_json::Value>, turn: &ConversationTurn) {
    let role = if turn.role == "assistant" {
        "assistant"
    } else {
        "user"
    };
    let content = turn.content.trim();
    if content.is_empty() {
        return;
    }
    messages.push(serde_json::json!({
        "role": role,
        "content": content
    }));
}

async fn call_agent_model(
    messages: Vec<serde_json::Value>,
    api_key: &str,
    context: &DialogueContext,
    user_message: &str,
) -> Result<AgentResponse, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": AGENT_MODEL,
            "messages": messages,
            "response_format": { "type": "json_object" },
            "temperature": 0.35,
            "max_completion_tokens": 4096
        }))
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
    let content = response["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "Пустой ответ агента".to_string())?;

    let parsed: AgentTurnJson = serde_json::from_str(content)
        .map_err(|e| format!("Агент вернул невалидный JSON ({}): {}", e, content))?;

    map_turn_to_response(parsed, context, user_message)
}

fn build_system_prompt(context: &DialogueContext) -> String {
    let target_lang = context
        .target_language
        .as_deref()
        .unwrap_or("не указан");
    let segments_block = format_segments_for_prompt(context.current_segments.as_deref());
    let glossary_block = format_glossary_for_prompt(context.current_glossary.as_deref());

    format!(
        "Ты AI-ассистент приложения Subtitle Studio, помощник по субтитрам.\n\
         Ты ведёшь обычный диалог с пользователем и при необходимости вносишь правки в субтитры проекта.\n\n\
         Язык ответа в поле message: тот же, на котором пишет пользователь (русский, английский и т.д.).\n\n\
         Контекст проекта:\n\
         - Целевой язык перевода: {target_lang}\n\
         - {glossary_block}\n\n\
         Текущие субтитры (id, таймкоды start-end в секундах, text = оригинал, translation = перевод):\n\
         {segments_block}\n\n\
         Как понимать намерение (смотри на смысл и историю диалога):\n\
         - Если пользователь обсуждает реплику и затем предлагает формулировку («надо вот так», «лучше так», \"should be\", \"make it\"…) — это правка субтитров.\n\
         - Если просит изменить/исправить/укоротить/перефразировать сегмент — edit_segments.\n\
         - Если только спрашивает, советует, уточняет без просьбы применить изменения — actions: [], только message.\n\
         - Если просит улучшить перевод — edit_segments с полем translation.\n\
         - Если просит анализ качества без правок — explain_issue.\n\
         - Если про термины/глоссарий — update_glossary и при необходимости edit_segments.\n\n\
         КРИТИЧНО:\n\
         - Если в message обещаешь внести правки / заменить / обновить глоссарий — в actions ОБЯЗАТЕЛЬНО нужен соответствующий объект. Нельзя писать «заменю» и оставлять actions пустым.\n\
         - «Замени везде A на B», «лучше Geek вместо Nerd», «давай» после согласования — это команды на применение.\n\
         - При смене перевода термина в глоссарии: update_glossary + edit_segments (старый target → новый во всех репликах).\n\n\
         Правила правок:\n\
         - В edit_segments указывай ТОЛЬКО изменённые сегменты (id обязателен).\n\
         - Включай только поля, которые меняются: text и/или translation.\n\
         - Не выдумывай id. Не меняй таймкоды.\n\
         - Не перефразируй весь файл без явной просьбы.\n\n\
         Верни СТРОГО один JSON-объект (без markdown):\n\
         {{\n\
           \"message\": \"текст ответа пользователю\",\n\
           \"actions\": [] ИЛИ [объект, ...],\n\
           \"suggestions\": null ИЛИ [\"строка\", ...]\n\
         }}\n\n\
         Типы элементов actions:\n\
         1) {{\"type\":\"edit_segments\",\"segments\":[{{\"id\":1,\"text\":\"...\",\"translation\":\"...\"}}]}}\n\
         2) {{\"type\":\"update_glossary\",\"entries\":[{{\"id\":\"\",\"source\":\"\",\"target\":\"\",\"description\":null,\"context\":null}}]}}\n\
         3) {{\"type\":\"explain_issue\",\"issue\":\"...\",\"solution\":\"...\"}}\n\
         4) {{\"type\":\"generate_text\",\"text\":\"...\"}}\n\n\
         Если правки не нужны, actions: []."
    )
}

fn format_segments_for_prompt(segments: Option<&[SubtitleSegment]>) -> String {
    let Some(segments) = segments else {
        return "(сегменты не переданы)".to_string();
    };
    if segments.is_empty() {
        return "(пустой список сегментов)".to_string();
    }

    let total = segments.len();
    let shown: Vec<_> = segments.iter().take(MAX_SEGMENTS_IN_PROMPT).collect();
    let lines: Vec<String> = shown
        .iter()
        .map(|s| {
            let tr = s.translation.as_deref().unwrap_or("");
            format!(
                "#{} [{:.2}-{:.2}] text={:?} translation={:?}",
                s.id, s.start, s.end, s.text, tr
            )
        })
        .collect();

    let mut block = lines.join("\n");
    if total > MAX_SEGMENTS_IN_PROMPT {
        block.push_str(&format!(
            "\n… и ещё {} сегментов (не показаны). Уточняй id при правках.",
            total - MAX_SEGMENTS_IN_PROMPT
        ));
    }
    block
}

fn format_glossary_for_prompt(glossary: Option<&[GlossaryEntry]>) -> String {
    let Some(glossary) = glossary else {
        return "Глоссарий: (не передан)".to_string();
    };
    if glossary.is_empty() {
        return "Глоссарий: пуст".to_string();
    }
    let lines: Vec<String> = glossary
        .iter()
        .map(|e| format!("- {} -> {}", e.source, e.target))
        .collect();
    format!("Глоссарий:\n{}", lines.join("\n"))
}

#[derive(Debug, Deserialize)]
struct AgentTurnJson {
    message: String,
    #[serde(default)]
    actions: Vec<serde_json::Value>,
    // legacy json от gpt
    action: Option<serde_json::Value>,
    #[serde(default)]
    suggestions: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct SegmentPatch {
    id: u32,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    translation: Option<String>,
}

fn map_turn_to_response(
    parsed: AgentTurnJson,
    context: &DialogueContext,
    user_message: &str,
) -> Result<AgentResponse, String> {
    let message = parsed.message.trim().to_string();
    let mut actions: Vec<AgentAction> = Vec::new();

    for value in &parsed.actions {
        if let Some(a) = parse_action(value, context) {
            actions.push(a);
        }
    }
    if actions.is_empty() {
        if let Some(ref single) = parsed.action {
            if let Some(a) = parse_action(single, context) {
                actions.push(a);
            }
        }
    }
    if actions.is_empty() {
        actions.extend(infer_actions_fallback(user_message, context));
    }

    Ok(AgentResponse {
        message: if message.is_empty() {
            "Готово.".to_string()
        } else {
            message
        },
        actions,
        suggestions: parsed.suggestions,
    })
}

fn parse_action(value: &serde_json::Value, context: &DialogueContext) -> Option<AgentAction> {
    let action_type = value.get("type").and_then(|v| v.as_str())?;

    match action_type {
        "edit_segments" => {
            let patches: Vec<SegmentPatch> =
                serde_json::from_value(value.get("segments")?.clone()).ok()?;
            let base = context.current_segments.as_deref()?;
            let merged = apply_segment_patches(base, &patches);
            Some(AgentAction::EditSegments {
                segments: collect_changed_segments(base, &merged),
            })
        }
        "update_glossary" => {
            let entries: Vec<GlossaryEntry> =
                serde_json::from_value(value.get("entries")?.clone()).ok()?;
            Some(AgentAction::UpdateGlossary { entries })
        }
        "explain_issue" => {
            let issue = value.get("issue")?.as_str()?.to_string();
            let solution = value.get("solution")?.as_str()?.to_string();
            Some(AgentAction::ExplainIssue { issue, solution })
        }
        "generate_text" => {
            let text = value.get("text")?.as_str()?.to_string();
            Some(AgentAction::GenerateText { text })
        }
        _ => None,
    }
}

fn apply_segment_patches(base: &[SubtitleSegment], patches: &[SegmentPatch]) -> Vec<SubtitleSegment> {
    if patches.is_empty() {
        return base.to_vec();
    }

    let mut result = base.to_vec();
    for patch in patches {
        if let Some(seg) = result.iter_mut().find(|s| s.id == patch.id) {
            if let Some(text) = &patch.text {
                seg.text = text.clone();
            }
            if let Some(translation) = &patch.translation {
                seg.translation = Some(translation.clone());
            }
        }
    }
    result
}

fn collect_changed_segments(
    before: &[SubtitleSegment],
    after: &[SubtitleSegment],
) -> Vec<SubtitleSegment> {
    let after_by_id: std::collections::HashMap<u32, &SubtitleSegment> =
        after.iter().map(|s| (s.id, s)).collect();
    before
        .iter()
        .filter_map(|b| {
            let a = after_by_id.get(&b.id)?;
            let tr_before = b.translation.as_deref().unwrap_or("");
            let tr_after = a.translation.as_deref().unwrap_or("");
            if b.text != a.text || tr_before != tr_after {
                Some((*a).clone())
            } else {
                None
            }
        })
        .collect()
}

fn infer_actions_fallback(user_message: &str, context: &DialogueContext) -> Vec<AgentAction> {
    let mut actions = Vec::new();
    let msg = user_message.trim();
    if msg.is_empty() {
        return actions;
    }

    if let Some((from, to)) = parse_bulk_replace_request(msg) {
        if let Some(glossary) = context.current_glossary.as_deref() {
            let updates = glossary_updates_for_replace(&from, &to, glossary);
            if !updates.is_empty() {
                actions.push(AgentAction::UpdateGlossary { entries: updates });
            }
        }
        actions.extend(bulk_replace_actions(&from, &to, context, false));
        return actions;
    }

    if let Some((entry, old_target)) = parse_glossary_translation_preference(msg, context) {
        actions.push(AgentAction::UpdateGlossary {
            entries: vec![entry.clone()],
        });
        if !old_target.is_empty() && !entry.target.is_empty() {
            actions.extend(bulk_replace_actions(
                &old_target,
                &entry.target,
                context,
                true,
            ));
        }
        return actions;
    }

    if is_short_confirmation(msg) {
        if let Some((from, to)) = infer_replace_from_dialogue(context) {
            actions.extend(bulk_replace_actions(&from, &to, context, false));
        }
    }

    actions
}

fn bulk_replace_actions(
    from: &str,
    to: &str,
    context: &DialogueContext,
    translation_only: bool,
) -> Vec<AgentAction> {
    let Some(base) = context.current_segments.as_deref() else {
        return Vec::new();
    };
    if from.trim().is_empty() || from.eq_ignore_ascii_case(to) {
        return Vec::new();
    }

    let merged = bulk_replace_in_segments(base, from, to, translation_only);
    let changed = collect_changed_segments(base, &merged);
    if changed.is_empty() {
        return Vec::new();
    }
    vec![AgentAction::EditSegments { segments: changed }]
}

fn bulk_replace_in_segments(
    base: &[SubtitleSegment],
    from: &str,
    to: &str,
    translation_only: bool,
) -> Vec<SubtitleSegment> {
    base.iter()
        .map(|seg| {
            let mut next = seg.clone();
            if !translation_only {
                next.text = replace_word_case_insensitive(&seg.text, from, to);
            }
            if let Some(tr) = &seg.translation {
                let replaced = replace_word_case_insensitive(tr, from, to);
                if replaced != *tr {
                    next.translation = Some(replaced);
                }
            }
            next
        })
        .collect()
}

fn replace_word_case_insensitive(haystack: &str, from: &str, to: &str) -> String {
    if from.is_empty() {
        return haystack.to_string();
    }
    let escaped = regex::escape(from);
    let pattern = format!(r"(?iu)(?<![\p{{L}}\p{{N}}_]){}(?![\p{{L}}\p{{N}}_])", escaped);
    let Ok(re) = Regex::new(&pattern) else {
        return haystack.to_string();
    };
    re.replace_all(haystack, to).into_owned()
}

fn parse_bulk_replace_request(msg: &str) -> Option<(String, String)> {
    let patterns = [
        r"(?is)(?:замени(?:те)?|поменя(?:й|йте)|исправ(?:ь|ьте)|переименуй(?:те)?)\s+(?:везде|во\s+всех|everywhere)?\s*(?:«)?(.+?)(?:»)?\s+(?:на|в)\s*(?:«)?(.+?)(?:»)?\s*\.?$",
        r"(?is)replace\s+(?:all\s+)?(?:«)?(.+?)(?:»)?\s+with\s+(?:«)?(.+?)(?:»)?\s*\.?$",
    ];
    for pat in patterns {
        let Ok(re) = Regex::new(pat) else {
            continue;
        };
        if let Some(caps) = re.captures(msg) {
            let from = caps.get(1)?.as_str().trim().to_string();
            let to = caps.get(2)?.as_str().trim().to_string();
            if !from.is_empty() && !to.is_empty() {
                return Some((from, to));
            }
        }
    }
    None
}

fn parse_glossary_translation_preference(
    msg: &str,
    context: &DialogueContext,
) -> Option<(GlossaryEntry, String)> {
    let glossary = context.current_glossary.as_deref()?;
    let new_target_re =
        Regex::new(r"(?i)(?:лучше|better|предпочитаю|prefer)\s+(?:«)?([^«\n,.!?]+)").ok()?;
    let new_target = new_target_re
        .captures(msg)?
        .get(1)?
        .as_str()
        .trim()
        .trim_matches(|c| c == '«' || c == '»' || c == '"' || c == '\'');
    if new_target.is_empty() {
        return None;
    }

    let msg_lower = msg.to_lowercase();
    for entry in glossary {
        let source = entry.source.trim();
        if source.is_empty() {
            continue;
        }
        if !msg_lower.contains(&source.to_lowercase()) {
            continue;
        }
        let old_target = entry.target.trim().to_string();
        if old_target.is_empty() || old_target.eq_ignore_ascii_case(new_target) {
            continue;
        }
        let mut updated = entry.clone();
        updated.target = new_target.to_string();
        return Some((updated, old_target));
    }
    None
}

fn is_short_confirmation(msg: &str) -> bool {
    let m = msg.trim().to_lowercase();
    matches!(
        m.as_str(),
        "давай"
            | "да"
            | "ок"
            | "ok"
            | "yes"
            | "делай"
            | "сделай"
            | "пожалуйста"
            | "go ahead"
            | "do it"
    )
}

fn glossary_updates_for_replace(
    from: &str,
    to: &str,
    glossary: &[GlossaryEntry],
) -> Vec<GlossaryEntry> {
    let mut updates = Vec::new();
    for entry in glossary {
        let src = entry.source.trim();
        let tgt = entry.target.trim();
        if src.eq_ignore_ascii_case(from) {
            let mut u = entry.clone();
            u.source = to.to_string();
            updates.push(u);
        } else if tgt.eq_ignore_ascii_case(from) {
            let mut u = entry.clone();
            u.target = to.to_string();
            updates.push(u);
        }
    }
    updates
}

fn infer_replace_from_dialogue(context: &DialogueContext) -> Option<(String, String)> {
    let last_assistant = context
        .conversation_history
        .iter()
        .rev()
        .find(|m| m.role == "assistant")?;
    let content = last_assistant.content.as_str();

    if let Some((from, to)) = parse_bulk_replace_request(content) {
        return Some((from, to));
    }

    let arrow_re = Regex::new(
        r"(?i)(?:«)?([^«\n]+?)(?:»)?\s*(?:→|->|—>)\s*(?:«)?([^«\n]+?)(?:»)?",
    )
    .ok()?;
    if let Some(caps) = arrow_re.captures(content) {
        let from = caps.get(1)?.as_str().trim().to_string();
        let to = caps.get(2)?.as_str().trim().to_string();
        if !from.is_empty() && !to.is_empty() {
            return Some((from, to));
        }
    }

    if let Some((entry, old_target)) = parse_glossary_translation_preference(content, context) {
        if !old_target.is_empty() && !entry.target.is_empty() {
            return Some((old_target, entry.target));
        }
    }

    None
}

fn get_api_key() -> Result<String, String> {
    let entry = keyring::Entry::new("subtitle-studio", "openai-api-key")
        .map_err(|e| e.to_string())?;

    entry
        .get_password()
        .map_err(|e| format!("Ключ не найден или ошибка доступа: {}", e))
}
