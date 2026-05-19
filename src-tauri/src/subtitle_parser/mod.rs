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
    let mut segments = match format {
        SubtitleFormat::SRT => srt::parse(content),
        SubtitleFormat::VTT => vtt::parse(content),
        SubtitleFormat::ASS | SubtitleFormat::SSA => {
            Err("Форматы ASS/SSA пока не поддерживаются".to_string())
        }
    }?;
    for seg in segments.iter_mut() {
        seg.text = sanitize_subtitle_text(&seg.text);
    }
    Ok(segments)
}

/// Удаляет теги форматирования (`<...>`, `{...}`) и схлопывает пробелы
/// Поддерживает SRT/VTT-теги цвета, курсива и WebVTT-классы вида `<c.cyan>`
pub fn sanitize_subtitle_text(input: &str) -> String {
    let mut stripped = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '<' => {
                for c in chars.by_ref() {
                    if c == '>' {
                        break;
                    }
                }
            }
            '{' => {
                for c in chars.by_ref() {
                    if c == '}' {
                        break;
                    }
                }
            }
            _ => stripped.push(ch),
        }
    }

    let decoded = decode_basic_entities(&stripped);

    let lines: Vec<String> = decoded
        .lines()
        .map(|line| {
            line.split_whitespace().collect::<Vec<_>>().join(" ")
        })
        .filter(|line| !line.is_empty())
        .collect();
    lines.join("\n")
}

fn decode_basic_entities(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    let bytes = input.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'&' {
            if let Some(end) = input[i..].find(';') {
                let entity = &input[i..i + end + 1];
                let replacement = match entity {
                    "&amp;" => Some("&"),
                    "&lt;" => Some("<"),
                    "&gt;" => Some(">"),
                    "&quot;" => Some("\""),
                    "&apos;" => Some("'"),
                    "&nbsp;" => Some(" "),
                    _ => None,
                };
                if let Some(r) = replacement {
                    out.push_str(r);
                    i += end + 1;
                    continue;
                }
            }
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}