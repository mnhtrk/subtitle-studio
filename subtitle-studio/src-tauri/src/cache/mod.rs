use std::path::{PathBuf, Path};
use std::fs;
use std::collections::HashMap;
use std::sync::Mutex;
use crate::project::{Project, SubtitleSegment};
use crate::types::TranslationResult;  // ← Импорт из общего модуля
use serde::{Serialize, Deserialize};
use sha2::{Sha256, Digest};

#[derive(Debug, Serialize, Deserialize)]
struct TranscriptionCacheEntry {
    file_hash: String,
    segments: Vec<SubtitleSegment>,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct TranslationCacheEntry {
    cache_key: String,
    translations: Vec<TranslationResult>,
    created_at: String,
}

pub struct Cache {
    cache_dir: PathBuf,
    memory_cache: Mutex<HashMap<String, Vec<SubtitleSegment>>>,
}

impl Cache {
    pub fn new(cache_dir: PathBuf) -> Self {
        fs::create_dir_all(&cache_dir).ok();
        
        Self {
            cache_dir,
            memory_cache: Mutex::new(HashMap::new()),
        }
    }
    
    pub async fn get_transcription(&self, file_hash: &str) -> Result<Option<Vec<SubtitleSegment>>, String> {
        {
            let cache = self.memory_cache.lock().map_err(|_| "Ошибка блокировки кэша".to_string())?;
            if let Some(segments) = cache.get(file_hash) {
                return Ok(Some(segments.clone()));
            }
        }
        
        let cache_file = self.cache_dir.join(format!("transcribe_{}.json", file_hash));
        
        if !cache_file.exists() {
            return Ok(None);
        }
        
        let content = fs::read_to_string(&cache_file).map_err(|e| e.to_string())?;
        let entry: TranscriptionCacheEntry = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        
        let now = chrono::Utc::now();
        let created = chrono::DateTime::parse_from_rfc3339(&entry.created_at)
            .map_err(|e| e.to_string())?;
        
        if now.signed_duration_since(created).num_days() > 30 {
            fs::remove_file(&cache_file).ok();
            return Ok(None);
        }
        
        {
            let mut cache = self.memory_cache.lock().map_err(|_| "Ошибка блокировки кэша".to_string())?;
            cache.insert(file_hash.to_string(), entry.segments.clone());
        }
        
        Ok(Some(entry.segments))
    }
    
    pub async fn set_transcription(&self, file_hash: &str, segments: &[SubtitleSegment]) -> Result<(), String> {
        let cache_file = self.cache_dir.join(format!("transcribe_{}.json", file_hash));
        
        let entry = TranscriptionCacheEntry {
            file_hash: file_hash.to_string(),
            segments: segments.to_vec(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        
        let json = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
        fs::write(cache_file, json).map_err(|e| e.to_string())?;
        
        {
            let mut cache = self.memory_cache.lock().map_err(|_| "Ошибка блокировки кэша".to_string())?;
            cache.insert(file_hash.to_string(), segments.to_vec());
        }
        
        Ok(())
    }
    
    pub async fn get_translation(&self, cache_key: &str) -> Result<Option<Vec<TranslationResult>>, String> {
        let cache_file = self.cache_dir.join(format!("translate_{}.json", cache_key));
        
        if !cache_file.exists() {
            return Ok(None);
        }
        
        let content = fs::read_to_string(&cache_file).map_err(|e| e.to_string())?;
        let entry: TranslationCacheEntry = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        
        let now = chrono::Utc::now();
        let created = chrono::DateTime::parse_from_rfc3339(&entry.created_at)
            .map_err(|e| e.to_string())?;
        
        if now.signed_duration_since(created).num_days() > 30 {
            fs::remove_file(&cache_file).ok();
            return Ok(None);
        }
        
        Ok(Some(entry.translations))
    }
    
    pub async fn set_translation(&self, cache_key: &str, translations: &[TranslationResult]) -> Result<(), String> {
        let cache_file = self.cache_dir.join(format!("translate_{}.json", cache_key));
        
        let entry = TranslationCacheEntry {
            cache_key: cache_key.to_string(),
            translations: translations.to_vec(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        
        let json = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
        fs::write(cache_file, json).map_err(|e| e.to_string())?;
        
        Ok(())
    }
    
    pub async fn cache_project_structure(&self, project_id: &str, project: &Project) -> Result<(), String> {
        let cache_file = self.cache_dir.join(format!("project_{}.json", project_id));
        
        let json = serde_json::to_string(project).map_err(|e| e.to_string())?;
        fs::write(cache_file, json).map_err(|e| e.to_string())?;
        
        Ok(())
    }
    
    pub async fn get_project_structure(&self, project_id: &str) -> Result<Option<Project>, String> {
        let cache_file = self.cache_dir.join(format!("project_{}.json", project_id));
        
        if !cache_file.exists() {
            return Ok(None);
        }
        
        let content = fs::read_to_string(&cache_file).map_err(|e| e.to_string())?;
        let project: Project = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        
        let now = chrono::Utc::now();
        let created = chrono::DateTime::parse_from_rfc3339(&project.updated_at)
            .map_err(|e| e.to_string())?;
        
        if now.signed_duration_since(created).num_minutes() > 60 {
            return Ok(None);
        }
        
        Ok(Some(project))
    }
    
    pub fn calculate_file_hash(path: &Path) -> Result<String, String> {
        use std::fs::File;
        use std::io::Read;
        
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 8192];
        
        loop {
            let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 { break; }
            hasher.update(&buffer[..n]);
        }
        
        Ok(format!("{:x}", hasher.finalize()))
    }
    
    pub fn generate_translation_cache_key(
        segments: &[SubtitleSegment],
        glossary: &[crate::project::GlossaryEntry],
        target_language: &str,
        style_prompt: &str,
    ) -> Result<String, String> {
        let mut hasher = Sha256::new();
        hasher.update(serde_json::to_string(segments).map_err(|e| e.to_string())?);
        hasher.update(serde_json::to_string(glossary).map_err(|e| e.to_string())?);
        hasher.update(target_language);
        hasher.update(style_prompt);
        Ok(format!("{:x}", hasher.finalize()))
    }
}