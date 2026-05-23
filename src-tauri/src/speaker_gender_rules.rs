use crate::project::{SpeakerGender, SubtitleSegment};

pub fn segment_speaker_gender_str(s: &SubtitleSegment) -> &'static str {
    match s.speaker_gender {
        Some(SpeakerGender::Male) => "male",
        Some(SpeakerGender::Female) => "female",
        Some(SpeakerGender::Unknown) | None => "unknown",
    }
}

/// Язык перевода из UI («Russian», «ru», «Русский») → ISO для правил рода.
pub fn normalize_target_language_iso(raw: &str) -> Option<String> {
    let lower = raw.trim().to_lowercase();
    if lower.is_empty() {
        return None;
    }
    let iso = match lower.as_str() {
        "en" | "english" | "английский" => "en",
        "ru" | "russian" | "русский" => "ru",
        "uk" | "ukrainian" | "украинский" => "uk",
        "pl" | "polish" | "польский" => "pl",
        "cs" | "czech" | "чешский" => "cs",
        "sk" | "slovak" | "словацкий" => "sk",
        "be" | "belarusian" | "белорусский" => "be",
        "sr" | "serbian" | "сербский" => "sr",
        "hr" | "croatian" | "хорватский" => "hr",
        "bg" | "bulgarian" | "болгарский" => "bg",
        "es" | "spanish" | "испанский" => "es",
        "fr" | "french" | "французский" => "fr",
        "de" | "german" | "немецкий" => "de",
        "it" | "italian" | "итальянский" => "it",
        "pt" | "portuguese" | "португальский" => "pt",
        code if code.len() == 2 && code.chars().all(|c| c.is_ascii_lowercase()) => code,
        _ => return None,
    };
    Some(iso.to_string())
}

pub fn language_needs_speaker_gender(lang_iso: &str) -> bool {
    let l = lang_iso.trim().to_lowercase();
    matches!(
        l.as_str(),
        "ru" | "uk" | "pl" | "cs" | "sk" | "be" | "sr" | "hr" | "bg"
    ) || l.starts_with("ru-")
        || l.starts_with("uk-")
        || l.starts_with("pl-")
}

pub fn dialogue_context_translation_rules(target_language: &str) -> String {
    let iso = match normalize_target_language_iso(target_language) {
        Some(code) => code,
        None => return String::new(),
    };
    if !language_needs_speaker_gender(&iso) {
        return "- В списке субтитров все реплики — одна сцена; правь перевод согласованно с соседними.\n"
            .to_string();
    }
    "Диалог (обязательно):\n\
     - Сначала прочитай ВСЕ реплики в блоке по порядку id/времени\n\
     - У каждой строки есть speaker_gender (male/female/unknown) — кто произносит ЭТУ реплику\n\
     - Определи также, кому адресована реплика (часто другой пол в соседних id)\n\
     - Правь каждый id отдельно, но грамматику согласуй с предыдущими и следующими — не изолированно\n\
     - Чередование male/female по id обычно = двое собеседников (вопрос/ответ)\n\n"
        .to_string()
}

pub fn speaker_gender_translation_rules(target_language: &str) -> String {
    let iso = match normalize_target_language_iso(target_language) {
        Some(code) => code,
        None => return String::new(),
    };
    if !language_needs_speaker_gender(&iso) {
        return String::new();
    }
    format!(
        "Согласование по полу на языке перевода ({target_language}):\n\
         - speaker_gender = кто произносит ЭТУ строку (не путать с собеседником)\n\
         - Первая лица (я/мы, глаголы и местоимения говорящего): строго по speaker_gender этого id\n\
         - Вторая лица (ты/вы к собеседнику): по полу АДРЕСАТА, не по speaker_gender говорящей реплики\n\
         - Описание «о себе» (меня, мой, один/одна и т.п. рядом с «мной»): по speaker_gender говорящего\n\
         - В одной фразе могут сочетаться формы к адресату и к говорящему — это нормально\n\
         - Грамматика исходного текста подсказывает пол говорящего и адресата — сверяй с соседними репликами\n\
         - При speaker_gender unknown — выводи из контекста соседних реплик и глоссария\n",
        target_language = target_language.trim(),
    )
}
