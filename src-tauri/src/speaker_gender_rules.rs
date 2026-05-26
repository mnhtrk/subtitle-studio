use crate::project::{GlossaryEntry, SpeakerGender, SubtitleSegment};

pub fn segment_speaker_gender_str(s: &SubtitleSegment) -> &'static str {
    match s.speaker_gender {
        Some(SpeakerGender::Male) => "male",
        Some(SpeakerGender::Female) => "female",
        Some(SpeakerGender::Unknown) | None => "unknown",
    }
}

// достаёт пол персонажа из строки description/context глоссария
// принимает любую форму - male/female/m/ж/мужчина/девочка и т.п.
pub fn parse_gender_marker(s: &str) -> Option<&'static str> {
    let l = s.to_lowercase();
    let has_word = |w: &str| -> bool {
        // ищем как подстроку, но рядом с границей слова (упрощённо)
        if let Some(pos) = l.find(w) {
            let before_ok = pos == 0
                || !l.as_bytes()[pos - 1].is_ascii_alphanumeric();
            let after = pos + w.len();
            let after_ok = after >= l.len()
                || !l.as_bytes()[after].is_ascii_alphanumeric();
            before_ok && after_ok
        } else {
            false
        }
    };
    // важно сначала female - чтобы "female" не схватился как "male"
    let female_markers = [
        "female", "f.", "женский", "женщина", "девушка", "девочка", "девушки", "женщины",
        "женский пол", "ж.", "(ж)", "fem",
    ];
    let male_markers = [
        "male", "m.", "мужской", "мужчина", "юноша", "мальчик", "мужчины",
        "мужской пол", "м.", "(м)", "masc",
    ];
    for w in &female_markers {
        if has_word(w) {
            return Some("female");
        }
    }
    for w in &male_markers {
        if has_word(w) {
            return Some("male");
        }
    }
    None
}

// карта имён персонажей -> пол на основе глоссария
// берём source и target термина если у него в description или context размечен пол
// сами слова имени приводим к lowercase
pub fn collect_character_genders(glossary: &[GlossaryEntry]) -> Vec<(String, &'static str)> {
    let mut out: Vec<(String, &'static str)> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for e in glossary {
        let marker = e
            .description
            .as_deref()
            .and_then(parse_gender_marker)
            .or_else(|| e.context.as_deref().and_then(parse_gender_marker));
        let Some(g) = marker else { continue };
        for raw in [&e.source, &e.target] {
            let name = raw.trim();
            if name.is_empty() {
                continue;
            }
            let key = name.to_lowercase();
            if seen.insert(key.clone()) {
                out.push((name.to_string(), g));
            }
        }
    }
    // длинные имена первыми - чтобы "X.A.N.A. virus" не съело "X.A.N.A."
    out.sort_by(|a, b| b.0.chars().count().cmp(&a.0.chars().count()));
    out
}


// язык из UI (Russian, ru, Русский) в iso код для правил рода
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
    "Диалог (справочно):\n\
     - Сначала прочитай реплики в блоке по порядку id/времени\n\
     - У каждой строки есть speaker_gender (male/female/unknown) — кто произносит ЭТУ реплику (акустическая оценка, может ошибаться)\n\
     - Адресата определяй сам по контексту: имена в реплике, вопрос-ответ в соседних id, сюжет\n\
     - При правке/переводе согласуй грамматику с соседями — не изолированно\n\
     - Не меняй другие реплики только из-за несогласования рода, если пользователь об этом не просил\n\n"
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
         - speaker_gender = кто произносит ЭТУ строку (акустика, бывает ошибочной)\n\
         - Пол адресата определяй сам по контексту диалога и блоку ПЕРСОНАЖИ\n\
         - Первое лицо (я/мы, глаголы говорящего): по полу говорящего (если знаешь персонажа — из ПЕРСОНАЖЕЙ, иначе по speaker_gender)\n\
         - Второе лицо (ты/вы к собеседнику): по полу адресата\n\
           Пример: female говорит мальчику → «Ты видел?» (не «видела»). male говорит девочке → «Ты видела?»\n\
         - Описание «о себе» (меня, мой, один/одна и т.п. рядом с «мной»): по полу говорящего\n\
           Пример: male «I saw it, too» → «Я тоже его видел» (не «видела»)\n\
         - В одной фразе могут сочетаться формы к адресату и к говорящему — это нормально\n\
         - Если по контексту пол неоднозначен — переформулируй нейтрально, не ставь мужской по умолчанию\n",
        target_language = target_language.trim(),
    )
}

// правила склонения имён при замене терминов и синхронизации глоссария
pub fn proper_name_declension_rules(target_language: &str) -> String {
    let iso = match normalize_target_language_iso(target_language) {
        Some(code) => code,
        None => return String::new(),
    };
    if !language_needs_speaker_gender(&iso) {
        return String::new();
    }
    match iso.as_str() {
        "ru" => "Склонение имён собственных в переводе (русский):\n\
             - Не подставляй имя механически (основа + окончание): «Лев» + «ом» ≠ «Левом». Нужна норма русского языка.\n\
             - Учитывай особые основы и беглую гласную: Лев → Льва, Льву, (о) Льве, со Львом, к Льву; Игорь → Игоря, с Игорем; Пётр → Петра, с Петром.\n\
             - Падеж и предлог по конструкции: «Что со Львом?» (творительный + со), «про Льва», «у Льва» — не всегда именительный.\n\
             - «с» перед группой согласных на стыке часто «со» (со Львом, со мной).\n\
             - Имя в глоссарии — справочная форма (lemma); в каждой реплике — грамматически верная форма в контексте.\n\n"
            .to_string(),
        "uk" => "Відмінювання власних імен у перекладі (українська): не механічна підстановка; узгоджуй відмінок і прийменник (з/зі, про, у) з контекстом репліки.\n\n"
            .to_string(),
        _ => format!(
            "Склонение / формы собственных имён ({target_language}): не механическая подстановка lemma; падеж, предлоги и особые основы — по правилам языка перевода.\n\n",
            target_language = target_language.trim()
        ),
    }
}
