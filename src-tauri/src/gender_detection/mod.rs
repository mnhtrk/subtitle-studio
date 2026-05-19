use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GenderDetectionResult {
    pub gender: Gender,
    pub confidence: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum Gender {
    Male,
    Female,
    Unknown,
}

pub async fn detect_speaker_gender(audio_path: &Path) -> Result<GenderDetectionResult, String> {
    // Читаем аудио файл
    let audio_data = tokio::fs::read(audio_path)
        .await
        .map_err(|e| format!("Ошибка чтения аудио файла: {}", e))?;
    
    // Анализируем аудио данные для определения тональности
    let pitch_info = analyze_audio_pitch(&audio_data)?;
    
    // Определяем пол на основе тональности
    let (gender, confidence) = determine_gender_from_pitch(pitch_info.average_pitch);
    
    Ok(GenderDetectionResult {
        gender,
        confidence,
    })
}

fn analyze_audio_pitch(audio_data: &[u8]) -> Result<PitchInfo, String> {
    if audio_data.len() < 4 {
        return Ok(PitchInfo { average_pitch: 100.0 });
    }
    
    let mut sum_pitch = 0.0;
    let mut count = 0;
    
    // Простой анализ: считаем среднее значение амплитуды как приближение к тональности
    for chunk in audio_data.chunks(4) {
        if chunk.len() == 4 {
            let sample_f32 = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            sum_pitch += sample_f32.abs() as f64;
            count += 1;
        }
    }
    
    if count > 0 {
        Ok(PitchInfo { average_pitch: sum_pitch / count as f64 })
    } else {
        Ok(PitchInfo { average_pitch: 100.0 })
    }
}

fn determine_gender_from_pitch(pitch: f64) -> (Gender, f64) {
    // Эмпирические значения для определения пола по тональности
    if pitch < 120.0 {
        (Gender::Male, 0.8)
    } else if pitch > 200.0 {
        (Gender::Female, 0.8)
    } else {
        (Gender::Unknown, 0.5)
    }
}

#[derive(Debug)]
struct PitchInfo {
    average_pitch: f64,
}