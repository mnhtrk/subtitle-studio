import {
	projectService,
	type GlossaryEntry,
	type GlossaryTermGenerated,
	type ProjectData,
	type SubtitleSegment
} from '../services/projectService';

export function resolveIsoLanguage(languageOrCode: string): string | null {
	const normalized = languageOrCode.trim().toLowerCase();
	if (!normalized) return null;
	if (normalized.length === 2) return normalized;
	if (normalized === 'english') return 'en';
	if (normalized === 'russian') return 'ru';
	if (normalized === 'spanish') return 'es';
	if (normalized === 'french') return 'fr';
	if (normalized === 'german') return 'de';
	if (normalized === 'italian') return 'it';
	if (normalized === 'portuguese') return 'pt';
	if (normalized === 'chinese') return 'zh';
	if (normalized === 'japanese') return 'ja';
	if (normalized === 'korean') return 'ko';
	if (normalized === 'arabic') return 'ar';
	if (normalized === 'hindi') return 'hi';
	if (normalized === 'turkish') return 'tr';
	if (normalized === 'polish') return 'pl';
	if (normalized === 'ukrainian') return 'uk';
	return null;
}

// человекочитаемое описание для колонки context
function termContextLabel(t: GlossaryTermGenerated): string {
	const meaning = (t.meaning_context ?? '').trim();
	if (meaning.length > 0) return meaning;
	const cat = (t.category ?? '').trim();
	return cat.length > 0 ? cat : '';
}

function glossaryEntryNeedsTranslation(e: GlossaryEntry): boolean {
	const s = e.source.trim();
	const t = e.target.trim();
	if (!s) return false;
	if (!t) return true;
	return t.toLowerCase() === s.toLowerCase();
}

function pseudoSegmentsForGlossarySources(sources: string[]): SubtitleSegment[] {
	const out: SubtitleSegment[] = [];
	let id = 1;
	for (const raw of sources) {
		const text = raw.trim();
		if (!text) continue;
		for (let i = 0; i < 2; i++) {
			out.push({
				id: id++,
				start: 0,
				end: 1,
				duration: 1,
				text,
				translation: null
			});
		}
	}
	return out;
}

export function mergeAutoGlossaryForTranscription(
	existing: GlossaryEntry[],
	generated: GlossaryTermGenerated[]
): GlossaryEntry[] {
	const seen = new Set(existing.map((e) => e.source.trim().toLowerCase()).filter(Boolean));
	const next = existing.map((e) => ({ ...e }));
	for (const t of generated) {
		const s = t.source.trim();
		if (!s) continue;
		const k = s.toLowerCase();
		const ctx = termContextLabel(t);
		const idx = next.findIndex((e) => e.source.trim().toLowerCase() === k);
		if (idx >= 0) {
			if (!next[idx].context?.trim()) {
				next[idx] = { ...next[idx], context: ctx };
			}
			continue;
		}
		if (seen.has(k)) continue;
		seen.add(k);
		next.push({
			id: crypto.randomUUID(),
			source: t.source,
			target: '',
			description: null,
			context: ctx
		});
	}
	return next;
}

export function mergeAutoGlossary(
	existing: GlossaryEntry[],
	generated: GlossaryTermGenerated[]
): GlossaryEntry[] {
	const seen = new Set(existing.map((e) => e.source.trim().toLowerCase()).filter(Boolean));
	const next = existing.map((e) => ({ ...e }));
	for (const t of generated) {
		const s = t.source.trim();
		const tgt = t.target.trim();
		if (!s || !tgt) continue;
		const k = s.toLowerCase();
		const idx = next.findIndex((e) => e.source.trim().toLowerCase() === k);
		if (idx >= 0) {
			const cur = next[idx].target.trim();
			if (!cur || cur.toLowerCase() === s.toLowerCase()) {
				next[idx] = { ...next[idx], target: tgt };
			}
			continue;
		}
		if (seen.has(k)) continue;
		seen.add(k);
		next.push({
			id: crypto.randomUUID(),
			source: t.source,
			target: t.target,
			description: null,
			context: termContextLabel(t)
		});
	}
	return next;
}

export type TranslationHint = { source: string; target: string };

// вытащить "X as Y" из текста мастера
export function parseTranslationHintsFromPrompt(prompt: string): TranslationHint[] {
	const hints: TranslationHint[] = [];
	const seen = new Set<string>();
	const add = (rawSource: string, rawTarget: string) => {
		const source = rawSource.trim().replace(/^["'«]+|["'»]+$/g, '');
		const target = rawTarget.trim().replace(/^["'«]+|["'»]+$/g, '');
		if (source.length < 2 || target.length < 1) return;
		const key = source.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		hints.push({ source, target });
	};

	const text = prompt.trim();
	if (!text) return hints;

	const rules: RegExp[] = [
		/\b(?:translate|переведи|переводи)\s+["«]?([^"»\n;]+?)["»]?\s+(?:as|как)\s+["«]?([^"»\n;]+?)["»]?(?=[.!?,;\n]|$)/gi,
		/\b["«]?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9'’\-\s]{1,48})["»]?\s+(?:→|->|as|как)\s+["«]?([^"»\n;]+?)["»]?(?=[.!?,;\n]|$)/gi
	];
	for (const re of rules) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			add(m[1], m[2]);
		}
	}
	return hints;
}

export function mergePromptHintsIntoGlossary(
	glossary: GlossaryEntry[],
	hints: TranslationHint[]
): GlossaryEntry[] {
	const next = glossary.map((e) => ({ ...e }));
	for (const { source, target } of hints) {
		const s = source.trim();
		const t = target.trim();
		if (!s || !t) continue;
		const key = s.toLowerCase();
		const idx = next.findIndex((e) => e.source.trim().toLowerCase() === key);
		if (idx >= 0) {
			next[idx] = { ...next[idx], target: t, description: 'user prompt' };
		} else {
			next.push({
				id: crypto.randomUUID(),
				source: s,
				target: t,
				description: 'user prompt',
				context: null
			});
		}
	}
	return next;
}

export function buildTranscriptionPrompt(
	userPrompt: string,
	_glossary: GlossaryEntry[]
): string | undefined {
	const manual = userPrompt.trim();
	return manual.length > 0 ? manual : undefined;
}

// переводит target-колонку всех записей глоссария проекта где target пустой или равен source
// использует translate_glossary_terms (явная транслитерация имён)
// НЕ запускает повторный auto_generate_glossary - только перевод того что уже есть
// onlySources=undefined - переводит всё пустое; иначе только указанные source-формы
export async function translateGlossaryTargetsInProject(
	projectPath: string,
	targetLanguage: string,
	contextPrompt?: string,
	onlySources?: string[]
): Promise<ProjectData> {
	const opened = await projectService.open(projectPath);
	const existing = opened.glossary ?? [];
	if (existing.length === 0) return opened;

	const onlyFilter = onlySources
		? new Set(onlySources.map((s) => s.trim().toLowerCase()).filter(Boolean))
		: null;

	const pending = existing.filter((e) => {
		if (!glossaryEntryNeedsTranslation(e)) return false;
		if (onlyFilter && !onlyFilter.has(e.source.trim().toLowerCase())) return false;
		return true;
	});
	if (pending.length === 0) return opened;

	const stylePrompt = contextPrompt?.trim() || 'Natural subtitle translation';
	const termInputs = pending
		.map((e) => ({
			source: e.source.trim(),
			context: e.context?.trim() || null
		}))
		.filter((t) => t.source.length > 0);
	if (termInputs.length === 0) return opened;

	try {
		const translations = await projectService.translateGlossaryTerms(
			termInputs,
			targetLanguage,
			stylePrompt
		);
		const bySource = new Map<string, string>();
		for (const tr of translations) {
			const src = tr.source.trim().toLowerCase();
			const tgt = tr.target.trim();
			if (src && tgt && tgt.toLowerCase() !== src) {
				bySource.set(src, tgt);
			}
		}
		if (bySource.size === 0) return opened;
		const updated = existing.map((e) => {
			const tr = bySource.get(e.source.trim().toLowerCase());
			if (tr && glossaryEntryNeedsTranslation(e)) {
				return { ...e, target: tr };
			}
			return e;
		});
		const toSave: ProjectData = {
			...opened,
			glossary: updated,
			updated_at: new Date().toISOString()
		};
		await projectService.save(toSave);
		return toSave;
	} catch (err) {
		console.warn('[glossary] translateGlossaryTargetsInProject failed', err);
		return opened;
	}
}

// сбрасывает target во всех записях глоссария проекта (нужно при смене target-языка)
// после сброса вызвать translateGlossaryTargetsInProject чтобы заполнить заново
export async function clearGlossaryTargetsInProject(projectPath: string): Promise<ProjectData> {
	const opened = await projectService.open(projectPath);
	const existing = opened.glossary ?? [];
	if (existing.length === 0) return opened;
	const cleared = existing.map((e) => ({ ...e, target: '' }));
	const toSave: ProjectData = {
		...opened,
		glossary: cleared,
		updated_at: new Date().toISOString()
	};
	await projectService.save(toSave);
	return toSave;
}

export async function applyAutoGlossaryToProject(
	projectPath: string,
	segments: SubtitleSegment[],
	opts: {
		targetLanguageIso: string;
		targetLanguage?: string;
		contextPrompt?: string;
		fillTranslation?: boolean;
		// язык для поля meaning_context (если не задан = targetLanguageIso)
		// в мастере target=исходный, но meaning_context надо писать на ui-языке проекта
		meaningContextLanguageIso?: string;
	}
): Promise<ProjectData> {
	const opened = await projectService.open(projectPath);
	const fillTranslation = opts.fillTranslation !== false;
	const existing = opened.glossary ?? [];
	const untranslatedSources = fillTranslation
		? existing.filter(glossaryEntryNeedsTranslation).map((e) => e.source.trim())
		: [];

	if (segments.length === 0 && untranslatedSources.length === 0) return opened;

	const glossaryNotes =
		untranslatedSources.length > 0
			? `Existing glossary terms that need translation: ${untranslatedSources.join(', ')}`
			: '';
	const contextPrompt = [opts.contextPrompt?.trim(), glossaryNotes].filter(Boolean).join('\n\n') || undefined;

	const corpusSegments = fillTranslation
		? [...segments, ...pseudoSegmentsForGlossarySources(untranslatedSources)]
		: segments;

	const autoOptions = {
		min_frequency: 2,
		max_terms: 45,
		target_language: opts.targetLanguageIso,
		contextPrompt,
		meaningContextLanguage: opts.meaningContextLanguageIso ?? opts.targetLanguageIso
	};

	try {
		let suggested =
			corpusSegments.length > 0
				? await projectService.autoGenerateGlossary(corpusSegments, autoOptions)
				: [];

		if (suggested.length === 0 && untranslatedSources.length > 0) {
			suggested = await projectService.autoGenerateGlossary(
				pseudoSegmentsForGlossarySources(untranslatedSources),
				autoOptions
			);
		}

		let merged =
			suggested.length > 0
				? fillTranslation
					? mergeAutoGlossary(existing, suggested)
					: mergeAutoGlossaryForTranscription(existing, suggested)
				: [...existing];

		const promptHints = parseTranslationHintsFromPrompt(opts.contextPrompt ?? '');
		if (promptHints.length > 0) {
			merged = mergePromptHintsIntoGlossary(merged, promptHints);
		}

		if (fillTranslation) {
			const targetLanguage = (opts.targetLanguage ?? opts.targetLanguageIso).trim();
			const stylePrompt = opts.contextPrompt?.trim() || 'Natural subtitle translation';
			const pending = merged.filter(glossaryEntryNeedsTranslation);
			if (pending.length > 0 && targetLanguage) {
				// translate_glossary_terms делает явную транслитерацию (Griselda -> Гризельда)
				// translate_batch на одиночных словах оставлял имена в латинице
				const termInputs = pending
					.map((e) => ({
						source: e.source.trim(),
						context: e.context?.trim() || null
					}))
					.filter((t) => t.source.length > 0);
				if (termInputs.length > 0) {
					try {
						const termTranslations = await projectService.translateGlossaryTerms(
							termInputs,
							targetLanguage,
							stylePrompt
						);
						const bySource = new Map<string, string>();
						for (const tr of termTranslations) {
							const src = tr.source.trim().toLowerCase();
							const tgt = tr.target.trim();
							if (src && tgt && tgt.toLowerCase() !== src) {
								bySource.set(src, tgt);
							}
						}
						merged = merged.map((e) => {
							const tr = bySource.get(e.source.trim().toLowerCase());
							if (tr && glossaryEntryNeedsTranslation(e)) {
								return { ...e, target: tr };
							}
							return e;
						});
					} catch (err) {
						console.warn('[glossary] translate_glossary_terms failed', err);
					}
				}
			}
		}

		const toSave: ProjectData = {
			...opened,
			glossary: merged,
			updated_at: new Date().toISOString()
		};
		await projectService.save(toSave);
		return toSave;
	} catch (err) {
		console.warn('auto glossary skipped', err);
		return opened;
	}
}
