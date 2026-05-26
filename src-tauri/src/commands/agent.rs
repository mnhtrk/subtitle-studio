use serde::{Deserialize, Serialize};
use crate::project::{SubtitleSegment, GlossaryEntry};
use crate::speaker_gender_rules::{
    dialogue_context_translation_rules, proper_name_declension_rules, segment_speaker_gender_str,
    speaker_gender_translation_rules,
};
use crate::agent::dialogue_history::{
    DialogueHistory, AgentMessage, ConversationTurn, DialogueContext, SubtitleFileContext,
};
use crate::agent::task_mode::{
    agent_model_for_task, classify_agent_intent, filter_changed_segments,
    reasoning_effort_for_task, task_mode_prompt_block, AgentIntent, AgentTaskMode,
};
use std::collections::HashSet;
use std::sync::Mutex;
use lazy_static::lazy_static;

const MAX_HISTORY_TURNS: usize = 30;
const DEFAULT_NEIGHBOR_RADIUS: usize = 5;
const MAX_NEIGHBOR_RADIUS: usize = 12;
const COMPACT_TEXT_MAX: usize = 80;
const COMPACT_TRANSLATION_MAX: usize = 120;
// при большом файле даём gpt структуру сцен + фокус, иначе раздуем промпт
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
    pub active_subtitle_file_id: Option<String>,
    #[serde(default)]
    pub active_subtitle_file_name: Option<String>,
    // active_episode или whole_project
    #[serde(default)]
    pub edit_scope: Option<String>,
    #[serde(default)]
    pub subtitle_files: Vec<SubtitleFileContext>,
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
    #[serde(default)]
    pub task_mode: Option<String>,
    #[serde(default)]
    pub replace_from: Option<String>,
    #[serde(default)]
    pub replace_to: Option<String>,
    #[serde(default)]
    pub translation_only: Option<bool>,
    #[serde(default)]
    pub replace_pairs: Option<Vec<crate::agent::task_mode::ReplacePair>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentResponse {
    pub message: String,
    #[serde(default)]
    pub actions: Vec<AgentAction>,
    pub suggestions: Option<Vec<String>>,
    // режим задачи после классификации - для пакетных запросов с фронта
    #[serde(default)]
    pub task_mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentIntentResponse {
    pub task_mode: String,
    #[serde(default)]
    pub replace_from: Option<String>,
    #[serde(default)]
    pub replace_to: Option<String>,
    #[serde(default)]
    pub translation_only: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum AgentAction {
    EditSegments {
        #[serde(default)]
        file_id: Option<String>,
        segments: Vec<SubtitleSegment>,
    },
    DeleteSegments {
        #[serde(default)]
        file_id: Option<String>,
        segment_ids: Vec<u32>,
    },
    UpdateGlossary { entries: Vec<GlossaryEntry> },
    GenerateText { text: String },
    ExplainIssue { issue: String, solution: String },
}

#[tauri::command]
pub async fn classify_agent_intent_command(
    message: String,
    conversation_history: Option<Vec<ConversationTurn>>,
) -> Result<AgentIntentResponse, String> {
    let conversation_history = conversation_history.unwrap_or_default();
    let api_key = get_api_key()?;
    let tail: Vec<(String, String)> = conversation_history
        .iter()
        .rev()
        .take(6)
        .map(|t| (t.role.clone(), t.content.clone()))
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let intent = classify_agent_intent(&api_key, &message, &tail).await?;
    Ok(AgentIntentResponse {
        task_mode: intent.task_mode,
        replace_from: intent.replace_from,
        replace_to: intent.replace_to,
        translation_only: intent.translation_only,
    })
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
            request.context.active_subtitle_file_id.clone(),
            request.context.active_subtitle_file_name.clone(),
            request.context.edit_scope.clone(),
            request.context.subtitle_files.clone(),
            request.context.focus_segment_id,
            request.context.neighbor_radius,
            request.context.batch_segment_ids.clone(),
            request.context.batch_index,
            request.context.batch_total,
            request.context.task_mode.clone(),
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
            active_subtitle_file_id: None,
            active_subtitle_file_name: None,
            edit_scope: None,
            subtitle_files: Vec::new(),
            focus_segment_id: None,
            neighbor_radius: 0,
            batch_segment_ids: None,
            batch_index: None,
            batch_total: None,
            task_mode: None,
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

    let (task_mode, intent) = resolve_task_mode_and_intent(
        &api_key,
        &request.context,
        &request.message,
        &request.conversation_history,
    )
    .await?;

    if task_mode == AgentTaskMode::AnswerOnly {
        let response = run_agent_turn(
            &request,
            &dialogue_context,
            &api_key,
            task_mode,
            intent.as_ref(),
        )
        .await?;
        if should_record_assistant_turn(&request.context) {
            record_assistant_message(&session_id, &response.message)?;
        }
        return Ok(AgentResponse {
            task_mode: Some(task_mode.as_str().to_string()),
            ..response
        });
    }

    let response = run_agent_turn(
        &request,
        &dialogue_context,
        &api_key,
        task_mode,
        intent.as_ref(),
    )
    .await?;

    if should_record_assistant_turn(&request.context) {
        record_assistant_message(&session_id, &response.message)?;
    }

    Ok(AgentResponse {
        task_mode: Some(task_mode.as_str().to_string()),
        ..response
    })
}

async fn resolve_task_mode_and_intent(
    api_key: &str,
    context: &AgentContext,
    message: &str,
    conversation_history: &[ConversationTurn],
) -> Result<(AgentTaskMode, Option<AgentIntent>), String> {
    if let Some(mode_str) = context.task_mode.as_deref() {
        if let Some(mode) = AgentTaskMode::parse(mode_str) {
            if mode != AgentTaskMode::General {
                if mode == AgentTaskMode::BulkReplace {
                    if let Some(intent) = bulk_replace_intent_from_context(context) {
                        return Ok((mode, Some(intent)));
                    }
                } else if mode == AgentTaskMode::GlossarySync {
                    return Ok((mode, glossary_sync_intent_from_context(context)));
                } else {
                    return Ok((mode, None));
                }
            }
        }
    }

    let tail: Vec<(String, String)> = conversation_history
        .iter()
        .rev()
        .take(6)
        .map(|t| (t.role.clone(), t.content.clone()))
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    let intent = classify_agent_intent(api_key, message, &tail).await?;
    let mode = intent.mode();
    Ok((mode, Some(intent)))
}

fn bulk_replace_intent_from_context(context: &AgentContext) -> Option<AgentIntent> {
    let from = context.replace_from.as_deref()?.trim();
    let to = context.replace_to.as_deref()?.trim();
    if from.is_empty() || to.is_empty() {
        return None;
    }
    Some(AgentIntent {
        task_mode: AgentTaskMode::BulkReplace.as_str().to_string(),
        replace_from: Some(from.to_string()),
        replace_to: Some(to.to_string()),
        translation_only: context.translation_only.unwrap_or(false),
        replace_pairs: None,
    })
}

fn glossary_sync_intent_from_context(context: &AgentContext) -> Option<AgentIntent> {
    Some(AgentIntent {
        task_mode: AgentTaskMode::GlossarySync.as_str().to_string(),
        replace_from: None,
        replace_to: None,
        translation_only: context.translation_only.unwrap_or(true),
        replace_pairs: context.replace_pairs.clone(),
    })
}

// промежуточные пакеты не пишем в историю - иначе чат забьётся типа пакет N не найдено
fn should_record_assistant_turn(context: &AgentContext) -> bool {
    match (context.batch_total, context.batch_index) {
        (Some(total), Some(idx)) if total > 1 => idx >= total,
        _ => true,
    }
}

fn record_assistant_message(session_id: &str, content: &str) -> Result<(), String> {
    let mut history_guard = DIALOGUE_HISTORY
        .lock()
        .map_err(|_| "Ошибка блокировки истории диалогов".to_string())?;
    let history = history_guard.as_mut().unwrap();
    history.add_message(
        session_id,
        AgentMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: "assistant".to_string(),
            content: content.to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        },
    );
    Ok(())
}

async fn run_agent_turn(
    request: &AgentRequest,
    context: &DialogueContext,
    api_key: &str,
    task_mode: AgentTaskMode,
    intent: Option<&AgentIntent>,
) -> Result<AgentResponse, String> {
    let system_prompt = build_system_prompt(context, task_mode, intent);
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

    let ep = context
        .active_subtitle_file_name
        .as_deref()
        .unwrap_or("?");
    let batch_label = match (context.batch_index, context.batch_total) {
        (Some(i), Some(t)) if t > 1 => format!("пакет {i}/{t}"),
        _ => "одиночный запрос".to_string(),
    };
    let scope_label = context.edit_scope.as_deref().unwrap_or("-");

    // диагностика по пересказам/прикреплённой реплике/другим эпизодам
    let active_id = context.active_subtitle_file_id.as_deref();
    let current_summary_len = active_id
        .and_then(|fid| context.subtitle_files.iter().find(|f| f.file_id == fid))
        .and_then(|f| f.summary.as_deref())
        .map(|s| s.trim().len())
        .unwrap_or(0);
    let other_files: Vec<&crate::agent::dialogue_history::SubtitleFileContext> = context
        .subtitle_files
        .iter()
        .filter(|f| active_id.map(|id| id != f.file_id).unwrap_or(true))
        .collect();
    let other_with = other_files
        .iter()
        .filter(|f| f.summary.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false))
        .count();
    let focus_label = match context.focus_segment_id {
        Some(id) => format!(
            "id={id}, ±{} соседей",
            context.neighbor_radius.min(MAX_NEIGHBOR_RADIUS)
        ),
        None => "нет".to_string(),
    };
    let current_seg_count = context
        .current_segments
        .as_deref()
        .map(|s| s.len())
        .unwrap_or(0);

    println!();
    println!("================================================================");
    println!("[agent][debug] >>> ЗАПРОС К АГЕНТУ");
    println!("  эпизод:           {ep}  ({current_seg_count} реплик в файле)");
    println!("  пачка:            {batch_label}");
    println!("  scope:            {scope_label}");
    println!("  task_mode:        {}", task_mode.as_str());
    println!("  прикреплённая:    {focus_label}");
    println!(
        "  пересказ эпиз.:   {}",
        if current_summary_len > 0 {
            format!("есть ({current_summary_len} симв.)")
        } else {
            "НЕТ (в промпте без пересказа)".to_string()
        }
    );
    println!(
        "  др. эпиз.:        {} (с пересказом: {})",
        other_files.len(),
        other_with
    );
    println!("  user-сообщение:   {} символов", request.message.len());
    println!("================================================================");

    println!("---------------- SYSTEM PROMPT ({} симв.) ----------------", system_prompt.len());
    println!("{}", system_prompt);
    println!("---------------- USER MESSAGE  ({} симв.) ----------------", request.message.len());
    println!("{}", request.message);
    if let Some(table) = pretty_batch_segments_table(context) {
        println!("---------------- ТАБЛИЦА СЕГМЕНТОВ ПАКЕТА ----------------");
        println!("{table}");
    }
    println!("================================================================");

    call_agent_model(messages, api_key, context, task_mode, intent).await
}

// печатает сегменты пакета в виде понятной таблицы для debug-лога
// возвращает None если пачки нет или сегменты не переданы
fn pretty_batch_segments_table(context: &DialogueContext) -> Option<String> {
    let ids = context.batch_segment_ids.as_deref()?;
    if ids.is_empty() {
        return None;
    }
    let segments = context.current_segments.as_deref()?;
    if segments.is_empty() {
        return None;
    }
    let id_set: HashSet<u32> = ids.iter().copied().collect();
    let mut filtered: Vec<&SubtitleSegment> = segments.iter().filter(|s| id_set.contains(&s.id)).collect();
    filtered.sort_by(|a, b| a.id.cmp(&b.id));
    if filtered.is_empty() {
        return None;
    }

    let bi = context.batch_index.unwrap_or(1);
    let bt = context.batch_total.unwrap_or(1);
    let mut out = String::new();
    out.push_str(&format!(
        "Пакет {bi}/{bt}, всего {} реплик.\n",
        filtered.len()
    ));
    out.push_str("┌────────┬──────────────┬────────┬──────────────────────────────────────┬──────────────────────────────────────┐\n");
    out.push_str("│   id   │   time       │ gender │ text (оригинал)                      │ translation                          │\n");
    out.push_str("├────────┼──────────────┼────────┼──────────────────────────────────────┼──────────────────────────────────────┤\n");
    for s in &filtered {
        let g = segment_speaker_gender_str(s);
        let txt = truncate_for_prompt(&s.text, 36);
        let tr = truncate_for_prompt(s.translation.as_deref().unwrap_or(""), 36);
        out.push_str(&format!(
            "│ {:>6} │ {:>5.1}-{:>5.1} │ {:^6} │ {:<36} │ {:<36} │\n",
            s.id, s.start, s.end, g, txt, tr
        ));
    }
    out.push_str("└────────┴──────────────┴────────┴──────────────────────────────────────┴──────────────────────────────────────┘");
    Some(out)
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
    task_mode: AgentTaskMode,
    intent: Option<&AgentIntent>,
) -> Result<AgentResponse, String> {
    let client = reqwest::Client::new();
    // у gpt-5.4-mini есть reasoning_effort. temperature с ним не работает - не шлём
    // max_completion_tokens сделали побольше тк reasoning тоже жрёт токены внутри ответа
    let reasoning = reasoning_effort_for_task(task_mode);
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": agent_model_for_task(task_mode),
            "messages": messages,
            "response_format": { "type": "json_object" },
            "reasoning_effort": reasoning,
            "max_completion_tokens": 16384
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

    let ep = context
        .active_subtitle_file_name
        .as_deref()
        .unwrap_or("?");
    let batch_label = match (context.batch_index, context.batch_total) {
        (Some(i), Some(t)) if t > 1 => format!("пакет {i}/{t}"),
        _ => "одиночный запрос".to_string(),
    };

    println!();
    println!("================================================================");
    println!("[agent][debug] <<< ОТВЕТ АГЕНТА");
    println!("  эпизод:    {ep}");
    println!("  пачка:     {batch_label}");
    println!("  reasoning: {reasoning}");
    println!("  размер:    {} символов", content.len());
    println!("================================================================");
    let pretty = serde_json::from_str::<serde_json::Value>(content)
        .ok()
        .and_then(|v| serde_json::to_string_pretty(&v).ok())
        .unwrap_or_else(|| content.to_string());
    println!("{pretty}");
    println!("================================================================");

    let parsed: AgentTurnJson = serde_json::from_str(content)
        .map_err(|e| format!("Агент вернул невалидный JSON ({}): {}", e, content))?;

    map_turn_to_response(parsed, context, task_mode, intent)
}

fn build_glossary_sync_batch_system_prompt(context: &DialogueContext) -> String {
    let target_lang = context
        .target_language
        .as_deref()
        .unwrap_or("не указан");
    let file_id = context
        .active_subtitle_file_id
        .as_deref()
        .unwrap_or("");
    let episode_name = context
        .active_subtitle_file_name
        .as_deref()
        .unwrap_or("?");
    // только translation - убираем text, чтобы модель его не копировала по ошибке
    let segments_block = format_translation_only_batch(
        context.current_segments.as_deref(),
        context.batch_segment_ids.as_deref(),
        context.batch_index,
        context.batch_total,
    );

    format!(
        "Ты помощник по точечной замене слов в поле translation субтитров.\n\
         Поле text в этом задании НЕ используется и НЕ редактируется. В ответе передавай только translation.\n\
         X в репликах может стоять в любой словоформе (другое окончание, падеж, число) - это всё ещё X, замени. \
         Если в твоём списке X указан в одной форме, а в реплике другая (склонённая/изменённая) - всё равно меняй.\n\n\
         После каждой пары в списке замен может идти \"| контекст: ...\" - это подсказка о термине из глоссария (тип, пол/род, склоняется/не склоняется, особенности).\n\
         СОГЛАСОВАНИЕ РОДА. Если в контексте указан род/пол термина (например \"мужской род\", \"женский род\", \"male\", \"female\"), а в реплике глаголы, прилагательные, причастия и местоимения, относящиеся к этому термину, согласованы с ДРУГИМ родом - перепиши их под указанный род. Это касается окружающих слов, грамматически связанных именно с термином, остальные слова в реплике не трогай.\n\
         Если в контексте сказано \"не склоняется\" или Y - другая письменность/аббревиатура без типичных окончаний - подставляй Y как есть, без окончаний.\n\n\
         Эпизод: «{episode_name}» (file_id: {file_id})\n\
         Язык translation: {target_lang}\n\
         У каждой реплики указан speaker_gender (male/female/unknown) - пол того, кто её произносит (по акустике, может ошибаться). \
         Используй его при согласовании первого лица и обращений по контексту. Род самого заменяемого термина бери из \"контекст\" в списке замен, а не из speaker_gender.\n\n\
         {segments_block}\n\n\
         Формат ответа - один JSON без markdown:\n\
         {{\"message\":\"\",\"actions\":[{{\"type\":\"edit_segments\",\"file_id\":\"{file_id}\",\"segments\":[{{\"id\":N,\"translation\":\"...\"}}]}}]}}\n\
         - message всегда пустой\n\
         - segments: только id, у которых ты реально что-то поменял в translation\n\
         - в каждом сегменте только поля id и translation (никогда не указывай text)\n\
         - если замен не было: \"actions\":[]"
    )
}

// формат для glossary_sync: только id и translation, без text
// чтобы mini-модель не путалась и не копировала text в translation
fn format_translation_only_batch(
    segments: Option<&[SubtitleSegment]>,
    batch_ids: Option<&[u32]>,
    batch_index: Option<u32>,
    batch_total: Option<u32>,
) -> String {
    let Some(segments) = segments else {
        return "(сегменты не переданы)".to_string();
    };
    let Some(ids) = batch_ids else {
        return "(пакет не указан)".to_string();
    };
    if ids.is_empty() {
        return "(пустой пакет)".to_string();
    }

    let id_set: HashSet<u32> = ids.iter().copied().collect();
    let mut filtered: Vec<&SubtitleSegment> = segments.iter().filter(|s| id_set.contains(&s.id)).collect();
    filtered.sort_by(|a, b| a.id.cmp(&b.id));

    let bi = batch_index.unwrap_or(1);
    let bt = batch_total.unwrap_or(1);
    let mut out = format!(
        "Реплики пакета {bi}/{bt} (текущее значение translation + пол говорящего по акустике):\n"
    );
    for s in &filtered {
        let tr = s.translation.as_deref().unwrap_or("");
        let g = segment_speaker_gender_str(s);
        out.push_str(&format!("#{} speaker_gender={} translation={:?}\n", s.id, g, tr));
    }
    out
}

fn build_system_prompt(
    context: &DialogueContext,
    task_mode: AgentTaskMode,
    _intent: Option<&AgentIntent>,
) -> String {
    if task_mode == AgentTaskMode::GlossarySync && context.batch_total.unwrap_or(0) > 1 {
        return build_glossary_sync_batch_system_prompt(context);
    }

    let target_lang = context
        .target_language
        .as_deref()
        .unwrap_or("не указан");
    let radius = if context.neighbor_radius == 0 {
        DEFAULT_NEIGHBOR_RADIUS
    } else {
        context.neighbor_radius.min(MAX_NEIGHBOR_RADIUS)
    };
    let episode_header = match (
        context.active_subtitle_file_name.as_deref(),
        context.active_subtitle_file_id.as_deref(),
    ) {
        (Some(name), Some(id)) => format!(
            "ТЕКУЩИЙ ЭПИЗОД: «{name}» (file_id: {id}). Все edit_segments в этом ответе относятся только к этому эпизоду.\n"
        ),
        _ => String::new(),
    };
    let scope_note = match context.edit_scope.as_deref() {
        Some("whole_project") => {
            "Область: весь проект — пользователь просил пройтись по всем эпизодам. \
             В ЭТОМ ответе передан только один эпизод (см. заголовок): edit_segments и delete_segments \
             только с его file_id. Остальные эпизоды обработает интерфейс отдельными запросами.\n"
        }
        _ => "Область: текущий эпизод (не меняй другие серии).\n",
    };
    // берём пересказ текущего эпизода из subtitle_files (если был сгенерирован раньше)
    let current_summary = context.active_subtitle_file_id.as_deref().and_then(|fid| {
        context
            .subtitle_files
            .iter()
            .find(|f| f.file_id == fid)
            .and_then(|f| f.summary.clone())
    });
    let mut segments_block = format_segments_for_prompt(
        context.current_segments.as_deref(),
        context.focus_segment_id,
        radius,
        context.batch_segment_ids.as_deref(),
        context.batch_index,
        context.batch_total,
        current_summary.as_deref(),
    );
    if !episode_header.is_empty() {
        segments_block = format!("{episode_header}{scope_note}\n{segments_block}");
    } else {
        segments_block = format!("{scope_note}\n{segments_block}");
    }
    let glossary_block = format_glossary_for_prompt(context.current_glossary.as_deref());
    let summaries_block = format_project_summaries(context);
    let gender_dialogue = dialogue_context_translation_rules(target_lang);
    let gender_rules = speaker_gender_translation_rules(target_lang);
    let name_declension_rules = proper_name_declension_rules(target_lang);
    let gender_field_note = "\n\
         У каждой реплики ниже указан speaker_gender (male/female/unknown) — пол того, кто произносит её (акустика, может ошибаться).\n\
         Пол адресата определяй сам по контексту: имена-обращения, смысл соседних реплик, глоссарий.\n";

    let batch_note = if context.batch_total.unwrap_or(0) > 1 {
        match task_mode {
            AgentTaskMode::Proofread => "\n\
                 РЕЖИМ ПАКЕТОВ (ВЫЧИТКА): в этом ответе — один пакет эпизода, полный текст всех его реплик ниже.\n\
                 - Проверь КАЖДУЮ реплику пакета: опечатки, пунктуация, точка в конце, стиль («Хммм» → «Хм-м-м...»).\n\
                 - Минимальная правка; не перефразируй. Уже корректные реплики не включай в edit_segments.\n\
                 - Только id из текущего пакета. message: \"\".\n",
            AgentTaskMode::TranslationFix => "\n\
                 РЕЖИМ ПАКЕТОВ (ПЕРЕВОД): проверь КАЖДУЮ реплику пакета (полный текст ниже).\n\
                 - Только поле translation, только явные ошибки. message: \"\".\n",
            _ => "\n\
                 РЕЖИМ ПАКЕТОВ: задача разбита на части. В этом ответе — один пакет (полный текст реплик пакета ниже).\n\
                 - Обработай ВСЕ реплики пакета из списка id в сообщении пользователя; не пропускай id без проверки.\n\
                 - Выполни задачу из сообщения пользователя; не расширяй её на посторонние правки.\n\
                 - Если в пакете нечего менять — actions: []. message: \"\".\n\
                 - edit_segments — только id этого пакета.\n\
                 - delete_segments: только водяной знак Whisper (amara.org, subtitles by…); смех и междометия не удалять.\n",
        }
    } else {
        ""
    };
    let mut task_block = task_mode_prompt_block(task_mode).to_string();

    format!(
        "Ты AI-ассистент приложения Subtitle Studio, помощник по субтитрам.\n\
         Ты ведёшь обычный диалог с пользователем и при необходимости вносишь правки в субтитры проекта.\n\n\
         Язык ответа в поле message: тот же, на котором пишет пользователь (русский, английский и т.д.).\n\n\
         Контекст проекта:\n\
         - Целевой язык перевода: {target_lang}\n\
         - {glossary_block}\n\
         {summaries_block}\n\
         {batch_note}\
         {task_block}\
         {gender_field_note}\
         {gender_dialogue}\
         {gender_rules}\
         {name_declension_rules}\
         Контекст по субтитрам этого запроса (прикреплённая реплика с соседями, если есть; полного списка реплик в промпте нет, пересказы серий — выше):\n\
         {segments_block}\n\n\
         Если в сообщении есть «Прикрепленная реплика» — она помечена <<< ПРИКРЕПЛЕНО; учитывай ±{radius} соседних строк в развёрнутом фрагменте (у них тоже есть speaker_gender).\n\n\
         Как понимать намерение (смотри на смысл и историю диалога):\n\
         - Если пользователь обсуждает реплику и затем предлагает формулировку («надо вот так», «лучше так», \"should be\", \"make it\"…) — это правка субтитров.\n\
         - Если просит изменить/исправить/укоротить/перефразировать сегмент — edit_segments.\n\
         - Если просит удалить галлюцинации/мусор Whisper или конкретную мусорную строку — delete_segments (см. правила ниже).\n\
         - Если только спрашивает, советует, уточняет без просьбы применить изменения — actions: [], только message.\n\
         - Если просит улучшить перевод — edit_segments с полем translation.\n\
         - Если просит анализ качества без правок — explain_issue.\n\
         - Если про термины/глоссарий — update_glossary и при необходимости edit_segments.\n\n\
         ОБЛАСТЬ ЗАДАЧИ (самое важное):\n\
         - Меняй субтитры ТОЛЬКО в рамках того, что пользователь явно попросил в текущем сообщении и в согласованной истории диалога.\n\
         - Не исправляй «заодно» другие ошибки, неточности перевода, род, говорящего, пунктуацию — даже если они очевидны.\n\
         - Правила speaker_gender ниже — справочник для строк, которые ты УЖЕ меняешь по просьбе пользователя; не повод править остальные реплики.\n\
         - Если пользователь просит заменить термин/фразу — меняй только это (и глоссарий, если просили); не переписывай соседний смысл.\n\n\
         КРИТИЧНО:\n\
         - Если в message обещаешь внести правки / заменить / обновить глоссарий — в actions ОБЯЗАТЕЛЬНО нужен соответствующий объект. Нельзя писать «заменю» и оставлять actions пустым.\n\
         - «Замени везде A на B», «лучше Geek вместо Nerd», «давай» после согласования — это команды на применение.\n\
         - При смене перевода термина в глоссарии: update_glossary + edit_segments (старый target → новый во всех репликах).\n\n\
         Правила правок:\n\
         - В edit_segments указывай ТОЛЬКО изменённые сегменты (id обязателен).\n\
         - Включай только поля, которые меняются: text и/или translation.\n\
         - delete_segments — ТОЛЬКО водяные знаки/галлюцинации Whisper (технические вставки ASR), НЕ речь персонажей.\n\
         - УДАЛЯЙ (белый список): строка содержит признаки водяного знака — «Subtitles by…» / «Subtitles by DimaTorzok» и любое имя, \
           «subtitles created», «субтитры сделаны», «Amara.org», «amara.org», обрывок «org.» без сцены; или полностью пустая строка-мусор.\n\
         - ЗАПРЕЩЕНО удалять через delete_segments (это диалог, даже если коротко или повтор звука):\n\
           смех и реакции — «Ха-ха», «Хи-хи», «Ха-ха-ха», «Хе-хе», «Лол»; междометия — «Ой», «Ай», «Ай-ай», «Э-э», \
           «Нет!», «Что?», «А?», «А-а-а» как крик/реакция в сцене; «…»; любые осмысленные реплики с именами и действиями.\n\
         - Повторяющиеся слоги в сцене (крик, смех, испуг) — НЕ галлюцинация Whisper; не путай с водяным знаком.\n\
         - Галлюцинации — редкие отдельные вставки (обычно 1–3 на эпизод), не десятки строк. Нет водяного знака в пакете — delete_segments: []. \
           При сомнении — не удаляй.\n\
         - Не выдумывай id. Не меняй таймкоды.\n\
         - Не перефразируй весь файл без явной просьбы.\n\
         - В message не хвали себя за посторонние правки; если в пакете нечего менять по задаче — так и напиши, actions: [].\n\n\
         Верни СТРОГО один JSON-объект (без markdown):\n\
         {{\n\
           \"message\": \"текст ответа пользователю\",\n\
           \"actions\": [] ИЛИ [объект, ...],\n\
           \"suggestions\": null ИЛИ [\"строка\", ...]\n\
         }}\n\n\
         Типы элементов actions:\n\
         1) {{\"type\":\"edit_segments\",\"file_id\":\"{file_id_hint}\",\"segments\":[{{\"id\":1,\"text\":\"...\",\"translation\":\"...\"}}]}}\n\
         (file_id — id текущего эпизода; если не уверен — укажи тот же id, что в заголовке эпизода)\n\
         2) {{\"type\":\"delete_segments\",\"file_id\":\"{file_id_hint}\",\"segment_ids\":[3,7]}}\n\
         3) {{\"type\":\"update_glossary\",\"entries\":[{{\"id\":\"\",\"source\":\"\",\"target\":\"\",\"description\":null,\"context\":null}}]}}\n\
         4) {{\"type\":\"explain_issue\",\"issue\":\"...\",\"solution\":\"...\"}}\n\
         5) {{\"type\":\"generate_text\",\"text\":\"...\"}}\n\n\
         Если правки не нужны, actions: [].",
        target_lang = target_lang,
        glossary_block = glossary_block,
        summaries_block = summaries_block,
        batch_note = batch_note,
        task_block = task_block,
        gender_field_note = gender_field_note,
        gender_dialogue = gender_dialogue,
        gender_rules = gender_rules,
        name_declension_rules = name_declension_rules,
        segments_block = segments_block,
        radius = radius,
        file_id_hint = context
            .active_subtitle_file_id
            .as_deref()
            .unwrap_or("null"),
    )
}

fn segments_for_file_id<'a>(
    context: &'a DialogueContext,
    file_id: Option<&str>,
) -> Option<&'a [SubtitleSegment]> {
    if let Some(fid) = file_id.filter(|s| !s.trim().is_empty()) {
        if let Some(f) = context.subtitle_files.iter().find(|f| f.file_id == fid) {
            return Some(f.segments.as_slice());
        }
        if context.active_subtitle_file_id.as_deref() == Some(fid) {
            return context.current_segments.as_deref();
        }
        return None;
    }
    context.current_segments.as_deref()
}

fn resolve_action_file_id(context: &DialogueContext, from_action: Option<&str>) -> Option<String> {
    if let Some(id) = from_action.map(str::trim).filter(|s| !s.is_empty()) {
        return Some(id.to_string());
    }
    context.active_subtitle_file_id.clone()
}

fn format_segment_line_full(s: &SubtitleSegment, mark: &str) -> String {
    let tr = s.translation.as_deref().unwrap_or("");
    let g = segment_speaker_gender_str(s);
    format!(
        "#{} [{:.2}-{:.2}] speaker_gender={} text={:?} translation={:?}{}\n",
        s.id, s.start, s.end, g, s.text, tr, mark
    )
}

#[allow(dead_code)]
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

fn format_segments_for_prompt(
    segments: Option<&[SubtitleSegment]>,
    focus_id: Option<u32>,
    neighbor_radius: usize,
    batch_ids: Option<&[u32]>,
    batch_index: Option<u32>,
    batch_total: Option<u32>,
    episode_summary: Option<&str>,
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
    let mut out = String::new();

    if let Some(ids) = batch_ids {
        if !ids.is_empty() {
            let id_set: HashSet<u32> = ids.iter().copied().collect();
            let bi = batch_index.unwrap_or(1);
            let bt = batch_total.unwrap_or(1);
            out.push_str(&format!(
                "\nПакет {bi}/{bt} — полный текст ВСЕХ реплик этого пакета (id в сообщении пользователя). \
                 Остальные id файла — в других пакетах:\n"
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

    // полный список реплик эпизода в промпт НИКОГДА не выгружаем
    // пересказы всех эпизодов идут отдельным блоком (format_project_summaries) выше в системном промпте
    // здесь — только заголовок и прикреплённая реплика с соседями, если есть
    let _ = in_focus_window;
    let _ = MAX_COMPACT_LINES_IN_PROMPT;
    let _ = episode_summary;
    out.push_str(
        "Полного списка реплик эпизода в промпте нет - используй прикреплённую реплику (фрагмент ±N соседей выше) или пакетную обработку. Если в сообщении пользователя нет ни прикреплённой реплики, ни пакета - правки реплик не делай, отвечай только текстом.\n",
    );

    out
}

// единый блок с пересказами всех серий проекта для системного промпта
// открытый эпизод помечен «(открытый файл)», порядок — как в проекте (сначала открытый)
// эпизоды без пересказа выводятся отдельным списком имён в конце
fn format_project_summaries(context: &DialogueContext) -> String {
    if context.subtitle_files.is_empty() {
        return String::new();
    }
    let active_id = context.active_subtitle_file_id.as_deref();

    let mut with_summary: Vec<(bool, &crate::agent::dialogue_history::SubtitleFileContext)> = Vec::new();
    let mut without_summary: Vec<&crate::agent::dialogue_history::SubtitleFileContext> = Vec::new();
    for f in &context.subtitle_files {
        let is_active = active_id.map(|id| id == f.file_id).unwrap_or(false);
        let summary_trim = f.summary.as_deref().map(str::trim).unwrap_or("");
        if summary_trim.is_empty() {
            without_summary.push(f);
        } else {
            with_summary.push((is_active, f));
        }
    }
    if with_summary.is_empty() && without_summary.is_empty() {
        return String::new();
    }
    // открытый эпизод первым в списке
    with_summary.sort_by_key(|(active, _)| if *active { 0 } else { 1 });

    let mut out = String::from("\nПересказы серий проекта (3-5 предложений на серию, сгенерировано GPT):\n");
    for (is_active, f) in &with_summary {
        let summary = f.summary.as_deref().unwrap_or("").trim();
        let mark = if *is_active { " (открытый файл)" } else { "" };
        out.push_str(&format!("- {}{}: {}\n", f.file_name, mark, summary));
    }
    if !without_summary.is_empty() {
        let names: Vec<String> = without_summary
            .iter()
            .map(|f| {
                let is_active = active_id.map(|id| id == f.file_id).unwrap_or(false);
                if is_active {
                    format!("{} (открытый файл)", f.file_name)
                } else {
                    f.file_name.clone()
                }
            })
            .collect();
        out.push_str(&format!(
            "- без пересказа (ещё не сгенерирован): {}\n",
            names.join(", ")
        ));
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
        .map(|e| {
            let mut line = format!("- {} -> {}", e.source, e.target);
            // meaning/context из глоссария: показываем оба поля если есть
            // помогает агенту согласовывать род/склонение/тип термина
            let context_trim = e.context.as_deref().map(str::trim).unwrap_or("");
            let desc_trim = e.description.as_deref().map(str::trim).unwrap_or("");
            let mut extras: Vec<&str> = Vec::new();
            if !context_trim.is_empty() {
                extras.push(context_trim);
            }
            if !desc_trim.is_empty() && desc_trim != context_trim {
                extras.push(desc_trim);
            }
            if !extras.is_empty() {
                line.push_str("  | контекст: ");
                line.push_str(&extras.join("; "));
            }
            line
        })
        .collect();
    format!("Глоссарий:\n{}", lines.join("\n"))
}

#[derive(Debug, Deserialize)]
struct AgentTurnJson {
    // message опциональный - бывает что модель возвращает {} или только actions
    // тогда подставим заглушку, чтобы не падать всем чатом
    #[serde(default)]
    message: Option<String>,
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
    task_mode: AgentTaskMode,
    intent: Option<&AgentIntent>,
) -> Result<AgentResponse, String> {
    let message = parsed
        .message
        .as_deref()
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| {
            // gpt вернул {} или только actions без сообщения - подставим заглушку
            // (часто бывает на answer_only с большим контекстом и низким reasoning)
            "Извини, не получилось сформировать развёрнутый ответ. Попробуй переформулировать вопрос.".to_string()
        });
    let mut actions: Vec<AgentAction> = Vec::new();

    for value in &parsed.actions {
        if let Some(a) = parse_action(value, context, task_mode, intent) {
            actions.push(a);
        }
    }
    if actions.is_empty() {
        if let Some(ref single) = parsed.action {
            if let Some(a) = parse_action(single, context, task_mode, intent) {
                actions.push(a);
            }
        }
    }
    let raw_action_count = actions.len();
    actions = filter_actions_by_task(actions, context, task_mode, intent);

    let ep_dbg = context.active_subtitle_file_name.as_deref().unwrap_or("?");
    let batch_dbg = match (context.batch_index, context.batch_total) {
        (Some(i), Some(t)) if t > 1 => format!("пакет {i}/{t}"),
        _ => "одиночный запрос".to_string(),
    };
    let parsed_raw = parsed.actions.len() + if parsed.action.is_some() { 1 } else { 0 };
    let edits_total: usize = actions
        .iter()
        .map(|a| match a {
            AgentAction::EditSegments { segments, .. } => segments.len(),
            _ => 0,
        })
        .sum();

    println!("---------------- ИТОГ ОБРАБОТКИ ОТВЕТА ----------------");
    println!(
        "  эпизод={ep_dbg} {batch_dbg} | в ответе actions={parsed_raw} → распарсено={raw_action_count} → после фильтра={} | всего изменённых сегментов={edits_total}",
        actions.len()
    );
    if parsed_raw > 0 && raw_action_count == 0 {
        println!(
            "  ВНИМАНИЕ: GPT прислал {parsed_raw} action(ов), но ни один не распарсился. \
             Проверь формат: правильный - {{\"type\":\"edit_segments\",\"file_id\":\"...\",\"segments\":[...]}}"
        );
    }
    if raw_action_count > 0 && actions.is_empty() {
        println!(
            "  ВНИМАНИЕ: {raw_action_count} action(ов) распарсилось, но все отфильтрованы task_mode={}/intent. \
             Возможно правки касались сегментов вне пачки или содержали недопустимые поля.",
            task_mode.as_str()
        );
    }
    for a in &actions {
        match a {
            AgentAction::EditSegments { file_id, segments } => {
                println!(
                    "  edit_segments file_id={:?} → {} сегмент(ов):",
                    file_id,
                    segments.len()
                );
                for s in segments {
                    let tr = s.translation.as_deref().unwrap_or("");
                    println!(
                        "    #{:>4} text={:?} translation={:?}",
                        s.id,
                        truncate_for_prompt(&s.text, 60),
                        truncate_for_prompt(tr, 60)
                    );
                }
            }
            AgentAction::DeleteSegments {
                file_id,
                segment_ids,
            } => {
                println!(
                    "  delete_segments file_id={:?} ids={:?}",
                    file_id, segment_ids
                );
            }
            other => {
                println!("  {:?}", other);
            }
        }
    }
    println!("================================================================");
    println!();

    let in_batch = context.batch_total.unwrap_or(0) > 1;
    let message = if in_batch {
        String::new()
    } else if message.is_empty() {
        "Готово.".to_string()
    } else {
        message
    };

    Ok(AgentResponse {
        message,
        actions,
        suggestions: parsed.suggestions,
        task_mode: None,
    })
}

// фильтр водяных знаков убран - он отсеивал валидные удаления на других языках
// (например итальянское "Sottotitoli a cura di QTSS")
// теперь доверяем gpt: промпт ему чётко объясняет что удалять, а что не трогать
// если gpt ошибётся - пользователь увидит реплику в списке удалённых и нажмёт undo
#[allow(dead_code)]
fn segment_is_whisper_watermark(_seg: &SubtitleSegment) -> bool {
    true
}

fn filter_delete_ids_to_watermarks(base: &[SubtitleSegment], ids: Vec<u32>) -> Vec<u32> {
    let valid_ids: std::collections::HashSet<u32> = base.iter().map(|s| s.id).collect();
    ids.into_iter().filter(|id| valid_ids.contains(id)).collect()
}

fn filter_actions_by_task(
    actions: Vec<AgentAction>,
    context: &DialogueContext,
    task_mode: AgentTaskMode,
    intent: Option<&AgentIntent>,
) -> Vec<AgentAction> {
    let in_batch = context.batch_total.unwrap_or(0) > 1;
    let task_mode = if task_mode == AgentTaskMode::General && in_batch {
        AgentTaskMode::StrictBatch
    } else {
        task_mode
    };

    if task_mode == AgentTaskMode::General {
        return actions
            .into_iter()
            .filter_map(|action| match action {
                AgentAction::DeleteSegments {
                    file_id,
                    segment_ids,
                } => {
                    let base = segments_for_file_id(context, file_id.as_deref())?;
                    let ids = filter_delete_ids_to_watermarks(base, segment_ids);
                    if ids.is_empty() {
                        None
                    } else {
                        Some(AgentAction::DeleteSegments {
                            file_id: resolve_action_file_id(context, file_id.as_deref()),
                            segment_ids: ids,
                        })
                    }
                }
                other => Some(other),
            })
            .collect();
    }

    if task_mode == AgentTaskMode::AnswerOnly {
        return actions
            .into_iter()
            .filter(|a| {
                !matches!(
                    a,
                    AgentAction::EditSegments { .. } | AgentAction::DeleteSegments { .. }
                )
            })
            .collect();
    }

    actions
        .into_iter()
        .filter_map(|action| match action {
            AgentAction::DeleteSegments {
                file_id,
                segment_ids,
            } => {
                let base = segments_for_file_id(context, file_id.as_deref())?;
                let ids = filter_delete_ids_to_watermarks(base, segment_ids);
                if ids.is_empty() {
                    None
                } else {
                    Some(AgentAction::DeleteSegments {
                        file_id: resolve_action_file_id(context, file_id.as_deref()),
                        segment_ids: ids,
                    })
                }
            }
            AgentAction::EditSegments { file_id, segments } => {
                let base = segments_for_file_id(context, file_id.as_deref())?;
                let proposed_ids: Vec<u32> = segments.iter().map(|s| s.id).collect();
                let proposed_count = segments.len();
                let filtered = filter_changed_segments(task_mode, base, segments, intent);
                if proposed_count != filtered.len() {
                    let kept_ids: std::collections::HashSet<u32> =
                        filtered.iter().map(|s| s.id).collect();
                    let dropped: Vec<u32> = proposed_ids
                        .into_iter()
                        .filter(|id| !kept_ids.contains(id))
                        .collect();
                    println!(
                        "[agent][debug] filter_changed_segments (task_mode={}): GPT прислал {} сегмент(ов), оставил {}, отброшены id={:?}",
                        task_mode.as_str(),
                        proposed_count,
                        filtered.len(),
                        dropped
                    );
                }
                if filtered.is_empty() {
                    None
                } else {
                    Some(AgentAction::EditSegments {
                        file_id: resolve_action_file_id(context, file_id.as_deref()),
                        segments: filtered,
                    })
                }
            }
            AgentAction::UpdateGlossary { .. }
                if matches!(
                    task_mode,
                    AgentTaskMode::Proofread
                        | AgentTaskMode::TranslationFix
                        | AgentTaskMode::StrictBatch
                        | AgentTaskMode::GlossarySync
                ) =>
            {
                None
            }
            other => Some(other),
        })
        .collect()
}

fn parse_action(
    value: &serde_json::Value,
    context: &DialogueContext,
    task_mode: AgentTaskMode,
    intent: Option<&AgentIntent>,
) -> Option<AgentAction> {
    // поддерживаем оба формата
    // 1) плоский: {"type":"edit_segments","file_id":"...","segments":[...]}
    // 2) enum-стиль из serde rust: {"EditSegments":{"file_id":"...","segments":[...]}}
    // GPT иногда срывается на вариант 2 если в подсказке промелькнул такой ключ
    let (action_type, payload): (&str, &serde_json::Value) =
        if let Some(t) = value.get("type").and_then(|v| v.as_str()) {
            (t, value)
        } else if let Some(p) = value.get("EditSegments") {
            ("edit_segments", p)
        } else if let Some(p) = value.get("DeleteSegments") {
            ("delete_segments", p)
        } else if let Some(p) = value.get("UpdateGlossary") {
            ("update_glossary", p)
        } else if let Some(p) = value.get("ExplainIssue") {
            ("explain_issue", p)
        } else if let Some(p) = value.get("GenerateText") {
            ("generate_text", p)
        } else {
            println!(
                "[agent][debug] parse_action: пропускаю action без type и без enum-ключа: {}",
                value
            );
            return None;
        };
    let value = payload;

    match action_type {
        "edit_segments" => {
            let file_id_raw = value
                .get("file_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let segments_value = match value.get("segments") {
                Some(v) => v,
                None => {
                    println!("[agent][debug] parse_action edit_segments: нет поля segments");
                    return None;
                }
            };
            let patches: Vec<SegmentPatch> = match serde_json::from_value(segments_value.clone()) {
                Ok(p) => p,
                Err(e) => {
                    println!(
                        "[agent][debug] parse_action edit_segments: не парсится segments → {e}"
                    );
                    return None;
                }
            };
            let base = match segments_for_file_id(context, file_id_raw.as_deref()) {
                Some(b) => b,
                None => {
                    println!(
                        "[agent][debug] parse_action edit_segments: не нашёл сегменты для file_id={:?}",
                        file_id_raw
                    );
                    return None;
                }
            };
            let merged = apply_segment_patches(base, &patches);
            let changed = collect_changed_segments(base, &merged);
            if changed.is_empty() {
                println!(
                    "[agent][debug] parse_action edit_segments: GPT вернул {} segment(ов), но НИ ОДИН не отличается от исходных text/translation (модель скопировала старые значения без замены).",
                    patches.len()
                );
                for p in &patches {
                    if let Some(orig) = base.iter().find(|s| s.id == p.id) {
                        let cur_tr = orig.translation.as_deref().unwrap_or("");
                        let new_tr = p.translation.as_deref().unwrap_or(cur_tr);
                        let cur_tx = orig.text.as_str();
                        let new_tx = p.text.as_deref().unwrap_or(cur_tx);
                        println!(
                            "    #{:>4} text {}={:?} | translation {}={:?}",
                            p.id,
                            if cur_tx == new_tx { "=" } else { "≠" },
                            truncate_for_prompt(new_tx, 50),
                            if cur_tr == new_tr { "=" } else { "≠" },
                            truncate_for_prompt(new_tr, 50)
                        );
                    } else {
                        println!("    #{:>4} id отсутствует в пакете", p.id);
                    }
                }
                return None;
            }
            let filtered = filter_changed_segments(task_mode, base, changed, intent);
            if filtered.is_empty() {
                println!(
                    "[agent][debug] parse_action edit_segments: после filter_changed_segments (task_mode={}) ничего не осталось",
                    task_mode.as_str()
                );
                return None;
            }
            Some(AgentAction::EditSegments {
                file_id: resolve_action_file_id(context, file_id_raw.as_deref()),
                segments: filtered,
            })
        }
        "delete_segments" => {
            let file_id_raw = value
                .get("file_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let ids: Vec<u32> = value
                .get("segment_ids")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .or_else(|| {
                    value
                        .get("ids")
                        .and_then(|v| serde_json::from_value(v.clone()).ok())
                })
                .unwrap_or_default();
            if ids.is_empty() {
                return None;
            }
            let base = segments_for_file_id(context, file_id_raw.as_deref())?;
            let valid = filter_delete_ids_to_watermarks(base, ids);
            if valid.is_empty() {
                return None;
            }
            Some(AgentAction::DeleteSegments {
                file_id: resolve_action_file_id(context, file_id_raw.as_deref()),
                segment_ids: valid,
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

fn get_api_key() -> Result<String, String> {
    let entry = keyring::Entry::new("subtitle-studio", "openai-api-key")
        .map_err(|e| e.to_string())?;

    entry
        .get_password()
        .map_err(|e| format!("Ключ не найден или ошибка доступа: {}", e))
}
