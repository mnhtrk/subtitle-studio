use tauri::Manager;
use std::path::Path;
use std::fs;
use crate::project::{Project, ProjectFile, ProjectType, SubtitleSegment};
use crate::cache::Cache;
use crate::types::RecentProject;  // ← Импорт из общего модуля

#[tauri::command]
pub async fn open_project(
    path: String,
    app_handle: tauri::AppHandle,
    cache: tauri::State<'_, Cache>,
) -> Result<Project, String> {
    let project_path = Path::new(&path);
    
    if !project_path.exists() {
        return Err(format!("Папка проекта не найдена: {}", path));
    }
    
    let project = Project::load_from_file(project_path, &app_handle)
        .map_err(|e| format!("Ошибка загрузки проекта: {}", e))?;
    
    cache.cache_project_structure(&project.id, &project).await?;
    update_recent_projects(&path, &app_handle)?;
    
    println!("📂 Проект '{}' открыт", project.name);
    Ok(project)
}

#[tauri::command]
pub async fn save_project(
    project: Project,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    project
        .save_to_file(&app_handle)
        .map_err(|e| format!("Ошибка сохранения проекта: {}", e))?;
    
    println!("💾 Проект '{}' сохранён", project.name);
    Ok(())
}

#[tauri::command]
pub async fn import_media(
    project_path: String,
    file_path: String,
    app_handle: tauri::AppHandle,
) -> Result<ProjectFile, String> {
    let project_path_buf = Path::new(&project_path);
    let source_file = Path::new(&file_path);
    
    if !source_file.exists() {
        return Err(format!("Исходный файл не найден: {}", file_path));
    }
    
    let dest_subdir = if is_video_file(source_file) {
        "video"
    } else if is_subtitle_file(source_file) {
        "subtitles"
    } else {
        "config"
    };
    
    let dest_dir = project_path_buf.join(dest_subdir);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    
    let file_name = source_file
        .file_name()
        .ok_or("Невозможно получить имя файла")?
        .to_string_lossy()
        .to_string();
    
    let dest_path = dest_dir.join(&file_name);
    fs::copy(source_file, &dest_path).map_err(|e| e.to_string())?;
    
    let file_type = if is_video_file(source_file) {
        ProjectType::Video
    } else if is_subtitle_file(source_file) {
        ProjectType::Subtitle
    } else {
        ProjectType::Config
    };
    
    let project_file = ProjectFile {
        id: uuid::Uuid::new_v4().to_string(),
        name: file_name.clone(),
        file_type,
        path: format!("{}/{}", dest_subdir, file_name),
        duration: None,
        subtitle_segments: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    
    let mut project = Project::load_from_file(project_path_buf, &app_handle)?;
    project.files.push(project_file.clone());
    project.save_to_file(&app_handle)?;
    
    println!("📥 Файл '{}' импортирован в проект", file_name);
    Ok(project_file)
}

#[tauri::command]
pub async fn export_subtitles(
    project_path: String,
    file_id: String,
    format: String,
    output_path: String,
    _app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let project_path_buf = Path::new(&project_path);
    let project = Project::load_from_file(project_path_buf, &_app_handle)?;
    
    let file = project.files
        .iter()
        .find(|f| f.id == file_id)
        .ok_or("Файл не найден в проекте")?;
    
    let segments = file.subtitle_segments
        .as_ref()
        .ok_or("Сегменты субтитров отсутствуют")?;
    
    let content = match format.as_str() {
        "srt" => generate_srt(segments),
        "vtt" => generate_vtt(segments),
        "txt" => generate_txt(segments),
        _ => return Err(format!("Неподдерживаемый формат: {}", format)),
    };
    
    fs::write(&output_path, content).map_err(|e| e.to_string())?;
    
    println!("📤 Субтитры экспортированы: {}", output_path);
    Ok(output_path)
}

#[tauri::command]
pub async fn list_recent_projects(
    app_handle: tauri::AppHandle,
) -> Result<Vec<RecentProject>, String> {
    let app_data_dir = app_handle.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("subtitle-studio");
    
    let recent_file = app_data_dir.join("recent_projects.json");
    
    if !recent_file.exists() {
        return Ok(vec![]);
    }
    
    let content = fs::read_to_string(&recent_file).map_err(|e| e.to_string())?;
    let projects: Vec<RecentProject> = serde_json::from_str(&content)
        .map_err(|e| format!("Ошибка парсинга: {}", e))?;
    
    Ok(projects)
}

fn update_recent_projects(project_path: &str, app_handle: &tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app_handle.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("subtitle-studio");
    
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    
    let recent_file = app_data_dir.join("recent_projects.json");
    
    let mut projects: Vec<RecentProject> = if recent_file.exists() {
        let content = fs::read_to_string(&recent_file).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    };
    
    projects.retain(|p| p.path != project_path);
    
    let project_name = Path::new(project_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();
    
    let new_project = RecentProject {
        path: project_path.to_string(),
        name: project_name,
        last_opened: chrono::Utc::now().to_rfc3339(),
    };
    
    projects.insert(0, new_project);
    projects.truncate(10);
    
    let json = serde_json::to_string_pretty(&projects).map_err(|e| e.to_string())?;
    fs::write(recent_file, json).map_err(|e| e.to_string())?;
    
    Ok(())
}

fn is_video_file(path: &Path) -> bool {
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    matches!(ext.to_lowercase().as_str(), "mp4" | "mkv" | "mov" | "avi" | "webm")
}

fn is_subtitle_file(path: &Path) -> bool {
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    matches!(ext.to_lowercase().as_str(), "srt" | "vtt" | "ass" | "ssa")
}

// Функции генерации субтитров
fn generate_srt(segments: &[SubtitleSegment]) -> String {
    let mut result = String::new();
    for (i, seg) in segments.iter().enumerate() {
        let index = i + 1;
        let start = format_time_srt(seg.start);
        let end = format_time_srt(seg.end);
        
        result.push_str(&format!("{}\n", index));
        result.push_str(&format!("{} --> {}\n", start, end));
        result.push_str(&format!("{}\n\n", seg.translation.as_ref().unwrap_or(&seg.text)));
    }
    result
}

fn generate_vtt(segments: &[SubtitleSegment]) -> String {
    let mut result = "WEBVTT\n\n".to_string();
    for seg in segments {
        let start = format_time_vtt(seg.start);
        let end = format_time_vtt(seg.end);
        
        result.push_str(&format!("{} --> {}\n", start, end));
        result.push_str(&format!("{}\n\n", seg.translation.as_ref().unwrap_or(&seg.text)));
    }
    result
}

fn generate_txt(segments: &[SubtitleSegment]) -> String {
    segments
        .iter()
        .map(|seg| {
            let time = format!("[{} - {}]", 
                format_time_simple(seg.start), 
                format_time_simple(seg.end)
            );
            format!("{} {}\n", time, seg.translation.as_ref().unwrap_or(&seg.text))
        })
        .collect()
}

fn format_time_srt(seconds: f64) -> String {
    let hours = (seconds / 3600.0) as u32;
    let minutes = ((seconds % 3600.0) / 60.0) as u32;
    let secs = (seconds % 60.0) as u32;
    let millis = ((seconds % 1.0) * 1000.0) as u32;
    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, secs, millis)
}

fn format_time_vtt(seconds: f64) -> String {
    let hours = (seconds / 3600.0) as u32;
    let minutes = ((seconds % 3600.0) / 60.0) as u32;
    let secs = (seconds % 60.0) as u32;
    let millis = ((seconds % 1.0) * 1000.0) as u32;
    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, secs, millis)
}

fn format_time_simple(seconds: f64) -> String {
    let minutes = (seconds / 60.0) as u32;
    let secs = (seconds % 60.0) as u32;
    format!("{:02}:{:02}", minutes, secs)
}