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
    agent_model_for_task, classify_agent_intent, filter_changed_segments, model_temperature,
    task_mode_prompt_block, AgentIntent, AgentTaskMode,
};
use std::collections::HashSet;
use std::sync::Mutex;
use lazy_static::lazy_static;

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
    pub active_subtitle_file_id: Option<String>,
    #[serde(default)]
    pub active_subtitle_file_name: Option<String>,
    /// active_episode | whole_project
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentResponse {
    pub message: String,
    #[serde(default)]
    pub actions: Vec<AgentAction>,
    pub suggestions: Option<Vec<String>>,
    /// Режим задачи после классификации (для пакетных запросов с фронта)
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
                    return Ok((mode, None));
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
    })
}

/// Промежуточные пакеты не пишем в историю — иначе чат забьётся «пакет N: не найдено».
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
    println!(
        "[agent][debug] turn episode={ep} batch={:?}/{:?} scope={:?} user_chars={}",
        context.batch_index,
        context.batch_total,
        context.edit_scope,
        request.message.len()
    );
    for (part_i, chunk) in request.message.as_bytes().chunks(3500).enumerate() {
        println!(
            "[agent][debug] turn_user[{part_i}]={}",
            String::from_utf8_lossy(chunk)
        );
    }

    call_agent_model(messages, api_key, context, task_mode, intent).await
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
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": agent_model_for_task(task_mode),
            "messages": messages,
            "response_format": { "type": "json_object" },
            "temperature": model_temperature(task_mode),
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

    let ep = context
        .active_subtitle_file_name
        .as_deref()
        .unwrap_or("?");
    println!(
        "[agent][debug] api_reply episode={ep} batch={:?}/{:?} chars={}",
        context.batch_index,
        context.batch_total,
        content.len()
    );
    for (part_i, chunk) in content.as_bytes().chunks(3500).enumerate() {
        println!(
            "[agent][debug] api_reply_body[{part_i}]={}",
            String::from_utf8_lossy(chunk)
        );
    }

    let parsed: AgentTurnJson = serde_json::from_str(content)
        .map_err(|e| format!("Агент вернул невалидный JSON ({}): {}", e, content))?;

    map_turn_to_response(parsed, context, task_mode, intent)
}

fn build_system_prompt(
    context: &DialogueContext,
    task_mode: AgentTaskMode,
    intent: Option<&AgentIntent>,
) -> String {
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
    let mut segments_block = format_segments_for_prompt(
        context.current_segments.as_deref(),
        context.focus_segment_id,
        radius,
        context.batch_segment_ids.as_deref(),
        context.batch_index,
        context.batch_total,
    );
    if !episode_header.is_empty() {
        segments_block = format!("{episode_header}{scope_note}\n{segments_block}");
    } else {
        segments_block = format!("{scope_note}\n{segments_block}");
    }
    let glossary_block = format_glossary_for_prompt(context.current_glossary.as_deref());
    let gender_dialogue = dialogue_context_translation_rules(target_lang);
    let gender_rules = speaker_gender_translation_rules(target_lang);
    let name_declension_rules = proper_name_declension_rules(target_lang);
    let gender_field_note = "\n\
         У каждой реплики в списке ниже указан speaker_gender (male/female/unknown) — пол говорящего в этой строке.\n";

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
    if task_mode == AgentTaskMode::BulkReplace {
        if let Some(i) = intent {
            if let (Some(from), Some(to)) = (&i.replace_from, &i.replace_to) {
                let scope = if i.translation_only {
                    "только в поле translation"
                } else {
                    "в text и/или translation"
                };
                let text_rule = if i.translation_only {
                    "\nОБЯЗАТЕЛЬНО: в edit_segments только поле translation — поле text не включай.\n"
                } else {
                    ""
                };
                task_block.push_str(&format!(
                    "\nЗамена по задаче: «{from}» → «{to}» ({scope}).\n\
                     Термин в text — только ориентир для поиска реплик; не подставляй перевод в оригинал.\n\
                     Для имён: все падежи и предлоги (не только именительный); особые формы (беглая гласная и т.п.).\n\
                     {text_rule}"
                ));
            }
        }
    }

    format!(
        "Ты AI-ассистент приложения Subtitle Studio, помощник по субтитрам.\n\
         Ты ведёшь обычный диалог с пользователем и при необходимости вносишь правки в субтитры проекта.\n\n\
         Язык ответа в поле message: тот же, на котором пишет пользователь (русский, английский и т.д.).\n\n\
         Контекст проекта:\n\
         - Целевой язык перевода: {target_lang}\n\
         - {glossary_block}\n\n\
         {batch_note}\
         {task_block}\
         {gender_field_note}\
         {gender_dialogue}\
         {gender_rules}\
         {name_declension_rules}\
         Субтитры (сначала краткая структура эпизода по сценам, затем реплики):\n\
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

    if total > MAX_COMPACT_LINES_IN_PROMPT {
        out.push_str(&format!(
            "\nПострочный список всех {total} реплик опущен (слишком большой для одного запроса без пакетов). \
             Если пришёл пакет с id — работай только с полным текстом пакета выше.\n"
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
    task_mode: AgentTaskMode,
    intent: Option<&AgentIntent>,
) -> Result<AgentResponse, String> {
    let message = parsed.message.trim().to_string();
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
    if context.batch_total.unwrap_or(1) > 1 {
        println!(
            "[agent][debug] actions_filtered episode={:?} batch={:?}/{:?} raw={} kept={}",
            context.active_subtitle_file_name,
            context.batch_index,
            context.batch_total,
            raw_action_count,
            actions.len()
        );
    }

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

fn segment_is_whisper_watermark(seg: &SubtitleSegment) -> bool {
    let text = seg.text.trim();
    let tr = seg.translation.as_deref().unwrap_or("").trim();
    let hay = format!("{text}\n{tr}").to_lowercase();
    if hay.is_empty() {
        return false;
    }
    if hay.contains("amara.org") || hay.contains("amara.") {
        return true;
    }
    if hay.contains("subtitles by")
        || hay.contains("subtitle by")
        || hay.contains("subtitles created")
    {
        return true;
    }
    if hay.contains("субтитр") && (hay.contains("сделан") || hay.contains("сообществ")) {
        return true;
    }
    let t = text.to_lowercase();
    if t == "org." || t == "org" {
        return true;
    }
    let t = tr.to_lowercase();
    t == "org." || t == "org"
}

fn filter_delete_ids_to_watermarks(base: &[SubtitleSegment], ids: Vec<u32>) -> Vec<u32> {
    ids.into_iter()
        .filter(|id| {
            base.iter()
                .find(|s| s.id == *id)
                .map(segment_is_whisper_watermark)
                .unwrap_or(false)
        })
        .collect()
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
                let filtered = filter_changed_segments(task_mode, base, segments, intent);
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
    let action_type = value.get("type").and_then(|v| v.as_str())?;

    match action_type {
        "edit_segments" => {
            let file_id_raw = value
                .get("file_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let patches: Vec<SegmentPatch> =
                serde_json::from_value(value.get("segments")?.clone()).ok()?;
            let base = segments_for_file_id(context, file_id_raw.as_deref())?;
            let merged = apply_segment_patches(base, &patches);
            let changed = collect_changed_segments(base, &merged);
            let filtered = filter_changed_segments(task_mode, base, changed, intent);
            if filtered.is_empty() {
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
