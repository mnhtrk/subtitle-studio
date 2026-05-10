use serde::{Deserialize, Serialize};
use crate::project::GlossaryEntry;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PostProcessingOptions {
    pub fix_punctuation: bool,
    pub fix_names: bool,
    pub target_language: String,
    pub style_prompt: Option<String>,
    pub name_hints: Option<String>,
    #[serde(default)]
    pub glossary: Vec<GlossaryEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PostProcessingResult {
    pub corrected_segments: Vec<crate::project::SubtitleSegment>,
    pub corrections_applied: u32,
    pub processing_time_ms: u64,
}

/// Сегментов в одном GPT-вызове. Больше - меньше походов к API, но риск переполнить контекст/ответ.
const POSTPROCESS_CHUNK_SIZE: usize = 60;

pub async fn postprocess_transcription(
    segments: Vec<crate::project::SubtitleSegment>,
    options: PostProcessingOptions,
    api_key: &str,
) -> Result<PostProcessingResult, String> {
    let start_time = std::time::Instant::now();
    let mut corrected = segments;
    let mut corrections_applied = 0u32;

    if options.fix_names || options.fix_punctuation {
        let hints_summary = options
            .name_hints
            .as_deref()
            .map(|s| format!("{} симв.", s.chars().count()))
            .unwrap_or_else(|| "(нет)".to_string());
        println!(
            "[postprocess] старт GPT-проверки: сегментов={}, fix_punctuation={}, fix_names={}, name_hints={}",
            corrected.len(),
            options.fix_punctuation,
            options.fix_names,
            hints_summary
        );

        match fix_with_gpt(
            corrected.clone(),
            &options.target_language,
            options.style_prompt.as_deref(),
            options.name_hints.as_deref(),
            &options.glossary,
            options.fix_punctuation,
            options.fix_names,
            api_key,
        )
        .await
        {
            Ok(updated) => {
                let mut diffs = 0u32;
                for (a, b) in corrected.iter().zip(updated.iter()) {
                    if a.text.trim() != b.text.trim() {
                        diffs += 1;
                    }
                }
                corrections_applied = diffs;
                println!(
                    "[postprocess] GPT исправил {} из {} сегментов",
                    diffs,
                    corrected.len()
                );
                corrected = updated;
            }
            Err(err) => {
                eprintln!(
                    "[postprocess] !!! GPT-постобработка ПРОПУЩЕНА: {}\n[postprocess] возвращаю сырые сегменты от Whisper",
                    err
                );
            }
        }
    } else {
        println!("[postprocess] пропуск: fix_punctuation=false и fix_names=false");
    }

    let corrected = if options.fix_punctuation {
        ensure_terminal_punctuation(corrected)
    } else {
        corrected
    };

    Ok(PostProcessingResult {
        corrected_segments: corrected,
        corrections_applied,
        processing_time_ms: start_time.elapsed().as_millis() as u64,
    })
}

fn ensure_terminal_punctuation(
    segments: Vec<crate::project::SubtitleSegment>,
) -> Vec<crate::project::SubtitleSegment> {
    segments
        .into_iter()
        .map(|mut seg| {
            let text = seg.text.trim_end();
            if text.is_empty() || has_terminal_punctuation(text) || ends_with_open_fragment(text) {
                return seg;
            }

            seg.text = format!("{}.", text);
            seg
        })
        .collect()
}

fn has_terminal_punctuation(text: &str) -> bool {
    text.chars()
        .rev()
        .find(|c| !c.is_whitespace() && !matches!(c, '"' | '\'' | '»' | '”' | ')' | ']'))
        .is_some_and(|c| matches!(c, '.' | '!' | '?' | '…' | ':' | ';'))
}

fn ends_with_open_fragment(text: &str) -> bool {
    text.ends_with('-') || text.ends_with('—') || text.ends_with("...")
}

fn build_authoritative_terms_block(name_hints: Option<&str>, glossary: &[GlossaryEntry]) -> String {
    let mut sections: Vec<String> = Vec::new();

    if let Some(hints) = name_hints {
        let trimmed = hints.trim();
        if !trimmed.is_empty() {
            sections.push(format!(
                "Whisper prompt / подсказки пользователя (написания считать авторитетными):\n{}",
                trimmed
            ));
        }
    }

    if !glossary.is_empty() {
        let glossary_lines = glossary
            .iter()
            .filter_map(|entry| {
                let source = entry.source.trim();
                let target = entry.target.trim();
                if source.is_empty() && target.is_empty() {
                    return None;
                }

                let mut line = if source.is_empty() {
                    target.to_string()
                } else if target.is_empty() || source.eq_ignore_ascii_case(target) {
                    source.to_string()
                } else {
                    format!("{} -> {}", source, target)
                };

                if let Some(description) = entry.description.as_deref() {
                    let description = description.trim();
                    if !description.is_empty() {
                        line.push_str(&format!(" ({})", description));
                    }
                }

                Some(line)
            })
            .collect::<Vec<_>>();

        if !glossary_lines.is_empty() {
            sections.push(format!(
                "Глоссарий проекта (source — правильное написание в транскрипции, target — перевод/локализация для контекста):\n{}",
                glossary_lines.join("\n")
            ));
        }
    }

    if sections.is_empty() {
        return String::new();
    }

    format!(
        "\n\nАвторитетный список имён, локаций и терминов для проверки написания:\n{}",
        sections.join("\n\n")
    )
}

async fn fix_with_gpt(
    segments: Vec<crate::project::SubtitleSegment>,
    target_language: &str,
    style_prompt: Option<&str>,
    name_hints: Option<&str>,
    glossary: &[GlossaryEntry],
    fix_punctuation: bool,
    fix_names: bool,
    api_key: &str,
) -> Result<Vec<crate::project::SubtitleSegment>, String> {
    if segments.is_empty() {
        return Ok(segments);
    }

    let style = style_prompt.unwrap_or("Профессиональные субтитры для видео");
    let names_block = build_authoritative_terms_block(name_hints, glossary);

    let mut tasks = Vec::<&'static str>::new();
    if fix_punctuation {
        tasks.push("- добавь только необходимую пунктуацию и капитализацию: точки, запятые, тире, ?, !; если сегмент выглядит как завершённая фраза, обязательно поставь конечный знак препинания; не переписывай стиль и смысл");
    }
    if fix_names {
        tasks.push("- исправь орфографические расхождения в именах персонажей, названиях локаций, брендах, аббревиатурах и терминах из авторитетного списка ниже");
        tasks.push("- если Whisper заменил имя/название похожим по звучанию словом, верни правильное написание из списка (например: Funhaus -> Von Kaos, Mai -> Mike)");
        tasks.push("- особенно проверяй обращения в начале реплики перед запятой: если слово похоже на имя из списка, это почти всегда имя, а не обычное слово (например: \"Mai, Bloom è pronta\" -> \"Mike, Bloom è pronta\")");
        tasks.push("- исправляй только случаи, где слово действительно похоже по звучанию/контексту на термин из списка; не выдумывай новые имена и не меняй обычные слова без причины");
    }
    let tasks_block = tasks.join("\n");

    let system_prompt = format!(
        "Ты профессиональный редактор субтитров. Тебе дают сегменты с тайм-кодами от Whisper.\n\
         Язык транскрипции: {target_language}. Стиль: {style}.\n\
         Твоя задача похожа на spell-check из документации OpenAI: исправить только расхождения в написании\n\
         имён/названий из предоставленного контекста, а также минимально восстановить пунктуацию.\n\
         Используй только контекст, который есть во входных сегментах и в авторитетном списке ниже.{names_block}\n\n\
         Задачи на каждый сегмент (НЕ объединяй сегменты, НЕ меняй id, НЕ меняй порядок, НЕ меняй смысл):\n\
         {tasks_block}\n\n\
         Жёсткие ограничения:\n\
         - Не переводить текст и не локализовать его: это коррекция транскрипции, а не перевод.\n\
         - Не перефразировать реплики.\n\
         - Не добавлять слова, которых нет в аудио/контексте.\n\
         - Если обычное слово одновременно похоже на имя из списка и стоит как обращение/имя персонажа в контексте, исправляй в пользу имени из списка.\n\
         - Если сомневаешься, оставь исходный текст без изменений.\n\n\
         Возвращай СТРОГО валидный JSON-объект вида:\n\
         {{\"segments\": [{{\"id\": <число>, \"text\": \"исправленный текст сегмента\"}}]}}\n\
         По одному объекту на каждый входной сегмент, в том же порядке. Без markdown и комментариев.",
        target_language = target_language,
        style = style,
        names_block = names_block,
        tasks_block = tasks_block
    );

    if let Some(hints) = name_hints {
        if !hints.trim().is_empty() {
            println!(
                "[postprocess] name_hints (для GPT): {}",
                hints.chars().take(400).collect::<String>()
            );
        }
    }
    if !glossary.is_empty() {
        println!(
            "[postprocess] glossary (для GPT): {} терминов",
            glossary.len()
        );
    }

    let client = reqwest::Client::new();
    let total = segments.len();
    let mut result: Vec<crate::project::SubtitleSegment> = Vec::with_capacity(total);
    let total_chunks = (total + POSTPROCESS_CHUNK_SIZE - 1) / POSTPROCESS_CHUNK_SIZE;

    for (chunk_idx, chunk) in segments.chunks(POSTPROCESS_CHUNK_SIZE).enumerate() {
        println!(
            "[postprocess] пакет {}/{} ({} сегм., id {}..{})",
            chunk_idx + 1,
            total_chunks,
            chunk.len(),
            chunk.first().map(|s| s.id).unwrap_or(0),
            chunk.last().map(|s| s.id).unwrap_or(0),
        );

        let payload = serde_json::json!({
            "segments": chunk.iter().map(|s| serde_json::json!({
                "id": s.id,
                "text": s.text,
            })).collect::<Vec<_>>()
        });
        let user_content = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

        let res = client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(api_key)
            .json(&serde_json::json!({
                "model": "gpt-5.4-mini",
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user", "content": user_content }
                ],
                "response_format": { "type": "json_object" },
                "temperature": 0.2,
                "max_completion_tokens": 4096
            }))
            .send()
            .await
            .map_err(|e| format!("Ошибка запроса к OpenAI: {}", e))?;

        if !res.status().is_success() {
            let status = res.status();
            let error_text = res.text().await.unwrap_or_else(|_| "Неизвестная ошибка".to_string());
            return Err(format!(
                "OpenAI ошибка ({}) на пакете постобработки {}: {}",
                status,
                chunk_idx + 1,
                error_text
            ));
        }

        let response: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let content = response["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| "Пустой content в ответе постобработки".to_string())?;

        let parsed: serde_json::Value = serde_json::from_str(content)
            .map_err(|e| format!("Постобработка: невалидный JSON ({}): {}", e, content))?;

        let arr = parsed
            .get("segments")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "В ответе нет массива segments".to_string())?;

        let mut by_id = std::collections::HashMap::<u32, String>::new();
        for item in arr {
            let Some(id) = item.get("id").and_then(|v| v.as_u64()) else { continue };
            let Some(text) = item.get("text").and_then(|v| v.as_str()) else { continue };
            by_id.insert(id as u32, text.trim().to_string());
        }

        for seg in chunk {
            let mut next = seg.clone();
            if let Some(new_text) = by_id.get(&seg.id) {
                if !new_text.is_empty() {
                    next.text = new_text.clone();
                }
            }
            result.push(next);
        }
    }

    Ok(result)
}
