use crate::project::SubtitleSegment;
use std::path::Path;

pub mod srt;
pub mod vtt;

#[derive(Debug)]
pub enum SubtitleFormat {
    SRT,
    VTT,
    ASS,
    SSA,
}

pub fn detect_format(path: &Path) -> Result<SubtitleFormat, String> {
    let ext = path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    
    match ext.as_str() {
        "srt" => Ok(SubtitleFormat::SRT),
        "vtt" => Ok(SubtitleFormat::VTT),
        "ass" => Ok(SubtitleFormat::ASS),
        "ssa" => Ok(SubtitleFormat::SSA),
        _ => Err(format!("Неподдерживаемый формат субтитров: {}", ext)),
    }
}

pub fn parse_subtitles(content: &str, format: SubtitleFormat) -> Result<Vec<SubtitleSegment>, String> {
    match format {
        SubtitleFormat::SRT => srt::parse(content),
        SubtitleFormat::VTT => vtt::parse(content),
        SubtitleFormat::ASS | SubtitleFormat::SSA => {
            Err("Форматы ASS/SSA пока не поддерживаются".to_string())
        }
    }
}