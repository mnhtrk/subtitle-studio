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
    "Диалог (справочно, только для строк, которые пользователь попросил править):\n\
     - Сначала прочитай реплики в блоке по порядку id/времени\n\
     - У каждой строки есть speaker_gender (male/female/unknown) — кто произносит ЭТУ реплику\n\
     - Определи также, кому адресована реплика (часто другой пол в соседних id)\n\
     - При правке запрошенного id согласуй грамматику с соседними — не изолированно\n\
     - Чередование male/female по id обычно = двое собеседников (вопрос/ответ)\n\
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

/// Правила склонения имён при замене терминов / синхронизации глоссария.
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
