use serde::{Deserialize, Serialize};
use std::path::Path;
use std::fs;
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
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
    #[serde(default)]
    pub agent_chat: Vec<serde_json::Value>,
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
    // linked: video <-> subtitle
    #[serde(default)]
    pub linked_file_id: Option<String>,
    // краткий пересказ эпизода (3-4 предложения), генерится gpt на основе субтитров
    // нужен чтобы не кормить агенту полный текст эпизода в каждый запрос
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// пол (gender sidecar)
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpeakerGender {
    Male,
    Female,
    Unknown,
}

impl SpeakerGender {
    pub fn as_str(&self) -> &'static str {
        match self {
            SpeakerGender::Male => "male",
            SpeakerGender::Female => "female",
            SpeakerGender::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SubtitleSegment {
    pub id: u32,
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    pub text: String,
    pub translation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker_gender: Option<SpeakerGender>,
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
        let mut project: Project = serde_json::from_str(&content).map_err(|e| e.to_string())?;

        // миграция legacy .config -> config
        // в старых проектах waveform лежал в .config, новый код пишет всё в config
        migrate_dot_config(project_path, &mut project);
        
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
            agent_chat: vec![],
            created_at: now.clone(),
            updated_at: now,
        };
        
        Ok(project)
    }
}

// переносит файлы из .config в config и обновляет пути в project.files
// нужно для старых проектов где waveform лежал в .config
fn migrate_dot_config(project_path: &Path, project: &mut Project) {
    let legacy = project_path.join(".config");
    if !legacy.is_dir() {
        return;
    }
    let target = project_path.join("config");
    if let Err(e) = fs::create_dir_all(&target) {
        eprintln!("[migrate] не удалось создать config/: {}", e);
        return;
    }

    let entries = match fs::read_dir(&legacy) {
        Ok(it) => it,
        Err(e) => {
            eprintln!("[migrate] не удалось прочитать .config: {}", e);
            return;
        }
    };
    let mut moved_any = false;
    for entry in entries.flatten() {
        let from = entry.path();
        if !from.is_file() {
            continue;
        }
        let name = match from.file_name() {
            Some(n) => n.to_os_string(),
            None => continue,
        };
        let to = target.join(&name);
        if to.exists() {
            // целевой файл уже есть - просто удалим старый
            let _ = fs::remove_file(&from);
            moved_any = true;
            continue;
        }
        if let Err(e) = fs::rename(&from, &to) {
            // на разных дисках rename может не сработать - копируем + удаляем
            if fs::copy(&from, &to).is_ok() {
                let _ = fs::remove_file(&from);
                moved_any = true;
            } else {
                eprintln!("[migrate] не удалось перенести {:?} -> {:?}: {}", from, to, e);
            }
        } else {
            moved_any = true;
        }
    }

    if moved_any {
        for f in project.files.iter_mut() {
            let normalized = f.path.replace('\\', "/");
            if let Some(rest) = normalized.strip_prefix(".config/") {
                f.path = format!("config/{}", rest);
            }
        }
        let _ = fs::remove_dir(&legacy);
        println!("[migrate] перенесли .config -> config");
    }
}