use serde::{Deserialize, Serialize};
use std::path::Path;
use std::fs;
use tauri::AppHandle;  // Manager не нужен здесь, так как методы не используют app_handle.path()

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ProjectType {
    Video,
    Subtitle,
    Config,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub target_language: String,
    pub files: Vec<ProjectFile>,
    pub glossary: Vec<GlossaryEntry>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectFile {
    pub id: String,
    pub name: String,
    pub file_type: ProjectType,
    pub path: String,
    pub duration: Option<f64>,
    pub subtitle_segments: Option<Vec<SubtitleSegment>>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SubtitleSegment {
    pub id: u32,
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    pub text: String,
    pub translation: Option<String>,
    pub flags: Option<SegmentFlags>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SegmentFlags {
    pub overlap: bool,
    pub too_fast: bool,
    pub spelling_error: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GlossaryEntry {
    pub id: String,
    pub source: String,
    pub target: String,
    pub description: Option<String>,
    pub context: Option<String>,
}

impl Project {
    pub fn save_to_file(&self, _app_handle: &AppHandle) -> Result<(), String> {
        let project_dir = Path::new(&self.path);
        let project_file = project_dir.join("project.json");
        
        fs::create_dir_all(project_dir.join("video")).map_err(|e| e.to_string())?;
        fs::create_dir_all(project_dir.join("subtitles")).map_err(|e| e.to_string())?;
        fs::create_dir_all(project_dir.join("config")).map_err(|e| e.to_string())?;
        
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(project_file, json).map_err(|e| e.to_string())?;
        
        Ok(())
    }
    
    pub fn load_from_file(project_path: &Path, _app_handle: &AppHandle) -> Result<Project, String> {
        let project_file = project_path.join("project.json");
        
        if !project_file.exists() {
            return Err(format!("Файл проекта не найден: {:?}", project_file));
        }
        
        let content = fs::read_to_string(&project_file).map_err(|e| e.to_string())?;
        let project: Project = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        
        Ok(project)
    }
    
    pub fn create_new(name: String, path: String, target_language: String) -> Result<Project, String> {
        let project_dir = Path::new(&path);
        
        fs::create_dir_all(project_dir.join("video")).map_err(|e| e.to_string())?;
        fs::create_dir_all(project_dir.join("subtitles")).map_err(|e| e.to_string())?;
        fs::create_dir_all(project_dir.join("config")).map_err(|e| e.to_string())?;
        
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        
        let project = Project {
            id,
            name,
            path,
            target_language,
            files: vec![],
            glossary: vec![],
            created_at: now.clone(),
            updated_at: now,
        };
        
        Ok(project)
    }
}