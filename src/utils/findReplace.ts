import type { SubtitleSegment } from '../services/projectService';

export type FindField = 'text' | 'translation';

export interface FindMatch {
	segmentIndex: number;
	field: FindField;
	start: number;
	end: number;
}

function fieldText(seg: SubtitleSegment, field: FindField): string {
	return field === 'translation' ? seg.translation ?? '' : seg.text;
}

function indexOfNeedle(haystack: string, needle: string, from: number, caseSensitive: boolean): number {
	if (!needle) return -1;
	if (caseSensitive) return haystack.indexOf(needle, from);
	const h = haystack.toLowerCase();
	const n = needle.toLowerCase();
	return h.indexOf(n, from);
}

export function collectFindMatches(
	segments: SubtitleSegment[],
	needle: string,
	caseSensitive: boolean
): FindMatch[] {
	if (!needle.trim()) return [];
	const matches: FindMatch[] = [];
	for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
		const seg = segments[segmentIndex];
		for (const field of ['translation', 'text'] as const) {
			const hay = fieldText(seg, field);
			let from = 0;
			while (from < hay.length) {
				const start = indexOfNeedle(hay, needle, from, caseSensitive);
				if (start < 0) break;
				matches.push({
					segmentIndex,
					field,
					start,
					end: start + needle.length
				});
				from = start + Math.max(1, needle.length);
			}
		}
	}
	return matches;
}

export function applyReplaceAt(
	segments: SubtitleSegment[],
	match: FindMatch,
	replacement: string
): SubtitleSegment[] {
	return segments.map((seg, i) => {
		if (i !== match.segmentIndex) return seg;
		const value = fieldText(seg, match.field);
		const nextValue = value.slice(0, match.start) + replacement + value.slice(match.end);
		if (match.field === 'translation') {
			return { ...seg, translation: nextValue || null };
		}
		return { ...seg, text: nextValue };
	});
}

export function applyReplaceAll(
	segments: SubtitleSegment[],
	needle: string,
	replacement: string,
	caseSensitive: boolean
): SubtitleSegment[] {
	if (!needle) return segments;
	const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const flags = caseSensitive ? 'g' : 'gi';
	const re = new RegExp(escaped, flags);
	return segments.map((seg) => {
		const tr = seg.translation ?? '';
		const text = seg.text;
		const nextTr = tr.replace(re, replacement);
		const nextText = text.replace(re, replacement);
		if (nextTr === tr && nextText === text) return seg;
		return {
			...seg,
			translation: nextTr || null,
			text: nextText
		};
	});
}
