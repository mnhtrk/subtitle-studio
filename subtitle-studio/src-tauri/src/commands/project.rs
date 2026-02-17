use tauri::Manager;
use crate::project::{Project, GlossaryEntry, ProjectFile};
use crate::cache::Cache;
use crate::types::{ProjectStructure, SegmentUpdates};  // ← Импорт из общего модуля

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
    updates: SegmentUpdates,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let project_path_buf = std::path::Path::new(&project_path);
    let mut project = Project::load_from_file(project_path_buf, &app_handle)?;
    
    if let Some(file) = project.files.iter_mut().find(|f| f.id == file_id) {
        if let Some(segments) = file.subtitle_segments.as_mut() {
            if let Some(segment) = segments.iter_mut().find(|s| s.id == segment_id) {
                if let Some(text) = &updates.text {
                    segment.text = text.clone();  // ← Тип String выводится автоматически
                }
                if let Some(translation) = &updates.translation {
                    segment.translation = Some(translation.clone());  // ← Тип String выводится автоматически
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