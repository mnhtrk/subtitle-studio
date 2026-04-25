use tauri::Manager;
use std::path::Path;
use std::fs;
use crate::commands::audio::media_duration_seconds;
use crate::project::{Project, ProjectFile, ProjectType, SubtitleSegment};
use crate::cache::Cache;
use crate::types::RecentProject;
use crate::subtitle_parser;
use zip::{ZipWriter, write::FileOptions};
use std::io::Write;
use serde::{Deserialize, Serialize};

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
    
    println!("Проект '{}' открыт", project.name);
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
    
    println!("Проект '{}' сохранён", project.name);
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
    
    let duration = if matches!(file_type, ProjectType::Video) {
        media_duration_seconds(&dest_path).await.ok()
    } else {
        None
    };

    let new_id = uuid::Uuid::new_v4().to_string();
    let project_file = ProjectFile {
        id: new_id.clone(),
        name: file_name.clone(),
        file_type,
        path: format!("{}/{}", dest_subdir, file_name),
        duration,
        subtitle_segments: None,
        linked_file_id: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    
    let mut project = Project::load_from_file(project_path_buf, &app_handle)?;
    project.files.push(project_file.clone());
    project.updated_at = chrono::Utc::now().to_rfc3339();

    match &project_file.file_type {
        ProjectType::Video => {
            if let Some(sid) = first_unpaired_subtitle_id(&project) {
                link_video_subtitle(&mut project, &new_id, &sid);
            }
        }
        ProjectType::Subtitle => {
            if let Some(vid) = first_unpaired_video_id(&project) {
                link_video_subtitle(&mut project, &vid, &new_id);
            }
        }
        ProjectType::Config => {}
    }

    project.save_to_file(&app_handle)?;
    
    println!("Файл '{}' импортирован в проект", file_name);
    project
        .files
        .iter()
        .find(|f| f.id == new_id)
        .cloned()
        .ok_or_else(|| "Внутренняя ошибка: импортированный файл не найден в проекте".to_string())
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
    
    if let Some(parent) = Path::new(&output_path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    fs::write(&output_path, content).map_err(|e| e.to_string())?;
    
    println!("Субтитры экспортированы: {}", output_path);
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

fn video_has_subtitle_partner(project: &Project, video_id: &str) -> bool {
    project.files.iter().any(|f| {
        f.file_type == ProjectType::Subtitle && f.linked_file_id.as_deref() == Some(video_id)
    })
}

fn first_unpaired_video_id(project: &Project) -> Option<String> {
    for f in project.files.iter().rev() {
        if f.file_type != ProjectType::Video {
            continue;
        }
        if !video_has_subtitle_partner(project, &f.id) {
            return Some(f.id.clone());
        }
    }
    None
}

fn first_unpaired_subtitle_id(project: &Project) -> Option<String> {
    for f in project.files.iter().rev() {
        if f.file_type == ProjectType::Subtitle && f.linked_file_id.is_none() {
            return Some(f.id.clone());
        }
    }
    None
}

fn link_video_subtitle(project: &mut Project, video_id: &str, subtitle_id: &str) {
    if let Some(v) = project.files.iter_mut().find(|f| f.id == video_id) {
        v.linked_file_id = Some(subtitle_id.to_string());
        v.updated_at = chrono::Utc::now().to_rfc3339();
    }
    if let Some(s) = project.files.iter_mut().find(|f| f.id == subtitle_id) {
        s.linked_file_id = Some(video_id.to_string());
        s.updated_at = chrono::Utc::now().to_rfc3339();
    }
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

#[tauri::command]
pub async fn remove_file_from_project(
    project_path: String,
    file_id: String,
    delete_physical_file: bool,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let project_path_buf = Path::new(&project_path);
    let mut project = Project::load_from_file(project_path_buf, &app_handle)?;
    
    // Находим файл для удаления (клонируем данные перед мутабельным заимствованием)
    let file_to_remove = if let Some(file_index) = project.files.iter().position(|f| f.id == file_id) {
        Some(project.files[file_index].clone()) // ← Клонируем структуру файла
    } else {
        None
    };
    
    if let Some(file) = file_to_remove {
        let partner_id = file.linked_file_id.clone();
        // Удаляем физический файл если требуется
        if delete_physical_file {
            let full_file_path = Path::new(&project.path).join(&file.path);
            if full_file_path.exists() {
                fs::remove_file(&full_file_path)
                    .map_err(|e| format!("Ошибка удаления файла {}: {}", full_file_path.display(), e))?;
                println!("Физический файл удалён: {}", full_file_path.display());
            }
        }

        if let Some(pid) = partner_id {
            let now = chrono::Utc::now().to_rfc3339();
            if let Some(partner) = project.files.iter_mut().find(|f| f.id == pid) {
                partner.linked_file_id = None;
                partner.updated_at = now.clone();
            }
        }
        
        // Удаляем запись из проекта
        if let Some(file_index) = project.files.iter().position(|f| f.id == file_id) {
            project.files.remove(file_index);
            project.updated_at = chrono::Utc::now().to_rfc3339();
            
            // Сохраняем проект
            project.save_to_file(&app_handle)?;
            println!("Файл '{}' удалён из проекта", file.name);
            
            Ok(())
        } else {
            Err("Файл не найден в проекте".to_string())
        }
    } else {
        Err("Файл не найден в проекте".to_string())
    }
}

#[tauri::command]
pub async fn import_existing_subtitles(
    subtitle_path: String,
    format: Option<String>,
    project_path: String,
    file_id: String,
    app_handle: tauri::AppHandle,
) -> Result<Vec<SubtitleSegment>, String> {
    println!("Импорт существующих субтитров: {}", subtitle_path);
    
    let subtitle_path_buf = Path::new(&subtitle_path);
    if !subtitle_path_buf.exists() {
        return Err(format!("Файл субтитров не найден: {}", subtitle_path));
    }
    
    // Определяем формат
    let detected_format = if let Some(fmt) = format {
        match fmt.to_lowercase().as_str() {
            "srt" => subtitle_parser::SubtitleFormat::SRT,
            "vtt" => subtitle_parser::SubtitleFormat::VTT,
            "ass" => subtitle_parser::SubtitleFormat::ASS,
            "ssa" => subtitle_parser::SubtitleFormat::SSA,
            _ => return Err(format!("Неподдерживаемый формат: {}", fmt)),
        }
    } else {
        subtitle_parser::detect_format(subtitle_path_buf)?
    };
    
    // Читаем содержимое файла
    let content = fs::read_to_string(subtitle_path_buf)
        .map_err(|e| format!("Ошибка чтения файла: {}", e))?;
    
    // Парсим субтитры
    let segments = subtitle_parser::parse_subtitles(&content, detected_format)?;
    
    if segments.is_empty() {
        return Err("Не удалось распарсить субтитры".to_string());
    }
    
    println!("Импортировано {} сегментов", segments.len());
    
    // Обновляем файл в проекте
    let project_path_buf = Path::new(&project_path);
    let mut project = Project::load_from_file(project_path_buf, &app_handle)?;
    
    if let Some(file) = project.files.iter_mut().find(|f| f.id == file_id) {
        file.subtitle_segments = Some(segments.clone());
        file.updated_at = chrono::Utc::now().to_rfc3339();
        project.updated_at = chrono::Utc::now().to_rfc3339();
        
        project.save_to_file(&app_handle)?;
        println!("Субтитры сохранены в проект");
    }
    
    Ok(segments)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupOptions {
    pub include_media: bool,
    pub compression: bool,
    pub backup_name: Option<String>,
}

#[tauri::command]
pub async fn backup_project(
    project_path: String,
    backup_path: String,
    options: Option<BackupOptions>,
    _app_handle: tauri::AppHandle,
) -> Result<String, String> {
    println!("Создание резервной копии проекта: {}", project_path);
    
    let project_path_buf = Path::new(&project_path);
    if !project_path_buf.exists() {
        return Err(format!("Папка проекта не найдена: {}", project_path));
    }
    
    let opts = options.unwrap_or(BackupOptions {
        include_media: true,
        compression: true,
        backup_name: None,
    });
    
    // Создаём директорию для резервной копии если её нет
    let backup_dir = Path::new(&backup_path);
    std::fs::create_dir_all(backup_dir)
        .map_err(|e| format!("Ошибка создания директории резервной копии: {}", e))?;
    
    // Генерируем имя файла резервной копии
    let project_name = project_path_buf.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project");
    
    let backup_name = opts.backup_name.unwrap_or_else(|| {
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        format!("{}_backup_{}.zip", project_name, timestamp)
    });
    
    let backup_file_path = backup_dir.join(&backup_name);
    let backup_file = std::fs::File::create(&backup_file_path)
        .map_err(|e| format!("Ошибка создания файла резервной копии: {}", e))?;
    
    // Создаём ZIP архив
    let mut zip = zip::ZipWriter::new(backup_file);
    let zip_opts = if opts.compression {
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated)
    } else {
        zip::write::FileOptions::default()
    };
    
    // Рекурсивно добавляем файлы в архив
    add_directory_to_zip(&mut zip, project_path_buf, project_path_buf, &zip_opts, opts.include_media)
        .map_err(|e| format!("Ошибка создания архива: {}", e))?;
    
    zip.finish()
        .map_err(|e| format!("Ошибка завершения архива: {}", e))?;
    
    let backup_path_str = backup_file_path.to_string_lossy().to_string();
    println!("Резервная копия создана: {}", backup_path_str);
    
    Ok(backup_path_str)
}

fn add_directory_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    root_path: &Path,
    current_path: &Path,
    options: &zip::write::FileOptions,
    include_media: bool,
) -> Result<(), String> {
    let entries = std::fs::read_dir(current_path)
        .map_err(|e| format!("Ошибка чтения директории {}: {}", current_path.display(), e))?;
    
    for entry in entries {
        let entry = entry.map_err(|e| format!("Ошибка чтения записи: {}", e))?;
        let path = entry.path();
        
        if path.is_file() {
            // Проверяем, нужно ли включать медиа файлы
            if !include_media {
                let ext = path.extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                
                if matches!(ext.as_str(), "mp4" | "mkv" | "mov" | "avi" | "mp3" | "wav") {
                    continue; // Пропускаем медиа файлы
                }
            }
            
            let relative_path = path.strip_prefix(root_path)
                .map_err(|e| format!("Ошибка получения относительного пути: {}", e))?;
            
            let file_data = std::fs::read(&path)
                .map_err(|e| format!("Ошибка чтения файла {}: {}", path.display(), e))?;
            
            zip.start_file(relative_path.to_string_lossy(), *options)
                .map_err(|e| format!("Ошибка добавления файла в архив: {}", e))?;
            
            zip.write_all(&file_data)
                .map_err(|e| format!("Ошибка записи данных в архив: {}", e))?;
        } else if path.is_dir() {
            add_directory_to_zip(zip, root_path, &path, options, include_media)?;
        }
    }
    
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectDiskFile {
    pub relative_path: String,
    pub name: String,
}

/// Файлы на диске в `config/`, `video/`, `subtitles/` для дерева проекта
#[tauri::command]
pub async fn list_project_directory_files(project_path: String) -> Result<Vec<ProjectDiskFile>, String> {
    let base = Path::new(&project_path);
    if !base.is_dir() {
        return Err("Папка проекта не найдена".to_string());
    }
    let mut out: Vec<ProjectDiskFile> = Vec::new();
    for sub in ["config", "video", "subtitles"] {
        let dir = base.join(sub);
        if !dir.is_dir() {
            continue;
        }
        let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() {
                let name = path
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let relative_path = format!("{}/{}", sub, name);
                out.push(ProjectDiskFile {
                    relative_path,
                    name,
                });
            }
        }
    }
    out.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(out)
}