import { invoke } from '@tauri-apps/api/core';
import nspell from 'nspell';
import type { Locale } from '../i18n';
import type { SubtitleSegment } from '../services/projectService';

import enAffUrl from '../../node_modules/dictionary-en/index.aff?url';
import enDicUrl from '../../node_modules/dictionary-en/index.dic?url';
import ruAffUrl from '../../node_modules/dictionary-ru/index.aff?url';
import ruDicUrl from '../../node_modules/dictionary-ru/index.dic?url';

export type SpellField = 'translation';

export interface SpellIssue {
	segmentIndex: number;
	field: SpellField;
	word: string;
	offset: number;
	length: number;
}

export interface SpellCheckers {
	en: ReturnType<typeof nspell>;
	ru: ReturnType<typeof nspell>;
}

export type SpellScanProgress = {
	done: number;
	total: number;
	found: number;
};

const WORD_RE = /[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu;
const SCAN_CHUNK_SIZE = 20;
const MIN_TYPO_DISTANCE = 1;
const BASE_MAX_TYPO_DISTANCE = 4;

let cachedCheckers: SpellCheckers | null = null;

function spellLog(message: string) {
	const line = `[spellcheck] ${message}`;
	console.log(line);
	void invoke('log_message', { level: 'info', message: line, context: null }).catch(() => {
		/* веб без Tauri */
	});
}

function yieldToMain(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	const prev = new Array<number>(n + 1);
	const curr = new Array<number>(n + 1);
	for (let j = 0; j <= n; j++) prev[j] = j;
	for (let i = 1; i <= m; i++) {
		curr[0] = i;
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
		}
		for (let j = 0; j <= n; j++) prev[j] = curr[j];
	}
	return prev[n];
}

function maxTypoDistance(word: string): number {
	return Math.min(8, Math.max(BASE_MAX_TYPO_DISTANCE, Math.ceil(word.length * 0.45)));
}

function decodeDictionaryBytes(buf: ArrayBuffer): string {
	return new TextDecoder('utf-8').decode(buf);
}

async function fetchDictionary(affUrl: string, dicUrl: string): Promise<{ aff: string; dic: string }> {
	const [affRes, dicRes] = await Promise.all([fetch(affUrl), fetch(dicUrl)]);
	if (!affRes.ok || !dicRes.ok) {
		throw new Error(`dictionary fetch failed: aff=${affRes.status} dic=${dicRes.status}`);
	}
	const [affBuf, dicBuf] = await Promise.all([affRes.arrayBuffer(), dicRes.arrayBuffer()]);
	if (affBuf.byteLength < 100 || dicBuf.byteLength < 100) {
		throw new Error('dictionary files are empty or corrupt');
	}
	return {
		aff: decodeDictionaryBytes(affBuf),
		dic: decodeDictionaryBytes(dicBuf)
	};
}

function assertDictionariesWork(checkers: SpellCheckers) {
	if (!spellAccepts(checkers.en, 'subtitle') && !spellAccepts(checkers.en, 'hello')) {
		throw new Error('English dictionary did not load correctly');
	}
	if (!spellAccepts(checkers.ru, 'субтитр') && !spellAccepts(checkers.ru, 'привет')) {
		throw new Error('Russian dictionary did not load correctly');
	}
}

export async function loadSpellCheckers(): Promise<SpellCheckers> {
	if (cachedCheckers) return cachedCheckers;
	spellLog('loading dictionaries (en + ru)…');
	const t0 = performance.now();
	const [enDict, ruDict] = await Promise.all([
		fetchDictionary(enAffUrl, enDicUrl),
		fetchDictionary(ruAffUrl, ruDicUrl)
	]);
	cachedCheckers = {
		en: nspell(enDict),
		ru: nspell(ruDict)
	};
	assertDictionariesWork(cachedCheckers);
	spellLog(`dictionaries ready in ${Math.round(performance.now() - t0)} ms`);
	return cachedCheckers;
}

function translationText(seg: SubtitleSegment): string {
	return (seg.translation ?? '').trim();
}

type WordScript = 'latin' | 'cyrillic' | 'other';

function wordScript(word: string): WordScript {
	let latin = 0;
	let cyrillic = 0;
	for (const ch of word) {
		if (/[\p{Script=Cyrillic}]/u.test(ch)) cyrillic++;
		else if (/[A-Za-z]/.test(ch)) latin++;
	}
	if (latin > 0 && cyrillic === 0) return 'latin';
	if (cyrillic > 0 && latin === 0) return 'cyrillic';
	return 'other';
}

function isCheckableWord(word: string): boolean {
	if (word.length < 2) return false;
	if (/^\d+$/.test(word)) return false;
	if (!/[\p{L}\p{M}]/u.test(word)) return false;
	if (/^[A-ZА-ЯЁ]{2,}$/.test(word)) return false;
	return true;
}

function spellAccepts(spell: ReturnType<typeof nspell>, word: string): boolean {
	if (spell.correct(word)) return true;
	const lower = word.toLocaleLowerCase();
	if (lower !== word && spell.correct(lower)) return true;
	if (word.length > 1) {
		const title = lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
		if (spell.correct(title)) return true;
	}
	return false;
}

function pickSpellsForWord(checkers: SpellCheckers, word: string): ReturnType<typeof nspell>[] {
	const script = wordScript(word);
	if (script === 'latin') return [checkers.en];
	if (script === 'cyrillic') return [checkers.ru];
	return [checkers.en, checkers.ru];
}

/** Сохранить регистр исходного слова в подсказке. */
export function applySuggestionCasing(original: string, suggestion: string): string {
	if (!suggestion) return suggestion;
	const hasLetters = /[\p{L}]/u.test(original);
	if (hasLetters && original === original.toUpperCase()) {
		return suggestion.toUpperCase();
	}
	if (
		hasLetters &&
		original.length > 0 &&
		original[0] === original[0].toUpperCase() &&
		original.slice(1) === original.slice(1).toLowerCase()
	) {
		return suggestion.charAt(0).toUpperCase() + suggestion.slice(1).toLowerCase();
	}
	return suggestion;
}

/** Все подсказки hunspell, отсортированные по близости к слову. */
export function rankSpellSuggestions(
	spell: ReturnType<typeof nspell>,
	word: string,
	limit = 8
): string[] {
	if (spellAccepts(spell, word)) return [];

	const lower = word.toLocaleLowerCase();
	const seen = new Set<string>();
	const scored: { sug: string; dist: number }[] = [];
	const inputs = lower !== word ? [word, lower] : [word];

	for (const input of inputs) {
		for (const sug of spell.suggest(input)) {
			const sl = sug.toLocaleLowerCase();
			if (sl === lower || seen.has(sl)) continue;
			seen.add(sl);
			scored.push({ sug, dist: levenshtein(lower, sl) });
		}
	}

	scored.sort((a, b) => a.dist - b.dist || a.sug.localeCompare(b.sug));
	return scored.map((s) => s.sug).slice(0, limit);
}

function bestTypoSuggestion(spell: ReturnType<typeof nspell>, word: string): string | null {
	if (spellAccepts(spell, word)) return null;

	const ranked = rankSpellSuggestions(spell, word, 12);
	if (ranked.length === 0) return null;

	const lower = word.toLocaleLowerCase();
	const maxDist = maxTypoDistance(word);

	for (const sug of ranked) {
		const dist = levenshtein(lower, sug.toLocaleLowerCase());
		if (dist >= MIN_TYPO_DISTANCE && dist <= maxDist) {
			return sug;
		}
	}

	// Словарь уверенно предлагает замену, но расстояние чуть больше порога — берём лучшую.
	return ranked[0];
}

function isLikelyTypo(checkers: SpellCheckers, word: string): boolean {
	if (!isCheckableWord(word)) return false;
	return pickSpellsForWord(checkers, word).some((s) => bestTypoSuggestion(s, word) !== null);
}

function collectTranslationIssuesForSegment(
	seg: SubtitleSegment,
	segmentIndex: number,
	checkers: SpellCheckers,
	issues: SpellIssue[]
): void {
	const content = translationText(seg);
	if (!content) return;

	WORD_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = WORD_RE.exec(content)) !== null) {
		const word = match[0];
		if (!isLikelyTypo(checkers, word)) continue;
		issues.push({
			segmentIndex,
			field: 'translation',
			word,
			offset: match.index,
			length: word.length
		});
	}
}

export function collectSpellIssues(segments: SubtitleSegment[], checkers: SpellCheckers): SpellIssue[] {
	const issues: SpellIssue[] = [];
	for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
		collectTranslationIssuesForSegment(segments[segmentIndex], segmentIndex, checkers, issues);
	}
	return issues;
}

export async function scanSubtitleSpellIssues(
	segments: SubtitleSegment[],
	_locale: Locale,
	onProgress?: (progress: SpellScanProgress) => void
): Promise<SpellIssue[]> {
	const total = segments.length;
	spellLog(`scan start: ${total} subtitle lines (translation only)`);
	const checkers = await loadSpellCheckers();
	const issues: SpellIssue[] = [];
	const t0 = performance.now();

	for (let start = 0; start < total; start += SCAN_CHUNK_SIZE) {
		const end = Math.min(start + SCAN_CHUNK_SIZE, total);
		for (let i = start; i < end; i++) {
			collectTranslationIssuesForSegment(segments[i], i, checkers, issues);
		}
		const progress = { done: end, total, found: issues.length };
		onProgress?.(progress);
		spellLog(`progress ${end}/${total}, typos found: ${issues.length}`);
		await yieldToMain();
	}

	spellLog(`scan done in ${Math.round(performance.now() - t0)} ms, ${issues.length} typo(s)`);
	return issues;
}

export function getIssueLineText(segments: SubtitleSegment[], issue: SpellIssue): string {
	return segments[issue.segmentIndex].translation ?? '';
}

export function applyWordReplacement(
	segments: SubtitleSegment[],
	issue: SpellIssue,
	replacement: string
): SubtitleSegment[] {
	return segments.map((seg, i) => {
		if (i !== issue.segmentIndex) return seg;
		const current = getIssueLineText(segments, issue);
		const nextText =
			current.slice(0, issue.offset) + replacement + current.slice(issue.offset + issue.length);
		return { ...seg, translation: nextText };
	});
}

export function applyFieldText(
	segments: SubtitleSegment[],
	issue: SpellIssue,
	nextLine: string
): SubtitleSegment[] {
	return segments.map((seg, i) => {
		if (i !== issue.segmentIndex) return seg;
		return { ...seg, translation: nextLine };
	});
}

export function firstSuggestion(checkers: SpellCheckers, word: string): string {
	for (const spell of pickSpellsForWord(checkers, word)) {
		const sug = bestTypoSuggestion(spell, word);
		if (sug) return applySuggestionCasing(word, sug);
		const ranked = rankSpellSuggestions(spell, word, 1);
		if (ranked[0]) return applySuggestionCasing(word, ranked[0]);
	}
	return word;
}
