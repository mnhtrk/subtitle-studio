import type { GlossaryEntry, ProjectData, ProjectFile, SubtitleSegment } from '../services/projectService';
import type { AgentEditScope, AgentIntent } from '../services/agentService';
import type { GlossaryReplacementChange } from '../components/modals/GlossaryModal';

export type { AgentEditScope };

export interface SubtitleFileBundle {
	id: string;
	name: string;
	segments: SubtitleSegment[];
	// пересказ эпизода для агента, генерится через summarize_episode
	summary?: string | null;
}

export function listProjectSubtitleFiles(project: ProjectData | null): SubtitleFileBundle[] {
	if (!project) return [];
	return project.files
		.filter((f) => f.file_type === 'Subtitle')
		.map((f) => ({
			id: f.id,
			name: f.name,
			segments: f.subtitle_segments ?? [],
			summary: f.summary ?? null
		}))
		.filter((f) => f.segments.length > 0);
}

function normalizeTerm(term: string): string {
	return term.trim().toLowerCase();
}

// похоже на водяной знак whisper, не реплика
export function segmentLooksLikeWhisperWatermark(seg: SubtitleSegment): boolean {
	const text = seg.text.trim();
	const tr = (seg.translation ?? '').trim();
	const hay = `${text}\n${tr}`.toLowerCase();
	if (!hay.trim()) return false;
	if (hay.includes('amara.org') || hay.includes('amara.')) return true;
	if (
		hay.includes('subtitles by') ||
		hay.includes('subtitle by') ||
		hay.includes('subtitles created')
	) {
		return true;
	}
	if (hay.includes('субтитр') && (hay.includes('сделан') || hay.includes('сообществ'))) {
		return true;
	}
	const tText = text.toLowerCase();
	if (tText === 'org.' || tText === 'org') return true;
	const tTr = tr.toLowerCase();
	if (tTr === 'org.' || tTr === 'org') return true;
	return false;
}

export function segmentContainsAnyTerm(seg: SubtitleSegment, terms: string[]): boolean {
	if (terms.length === 0) return false;
	const hay = `${seg.text}\n${seg.translation ?? ''}`.toLowerCase();
	return terms.some((t) => {
		const n = normalizeTerm(t);
		return n.length > 0 && hay.includes(n);
	});
}

export function fileContainsAnyTerm(file: SubtitleFileBundle, terms: string[]): boolean {
	if (terms.length === 0) return true;
	return file.segments.some((s) => segmentContainsAnyTerm(s, terms));
}

// bulk replace: в эпизод только если есть старая форма
export function collectTermsFromIntent(intent: AgentIntent): string[] {
	if (intent.task_mode === 'bulk_replace' && intent.replace_from?.trim()) {
		return [intent.replace_from.trim()];
	}
	const terms: string[] = [];
	if (intent.replace_from?.trim()) terms.push(intent.replace_from.trim());
	if (intent.replace_to?.trim()) terms.push(intent.replace_to.trim());
	return [...new Set(terms)];
}

// глоссарий: фильтр эпизодов по старым формулировкам
export function collectGlossaryEpisodeFilterTerms(changes: GlossaryReplacementChange[]): string[] {
	const terms: string[] = [];
	for (const c of changes) {
		if (c.oldSource?.trim()) terms.push(c.oldSource.trim());
		if (c.oldTarget?.trim()) terms.push(c.oldTarget.trim());
	}
	return [...new Set(terms)];
}

export function filterSubtitleFilesForTerms(
	files: SubtitleFileBundle[],
	terms: string[]
): SubtitleFileBundle[] {
	if (terms.length === 0) return files;
	return files.filter((f) => fileContainsAnyTerm(f, terms));
}

export function isProjectWideAgentRequest(text: string): boolean {
	const t = text.toLowerCase();
	return (
		/всех?\s+эпизод|все\s+сери|по\s+всем\s+эпизод|весь\s+проект|во\s+всех\s+эпизод|все\s+файл|кажд(ый|ом)\s+эпизод|all\s+episodes?|entire\s+project|whole\s+project|across\s+(the\s+)?project|every\s+episode/i.test(
			t
		) ||
		/всех?\s+субтит|все\s+реплик|весь\s+(файл|список)|по\s+всем|пройди(сь)?\s+по|пройтись\s+по|исправ(ь|ить)\s+(все|всё)|провер(ь|ить)\s+(все|всё)|кажд(ую|ый)\s+реплик|all\s+subtitle|every\s+subtitle/i.test(
			t
		) ||
		/из\s+проекта|по\s+проекту|в\s+проекте|по\s+всему\s+проекту|across\s+the\s+project/i.test(t) ||
		/галлюцин|whisper|amara\.org|водян(ой|ые)\s+знак|мусорн(ые|ую)\s+вставк|junk\s+subtitle|hallucin/i.test(
			t
		) ||
		/удал(и|ить|яй|ять).*(галлюцин|мусор|whisper|amara)|remove\s+.*hallucin|delete\s+.*hallucin/i.test(t)
	);
}

export function resolveAgentEditScope(params: {
	message: string;
	hasAttachedSegment: boolean;
	intent: AgentIntent;
}): AgentEditScope {
	const { message, hasAttachedSegment, intent } = params;
	if (hasAttachedSegment) return 'active_episode';
	if (isProjectWideAgentRequest(message)) return 'whole_project';
	if (intent.task_mode === 'bulk_replace' || intent.task_mode === 'glossary_sync') {
		return 'whole_project';
	}
	if (intent.task_mode === 'proofread' || intent.task_mode === 'translation_fix') {
		return 'whole_project';
	}
	return 'active_episode';
}

export function subtitleFilesForAgentScope(
	project: ProjectData | null,
	activeSubtitleFileId: string | null,
	scope: AgentEditScope,
	termsFilter: string[] | null
): SubtitleFileBundle[] {
	const all = listProjectSubtitleFiles(project);
	if (all.length === 0) return [];

	let files: SubtitleFileBundle[];
	if (scope === 'whole_project') {
		files = all;
	} else {
		const active = all.find((f) => f.id === activeSubtitleFileId) ?? all[0];
		files = active ? [active] : [];
	}

	if (termsFilter && termsFilter.length > 0) {
		files = filterSubtitleFilesForTerms(files, termsFilter);
	}
	return files;
}

export function findSubtitleFileInProject(
	project: ProjectData | null,
	fileId: string
): ProjectFile | undefined {
	return project?.files.find((f) => f.id === fileId && f.file_type === 'Subtitle');
}

export function intentFromGlossaryChanges(changes: GlossaryReplacementChange[]): AgentIntent {
	const translationPairs = changes
		.filter(
			(c) =>
				c.oldTarget?.trim() &&
				c.newTarget?.trim() &&
				c.oldTarget.trim().toLowerCase() !== c.newTarget.trim().toLowerCase()
		)
		.map((c) => ({ from: c.oldTarget.trim(), to: c.newTarget.trim() }));
	const sourcePairs = changes
		.filter(
			(c) =>
				c.oldSource?.trim() &&
				c.newSource?.trim() &&
				c.oldSource.trim().toLowerCase() !== c.newSource.trim().toLowerCase()
		)
		.map((c) => ({ from: c.oldSource.trim(), to: c.newSource.trim() }));

	const allPairs = [...translationPairs, ...sourcePairs];
	const translationOnly = sourcePairs.length === 0 && translationPairs.length > 0;

	if (allPairs.length === 0) {
		return {
			task_mode: 'glossary_sync',
			replace_from: null,
			replace_to: null,
			translation_only: true,
			replace_pairs: []
		};
	}

	return {
		task_mode: 'glossary_sync',
		replace_from: null,
		replace_to: null,
		translation_only: translationOnly,
		replace_pairs: allPairs
	};
}

export function glossaryEntriesFromChanges(
	changes: GlossaryReplacementChange[],
	current: GlossaryEntry[]
): GlossaryEntry[] {
	const updates: GlossaryEntry[] = [];
	for (const change of changes) {
		for (const entry of current) {
			if (change.oldSource && entry.source.trim() === change.oldSource.trim()) {
				updates.push({
					...entry,
					source: change.newSource ?? entry.source,
					target: change.newTarget ?? entry.target
				});
			} else if (change.oldTarget && entry.target.trim() === change.oldTarget.trim()) {
				updates.push({
					...entry,
					source: change.newSource ?? entry.source,
					target: change.newTarget ?? entry.target
				});
			}
		}
	}
	return updates;
}
