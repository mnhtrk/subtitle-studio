use std::collections::HashMap;
use super::GlossaryEntry;

/// Найти перевод термина в глоссарии (регистронезависимо)
pub fn find_translation<'a>(glossary: &'a [GlossaryEntry], term: &str) -> Option<&'a GlossaryEntry> {
    glossary.iter().find(|entry| entry.source.eq_ignore_ascii_case(term))
}

/// Применить глоссарий к тексту (заменяет термины с учётом регистра)
pub fn apply_glossary(text: &str, glossary: &[GlossaryEntry]) -> String {
    if glossary.is_empty() {
        return text.to_string();
    }
    
    let mut result = text.to_string();
    
    // Сортируем по длине (длинные термины первыми, чтобы избежать частичных замен)
    let mut sorted_glossary: Vec<&GlossaryEntry> = glossary.iter().collect();
    sorted_glossary.sort_by(|a, b| b.source.len().cmp(&a.source.len()));
    
    // Заменяем термины с сохранением регистра
    for entry in sorted_glossary {
        // Простая замена без учёта регистра (для субтитров этого достаточно)
        result = result.replace(&entry.source, &entry.target);
    }
    
    result
}

/// Создать индекс глоссария для быстрого поиска
pub fn create_index(glossary: &[GlossaryEntry]) -> HashMap<String, &GlossaryEntry> {
    glossary.iter().map(|e| (e.source.to_lowercase(), e)).collect()
}

/// Проверить, содержит ли текст термины из глоссария
pub fn contains_glossary_terms(text: &str, glossary: &[GlossaryEntry]) -> bool {
    glossary.iter().any(|entry| text.contains(&entry.source))
}