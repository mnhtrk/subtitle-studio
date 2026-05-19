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

function termContextLabel(t: GlossaryTermGenerated): string {
	const cat = (t.category ?? '').trim();
	const conf = Math.round(t.confidence * 100);
	return cat.length > 0 ? `auto ${conf}% (${cat})` : `auto ${conf}%`;
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

/** «Fonterossa as Red fountain», «перевести X как Y» и т.п. из промпта мастера */
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
	glossary: GlossaryEntry[]
): string | undefined {
	const manual = userPrompt.trim();
	const glossaryOriginals = glossary
		.map((e) => e.source.trim())
		.filter(Boolean)
		.filter((value, index, arr) => arr.findIndex((x) => x.toLowerCase() === value.toLowerCase()) === index);

	if (manual.length > 0) {
		if (glossaryOriginals.length === 0) return manual;
		return `${manual}\n\nImportant names/terms to keep exactly:\n${glossaryOriginals.join(', ')}`;
	}

	if (glossaryOriginals.length === 0) return undefined;
	return `Important names/terms to keep exactly:\n${glossaryOriginals.join(', ')}`;
}

export async function applyAutoGlossaryToProject(
	projectPath: string,
	segments: SubtitleSegment[],
	opts: {
		targetLanguageIso: string;
		targetLanguage?: string;
		contextPrompt?: string;
		fillTranslation?: boolean;
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
		contextPrompt
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
				const sources = pending.map((e) => e.source.trim()).filter(Boolean);
				const termSegments = pseudoSegmentsForGlossarySources(sources);
				if (termSegments.length > 0) {
					const termTranslations = await projectService.translateBatch(
						termSegments,
						targetLanguage,
						stylePrompt,
						merged
					);
					const byId = new Map(termTranslations.map((t) => [t.id, t.translated_text.trim()]));
					const bySource = new Map<string, string>();
					for (let i = 0; i < sources.length; i++) {
						const tr =
							byId.get(i * 2 + 1) ||
							byId.get(i * 2 + 2) ||
							'';
						if (tr) bySource.set(sources[i].toLowerCase(), tr);
					}
					merged = merged.map((e) => {
						const tr = bySource.get(e.source.trim().toLowerCase());
						if (tr && glossaryEntryNeedsTranslation(e)) {
							return { ...e, target: tr };
						}
						return e;
					});
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
