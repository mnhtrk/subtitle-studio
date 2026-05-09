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
        // Простая замена без учёта регистра (для субтитров этого достаточно)
        result = result.replace(&entry.source, &entry.target);
    }
    
    result
}