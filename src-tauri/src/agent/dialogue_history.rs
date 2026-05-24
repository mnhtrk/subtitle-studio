use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use crate::project::{SubtitleSegment, GlossaryEntry};

pub const MAX_HISTORY_MESSAGES: usize = 40;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConversationTurn {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SubtitleFileContext {
    pub file_id: String,
    pub file_name: String,
    pub segments: Vec<SubtitleSegment>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DialogueContext {
    pub project_id: Option<String>,
    pub current_segments: Option<Vec<SubtitleSegment>>,
    pub current_glossary: Option<Vec<GlossaryEntry>>,
    pub target_language: Option<String>,
    #[serde(default)]
    pub active_subtitle_file_id: Option<String>,
    #[serde(default)]
    pub active_subtitle_file_name: Option<String>,
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
    pub conversation_history: Vec<AgentMessage>,
}

pub struct DialogueHistory {
    sessions: HashMap<String, DialogueContext>,
}

impl DialogueHistory {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub fn get_or_create_session(&mut self, session_id: &str) -> &mut DialogueContext {
        self.sessions.entry(session_id.to_string()).or_insert_with(|| {
            DialogueContext {
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
            }
        })
    }

    pub fn get_session(&self, session_id: &str) -> Option<DialogueContext> {
        self.sessions.get(session_id).cloned()
    }

    pub fn sync_context(
        &mut self,
        session_id: &str,
        project_id: Option<String>,
        segments: Option<Vec<SubtitleSegment>>,
        glossary: Option<Vec<GlossaryEntry>>,
        target_language: Option<String>,
        active_subtitle_file_id: Option<String>,
        active_subtitle_file_name: Option<String>,
        edit_scope: Option<String>,
        subtitle_files: Vec<SubtitleFileContext>,
        focus_segment_id: Option<u32>,
        neighbor_radius: usize,
        batch_segment_ids: Option<Vec<u32>>,
        batch_index: Option<u32>,
        batch_total: Option<u32>,
        task_mode: Option<String>,
        client_history: &[ConversationTurn],
    ) {
        let session = self.get_or_create_session(session_id);
        session.project_id = project_id;
        session.current_segments = segments;
        session.current_glossary = glossary;
        session.target_language = target_language;
        session.active_subtitle_file_id = active_subtitle_file_id;
        session.active_subtitle_file_name = active_subtitle_file_name;
        session.edit_scope = edit_scope;
        session.subtitle_files = subtitle_files;
        session.focus_segment_id = focus_segment_id;
        session.neighbor_radius = neighbor_radius;
        session.batch_segment_ids = batch_segment_ids;
        session.batch_index = batch_index;
        session.batch_total = batch_total;
        session.task_mode = task_mode;

        if client_history.is_empty() {
            return;
        }

        let server_len = session.conversation_history.len();
        if client_history.len() >= server_len {
            session.conversation_history = client_history
                .iter()
                .map(|turn| AgentMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    role: turn.role.clone(),
                    content: turn.content.clone(),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                })
                .collect();
            trim_history(&mut session.conversation_history);
        }
    }

    pub fn add_message(&mut self, session_id: &str, message: AgentMessage) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.conversation_history.push(message);
            trim_history(&mut session.conversation_history);
        }
    }
}

fn trim_history(history: &mut Vec<AgentMessage>) {
    if history.len() > MAX_HISTORY_MESSAGES {
        let excess = history.len() - MAX_HISTORY_MESSAGES;
        history.drain(0..excess);
    }
}
