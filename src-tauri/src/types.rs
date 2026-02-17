use serde::{Deserialize, Serialize};
use crate::project::{SubtitleSegment, GlossaryEntry};

// Типы для команды AI
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranslationResult {
    pub id: u32,
    pub translated_text: String,
}

// Типы для команды файлов
#[derive(Debug, Serialize, Deserialize)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub last_opened: String,
}

// Типы для команды проекта
#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectStructure {
    pub project: crate::project::Project,
    pub files: Vec<crate::project::ProjectFile>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SegmentUpdates {
    pub text: Option<String>,
    pub translation: Option<String>,
    pub start: Option<f64>,
    pub end: Option<f64>,
}