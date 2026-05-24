use crate::project::SubtitleSegment;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentTaskMode {
    General,
    /// Только ответ в чате, без правок субтитров
    AnswerOnly,
    /// Замена термина/фразы (from → to), без посторонних правок
    BulkReplace,
    /// Опечатки и грамматика — минимальные точечные правки
    Proofread,
    /// Исправление ошибок перевода — только поле translation
    TranslationFix,
    /// Пакет: не расширять задачу за пределы запроса
    StrictBatch,
    /// Применить изменения глоссария ко всем репликам
    GlossarySync,
}

impl AgentTaskMode {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "general" => Some(Self::General),
            "answer_only" | "qa_only" | "chat" => Some(Self::AnswerOnly),
            "bulk_replace" | "replace" => Some(Self::BulkReplace),
            "proofread" | "typo" | "grammar" => Some(Self::Proofread),
            "translation_fix" | "translation" => Some(Self::TranslationFix),
            "strict_batch" => Some(Self::StrictBatch),
            "glossary_sync" | "glossary" => Some(Self::GlossarySync),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::General => "general",
            Self::AnswerOnly => "answer_only",
            Self::BulkReplace => "bulk_replace",
            Self::Proofread => "proofread",
            Self::TranslationFix => "translation_fix",
            Self::StrictBatch => "strict_batch",
            Self::GlossarySync => "glossary_sync",
        }
    }

    pub fn from_context(task_mode: Option<&str>) -> Self {
        task_mode
            .and_then(Self::parse)
            .unwrap_or(Self::General)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentIntent {
    pub task_mode: String,
    #[serde(default)]
    pub replace_from: Option<String>,
    #[serde(default)]
    pub replace_to: Option<String>,
    #[serde(default)]
    pub translation_only: bool,
}

impl AgentIntent {
    pub fn mode(&self) -> AgentTaskMode {
        AgentTaskMode::parse(&self.task_mode).unwrap_or(AgentTaskMode::General)
    }
}

#[derive(Debug, Deserialize)]
struct IntentClassifierJson {
    task_mode: String,
    #[serde(default)]
    replace_from: Option<String>,
    #[serde(default)]
    replace_to: Option<String>,
    #[serde(default)]
    translation_only: bool,
}

/// Классификация намерения по сообщению пользователя (любой язык) — только LLM, без regex по тексту.
pub async fn classify_agent_intent(
    api_key: &str,
    user_message: &str,
    conversation_tail: &[(String, String)],
) -> Result<AgentIntent, String> {
    let user_message = strip_batch_processing_suffix(user_message);
    if user_message.trim().is_empty() {
        return Ok(AgentIntent {
            task_mode: AgentTaskMode::General.as_str().to_string(),
            replace_from: None,
            replace_to: None,
            translation_only: false,
        });
    }

    let history_block = if conversation_tail.is_empty() {
        "(нет предыдущих реплик)".to_string()
    } else {
        conversation_tail
            .iter()
            .map(|(role, content)| format!("{role}: {}", content.trim()))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let system = r#"You classify what a subtitle-editing assistant should do next.
Read the user's latest message and recent dialogue. The user may write in ANY language.

Return ONLY one JSON object:
{
  "task_mode": "answer_only" | "general" | "bulk_replace" | "proofread" | "translation_fix",
  "replace_from": string or null,
  "replace_to": string or null,
  "translation_only": boolean
}

Rules for task_mode:
- answer_only: questions, discussion, advice, analysis — NO subtitle edits requested.
- general: edit specific segment(s), rephrase, improve style, glossary, mixed small tasks — NOT whole-file replace or whole-file proofread.
- bulk_replace: user wants to replace a term/phrase across subtitles via contextual translation. Set replace_from and replace_to to the OLD and NEW wording in the TRANSLATION column when fixing how a source term is translated. Use the source term in field text only to FIND lines — do NOT replace inside text unless the user explicitly asks to change the original dialogue. translation_only=true when the user says translate/переведи/как (how to translate), or when from and to use different scripts (e.g. Latin source term → Cyrillic translation). translation_only=false only if the user clearly wants to edit the original (text) column.
- proofread: user asks to fix typos/grammar/spelling across subtitles — minimal fixes only, not rewriting good lines.
- translation_fix: user asks to fix translation errors/quality across subtitles — only translation field.

Do NOT guess replace_from/replace_to unless the user clearly asked for a replacement.
For bulk_replace, extract the actual old and new wording from context (e.g. glossary term + wrong vs right translation)."#;

    let user = format!(
        "Recent dialogue:\n{history_block}\n\nLatest user message:\n{user_message}"
    );

    let client = reqwest::Client::new();
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": "gpt-5.4",
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user }
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0,
            "max_completion_tokens": 512
        }))
        .send()
        .await
        .map_err(|e| format!("Ошибка классификации намерения: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("OpenAI классификация ({}): {}", status, body));
    }

    let response: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let content = response["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "Пустой ответ классификатора".to_string())?;

    let parsed: IntentClassifierJson =
        serde_json::from_str(content).map_err(|e| format!("Невалидный JSON классификатора: {}", e))?;

    let mut intent = AgentIntent {
        task_mode: parsed.task_mode,
        replace_from: parsed.replace_from.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        replace_to: parsed.replace_to.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        translation_only: parsed.translation_only,
    };

    if intent.mode() == AgentTaskMode::BulkReplace {
        if intent.replace_from.is_none() || intent.replace_to.is_none() {
            intent.task_mode = AgentTaskMode::General.as_str().to_string();
            intent.replace_from = None;
            intent.replace_to = None;
        } else if intent
            .replace_from
            .as_ref()
            .zip(intent.replace_to.as_ref())
            .map(|(a, b)| a.eq_ignore_ascii_case(b))
            .unwrap_or(false)
        {
            intent.task_mode = AgentTaskMode::General.as_str().to_string();
            intent.replace_from = None;
            intent.replace_to = None;
        } else {
            normalize_bulk_replace_intent(&mut intent, &user_message);
        }
    }

    Ok(intent)
}

/// Уточняет bulk_replace: правка перевода, не оригинала.
pub fn normalize_bulk_replace_intent(intent: &mut AgentIntent, user_message: &str) {
    if intent.mode() != AgentTaskMode::BulkReplace {
        return;
    }
    let msg = user_message.to_lowercase();
    let translate_cue = [
        "переведи",
        "перевести",
        "перевод",
        "translate",
        "traducir",
        "traduce",
        "tradu",
    ];
    if translate_cue.iter().any(|c| msg.contains(c)) {
        intent.translation_only = true;
    }
    if cross_script_replace(intent) {
        intent.translation_only = true;
    }
}

fn cross_script_replace(intent: &AgentIntent) -> bool {
    let from = intent.replace_from.as_deref().unwrap_or("");
    let to = intent.replace_to.as_deref().unwrap_or("");
    let sf = script_bucket(from);
    let st = script_bucket(to);
    sf != ScriptBucket::Other && st != ScriptBucket::Other && sf != st
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScriptBucket {
    Other,
    Latin,
    Cyrillic,
}

fn script_bucket(s: &str) -> ScriptBucket {
    let mut latin = 0u32;
    let mut cyrillic = 0u32;
    for c in s.chars() {
        if ('\u{0400}'..='\u{04FF}').contains(&c) {
            cyrillic += 1;
        } else if c.is_ascii_alphabetic() {
            latin += 1;
        }
    }
    if cyrillic > latin && cyrillic > 0 {
        ScriptBucket::Cyrillic
    } else if latin > 0 {
        ScriptBucket::Latin
    } else {
        ScriptBucket::Other
    }
}

fn strip_batch_processing_suffix(message: &str) -> String {
    let marker = "\n\nПАКЕТНАЯ ОБРАБОТКА:";
    if let Some(idx) = message.find(marker) {
        message[..idx].trim().to_string()
    } else {
        message.trim().to_string()
    }
}

pub fn model_temperature(mode: AgentTaskMode) -> f32 {
    match mode {
        AgentTaskMode::BulkReplace
        | AgentTaskMode::Proofread
        | AgentTaskMode::TranslationFix
        | AgentTaskMode::StrictBatch
        | AgentTaskMode::GlossarySync
        | AgentTaskMode::AnswerOnly => 0.2,
        AgentTaskMode::General => 0.5,
    }
}

pub fn task_mode_prompt_block(mode: AgentTaskMode) -> &'static str {
    match mode {
        AgentTaskMode::AnswerOnly => "\n\
             РЕЖИМ: ТОЛЬКО ОТВЕТ. Пользователь не просил менять субтитры — actions: [], только message.\n",
        AgentTaskMode::BulkReplace => "\n\
             РЕЖИМ ЗАМЕНЫ ТЕРМИНА (контекстный перевод):\n\
             - Меняй ТОЛЬКО поле translation, если в задаче translation_only (типично при «переведи X как Y»).\n\
             - Поле text (оригинал диалога) НЕ МЕНЯЙ — там язык источника; термин в text только для поиска реплик.\n\
             - Замени смысл старого перевода на «to»; учитывай словоформы, фразы, приставки (ex-, бывший…).\n\
             - Для имён собственных: полное склонение по контексту (падеж, предлог с/со), не механическая подстановка lemma.\n\
             - Подбирай род, падеж, число по speaker_gender и контексту.\n\
             - Не исправляй посторонние ошибки «заодно».\n\
             - В edit_segments — только translation (не text), только изменённые id.\n",
        AgentTaskMode::Proofread => "\n\
             РЕЖИМ ВЫЧИТКИ: только явные опечатки и грамматические ошибки.\n\
             - Не перефразируй и не «улучшай» удачные строки; корректные реплики не трогай.\n\
             - Минимальная правка (буква, окончание, знак), не новая формулировка.\n\
             - Если ошибки нет — не включай реплику в edit_segments.\n",
        AgentTaskMode::TranslationFix => "\n\
             РЕЖИМ ПЕРЕВОДА: только поле translation, только явные ошибки перевода.\n\
             - Не переписывай удачный перевод; text (оригинал) не меняй.\n\
             - Без стилистических улучшений «на всякий случай».\n",
        AgentTaskMode::StrictBatch => "\n\
             РЕЖИМ ПАКЕТА (СТРОГО): выполни ТОЛЬКО задачу из сообщения пользователя.\n\
             - Не проводи общую проверку качества и не исправляй постороннее.\n\
             - Если в пакете нечего менять по задаче — actions: [], кратко в message.\n",
        AgentTaskMode::GlossarySync => "\n\
             РЕЖИМ СИНХРОНИЗАЦИИ С ГЛОССАРИЕМ:\n\
             - В сообщении перечислены изменения глоссария — примени их ко ВСЕМ подходящим репликам пакета.\n\
             - Ниже дан полный текст реплик пакета — не пиши, что списка нет.\n\
             - Если изменился только перевод термина — правь только translation; только original — только text; оба — оба поля.\n\
             - Учитывай Context термина (род, склонение); заменяй все словоформы и устойчивые сочетания с термином.\n\
             - Для имён: особые формы языка перевода (беглая гласная, предлог со/с), не «имя + окончание».\n\
             - Не исправляй постороннее. message оставь пустым. actions: только edit_segments.\n",
        AgentTaskMode::General => "",
    }
}

pub fn replace_word_case_insensitive(haystack: &str, from: &str, to: &str) -> String {
    if from.is_empty() {
        return haystack.to_string();
    }
    let hay_lower = haystack.to_lowercase();
    let from_lower = from.to_lowercase();
    let mut out = String::with_capacity(haystack.len());
    let mut rest = haystack;
    let mut rest_lower = hay_lower.as_str();
    while let Some(pos) = rest_lower.find(&from_lower) {
        out.push_str(&rest[..pos]);
        out.push_str(to);
        rest = &rest[pos + from.len()..];
        rest_lower = &rest_lower[pos + from.len()..];
    }
    out.push_str(rest);
    out
}

pub fn filter_changed_segments(
    task_mode: AgentTaskMode,
    base: &[SubtitleSegment],
    changed: Vec<SubtitleSegment>,
    intent: Option<&AgentIntent>,
) -> Vec<SubtitleSegment> {
    let base_by_id: std::collections::HashMap<u32, &SubtitleSegment> =
        base.iter().map(|s| (s.id, s)).collect();

    changed
        .into_iter()
        .filter_map(|seg| {
            let Some(b) = base_by_id.get(&seg.id) else {
                return None;
            };
            match task_mode {
                AgentTaskMode::BulkReplace => {
                    let Some(intent) = intent else {
                        return None;
                    };
                    if intent.replace_from.as_deref().unwrap_or("").trim().is_empty() {
                        return None;
                    }
                    let clamped = clamp_bulk_replace_segment(b, &seg, intent);
                    if segment_matches_bulk_replace_contextual(b, &clamped, intent) {
                        Some(clamped)
                    } else {
                        None
                    }
                }
                AgentTaskMode::Proofread => {
                    let tr_b = b.translation.as_deref().unwrap_or("");
                    let tr_a = seg.translation.as_deref().unwrap_or("");
                    let text_ok =
                        b.text == seg.text || is_minimal_proofread_edit(&b.text, &seg.text);
                    let tr_ok = tr_b == tr_a
                        || is_minimal_proofread_edit(tr_b, tr_a);
                    if text_ok && tr_ok && (b.text != seg.text || tr_b != tr_a) {
                        Some(seg)
                    } else {
                        None
                    }
                }
                AgentTaskMode::TranslationFix => {
                    if b.text == seg.text
                        && b.translation != seg.translation
                        && seg
                            .translation
                            .as_deref()
                            .map(|t| is_minimal_proofread_edit(
                                b.translation.as_deref().unwrap_or(""),
                                t,
                            ))
                            .unwrap_or(false)
                    {
                        Some(seg)
                    } else {
                        None
                    }
                }
                AgentTaskMode::AnswerOnly => None,
                AgentTaskMode::GlossarySync | AgentTaskMode::StrictBatch | AgentTaskMode::General => {
                    Some(seg)
                }
            }
        })
        .collect()
}

/// Восстанавливает text, если модель ошибочно подставила перевод в оригинал.
pub fn clamp_bulk_replace_segment(
    before: &SubtitleSegment,
    after: &SubtitleSegment,
    intent: &AgentIntent,
) -> SubtitleSegment {
    let mut out = after.clone();
    if intent.translation_only {
        out.text = before.text.clone();
        return out;
    }
    let from = intent.replace_from.as_deref().unwrap_or("");
    let to = intent.replace_to.as_deref().unwrap_or("");
    if out.text != before.text && !allow_original_text_edit(&before.text, from, to) {
        out.text = before.text.clone();
    }
    out
}

fn allow_original_text_edit(original: &str, from: &str, to: &str) -> bool {
    if from.trim().is_empty() {
        return false;
    }
    if !text_related_to_term(original, from) {
        return false;
    }
    script_bucket(original) == script_bucket(from) && script_bucket(original) == script_bucket(to)
}

/// Пропускает правки GPT по замене термина: реплика относилась к старому термину (в т.ч. словоформы).
fn segment_matches_bulk_replace_contextual(
    before: &SubtitleSegment,
    after: &SubtitleSegment,
    intent: &AgentIntent,
) -> bool {
    let from = intent.replace_from.as_deref().unwrap_or("").trim();
    if from.is_empty() {
        return false;
    }
    let translation_only = intent.translation_only;
    let tr_before = before.translation.as_deref().unwrap_or("");
    let tr_after = after.translation.as_deref().unwrap_or("");

    if before.text == after.text && tr_before == tr_after {
        return false;
    }
    if translation_only && before.text != after.text {
        return false;
    }

    let in_tr = text_related_to_term(tr_before, from);
    let in_text = text_related_to_term(&before.text, from);
    if translation_only {
        return tr_before != tr_after && (in_tr || in_text);
    }

    if tr_before != tr_after && (in_tr || in_text) {
        return true;
    }
    if before.text != after.text && (in_text || in_tr) {
        return true;
    }

    false
}

/// Совпадение термина с учётом словоформ (lemma ⊂ словоформа, фраза с термином).
fn text_related_to_term(haystack: &str, term: &str) -> bool {
    let term = term.trim();
    if term.is_empty() {
        return false;
    }
    let hay = haystack.to_lowercase();
    let term_l = term.to_lowercase();
    if hay.contains(&term_l) {
        return true;
    }
    let n = term_l.chars().count();
    if n < 3 {
        return false;
    }
    let stem_len = n.saturating_sub(2).clamp(4, n);
    let stem: String = term_l.chars().take(stem_len).collect();
    if stem.len() >= 3 && hay.contains(&stem) {
        return true;
    }
    hay.split(|c: char| !c.is_alphabetic())
        .any(|w| w.len() >= 3 && (w.starts_with(&stem) || stem.starts_with(w)))
}

/// Отсекает «переписывание» при вычитке: слишком большая доля новых слов.
fn is_minimal_proofread_edit(before: &str, after: &str) -> bool {
    let before = before.trim();
    let after = after.trim();
    if before == after {
        return false;
    }
    if before.is_empty() || after.is_empty() {
        return before.len().abs_diff(after.len()) <= 3;
    }
    if is_substantial_rewrite(before, after) {
        return false;
    }
    let max_len = before.chars().count().max(after.chars().count());
    let edits = levenshtein_chars(before, after);
    edits as f64 / max_len as f64 <= 0.35
}

fn is_substantial_rewrite(before: &str, after: &str) -> bool {
    let old: std::collections::HashSet<String> = before
        .split_whitespace()
        .map(|w| w.to_lowercase())
        .collect();
    let new: std::collections::HashSet<String> = after
        .split_whitespace()
        .map(|w| w.to_lowercase())
        .collect();
    if old.is_empty() || new.is_empty() {
        return false;
    }
    let inter = old.intersection(&new).count();
    let union = old.union(&new).count().max(1);
    (inter as f64 / union as f64) < 0.45
}

fn levenshtein_chars(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let n = a.len();
    let m = b.len();
    if n == 0 {
        return m;
    }
    if m == 0 {
        return n;
    }
    let mut prev: Vec<usize> = (0..=m).collect();
    let mut curr = vec![0; m + 1];
    for i in 1..=n {
        curr[0] = i;
        for j in 1..=m {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            curr[j] = (prev[j] + 1)
                .min(curr[j -  1] + 1)
                .min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[m]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimal_proofread_rejects_rewrite() {
        assert!(!is_minimal_proofread_edit(
            "Она пошла в магазин за хлебом",
            "Она отправилась в продуктовый за буханкой"
        ));
    }

    #[test]
    fn minimal_proofread_accepts_typo() {
        assert!(is_minimal_proofread_edit("привт", "привет"));
    }

    #[test]
    fn term_related_inflection() {
        assert!(text_related_to_term("former widgets", "widget"));
        assert!(text_related_to_term("Widgets!", "widget"));
    }

    #[test]
    fn cross_script_sets_translation_only() {
        let mut intent = AgentIntent {
            task_mode: "bulk_replace".to_string(),
            replace_from: Some("Cuñadísima".to_string()),
            replace_to: Some("сестрёнушка".to_string()),
            translation_only: false,
        };
        normalize_bulk_replace_intent(&mut intent, "переведи везде Cuñadísima как сестрёнушка");
        assert!(intent.translation_only);
    }

    #[test]
    fn clamp_restores_original_text() {
        let before = SubtitleSegment {
            id: 1,
            start: 0.0,
            end: 1.0,
            duration: 1.0,
            text: "Ya puedes decirme ex-cuñadísima.".to_string(),
            translation: Some("Можешь называть меня бывшей золовушкой.".to_string()),
            speaker_gender: None,
            flags: None,
        };
        let mut after = before.clone();
        after.text = "Ya puedes decirme ex-сестрёнушка.".to_string();
        after.translation = Some("Можешь называть меня бывшей сестрёнушкой.".to_string());
        let intent = AgentIntent {
            task_mode: "bulk_replace".to_string(),
            replace_from: Some("Cuñadísima".to_string()),
            replace_to: Some("сестрёнушка".to_string()),
            translation_only: true,
        };
        let fixed = clamp_bulk_replace_segment(&before, &after, &intent);
        assert_eq!(fixed.text, before.text);
        assert_ne!(fixed.translation, before.translation);
    }
}
