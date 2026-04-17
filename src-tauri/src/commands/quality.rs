use serde::{Deserialize, Serialize};
use crate::project::SubtitleSegment;

#[derive(Debug, Serialize, Deserialize)]
pub struct QualityCheckOptions {
    pub check_length_ratio: bool,
    pub check_meaning_preservation: bool,
    pub length_tolerance: f64, // Допустимое отклонение длины (0.0-1.0)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QualityIssue {
    pub segment_id: u32,
    pub issue_type: String,
    pub description: String,
    pub severity: QualitySeverity,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum QualitySeverity {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QualityReport {
    pub total_segments: u32,
    pub issues_found: u32,
    pub issues: Vec<QualityIssue>,
    pub quality_score: f64, // 0.0-100.0
}

#[tauri::command]
pub async fn check_translation_quality(
    segments: Vec<SubtitleSegment>,
    options: Option<QualityCheckOptions>,
    _app_handle: tauri::AppHandle,
) -> Result<QualityReport, String> {
    println!("🔍 Проверка качества перевода для {} сегментов", segments.len());
    
    let options = options.unwrap_or(QualityCheckOptions {
        check_length_ratio: true,
        check_meaning_preservation: true,
        length_tolerance: 0.3, // ±30% допустимо
    });
    
    let mut issues = Vec::new();
    let mut total_issues = 0u32;
    
    for segment in &segments {
        if let Some(ref translation) = segment.translation {
            // Проверка соотношения длин
            if options.check_length_ratio {
                let length_issue = check_length_ratio(&segment.text, translation, options.length_tolerance);
                if let Some(issue) = length_issue {
                    issues.push(issue);
                    total_issues += 1;
                }
            }
            
            // Проверка сохранения смысла (упрощённая)
            if options.check_meaning_preservation {
                let meaning_issue = check_meaning_preservation(&segment.text, translation);
                if let Some(issue) = meaning_issue {
                    issues.push(issue);
                    total_issues += 1;
                }
            }
        }
    }
    
    // Рассчитываем общий балл качества
    let quality_score = if segments.is_empty() {
        100.0
    } else {
        let translated_segments = segments.iter()
            .filter(|s| s.translation.is_some())
            .count() as f64;
        
        let coverage_score = (translated_segments / segments.len() as f64) * 50.0;
        let issues_penalty = (total_issues as f64 / segments.len() as f64) * 50.0;
        
        (coverage_score + (50.0 - issues_penalty)).max(0.0)
    };
    
    println!("✅ Найдено {} проблем в {} сегментах", total_issues, segments.len());
    
    Ok(QualityReport {
        total_segments: segments.len() as u32,
        issues_found: total_issues,
        issues,
        quality_score,
    })
}

fn check_length_ratio(original: &str, translation: &str, tolerance: f64) -> Option<QualityIssue> {
    let original_chars = original.chars().count() as f64;
    let translation_chars = translation.chars().count() as f64;
    
    if original_chars == 0.0 {
        return None;
    }
    
    let ratio = translation_chars / original_chars;
    let expected_min = 1.0 - tolerance;
    let expected_max = 1.0 + tolerance;
    
    if ratio < expected_min || ratio > expected_max {
        let description = format!(
            "Соотношение длин: {:.2} (ожидается {:.2}-{:.2})",
            ratio, expected_min, expected_max
        );
        
        let severity = if ratio < expected_min * 0.8 || ratio > expected_max * 1.2 {
            QualitySeverity::High
        } else {
            QualitySeverity::Medium
        };
        
        return Some(QualityIssue {
            segment_id: 0, // Будет установлен позже
            issue_type: "length_ratio".to_string(),
            description,
            severity,
        });
    }
    
    None
}

fn check_meaning_preservation(original: &str, translation: &str) -> Option<QualityIssue> {
    // Простая проверка: наличие ключевых слов
    // В реальном приложении можно использовать семантический анализ или LLM
    
    let original_lower = original.to_lowercase();
    let translation_lower = translation.to_lowercase();
    
    // Проверяем наличие общих слов
    let original_words: Vec<&str> = original_lower.split_whitespace().collect();
    let translation_words: Vec<&str> = translation_lower.split_whitespace().collect();
    
    if original_words.is_empty() {
        return None;
    }
    
    let common_words = original_words.iter()
        .filter(|word| translation_words.contains(word))
        .count();
    
    let similarity = common_words as f64 / original_words.len() as f64;
    
    if similarity < 0.2 { // Менее 20% общих слов
        let description = format!(
            "Низкое сходство текстов: {:.1}% общих слов",
            similarity * 100.0
        );
        
        let severity = if similarity < 0.1 {
            QualitySeverity::Critical
        } else {
            QualitySeverity::High
        };
        
        return Some(QualityIssue {
            segment_id: 0,
            issue_type: "meaning_preservation".to_string(),
            description,
            severity,
        });
    }
    
    None
}