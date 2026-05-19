use super::GlossaryEntry;

/// Применить глоссарий к тексту (заменяет термины с учётом регистра)
pub fn apply_glossary(text: &str, glossary: &[GlossaryEntry]) -> String {
    if glossary.is_empty() {
        return text.to_string();
    }
    
    let mut result = text.to_string();
    
    // Сортируем по длине (длинные термины первыми, чтобы избежать частичных замен)
    let mut sorted_glossary: Vec<&GlossaryEntry> = glossary.iter().collect();
    sorted_glossary.sort_by(|a, b| b.source.len().cmp(&a.source.len()));
    
    for entry in sorted_glossary {
        let source = entry.source.trim();
        let target = entry.target.trim();
        // Пустой target (черновик глоссария после транскрипции) не должен вырезать имена
        if source.is_empty() || target.is_empty() {
            continue;
        }
        if source.eq_ignore_ascii_case(target) {
            continue;
        }
        result = replace_term(&result, source, target);
    }

    result
}

fn replace_term(haystack: &str, source: &str, target: &str) -> String {
    if source.is_empty() {
        return haystack.to_string();
    }
    if haystack.contains(source) {
        return haystack.replace(source, target);
    }
    let lower_hay: String = haystack.to_lowercase();
    let lower_src = source.to_lowercase();
    if !lower_hay.contains(&lower_src) {
        return haystack.to_string();
    }
    let src_chars: Vec<char> = source.chars().collect();
    let mut out = String::new();
    let mut rest = haystack;
    while let Some(pos) = rest.to_lowercase().find(&lower_src) {
        let (before, after) = rest.split_at(pos);
        out.push_str(before);
        let matched: String = after.chars().take(src_chars.len()).collect();
        out.push_str(target);
        rest = after.split_at(matched.len()).1;
    }
    out.push_str(rest);
    out
}