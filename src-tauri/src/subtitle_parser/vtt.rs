use crate::project::SubtitleSegment;
use regex::Regex;

pub fn parse(content: &str) -> Result<Vec<SubtitleSegment>, String> {
    let mut segments = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;
    
    // Пропускаем заголовок WebVTT
    while i < lines.len() && lines[i].trim().is_empty() {
        i += 1;
    }
    
    if i < lines.len() && lines[i].contains("WEBVTT") {
        i += 1;
        // Пропускаем пустые строки после заголовка
        while i < lines.len() && lines[i].trim().is_empty() {
            i += 1;
        }
    }
    
    let time_regex = Regex::new(r"(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})")
        .map_err(|e| format!("Ошибка компиляции регулярного выражения: {}", e))?;
    
    while i < lines.len() {
        let line = lines[i].trim();
        
        if line.is_empty() {
            i += 1;
            continue;
        }
        
        // Проверяем строку времени
        if let Some(captures) = time_regex.captures(line) {
            let start_hours = captures[1].parse::<u32>().unwrap_or(0);
            let start_minutes = captures[2].parse::<u32>().unwrap_or(0);
            let start_seconds = captures[3].parse::<u32>().unwrap_or(0);
            let start_millis = captures[4].parse::<u32>().unwrap_or(0);
            
            let end_hours = captures[5].parse::<u32>().unwrap_or(0);
            let end_minutes = captures[6].parse::<u32>().unwrap_or(0);
            let end_seconds = captures[7].parse::<u32>().unwrap_or(0);
            let end_millis = captures[8].parse::<u32>().unwrap_or(0);
            
            let start = (start_hours as f64 * 3600.0) + 
                       (start_minutes as f64 * 60.0) + 
                       (start_seconds as f64) + 
                       (start_millis as f64 / 1000.0);
            
            let end = (end_hours as f64 * 3600.0) + 
                     (end_minutes as f64 * 60.0) + 
                     (end_seconds as f64) + 
                     (end_millis as f64 / 1000.0);
            
            i += 1;
            let mut text_lines = Vec::new();
            
            // Собираем текст сегмента
            while i < lines.len() && !lines[i].trim().is_empty() {
                text_lines.push(lines[i]);
                i += 1;
            }
            
            let text = text_lines.join("\n");
            let id = segments.len() as u32 + 1;
            
            segments.push(SubtitleSegment {
                id,
                start,
                end,
                duration: end - start,
                text,
                translation: None,
                flags: None,
            });
        } else {
            // Пропускаем другие строки (идентификаторы, заметки и т.д.)
            i += 1;
        }
    }
    
    Ok(segments)
}