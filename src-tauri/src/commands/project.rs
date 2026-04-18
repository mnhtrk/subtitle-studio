use tauri::Manager;
use crate::project::{Project, GlossaryEntry, SubtitleSegment};
use crate::cache::Cache;
use crate::types::ProjectStructure;
use std::path::Path;
use serde::{Deserialize, Serialize};
#[tauri::command]
pub async fn create_project(
    name: String,
    path: String,
    target_language: String,
    app_handle: tauri::AppHandle,
) -> Result<Project, String> {
    println!("📁 Создание проекта: {}", name);
    
    let project = Project::create_new(name, path, target_language)?;
    project.save_to_file(&app_handle)?;
    
    println!("✅ Проект '{}' создан", project.name);
    Ok(project)
}

#[tauri::command]
pub async fn get_project_structure(
    project_id: String,
    app_handle: tauri::AppHandle,
    cache: tauri::State<'_, Cache>,
) -> Result<ProjectStructure, String> {
    if let Some(cached_project) = cache.get_project_structure(&project_id).await? {
        let structure = ProjectStructure {
            project: cached_project.clone(),
            files: cached_project.files.clone(),
        };
        return Ok(structure);
    }
    
    let projects_dir = app_handle.path().document_dir()
        .map_err(|e| e.to_string())?
        .join("SubtitleStudio");
    
    let project_path = projects_dir.join(&project_id);
    
    if !project_path.exists() {
        return Err(format!("Папка проекта не найдена: {:?}", project_path));
    }
    
    let project = Project::load_from_file(&project_path, &app_handle)?;
    
    let structure = ProjectStructure {
        project: project.clone(),
        files: project.files.clone(),
    };
    
    cache.cache_project_structure(&project_id, &project).await?;
    
    Ok(structure)
}

#[tauri::command]
pub async fn get_glossary(
    project_id: String,
    app_handle: tauri::AppHandle,
) -> Result<Vec<GlossaryEntry>, String> {
    let projects_dir = app_handle.path().document_dir()
        .map_err(|e| e.to_string())?
        .join("SubtitleStudio");
    
    let project_path = projects_dir.join(&project_id);
    let project = Project::load_from_file(&project_path, &app_handle)?;
    
    Ok(project.glossary)
}

#[tauri::command]
pub async fn update_glossary(
    project_id: String,
    entries: Vec<GlossaryEntry>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let projects_dir = app_handle.path().document_dir()
        .map_err(|e| e.to_string())?
        .join("SubtitleStudio");
    
    let project_path = projects_dir.join(&project_id);
    let mut project = Project::load_from_file(&project_path, &app_handle)?;
    
    project.glossary = entries;
    project.updated_at = chrono::Utc::now().to_rfc3339();
    
    project.save_to_file(&app_handle)?;
    Ok(())
}

#[tauri::command]
pub async fn add_glossary_entry(
    project_id: String,
    entry: GlossaryEntry,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let projects_dir = app_handle.path().document_dir()
        .map_err(|e| e.to_string())?
        .join("SubtitleStudio");
    
    let project_path = projects_dir.join(&project_id);
    let mut project = Project::load_from_file(&project_path, &app_handle)?;
    
    project.glossary.push(entry);
    project.updated_at = chrono::Utc::now().to_rfc3339();
    
    project.save_to_file(&app_handle)?;
    Ok(())
}

#[tauri::command]
pub async fn update_subtitle_segment(
    project_path: String,
    file_id: String,
    segment_id: u32,
    updates: crate::types::SegmentUpdates,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let project_path_buf = std::path::Path::new(&project_path);
    let mut project = Project::load_from_file(project_path_buf, &app_handle)?;
    
    if let Some(file) = project.files.iter_mut().find(|f| f.id == file_id) {
        if let Some(segments) = file.subtitle_segments.as_mut() {
            if let Some(segment) = segments.iter_mut().find(|s| s.id == segment_id) {
                if let Some(text) = &updates.text {
                    segment.text = text.clone();
                }
                if let Some(translation) = &updates.translation {
                    segment.translation = Some(translation.clone());
                }
                if let Some(start) = updates.start {
                    segment.start = start;
                    segment.duration = segment.end - segment.start;
                }
                if let Some(end) = updates.end {
                    segment.end = end;
                    segment.duration = segment.end - segment.start;
                }
                
                file.updated_at = chrono::Utc::now().to_rfc3339();
                project.updated_at = chrono::Utc::now().to_rfc3339();
                
                project.save_to_file(&app_handle)?;
                return Ok(());
            }
        }
    }
    
    Err("Сегмент не найден".to_string())
}

#[tauri::command]
pub async fn create_empty_segments(
    project_path: String,
    file_id: String,
    count: u32,
    duration_per_segment: f64,
    app_handle: tauri::AppHandle,
) -> Result<Vec<SubtitleSegment>, String> {
    let project_path_buf = Path::new(&project_path);
    let mut project = Project::load_from_file(project_path_buf, &app_handle)?;
    
    if let Some(file) = project.files.iter_mut().find(|f| f.id == file_id) {
        let start_time = file.subtitle_segments
            .as_ref()
            .and_then(|segs| segs.last())
            .map(|last| last.end)
            .unwrap_or(0.0);
        
        let mut new_segments = Vec::new();
        
        for i in 0..count {
            let segment_id = file.subtitle_segments
                .as_ref()
                .map(|segs| segs.iter().map(|s| s.id).max().unwrap_or(0) + i + 1)
                .unwrap_or(i + 1);
            
            let start = start_time + (i as f64) * duration_per_segment;
            let end = start + duration_per_segment;
            
            let segment = SubtitleSegment {
                id: segment_id,
                start,
                end,
                duration: duration_per_segment,
                text: String::new(),
                translation: None,
                flags: None,
            };
            
            new_segments.push(segment.clone());
            
            if let Some(segments) = file.subtitle_segments.as_mut() {
                segments.push(segment);
            } else {
                file.subtitle_segments = Some(vec![segment]);
            }
        }
        
        file.updated_at = chrono::Utc::now().to_rfc3339();
        project.updated_at = chrono::Utc::now().to_rfc3339();
        
        project.save_to_file(&app_handle)?;
        println!("➕ Создано {} пустых сегментов", count);
        
        Ok(new_segments)
    } else {
        Err("Файл не найден в проекте".to_string())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectStatistics {
    pub total_segments: u32,
    pub translated_segments: u32,
    pub total_duration: f64,
    pub files_count: u32,
    pub glossary_terms: u32,
    pub translation_coverage: f64,
}

#[tauri::command]
pub async fn get_project_statistics(
    project_id: String,
    app_handle: tauri::AppHandle,
) -> Result<ProjectStatistics, String> {
    let projects_dir = app_handle.path().document_dir()
        .map_err(|e| e.to_string())?
        .join("SubtitleStudio");
    
    let project_path = projects_dir.join(&project_id);
    let project = Project::load_from_file(&project_path, &app_handle)?;
    
    let mut total_segments = 0u32;
    let mut translated_segments = 0u32;
    let mut total_duration = 0.0;
    let files_count = project.files.len() as u32;
    let glossary_terms = project.glossary.len() as u32;
    
    for file in &project.files {
        if let Some(segments) = &file.subtitle_segments {
            total_segments += segments.len() as u32;
            total_duration += segments.iter().map(|s| s.duration).sum::<f64>();
            
            translated_segments += segments
                .iter()
                .filter(|s| s.translation.is_some())
                .count() as u32;
        }
    }
    
    let translation_coverage = if total_segments > 0 {
        (translated_segments as f64 / total_segments as f64) * 100.0
    } else {
        0.0
    };
    
    Ok(ProjectStatistics {
        total_segments,
        translated_segments,
        total_duration,
        files_count,
        glossary_terms,
        translation_coverage,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FindReplaceOptions {
    pub case_sensitive: bool,
    pub whole_words: bool,
    pub regex: bool,
    pub search_in_original: bool,
    pub search_in_translation: bool,
}

#[tauri::command]
pub async fn find_and_replace_in_subtitles(
    project_path: String,
    file_id: String,
    search_term: String,
    replace_term: String,
    options: FindReplaceOptions,
    app_handle: tauri::AppHandle,
) -> Result<u32, String> {
    println!("🔍 Поиск и замена: '{}' → '{}'", search_term, replace_term);
    
    let project_path_buf = Path::new(&project_path);
    let mut project = Project::load_from_file(project_path_buf, &app_handle)?;
    
    let mut replacements_count = 0u32;
    
    if let Some(file) = project.files.iter_mut().find(|f| f.id == file_id) {
        if let Some(segments) = file.subtitle_segments.as_mut() {
            for segment in segments {
                let mut replaced = false;
                
                if options.search_in_original {
                    let new_text = perform_replace(
                        &segment.text, 
                        &search_term, 
                        &replace_term, 
                        &options
                    );
                    if new_text != segment.text {
                        segment.text = new_text;
                        replaced = true;
                    }
                }
                
                if options.search_in_translation {
                    if let Some(ref mut translation) = segment.translation {
                        let new_translation = perform_replace(
                            translation, 
                            &search_term, 
                            &replace_term, 
                            &options
                        );
                        if new_translation != *translation {
                            *translation = new_translation;
                            replaced = true;
                        }
                    }
                }
                
                if replaced {
                    replacements_count += 1;
                }
            }
            
            if replacements_count > 0 {
                file.updated_at = chrono::Utc::now().to_rfc3339();
                project.updated_at = chrono::Utc::now().to_rfc3339();
                project.save_to_file(&app_handle)?;
                println!("✅ Выполнено {} замен", replacements_count);
            }
        }
    }
    
    Ok(replacements_count)
}

fn perform_replace(
    text: &str, 
    search: &str, 
    replace: &str, 
    options: &FindReplaceOptions
) -> String {
    if options.regex {
        use regex::RegexBuilder;
        use regex::Regex;
        
        let regex = RegexBuilder::new(search)
            .case_insensitive(!options.case_sensitive)
            .build()
            .unwrap_or_else(|_| Regex::new(&regex::escape(search)).unwrap());
        
        regex.replace_all(text, replace).to_string()
    } else {
        if options.whole_words {
            let mut result = String::new();
            let mut last_end = 0;
            
            for (start, end) in find_word_boundaries(text, search, options) {
                result.push_str(&text[last_end..start]);
                result.push_str(replace);
                last_end = end;
            }
            
            result.push_str(&text[last_end..]);
            result
        } else {
            if options.case_sensitive {
                text.replace(search, replace)
            } else {
                let mut result = String::new();
                let mut last_end = 0;
                let text_lower = text.to_lowercase();
                let search_lower = search.to_lowercase();
                
                while let Some(pos) = text_lower[last_end..].find(&search_lower) {
                    let start = last_end + pos;
                    let end = start + search.len();
                    
                    result.push_str(&text[last_end..start]);
                    result.push_str(replace);
                    last_end = end;
                }
                
                result.push_str(&text[last_end..]);
                result
            }
        }
    }
}

fn find_word_boundaries(text: &str, word: &str, options: &FindReplaceOptions) -> Vec<(usize, usize)> {
    let mut boundaries = Vec::new();
    let mut last_pos = 0;
    
    while let Some(pos) = if options.case_sensitive {
        text[last_pos..].find(word)
    } else {
        text[last_pos..].to_lowercase().find(&word.to_lowercase())
    } {
        let start = last_pos + pos;
        let end = start + word.len();
        
        let is_word_start = start == 0 || !text.chars().nth(start - 1).unwrap_or(' ').is_alphanumeric();
        let is_word_end = end >= text.len() || !text.chars().nth(end).unwrap_or(' ').is_alphanumeric();
        
        if is_word_start && is_word_end {
            boundaries.push((start, end));
        }
        
        last_pos = end;
    }
    
    boundaries
}