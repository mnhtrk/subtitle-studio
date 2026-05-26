import type { SubtitleSegment, GlossaryEntry } from '../services/projectService';
import type { AgentIntent } from '../services/agentService';

// подстановка термина в сегментах
export function applyBulkReplaceToSegments(
	segments: SubtitleSegment[],
	from: string,
	to: string,
	translationOnly: boolean
): SubtitleSegment[] {
	const needle = from.trim();
	const replacement = to.trim();
	if (!needle || needle.toLowerCase() === replacement.toLowerCase()) {
		return [];
	}

	const patches: SubtitleSegment[] = [];
	for (const seg of segments) {
		let nextText = seg.text;
		let nextTr = seg.translation ?? '';
		let changed = false;

		if (!translationOnly) {
			const replaced = replaceCaseInsensitive(seg.text, needle, replacement);
			if (replaced !== seg.text) {
				nextText = replaced;
				changed = true;
			}
		}
		if (seg.translation != null) {
			const replaced = replaceCaseInsensitive(seg.translation, needle, replacement);
			if (replaced !== seg.translation) {
				nextTr = replaced;
				changed = true;
			}
		}
		if (changed) {
			patches.push({
				...seg,
				text: nextText,
				translation: seg.translation != null ? nextTr : seg.translation
			});
		}
	}
	return patches;
}

function scriptBucket(s: string): 'latin' | 'cyrillic' | 'other' {
	let latin = 0;
	let cyrillic = 0;
	for (const c of s) {
		const code = c.codePointAt(0) ?? 0;
		if (code >= 0x0400 && code <= 0x04ff) cyrillic++;
		else if (/[A-Za-z]/.test(c)) latin++;
	}
	if (cyrillic > latin && cyrillic > 0) return 'cyrillic';
	if (latin > 0) return 'latin';
	return 'other';
}

export function glossaryUpdatesForBulkReplace(
	from: string,
	to: string,
	glossary: GlossaryEntry[]
): GlossaryEntry[] {
	const f = from.trim();
	const t = to.trim();
	if (!f) return [];
	const crossLang =
		scriptBucket(f) !== scriptBucket(t) &&
		scriptBucket(f) !== 'other' &&
		scriptBucket(t) !== 'other';
	const updates: GlossaryEntry[] = [];
	for (const entry of glossary) {
		const src = entry.source.trim();
		const tgt = entry.target.trim();
		if (crossLang) {
			if (src.toLowerCase() === f.toLowerCase() || tgt.toLowerCase() === f.toLowerCase()) {
				updates.push({ ...entry, target: t });
			}
		} else if (src.toLowerCase() === f.toLowerCase()) {
			updates.push({ ...entry, source: t });
		} else if (tgt.toLowerCase() === f.toLowerCase()) {
			updates.push({ ...entry, target: t });
		}
	}
	return updates;
}

export function agentContextFromIntent(intent: AgentIntent): {
	task_mode: string;
	replace_from?: string | null;
	replace_to?: string | null;
	translation_only?: boolean;
	replace_pairs?: { from: string; to: string }[] | null;
} {
	return {
		task_mode: intent.task_mode,
		replace_from: intent.replace_from ?? null,
		replace_to: intent.replace_to ?? null,
		translation_only: intent.translation_only ?? false,
		replace_pairs: intent.replace_pairs ?? null
	};
}

function replaceCaseInsensitive(haystack: string, from: string, to: string): string {
	const lower = haystack.toLowerCase();
	const fromLower = from.toLowerCase();
	let out = '';
	let pos = 0;
	while (pos < haystack.length) {
		const idx = lower.indexOf(fromLower, pos);
		if (idx < 0) {
			out += haystack.slice(pos);
			break;
		}
		out += haystack.slice(pos, idx) + to;
		pos = idx + from.length;
	}
	return out;
}
