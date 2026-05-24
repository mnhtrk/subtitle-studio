import type { SubtitleSegment } from '../services/projectService';

export const AGENT_NEIGHBOR_RADIUS = 5;

export function formatSpeakerGenderForAgent(gender?: string | null): string {
	if (gender === 'male' || gender === 'female') return gender;
	return 'unknown';
}
export const AGENT_BATCH_SIZE = 40;

// правка всего эпизода - пакетами, при «весь проект» - по файлам
export function isWholeFileAgentRequest(text: string): boolean {
	const t = text.toLowerCase();
	return (
		/всех?\s+субтит|все\s+реплик|весь\s+(файл|эпизод|список)|по\s+всем|пройди(сь)?\s+по|пройтись\s+по|исправ(ь|ить)\s+(все|всё)|провер(ь|ить)\s+(все|всё)|кажд(ую|ый)\s+реплик|all\s+subtitle|every\s+subtitle|entire\s+file/i.test(
			t
		) ||
		/галлюцин|whisper|amara|удал(и|ить).*(галлюцин|мусор)|remove\s+.*hallucin|delete\s+.*hallucin/i.test(t) ||
		/из\s+проекта|по\s+проекту|в\s+проекте|всех?\s+эпизод|весь\s+проект|whole\s+project|entire\s+project/i.test(t)
	);
}

export function chunkSubtitleSegments(
	segs: SubtitleSegment[],
	size: number
): SubtitleSegment[][] {
	if (segs.length === 0) return [];
	const sorted = [...segs].sort((a, b) => {
		if (a.start !== b.start) return a.start - b.start;
		return a.id - b.id;
	});
	const out: SubtitleSegment[][] = [];
	for (let i = 0; i < sorted.length; i += size) {
		out.push(sorted.slice(i, i + size));
	}
	return out;
}
