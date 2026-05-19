use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::project::SubtitleSegment;

#[derive(Debug, Clone)]
pub struct Cache {
    cache_dir: PathBuf,
    memory_cache: Arc<RwLock<HashMap<String, Vec<SubtitleSegment>>>>,
}

impl Cache {
    pub fn new(cache_dir: PathBuf) -> Self {
        Self {
            cache_dir,
            memory_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn get_transcription(&self, file_hash: &str) -> Result<Option<Vec<SubtitleSegment>>, String> {
        // Сначала проверяем память
        {
            let cache = self.memory_cache.read().await;
            if let Some(segments) = cache.get(file_hash) {
                return Ok(Some(segments.clone()));
            }
        }

        // Затем проверяем диск
        let cache_path = self.cache_dir.join(format!("transcribe_{}.json", file_hash));
        if !cache_path.exists() {
            return Ok(None);
        }

        let content = tokio::fs::read_to_string(&cache_path)
            .await
            .map_err(|e| format!("Ошибка чтения кэша транскрибации: {}", e))?;

        let segments: Vec<SubtitleSegment> = serde_json::from_str(&content)
            .map_err(|e| format!("Ошибка парсинга кэша транскрибации: {}", e))?;

        // Сохраняем в память
        {
            let mut cache = self.memory_cache.write().await;
            cache.insert(file_hash.to_string(), segments.clone());
        }

        Ok(Some(segments))
    }

    pub async fn set_transcription(&self, file_hash: &str, segments: &[SubtitleSegment]) -> Result<(), String> {
        // Сохраняем в память
        {
            let mut cache = self.memory_cache.write().await;
            cache.insert(file_hash.to_string(), segments.to_vec());
        }

        // Сохраняем на диск
        let cache_path = self.cache_dir.join(format!("transcribe_{}.json", file_hash));
        let content = serde_json::to_string(segments)
            .map_err(|e| format!("Ошибка сериализации кэша транскрибации: {}", e))?;

        tokio::fs::write(&cache_path, content)
            .await
            .map_err(|e| format!("Ошибка записи кэша транскрибации: {}", e))?;

        Ok(())
    }

    pub fn calculate_file_hash(file_path: &Path) -> Result<String, String> {
        use sha2::{Sha256, Digest};
        use std::fs::File;
        use std::io::Read;

        let mut file = File::open(file_path)
            .map_err(|e| format!("Ошибка открытия файла для хэширования: {}", e))?;

        let mut hasher = Sha256::new();
        let mut buffer = [0; 8192];

        loop {
            match file.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => hasher.update(&buffer[..n]),
                Err(e) => return Err(format!("Ошибка чтения файла для хэширования: {}", e)),
            }
        }

        let result = hasher.finalize();
        Ok(hex::encode(result))
    }
}