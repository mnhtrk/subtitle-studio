use serde::{Deserialize, Serialize};
use crate::project::{SubtitleSegment, GlossaryEntry};
use crate::speaker_gender_rules::{
    dialogue_context_translation_rules, segment_speaker_gender_str,
    speaker_gender_translation_rules,
};
use crate::agent::dialogue_history::{DialogueHistory, AgentMessage, ConversationTurn, DialogueContext};
use std::collections::HashSet;
use std::sync::Mutex;
use lazy_static::lazy_static;
use regex::Regex;

const AGENT_MODEL: &str = "gpt-5.4";
const MAX_HISTORY_TURNS: usize = 30;
const DEFAULT_NEIGHBOR_RADIUS: usize = 5;
const MAX_NEIGHBOR_RADIUS: usize = 12;
const COMPACT_TEXT_MAX: usize = 80;
const COMPACT_TRANSLATION_MAX: usize = 120;
/// При большом файле — структура сцен + фокус/пакет, без тысяч компактных строк.
const MAX_COMPACT_LINES_IN_PROMPT: usize = 350;

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
    #[serde(default)]
    pub focus_segment_id: Option<u32>,
    #[serde(default)]
    pub neighbor_radius: usize,
    #[serde(default)]
    pub batch_segment_ids: Option<Vec<u32>>,
    #[serde(default)]
    pub batch_index: Option<u32>,
    #[serde(default)]
    pub batch_total: Option<u32>,
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
            request.context.focus_segment_id,
            request.context.neighbor_radius,
            request.context.batch_segment_ids.clone(),
            request.context.batch_index,
            request.context.batch_total,
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
            focus_segment_id: None,
            neighbor_radius: 0,
            batch_segment_ids: None,
            batch_index: None,
            batch_total: None,
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
    let radius = if context.neighbor_radius == 0 {
        DEFAULT_NEIGHBOR_RADIUS
    } else {
        context.neighbor_radius.min(MAX_NEIGHBOR_RADIUS)
    };
    let segments_block = format_segments_for_prompt(
        context.current_segments.as_deref(),
        context.focus_segment_id,
        radius,
        context.batch_segment_ids.as_deref(),
        context.batch_index,
        context.batch_total,
    );
    let glossary_block = format_glossary_for_prompt(context.current_glossary.as_deref());
    let gender_dialogue = dialogue_context_translation_rules(target_lang);
    let gender_rules = speaker_gender_translation_rules(target_lang);
    let gender_field_note = "\n\
         У каждой реплики в списке ниже указан speaker_gender (male/female/unknown) — пол говорящего в этой строке.\n";

    let batch_note = if context.batch_total.unwrap_or(0) > 1 {
        "\n\
         РЕЖИМ ПАКЕТОВ: пользователь просит пройти по всему файлу. Обрабатывай ТОЛЬКО сегменты текущего пакета (полный текст ниже). \
         В edit_segments возвращай только изменённые id из этого пакета. Остальные пакеты придут отдельными запросами.\n"
    } else {
        ""
    };

    format!(
        "Ты AI-ассистент приложения Subtitle Studio, помощник по субтитрам.\n\
         Ты ведёшь обычный диалог с пользователем и при необходимости вносишь правки в субтитры проекта.\n\n\
         Язык ответа в поле message: тот же, на котором пишет пользователь (русский, английский и т.д.).\n\n\
         Контекст проекта:\n\
         - Целевой язык перевода: {target_lang}\n\
         - {glossary_block}\n\n\
         {batch_note}\
         {gender_field_note}\
         {gender_dialogue}\
         {gender_rules}\
         Субтитры (сначала краткая структура эпизода по сценам, затем реплики):\n\
         {segments_block}\n\n\
         Если в сообщении есть «Прикрепленная реплика» — она помечена <<< ПРИКРЕПЛЕНО; учитывай ±{radius} соседних строк в развёрнутом фрагменте (у них тоже есть speaker_gender).\n\n\
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
         Если правки не нужны, actions: [].",
        target_lang = target_lang,
        glossary_block = glossary_block,
        batch_note = batch_note,
        gender_field_note = gender_field_note,
        gender_dialogue = gender_dialogue,
        gender_rules = gender_rules,
        segments_block = segments_block,
        radius = radius,
    )
}

fn format_segment_line_full(s: &SubtitleSegment, mark: &str) -> String {
    let tr = s.translation.as_deref().unwrap_or("");
    let g = segment_speaker_gender_str(s);
    format!(
        "#{} [{:.2}-{:.2}] speaker_gender={} text={:?} translation={:?}{}\n",
        s.id, s.start, s.end, g, s.text, tr, mark
    )
}

fn format_segment_line_compact(s: &SubtitleSegment) -> String {
    let tr = truncate_for_prompt(s.translation.as_deref().unwrap_or(""), COMPACT_TRANSLATION_MAX);
    let txt = truncate_for_prompt(&s.text, COMPACT_TEXT_MAX);
    let g = segment_speaker_gender_str(s);
    format!(
        "#{} [{:.2}-{:.2}] gender={} orig={:?} tr={:?}\n",
        s.id, s.start, s.end, g, txt, tr
    )
}

fn truncate_for_prompt(s: &str, max_chars: usize) -> String {
    let t = s.trim();
    if t.is_empty() {
        return String::new();
    }
    if t.chars().count() <= max_chars {
        return t.to_string();
    }
    let mut out: String = t.chars().take(max_chars).collect();
    out.push('…');
    out
}

fn format_time_hms(seconds: f64) -> String {
    if !seconds.is_finite() || seconds < 0.0 {
        return "00:00:00".to_string();
    }
    let total = seconds.floor() as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    format!("{h:02}:{m:02}:{s:02}")
}

/// Сцены по паузам между репликами (без вызова LLM).
fn format_episode_outline(segments: &[SubtitleSegment]) -> String {
    if segments.is_empty() {
        return "Структура эпизода: (нет реплик)".to_string();
    }

    const SCENE_GAP_SEC: f64 = 5.0;

    let mut sorted: Vec<&SubtitleSegment> = segments.iter().collect();
    sorted.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });

    let mut scenes: Vec<Vec<&SubtitleSegment>> = Vec::new();
    let mut current: Vec<&SubtitleSegment> = vec![sorted[0]];
    for w in sorted.windows(2) {
        if w[1].start - w[0].end > SCENE_GAP_SEC {
            scenes.push(current);
            current = vec![w[1]];
        } else {
            current.push(w[1]);
        }
    }
    scenes.push(current);

    let total = sorted.len();
    let duration_end = sorted.last().map(|s| s.end).unwrap_or(0.0);
    let mut lines = vec![format!(
        "Структура эпизода ({} сцен, пауза между сценами ≥{:.0}s, {} реплик, длительность до {}):",
        scenes.len(),
        SCENE_GAP_SEC,
        total,
        format_time_hms(duration_end)
    )];

    for (i, scene) in scenes.iter().enumerate() {
        let start = scene.first().map(|s| s.start).unwrap_or(0.0);
        let end = scene.last().map(|s| s.end).unwrap_or(0.0);
        let first = scene.first();
        let sample_o = first
            .map(|s| truncate_for_prompt(&s.text, 70))
            .unwrap_or_default();
        let sample_t = first
            .and_then(|s| s.translation.as_deref())
            .map(|t| truncate_for_prompt(t, 70))
            .unwrap_or_default();
        lines.push(format!(
            "  Сцена {} [{}–{}] — {} реплик | начало: {:?} → {:?}",
            i + 1,
            format_time_hms(start),
            format_time_hms(end),
            scene.len(),
            sample_o,
            sample_t
        ));
    }

    lines.join("\n")
}

fn format_segments_for_prompt(
    segments: Option<&[SubtitleSegment]>,
    focus_id: Option<u32>,
    neighbor_radius: usize,
    batch_ids: Option<&[u32]>,
    batch_index: Option<u32>,
    batch_total: Option<u32>,
) -> String {
    let Some(segments) = segments else {
        return "(сегменты не переданы)".to_string();
    };
    if segments.is_empty() {
        return "(пустой список сегментов)".to_string();
    }

    let mut sorted: Vec<&SubtitleSegment> = segments.iter().collect();
    sorted.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });

    let total = sorted.len();
    let mut out = format_episode_outline(segments);
    out.push('\n');

    if let Some(ids) = batch_ids {
        if !ids.is_empty() {
            let id_set: HashSet<u32> = ids.iter().copied().collect();
            let bi = batch_index.unwrap_or(1);
            let bt = batch_total.unwrap_or(1);
            out.push_str(&format!(
                "\nПакет {bi}/{bt} — полный текст только этих id (остальные сегменты файла в других пакетах):\n"
            ));
            for s in &sorted {
                if id_set.contains(&s.id) {
                    out.push_str(&format_segment_line_full(s, ""));
                }
            }
            return out;
        }
    }

    let focus_idx = focus_id.and_then(|id| sorted.iter().position(|s| s.id == id));
    let radius = neighbor_radius.min(MAX_NEIGHBOR_RADIUS);

    let in_focus_window = |idx: usize| -> bool {
        if let Some(fi) = focus_idx {
            let lo = fi.saturating_sub(radius);
            let hi = (fi + radius).min(total.saturating_sub(1));
            idx >= lo && idx <= hi
        } else {
            false
        }
    };

    out.push_str(&format!("\nВсего сегментов: {total}.\n"));

    if let Some(fi) = focus_idx {
        let lo = fi.saturating_sub(radius);
        let hi = (fi + radius).min(total.saturating_sub(1));
        out.push_str(&format!(
            "Развёрнутый фрагмент (прикреплённая реплика и ±{radius} соседей, id {}..{}):\n",
            sorted[lo].id,
            sorted[hi].id
        ));
        for idx in lo..=hi {
            let s = sorted[idx];
            let mark = if Some(s.id) == focus_id {
                " <<< ПРИКРЕПЛЕНО"
            } else {
                ""
            };
            out.push_str(&format_segment_line_full(s, mark));
        }
        out.push('\n');
    }

    if total > MAX_COMPACT_LINES_IN_PROMPT {
        out.push_str(&format!(
            "\nПострочный список всех {total} реплик опущен (слишком большой для одного запроса). \
             Используй структуру сцен выше; для правок по всему файлу пользователь запускает пакетный режим. \
             При правке указывай id из сообщения или прикреплённого фрагмента.\n"
        ));
    } else {
        out.push_str("Все реплики (компактно; развёрнутый фрагмент выше не дублируется):\n");
        for (idx, s) in sorted.iter().enumerate() {
            if in_focus_window(idx) {
                continue;
            }
            out.push_str(&format_segment_line_compact(s));
        }
    }

    out
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
