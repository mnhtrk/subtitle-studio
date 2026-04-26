import type { SubtitleSegment } from '../services/projectService';

function sortAndRenumberSubtitleIds(segments: SubtitleSegment[]): SubtitleSegment[] {
	const sorted = [...segments].sort((a, b) => {
		if (a.start !== b.start) return a.start - b.start;
		return a.id - b.id;
	});
	return sorted.map((s, i) => ({ ...s, id: i + 1 }));
}

/** Как в Rust `insert_subtitle_segment`: вставка пустого блока и перенумерация id 1..n по времени. */
export function insertEmptySegment(
	segments: SubtitleSegment[],
	start: number,
	end: number
): { segments: SubtitleSegment[]; insertedId: number } {
	const duration = end - start;
	const next: SubtitleSegment[] = [
		...segments,
		{
			id: 0,
			start,
			end,
			duration,
			text: '',
			translation: null
		}
	];
	const renumbered = sortAndRenumberSubtitleIds(next);
	const inserted = renumbered.find(
		(s) => Math.abs(s.start - start) < 1e-6 && Math.abs(s.end - end) < 1e-6
	);
	if (!inserted) {
		throw new Error('insertEmptySegment: could not find inserted segment');
	}
	return { segments: renumbered, insertedId: inserted.id };
}

/** Как в Rust `delete_subtitle_segment`. */
export function deleteSegmentById(segments: SubtitleSegment[], segmentId: number): SubtitleSegment[] {
	return sortAndRenumberSubtitleIds(segments.filter((s) => s.id !== segmentId));
}

/** Разрез одного сегмента по времени splitTime; текст/перевод копируются во вторую часть. */
export function splitSegmentAt(
	segments: SubtitleSegment[],
	index: number,
	splitTime: number
): SubtitleSegment[] {
	const seg = segments[index];
	if (!seg) throw new Error('splitSegmentAt: invalid index');
	const origEnd = seg.end;
	const first: SubtitleSegment = {
		...seg,
		end: splitTime,
		duration: Math.max(0, splitTime - seg.start)
	};
	const second: SubtitleSegment = {
		...seg,
		id: 0,
		start: splitTime,
		end: origEnd,
		duration: Math.max(0, origEnd - splitTime)
	};
	const without = segments.filter((_, i) => i !== index);
	return sortAndRenumberSubtitleIds([...without, first, second]);
}
