use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;

#[tauri::command]
pub async fn extract_audio_from_video(
    video_path: String,
    output_path: String,
    _app_handle: tauri::AppHandle,
) -> Result<String, String> {
    println!("Извлечение аудио из видео: {}", video_path);
    
    // Проверяем существование исходного файла
    let video_path_buf = Path::new(&video_path);
    if !video_path_buf.exists() {
        return Err(format!("Видео файл не найден: {}", video_path));
    }
    
    // Создаём директорию для выходного файла
    let output_path_buf = Path::new(&output_path);
    if let Some(parent) = output_path_buf.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    // Проверяем FFmpeg
    let ffmpeg_available = is_ffmpeg_available().await;
    if !ffmpeg_available {
        return Err("FFmpeg не установлен в системе".to_string());
    }
    
    // Формируем команду FFmpeg
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-i")
        .arg(&video_path)
        .arg("-vn")           // Отключаем видео дорожку
        .arg("-acodec")       // Кодек аудио
        .arg("libmp3lame")    // Используем MP3 кодек
        .arg("-b:a")          // Битрейт
        .arg("192k")          // 192 kbps качество
        .arg("-y")            // Перезаписывать без подтверждения
        .arg(&output_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    
    println!("Выполнение команды: ffmpeg -i {} -vn -acodec libmp3lame -b:a 192k -y {}", 
             video_path, output_path);
    
    // Запускаем процесс
    let output = cmd.output().await.map_err(|e| {
        format!("Ошибка запуска FFmpeg: {}", e)
    })?;
    
    // Проверяем результат
    if output.status.success() {
        println!("Аудио успешно извлечено: {}", output_path);
        
        // Проверяем, что файл создан и имеет ненулевой размер
        if output_path_buf.exists() {
            let metadata = std::fs::metadata(&output_path).map_err(|e| e.to_string())?;
            if metadata.len() > 0 {
                return Ok(output_path);
            } else {
                return Err("Созданный аудиофайл пустой".to_string());
            }
        } else {
            return Err("Аудиофайл не был создан".to_string());
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let error_msg = format!(
            "FFmpeg завершился с ошибкой:\nSTDERR: {}\nSTDOUT: {}",
            stderr, stdout
        );
        println!("Ошибка FFmpeg: {}", error_msg);
        return Err(error_msg);
    }
}

/// Проверяет доступность FFmpeg в системе
async fn is_ffmpeg_available() -> bool {
    let output = Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await;
    
    match output {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

/// Получает информацию о медиафайле через FFprobe (часть FFmpeg)
#[tauri::command]
pub async fn get_media_info(video_path: String) -> Result<MediaInfo, String> {
    let video_path_buf = Path::new(&video_path);
    if !video_path_buf.exists() {
        return Err(format!("Файл не найден: {}", video_path));
    }
    
    // Проверяем FFprobe
    let ffprobe_available = is_ffprobe_available().await;
    if !ffprobe_available {
        return Err("FFprobe не доступен. Убедитесь, что FFmpeg установлен.".to_string());
    }
    
    let mut cmd = Command::new("ffprobe");
    cmd.arg("-v")
        .arg("quiet")
        .arg("-print_format")
        .arg("json")
        .arg("-show_format")
        .arg("-show_streams")
        .arg(&video_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    
    let output = cmd.output().await.map_err(|e| format!("Ошибка ffprobe: {}", e))?;
    
    if output.status.success() {
        let json_str = String::from_utf8_lossy(&output.stdout);
        let info: MediaInfo = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
        Ok(info)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("ffprobe ошибка: {}", stderr))
    }
}

async fn is_ffprobe_available() -> bool {
    let output = Command::new("ffprobe")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await;
    
    match output {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct MediaInfo {
    pub format: FormatInfo,
    pub streams: Vec<StreamInfo>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct FormatInfo {
    pub filename: String,
    pub nb_streams: i32,
    pub duration: String,
    pub size: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct StreamInfo {
    pub codec_type: String,
    pub codec_name: String,
    pub duration: Option<String>,
    pub channels: Option<i32>,
    pub sample_rate: Option<String>,
}