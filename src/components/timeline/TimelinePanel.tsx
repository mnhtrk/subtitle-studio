import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type MutableRefObject,
	type RefObject
} from 'react';
import type { SubtitleSegment } from '../../services/projectService';
import {
	sliderValueToTimelineZoom,
	stepTimelineZoom,
	timelineZoomToFillPercent,
	timelineZoomToSliderValue,
	TIMELINE_ZOOM_SLIDER_MAX,
	TIMELINE_ZOOM_SLIDER_MIN
} from '../../utils/timelineZoom';
import { TimelineWaveform } from './TimelineWaveform';
import {
	timelineRatioAtClientX,
	timelineRatioAtViewportCenter,
	visibleTimelineSegments,
	visibleTimeRangeFromScroll
} from './visibleSegments';

const TIMELINE_ZOOM_BTN_CLASS =
	'flex h-[22px] w-[22px] shrink-0 items-center justify-center border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-primary-main/40';

const TIMELINE_ZOOM_OUT_ICON_CLASS =
	'pointer-events-none inline-block h-[22px] w-[22px] shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/tzoomout:scale-110 group-active/tzoomout:scale-[0.92]';

const TIMELINE_ZOOM_IN_ICON_CLASS =
	'pointer-events-none inline-block h-[22px] w-[22px] shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/tzoomin:scale-110 group-active/tzoomin:scale-[0.92]';

const VISIBLE_OVERSCAN_SEC = 4;

function sidebarIconMaskStyle(src: string): React.CSSProperties {
	return {
		maskImage: `url(${src})`,
		WebkitMaskImage: `url(${src})`,
		maskSize: 'contain',
		maskRepeat: 'no-repeat',
		maskPosition: 'center'
	};
}

export type TimelinePanelProps = {
	wheelRef: RefObject<HTMLDivElement | null>;
	scrollRef: RefObject<HTMLDivElement | null>;
	innerRef: RefObject<HTMLDivElement | null>;
	playheadRef: RefObject<HTMLDivElement | null>;
	scrollbarThumbRef: RefObject<HTMLDivElement | null>;
	timelineTotalDuration: number;
	timelineTotalDurationRef: MutableRefObject<number>;
	segmentsSorted: SubtitleSegment[];
	segmentIndexById: ReadonlyMap<number, number>;
	segmentSortedOrderById: ReadonlyMap<number, number>;
	selectedSegmentIndex: number;
	selectedSegmentIds: ReadonlySet<number>;
	waveformImageSrc: string | null;
	waveformPeaks: number[] | null;
	timelineRangePreview: { a: number; b: number } | null;
	timelineInsertRange: { start: number; end: number } | null;
	minSegmentDuration: number;
	onRangeSelectPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
	onTimelineContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
	onSegmentClick: (
		e: React.MouseEvent<HTMLDivElement>,
		seg: SubtitleSegment,
		idx: number,
		clickTime: number
	) => void;
	beginTimelineEdgeDrag: (edge: 'start' | 'end', idx: number, e: React.MouseEvent) => void;
	beginTimelineSegmentMove: (idx: number, e: React.MouseEvent) => void;
	segmentBodyDragMovedRef: MutableRefObject<boolean>;
	clientXToTimelineTime: (clientX: number) => number;
	iconZoomIn: string;
	iconZoomOut: string;
	zoomOutTitle: string;
	zoomInTitle: string;
	zoomSliderTitle: string;
};

function TimelinePanelInner({
	wheelRef,
	scrollRef,
	innerRef,
	playheadRef,
	scrollbarThumbRef,
	timelineTotalDuration,
	timelineTotalDurationRef,
	segmentsSorted,
	segmentIndexById,
	segmentSortedOrderById,
	selectedSegmentIndex,
	selectedSegmentIds,
	waveformImageSrc,
	waveformPeaks,
	timelineRangePreview,
	timelineInsertRange,
	minSegmentDuration,
	onRangeSelectPointerDown,
	onTimelineContextMenu,
	onSegmentClick,
	beginTimelineEdgeDrag,
	beginTimelineSegmentMove,
	segmentBodyDragMovedRef,
	clientXToTimelineTime,
	iconZoomIn,
	iconZoomOut,
	zoomOutTitle,
	zoomInTitle,
	zoomSliderTitle
}: TimelinePanelProps) {
	const [timelineZoomPercent, setTimelineZoomPercent] = useState(100);
	const zoomRef = useRef(100);
	zoomRef.current = timelineZoomPercent;

	const zoomAnchorRef = useRef<{ ratio: number; scrollLeft: number; innerW: number } | null>(null);
	const zoomRafRef = useRef(0);
	const pendingZoomStepsRef = useRef(0);
	const lastTimelineClientXRef = useRef<number | null>(null);

	const captureZoomAnchor = useCallback(
		(clientX?: number | null) => {
			const scr = scrollRef.current;
			const inner = innerRef.current;
			if (!scr || !inner || inner.offsetWidth <= 0) {
				zoomAnchorRef.current = null;
				return;
			}
			const ratio =
				clientX != null
					? timelineRatioAtClientX(clientX, scr, inner)
					: timelineRatioAtViewportCenter(scr, inner);
			zoomAnchorRef.current = {
				ratio,
				scrollLeft: scr.scrollLeft,
				innerW: inner.offsetWidth
			};
		},
		[scrollRef, innerRef]
	);

	const [visibleSegments, setVisibleSegments] = useState<SubtitleSegment[]>([]);
	const visibleSigRef = useRef('');

	const syncTimelineScrollbarThumb = useCallback(() => {
		const el = scrollRef.current;
		const thumb = scrollbarThumbRef.current;
		if (!el || !thumb) return;
		const sl = el.scrollLeft;
		const sw = el.scrollWidth;
		const cw = el.clientWidth;
		if (!sw || sw <= cw) {
			thumb.style.width = '100%';
			thumb.style.left = '0%';
			return;
		}
		const thumbW = Math.max((cw / sw) * 100, 8);
		const maxScroll = sw - cw;
		const travel = 100 - thumbW;
		thumb.style.width = `${thumbW}%`;
		thumb.style.left = `${(sl / maxScroll) * travel}%`;
	}, [scrollRef, scrollbarThumbRef]);

	const refreshVisibleSegments = useCallback(() => {
		const scr = scrollRef.current;
		const inner = innerRef.current;
		const td = timelineTotalDurationRef.current;
		if (!scr || !inner || td <= 0 || segmentsSorted.length === 0) {
			if (visibleSigRef.current !== 'empty') {
				visibleSigRef.current = 'empty';
				setVisibleSegments([]);
			}
			return;
		}
		const { start, end } = visibleTimeRangeFromScroll(
			scr.scrollLeft,
			scr.clientWidth,
			inner.offsetWidth,
			td,
			VISIBLE_OVERSCAN_SEC
		);
		const next = visibleTimelineSegments(segmentsSorted, start, end);
		const sig = `${start.toFixed(2)}|${end.toFixed(2)}|${next.length}|${next[0]?.id ?? ''}|${next[next.length - 1]?.id ?? ''}`;
		if (sig === visibleSigRef.current) return;
		visibleSigRef.current = sig;
		setVisibleSegments(next);
	}, [scrollRef, innerRef, timelineTotalDurationRef, segmentsSorted]);

	const scheduleVisibleRefresh = useCallback(() => {
		if (visibleRafRef.current) return;
		visibleRafRef.current = requestAnimationFrame(() => {
			visibleRafRef.current = 0;
			refreshVisibleSegments();
		});
	}, [refreshVisibleSegments]);
	const visibleRafRef = useRef(0);

	const applyZoomSteps = useCallback(
		(steps: number) => {
			if (steps === 0) return;
			let z = zoomRef.current;
			const dir: 1 | -1 = steps > 0 ? 1 : -1;
			let remaining = Math.abs(steps);
			while (remaining > 0) {
				const next = stepTimelineZoom(z, dir);
				if (next === z) break;
				z = next;
				remaining -= 1;
			}
			if (z === zoomRef.current) {
				zoomAnchorRef.current = null;
				return;
			}
			setTimelineZoomPercent(z);
		},
		[]
	);

	const flushZoomRaf = useCallback(() => {
		zoomRafRef.current = 0;
		const steps = pendingZoomStepsRef.current;
		pendingZoomStepsRef.current = 0;
		if (steps !== 0) applyZoomSteps(steps);
		requestAnimationFrame(() => syncTimelineScrollbarThumb());
	}, [applyZoomSteps, syncTimelineScrollbarThumb]);

	useEffect(() => {
		const panel = wheelRef.current;
		if (!panel) return;

		const onWheel = (e: WheelEvent) => {
			if (e.altKey) {
				e.preventDefault();
				const dir: 1 | -1 = e.deltaY > 0 ? -1 : 1;
				const scr = scrollRef.current;
				if (scr) {
					const rect = scr.getBoundingClientRect();
					const overTrack =
						e.clientX >= rect.left &&
						e.clientX <= rect.right &&
						e.clientY >= rect.top &&
						e.clientY <= rect.bottom;
					if (overTrack) {
						lastTimelineClientXRef.current = e.clientX;
						captureZoomAnchor(e.clientX);
					} else {
						captureZoomAnchor(lastTimelineClientXRef.current);
					}
				}
				pendingZoomStepsRef.current += dir;
				if (!zoomRafRef.current) {
					zoomRafRef.current = requestAnimationFrame(flushZoomRaf);
				}
				return;
			}
			const scr = scrollRef.current;
			if (!scr) return;
			const scrollDelta =
				Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
			if (scrollDelta === 0) return;
			e.preventDefault();
			scr.scrollLeft += scrollDelta;
			scheduleVisibleRefresh();
			requestAnimationFrame(() => syncTimelineScrollbarThumb());
		};

		panel.addEventListener('wheel', onWheel, { passive: false });
		return () => {
			panel.removeEventListener('wheel', onWheel);
			if (zoomRafRef.current) {
				cancelAnimationFrame(zoomRafRef.current);
				zoomRafRef.current = 0;
			}
		};
	}, [
		wheelRef,
		scrollRef,
		captureZoomAnchor,
		flushZoomRaf,
		scheduleVisibleRefresh,
		syncTimelineScrollbarThumb
	]);

	useEffect(() => {
		const scr = scrollRef.current;
		if (!scr) return;
		const onMove = (e: MouseEvent) => {
			lastTimelineClientXRef.current = e.clientX;
		};
		scr.addEventListener('mousemove', onMove, { passive: true });
		return () => scr.removeEventListener('mousemove', onMove);
	}, [scrollRef]);

	useLayoutEffect(() => {
		const a = zoomAnchorRef.current;
		if (!a) return;
		zoomAnchorRef.current = null;
		const scr = scrollRef.current;
		const inner = innerRef.current;
		if (!scr || !inner) return;
		const wAfter = inner.offsetWidth;
		const sNew = a.ratio * wAfter - (a.ratio * a.innerW - a.scrollLeft);
		const maxSl = Math.max(0, scr.scrollWidth - scr.clientWidth);
		scr.scrollLeft = Math.max(0, Math.min(sNew, maxSl));
		syncTimelineScrollbarThumb();
		scheduleVisibleRefresh();
	}, [timelineZoomPercent, scrollRef, innerRef, syncTimelineScrollbarThumb, scheduleVisibleRefresh]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		let raf = 0;
		const schedule = () => {
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				syncTimelineScrollbarThumb();
				scheduleVisibleRefresh();
			});
		};
		el.addEventListener('scroll', schedule, { passive: true });
		schedule();
		return () => {
			el.removeEventListener('scroll', schedule);
			if (raf) cancelAnimationFrame(raf);
		};
	}, [scrollRef, syncTimelineScrollbarThumb, scheduleVisibleRefresh]);

	useLayoutEffect(() => {
		visibleSigRef.current = '';
		scheduleVisibleRefresh();
		requestAnimationFrame(() => syncTimelineScrollbarThumb());
	}, [
		timelineZoomPercent,
		segmentsSorted,
		timelineTotalDuration,
		scheduleVisibleRefresh,
		syncTimelineScrollbarThumb
	]);

	const handleTimelineScrubPointerDown = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			e.preventDefault();
			const bar = e.currentTarget;
			const el = scrollRef.current;
			if (!el) return;
			let moveRaf = 0;
			const apply = (clientX: number) => {
				const maxScroll = el.scrollWidth - el.clientWidth;
				if (maxScroll <= 0) return;
				const rect = bar.getBoundingClientRect();
				const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
				el.scrollLeft = ratio * maxScroll;
				if (moveRaf) return;
				moveRaf = requestAnimationFrame(() => {
					moveRaf = 0;
					syncTimelineScrollbarThumb();
					scheduleVisibleRefresh();
				});
			};
			apply(e.clientX);
			const onMove = (ev: MouseEvent) => apply(ev.clientX);
			const onUp = () => {
				if (moveRaf) cancelAnimationFrame(moveRaf);
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
				syncTimelineScrollbarThumb();
				scheduleVisibleRefresh();
			};
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		},
		[scrollRef, syncTimelineScrollbarThumb, scheduleVisibleRefresh]
	);

	const rangeOverlay = useMemo(() => {
		const td = timelineTotalDuration;
		if (td <= 0) return null;
		if (timelineRangePreview) {
			const lo = Math.min(timelineRangePreview.a, timelineRangePreview.b);
			const hi = Math.max(timelineRangePreview.a, timelineRangePreview.b);
			const left = (lo / td) * 100;
			const w = Math.max(((hi - lo) / td) * 100, 0.04);
			return (
				<div
					className="absolute top-0 bottom-0 z-[8] rounded-sm bg-primary-main/30 pointer-events-none"
					style={{ left: `${left}%`, width: `${w}%` }}
				/>
			);
		}
		if (
			timelineInsertRange &&
			timelineInsertRange.end - timelineInsertRange.start >= minSegmentDuration
		) {
			const { start: rs, end: re } = timelineInsertRange;
			const left = (rs / td) * 100;
			const w = ((re - rs) / td) * 100;
			return (
				<div
					className="absolute top-0 bottom-0 z-[8] rounded-sm bg-primary-main/25 pointer-events-none"
					style={{ left: `${left}%`, width: `${w}%` }}
				/>
			);
		}
		return null;
	}, [timelineTotalDuration, timelineRangePreview, timelineInsertRange, minSegmentDuration]);

	const segmentsToRender =
		visibleSegments.length > 0 || segmentsSorted.length === 0
			? visibleSegments
			: segmentsSorted;

	const divRef = (r: RefObject<HTMLDivElement | null>) => r as React.Ref<HTMLDivElement>;

	return (
		<div
			ref={divRef(wheelRef)}
			className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-surface-panel p-3"
		>
			<div
				ref={divRef(scrollRef)}
				className="timeline-pan-no-scrollbar relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-md border border-black bg-[#121212] shadow-inner group [overflow-anchor:none]"
			>
				<div
					ref={divRef(innerRef)}
					className="relative h-full min-h-0 select-none [contain:layout_style]"
					style={{ width: `${Math.max(100, timelineZoomPercent)}%` }}
					onPointerDown={onRangeSelectPointerDown}
					onContextMenu={onTimelineContextMenu}
				>
					<div
						className="absolute inset-0 opacity-10 pointer-events-none"
						style={{
							backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
							backgroundSize: '20px 20px'
						}}
					/>
					{rangeOverlay}

					{waveformImageSrc ? (
						<div
							key={waveformImageSrc}
							className="absolute inset-x-0 top-2 bottom-2 z-[5] overflow-hidden pointer-events-none"
						>
							<img
								src={waveformImageSrc}
								alt=""
								draggable={false}
								className="h-full w-full min-h-0 select-none object-fill opacity-95 [image-rendering:pixelated]"
								style={{ imageRendering: 'pixelated' }}
							/>
						</div>
					) : (
						<TimelineWaveform
							peaks={waveformPeaks}
							className="absolute inset-x-0 top-2 bottom-2 z-[5] w-full min-w-0 opacity-95 pointer-events-none"
						/>
					)}

					<div className="absolute inset-0 flex items-stretch pointer-events-none">
						{segmentsToRender.map((seg) => {
							const idx = segmentIndexById.get(seg.id) ?? -1;
							if (idx < 0) return null;
							const orderIdx = segmentSortedOrderById.get(seg.id) ?? idx;
							const left = (seg.start / timelineTotalDuration) * 100;
							const w = Math.max(
								0,
								((seg.end - seg.start) / timelineTotalDuration) * 100
							);
							const isSel = idx === selectedSegmentIndex;
							const isMultiSel = selectedSegmentIds.has(seg.id);
							const tr = seg.translation?.trim() ?? '';
							return (
								<div
									key={seg.id}
									data-tl-segment
									className={`absolute top-0 z-[11] h-full flex flex-col justify-between pointer-events-auto cursor-pointer ${
										isMultiSel
											? 'border-x-2 border-primary-main bg-primary-main/20'
											: `border-x border-[#A3E635] ${isSel ? 'bg-surface-secondary/10' : 'bg-surface-secondary/5'}`
									}`}
									style={{ left: `${left}%`, width: `${w}%` }}
									onClick={(e) => {
										if ((e.target as HTMLElement).closest('[data-tl-edge]')) return;
										if (segmentBodyDragMovedRef.current) {
											segmentBodyDragMovedRef.current = false;
											return;
										}
										e.stopPropagation();
										onSegmentClick(e, seg, idx, clientXToTimelineTime(e.clientX));
									}}
								>
									<div
										data-tl-body
										className="relative z-[10] flex flex-col justify-between p-2 min-h-0 flex-1 min-w-0 cursor-grab active:cursor-grabbing"
										onMouseDown={(e) => beginTimelineSegmentMove(idx, e)}
									>
										<span className="text-[12px] font-bold font-inter text-white/85 truncate">
											{tr || '\u00A0'}
										</span>
										<div className="text-[12px] font-bold font-inter text-white/70 truncate min-w-0 w-full shrink tabular-nums">
											#{orderIdx + 1} {seg.duration.toFixed(2)}s
										</div>
									</div>
									<div
										data-tl-edge="start"
										className="absolute left-0 top-0 bottom-0 w-2 z-[35] cursor-ew-resize hover:bg-white/25"
										onMouseDown={(e) => beginTimelineEdgeDrag('start', idx, e)}
									/>
									<div
										data-tl-edge="end"
										className="absolute right-0 top-0 bottom-0 w-2 z-[35] cursor-ew-resize hover:bg-white/25"
										onMouseDown={(e) => beginTimelineEdgeDrag('end', idx, e)}
									/>
								</div>
							);
						})}
						<div
							ref={divRef(playheadRef)}
							className="absolute top-0 bottom-0 w-px bg-primary-main z-20 pointer-events-none will-change-[left]"
							style={{ left: '0%' }}
						/>
					</div>
				</div>
			</div>

			<div className="flex shrink-0 items-center gap-[24px]">
				<div className="flex items-center gap-3">
					<button
						type="button"
						title={zoomOutTitle}
						aria-label={zoomOutTitle}
						className={`group/tzoomout ${TIMELINE_ZOOM_BTN_CLASS}`}
						onClick={() => {
							captureZoomAnchor(lastTimelineClientXRef.current);
							setTimelineZoomPercent((z) => stepTimelineZoom(z, -1));
						}}
					>
						<span
							className={TIMELINE_ZOOM_OUT_ICON_CLASS}
							style={sidebarIconMaskStyle(iconZoomOut)}
							aria-hidden
						/>
					</button>

					<input
						type="range"
						min={TIMELINE_ZOOM_SLIDER_MIN}
						max={TIMELINE_ZOOM_SLIDER_MAX}
						step={1}
						aria-label={zoomSliderTitle}
						title={zoomSliderTitle}
						className="timeline-zoom-slider h-[22px] w-[160px] cursor-pointer"
						style={
							{
								'--timeline-zoom-fill': `${timelineZoomToFillPercent(timelineZoomPercent)}%`
							} as React.CSSProperties
						}
						value={timelineZoomToSliderValue(timelineZoomPercent)}
						onPointerDown={() => captureZoomAnchor(lastTimelineClientXRef.current)}
						onChange={(e) => {
							captureZoomAnchor(lastTimelineClientXRef.current);
							const slider = Number(e.target.value);
							setTimelineZoomPercent(sliderValueToTimelineZoom(slider));
						}}
					/>

					<button
						type="button"
						title={zoomInTitle}
						aria-label={zoomInTitle}
						className={`group/tzoomin ${TIMELINE_ZOOM_BTN_CLASS}`}
						onClick={() => {
							captureZoomAnchor(lastTimelineClientXRef.current);
							setTimelineZoomPercent((z) => stepTimelineZoom(z, 1));
						}}
					>
						<span
							className={TIMELINE_ZOOM_IN_ICON_CLASS}
							style={sidebarIconMaskStyle(iconZoomIn)}
							aria-hidden
						/>
					</button>
				</div>

				<div
					className="relative h-[4px] min-w-0 flex-1 cursor-pointer overflow-hidden rounded-full bg-border-default"
					onMouseDown={handleTimelineScrubPointerDown}
				>
					<div
						ref={divRef(scrollbarThumbRef)}
						className="absolute top-0 h-full rounded-full bg-primary-disabled"
						style={{ width: '100%', left: '0%' }}
					/>
				</div>
			</div>
		</div>
	);
}

export const TimelinePanel = memo(TimelinePanelInner);
