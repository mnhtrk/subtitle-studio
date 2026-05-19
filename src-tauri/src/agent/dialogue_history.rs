use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use crate::project::{SubtitleSegment, GlossaryEntry};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DialogueContext {
    pub project_id: Option<String>,
    pub current_segments: Option<Vec<SubtitleSegment>>,
    pub current_glossary: Option<Vec<GlossaryEntry>>,
    pub target_language: Option<String>,
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
                conversation_history: Vec::new(),
            }
        })
    }

    pub fn get_session(&self, session_id: &str) -> Option<DialogueContext> {
        self.sessions.get(session_id).cloned()
    }
    
    pub fn add_message(&mut self, session_id: &str, message: AgentMessage) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.conversation_history.push(message);
            if session.conversation_history.len() > 10 {
                session.conversation_history.remove(0);
            }
        }
    }
}