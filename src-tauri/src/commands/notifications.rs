use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize)]
pub enum NotificationType {
    Success,
    Warning,
    Error,
    Info,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub title: String,
    pub message: String,
    pub notification_type: NotificationType,
    pub duration: Option<u32>, // в мс
    pub progress: Option<f64>, // 0..1
}

#[tauri::command]
pub async fn show_notification(
    notification: Notification,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // кидаем уведомление во фронт
    app_handle.emit("show_notification", &notification)
        .map_err(|e| format!("Ошибка отправки уведомления: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub async fn log_message(
    level: String,
    message: String,
    context: Option<serde_json::Value>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // печатаем в консоль
    match level.as_str() {
        "info" => println!("[info] {}", message),
        "warn" => println!("[warn] {}", message),
        "error" => println!("[error] {}", message),
        "debug" => println!("[debug] {}", message),
        _ => println!("[log] {}", message),
    }
    
    // и шлём событие во фронт чтобы показать
    let log_entry = serde_json::json!({
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "level": level,
        "message": message,
        "context": context
    });
    
    app_handle.emit("log_message", &log_entry)
        .map_err(|e| format!("Ошибка отправки лога: {}", e))?;
    
    Ok(())
}