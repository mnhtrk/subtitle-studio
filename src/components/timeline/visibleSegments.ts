import type { SubtitleSegment } from '../../services/projectService';

/** Сегменты, пересекающие [timeStart, timeEnd] (sorted по start). */
export function visibleTimelineSegments(
	sorted: SubtitleSegment[],
	timeStart: number,
	timeEnd: number
): SubtitleSegment[] {
	if (sorted.length === 0 || timeEnd < timeStart) return [];

	let lo = 0;
	let hi = sorted.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid].end < timeStart) lo = mid + 1;
		else hi = mid;
	}

	const out: SubtitleSegment[] = [];
	for (let i = lo; i < sorted.length; i++) {
		const s = sorted[i];
		if (s.start > timeEnd) break;
		out.push(s);
	}
	return out;
}

/** Доля длительности (0…1) под курсором в области скролла таймлайна. */
export function timelineRatioAtClientX(
	clientX: number,
	scrollEl: HTMLElement,
	innerEl: HTMLElement
): number {
	const innerW = innerEl.offsetWidth;
	if (innerW <= 0) return 0;
	const rect = scrollEl.getBoundingClientRect();
	const xInView = Math.max(0, Math.min(scrollEl.clientWidth, clientX - rect.left));
	const xOnInner = scrollEl.scrollLeft + xInView;
	return Math.max(0, Math.min(1, xOnInner / innerW));
}

/** Якорь зума по центру видимой области таймлайна. */
export function timelineRatioAtViewportCenter(
	scrollEl: HTMLElement,
	innerEl: HTMLElement
): number {
	const innerW = innerEl.offsetWidth;
	if (innerW <= 0) return 0;
	const xOnInner = scrollEl.scrollLeft + scrollEl.clientWidth / 2;
	return Math.max(0, Math.min(1, xOnInner / innerW));
}

export function visibleTimeRangeFromScroll(
	scrollLeft: number,
	clientWidth: number,
	innerWidth: number,
	totalDuration: number,
	overscanSec: number
): { start: number; end: number } {
	if (totalDuration <= 0 || innerWidth <= 0) {
		return { start: 0, end: 0 };
	}
	const t0 = (scrollLeft / innerWidth) * totalDuration - overscanSec;
	const t1 = ((scrollLeft + clientWidth) / innerWidth) * totalDuration + overscanSec;
	return {
		start: Math.max(0, t0),
		end: Math.min(totalDuration, t1)
	};
}
