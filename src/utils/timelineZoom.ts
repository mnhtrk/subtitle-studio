export const TIMELINE_ZOOM_MIN = 100;
export const TIMELINE_ZOOM_MAX = 10000;
export const TIMELINE_ZOOM_FACTOR = 1.08;
export const TIMELINE_ZOOM_SLIDER_MIN = 0;
export const TIMELINE_ZOOM_SLIDER_MAX = 1000;

export function clampTimelineZoom(value: number): number {
	if (!Number.isFinite(value)) return TIMELINE_ZOOM_MIN;
	return Math.max(TIMELINE_ZOOM_MIN, Math.min(TIMELINE_ZOOM_MAX, Math.round(value)));
}

export function timelineZoomToSliderValue(zoom: number): number {
	const clamped = clampTimelineZoom(zoom);
	const minLog = Math.log(TIMELINE_ZOOM_MIN);
	const maxLog = Math.log(TIMELINE_ZOOM_MAX);
	const ratio = (Math.log(clamped) - minLog) / (maxLog - minLog);
	return Math.round(TIMELINE_ZOOM_SLIDER_MIN + ratio * (TIMELINE_ZOOM_SLIDER_MAX - TIMELINE_ZOOM_SLIDER_MIN));
}

export function sliderValueToTimelineZoom(slider: number): number {
	const sliderClamped = Math.max(TIMELINE_ZOOM_SLIDER_MIN, Math.min(TIMELINE_ZOOM_SLIDER_MAX, slider));
	const ratio = (sliderClamped - TIMELINE_ZOOM_SLIDER_MIN) / (TIMELINE_ZOOM_SLIDER_MAX - TIMELINE_ZOOM_SLIDER_MIN);
	const minLog = Math.log(TIMELINE_ZOOM_MIN);
	const maxLog = Math.log(TIMELINE_ZOOM_MAX);
	return clampTimelineZoom(Math.exp(minLog + ratio * (maxLog - minLog)));
}

export function timelineZoomToFillPercent(zoom: number): number {
	const sliderValue = timelineZoomToSliderValue(zoom);
	return (
		(sliderValue - TIMELINE_ZOOM_SLIDER_MIN) /
		(TIMELINE_ZOOM_SLIDER_MAX - TIMELINE_ZOOM_SLIDER_MIN)
	) * 100;
}

export function stepTimelineZoom(current: number, direction: 1 | -1): number {
	if (direction > 0) return clampTimelineZoom(current * TIMELINE_ZOOM_FACTOR);
	return clampTimelineZoom(current / TIMELINE_ZOOM_FACTOR);
}
