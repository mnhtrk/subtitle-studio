import { useCallback, useEffect, useRef, useState } from 'react';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';

import {
	MAIN_WINDOW_LABEL,
	VIEWER_CMD_MUTE_TOGGLE,
	VIEWER_CMD_PLAY_PAUSE,
	VIEWER_CMD_SEEK,
	VIEWER_CMD_STOP,
	VIEWER_CMD_VOLUME,
	VIEWER_EVENT_OVERLAY,
	VIEWER_EVENT_READY,
	VIEWER_EVENT_SEEK,
	VIEWER_EVENT_STATE,
	VIEWER_EVENT_TICK,
	type ViewerLabels,
	type ViewerOverlayPayload,
	type ViewerSeekCmdPayload,
	type ViewerSeekPayload,
	type ViewerStatePayload,
	type ViewerTickPayload,
	type ViewerVolumeCmdPayload
} from '../../utils/dualMonitorTypes';
import { formatPlaybackClock } from '../../utils/playbackClock';
import { sidebarIconMaskStyle } from '../../utils/iconMask';

import {
	iconPause as iconPauseSvg,
	iconPlay as iconPlaySvg,
	iconStop as iconStopSvg,
	iconVolume as iconVolumeSvg,
	iconVolumeMute as iconVolumeMuteSvg
} from '../../assets/iconUrls';

const DEFAULT_LABELS: ViewerLabels = {
	preparing: 'Preparing playback...',
	preview: 'Video Preview',
	play: 'Play',
	pause: 'Pause',
	stop: 'Stop',
	mute: 'Mute',
	unmute: 'Unmute',
	emptyTitle: 'Subtitle Studio · Video'
};

const VIDEO_CTRL_BTN_CLASS =
	'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-primary-main/40 disabled:pointer-events-none disabled:opacity-40';

const VIDEO_CTRL_ICON =
	'pointer-events-none inline-block h-6 w-6 shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/vbtn:scale-110 group-active/vbtn:scale-[0.92]';

// порог дрейфа после которого тянем время
const DRIFT_SNAP_THRESHOLD_S = 0.35;
// порог для жёсткого сика
const SEEK_HARD_THRESHOLD_S = 0.05;

function emitMain(event: string, payload?: unknown) {
	void emitTo(MAIN_WINDOW_LABEL, event, payload);
}

export function ViewerWindow() {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const translationOverlayRef = useRef<HTMLSpanElement | null>(null);
	const originalOverlayRef = useRef<HTMLSpanElement | null>(null);
	const progressFillRef = useRef<HTMLDivElement | null>(null);
	const clockRef = useRef<HTMLSpanElement | null>(null);
	const volumeFillRef = useRef<HTMLDivElement | null>(null);

	const durationRef = useRef(0);
	const timeRef = useRef(0);
	const volumeRef = useRef(1);
	const mutedRef = useRef(false);
	const sourceKeyRef = useRef<string | null>(null);
	const wantPlayingRef = useRef(false);
	const playingRef = useRef(false);

	const [src, setSrc] = useState<string | null>(null);
	const [sourceKey, setSourceKey] = useState<string | null>(null);
	const [labels, setLabels] = useState<ViewerLabels>(DEFAULT_LABELS);
	const [playing, setPlaying] = useState(false);
	const [muted, setMuted] = useState(false);
	const [volume, setVolume] = useState(1);
	const [duration, setDuration] = useState(0);
	const [time, setTime] = useState(0);
	const [showOriginal, setShowOriginal] = useState(true);
	const [preparing, setPreparing] = useState(false);
	const [hasState, setHasState] = useState(false);

	const setOverlay = useCallback((translation: string, original: string, showOrig: boolean) => {
		const tr = translationOverlayRef.current;
		if (tr) tr.textContent = translation.trim() || '\u00A0';
		const orig = originalOverlayRef.current;
		if (orig) orig.textContent = showOrig ? original.trim() || '\u00A0' : '\u00A0';
	}, []);

	const applyTimeToUi = useCallback((t: number, dur: number) => {
		const ratio = dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 0;
		const fill = progressFillRef.current;
		if (fill) fill.style.width = `${ratio * 100}%`;
		const clock = clockRef.current;
		if (clock) clock.textContent = formatPlaybackClock(t);
	}, []);

	const applyVolumeToUi = useCallback((v: number) => {
		const fill = volumeFillRef.current;
		if (fill) fill.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
	}, []);

	const hardSeekTo = useCallback((t: number) => {
		const v = videoRef.current;
		if (!v) return;
		const target = Math.max(0, t);
		try {
			if (typeof v.fastSeek === 'function') {
				v.fastSeek(target);
			} else {
				v.currentTime = target;
			}
		} catch {
			try {
				v.currentTime = target;
			} catch {
				/* noop */
			}
		}
	}, []);

	const applyPlayingTarget = useCallback((isPlaying: boolean) => {
		wantPlayingRef.current = isPlaying;
		const v = videoRef.current;
		if (!v) return;
		if (isPlaying && v.paused) {
			void v.play().catch(() => {});
		} else if (!isPlaying && !v.paused) {
			try {
				v.pause();
			} catch {
				/* noop */
			}
		}
	}, []);

	useEffect(() => {
		const unlisteners: UnlistenFn[] = [];
		let cancelled = false;

		void (async () => {
			const u1 = await listen<ViewerStatePayload>(VIEWER_EVENT_STATE, (event) => {
				const p = event.payload;
				setHasState(true);
				setLabels(p.labels);
				setShowOriginal(p.showOriginal);
				setPreparing(p.preparing);
				setDuration(p.duration || 0);
				durationRef.current = p.duration || 0;
				setTime(p.time || 0);
				timeRef.current = p.time || 0;
				setVolume(p.volume);
				volumeRef.current = p.volume;
				setMuted(p.muted);
				mutedRef.current = p.muted;
				setPlaying(p.playing);
				playingRef.current = p.playing;
				applyTimeToUi(p.time || 0, p.duration || 0);
				applyVolumeToUi(p.volume);
				setOverlay(p.overlay.translation, p.overlay.original, p.showOriginal);

				if (p.labels.emptyTitle) {
					document.title = p.labels.emptyTitle;
				}

				const srcChanged = sourceKeyRef.current !== p.sourceKey;
				if (srcChanged) {
					sourceKeyRef.current = p.sourceKey;
					setSourceKey(p.sourceKey);
					setSrc(p.src);
					wantPlayingRef.current = p.playing;
					return;
				}

				const v = videoRef.current;
				if (v) {
					v.volume = p.volume;
					v.muted = p.muted;
					const cur = Number.isFinite(v.currentTime) ? v.currentTime : 0;
					if (Math.abs(cur - (p.time || 0)) > SEEK_HARD_THRESHOLD_S) {
						hardSeekTo(p.time || 0);
					}
				}
				applyPlayingTarget(p.playing);
			});
			const u2 = await listen<ViewerTickPayload>(VIEWER_EVENT_TICK, (event) => {
				const { time: t, duration: dur, playing: isPlaying } = event.payload;
				if (dur && dur !== durationRef.current) {
					durationRef.current = dur;
					setDuration(dur);
				}
				timeRef.current = t;
				applyTimeToUi(t, dur || durationRef.current || 0);
				const v = videoRef.current;
				if (v) {
					const cur = Number.isFinite(v.currentTime) ? v.currentTime : 0;
					if (Math.abs(cur - t) > DRIFT_SNAP_THRESHOLD_S) {
						hardSeekTo(t);
					}
				}
				if (playingRef.current !== isPlaying) {
					playingRef.current = isPlaying;
					setPlaying(isPlaying);
				}
				applyPlayingTarget(isPlaying);
			});
			const u3 = await listen<ViewerOverlayPayload>(VIEWER_EVENT_OVERLAY, (event) => {
				setShowOriginal(event.payload.showOriginal);
				setOverlay(event.payload.translation, event.payload.original, event.payload.showOriginal);
			});
			const u4 = await listen<ViewerSeekPayload>(VIEWER_EVENT_SEEK, (event) => {
				const t = event.payload.time;
				timeRef.current = t;
				setTime(t);
				applyTimeToUi(t, durationRef.current || 0);
				hardSeekTo(t);
			});
			if (cancelled) {
				u1();
				u2();
				u3();
				u4();
				return;
			}
			unlisteners.push(u1, u2, u3, u4);
		})();

		void emitTo(MAIN_WINDOW_LABEL, VIEWER_EVENT_READY, {});

		return () => {
			cancelled = true;
			for (const u of unlisteners) {
				try {
					u();
				} catch {
					/* noop */
				}
			}
		};
	}, [applyPlayingTarget, applyTimeToUi, applyVolumeToUi, hardSeekTo, setOverlay]);

	const handleProgressPointerDown = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			e.preventDefault();
			const bar = e.currentTarget;
			const applyAt = (clientX: number, final: boolean) => {
				const rect = bar.getBoundingClientRect();
				const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
				const fill = progressFillRef.current;
				if (fill) fill.style.width = `${ratio * 100}%`;
				emitMain(VIEWER_CMD_SEEK, { ratio, final } satisfies ViewerSeekCmdPayload);
			};
			applyAt(e.clientX, false);
			const onMove = (ev: MouseEvent) => applyAt(ev.clientX, false);
			const onUp = (ev: MouseEvent) => {
				applyAt(ev.clientX, true);
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
			};
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		},
		[]
	);

	const handleVolumePointerDown = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			e.preventDefault();
			const bar = e.currentTarget;
			const apply = (clientX: number) => {
				const rect = bar.getBoundingClientRect();
				const r = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
				applyVolumeToUi(r);
				emitMain(VIEWER_CMD_VOLUME, { volume: r } satisfies ViewerVolumeCmdPayload);
			};
			apply(e.clientX);
			const onMove = (ev: MouseEvent) => apply(ev.clientX);
			const onUp = () => {
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
			};
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		},
		[applyVolumeToUi]
	);

	const handlePlayPauseClick = useCallback(() => {
		emitMain(VIEWER_CMD_PLAY_PAUSE);
	}, []);

	const handleStopClick = useCallback(() => {
		emitMain(VIEWER_CMD_STOP);
	}, []);

	const handleMuteToggleClick = useCallback(() => {
		emitMain(VIEWER_CMD_MUTE_TOGGLE);
	}, []);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			const tag = target?.tagName?.toLowerCase();
			if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
			if (e.code === 'Space') {
				e.preventDefault();
				emitMain(VIEWER_CMD_PLAY_PAUSE);
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	useEffect(() => {
		const v = videoRef.current;
		if (!v) return;
		v.volume = volume;
	}, [volume, src]);

	useEffect(() => {
		const v = videoRef.current;
		if (!v) return;
		v.muted = muted;
	}, [muted, src]);

	const isMutedView = muted || volume < 1e-4;
	const showEmpty = !src;

	return (
		<div className="flex flex-col h-screen w-full overflow-hidden bg-black select-none">
			<div className="flex-1 relative flex flex-col items-center justify-center group bg-black overflow-hidden">
				{src ? (
					<video
						key={sourceKey ?? src ?? 'viewer-v'}
						ref={videoRef}
						src={src}
						className="absolute inset-0 z-0 h-full w-full object-contain [transform:translateZ(0)] [backface-visibility:hidden]"
						style={{ willChange: 'contents' }}
						playsInline
						preload="auto"
						disablePictureInPicture
						onLoadedMetadata={(e) => {
							const v = e.currentTarget;
							const d = v.duration;
							if (Number.isFinite(d)) {
								setDuration(d);
								durationRef.current = d;
							}
							v.volume = volumeRef.current;
							v.muted = mutedRef.current;
							const targetT = timeRef.current;
							if (Math.abs(v.currentTime - targetT) > SEEK_HARD_THRESHOLD_S) {
								try {
									if (typeof v.fastSeek === 'function') {
										v.fastSeek(Math.max(0, targetT));
									} else {
										v.currentTime = Math.max(0, targetT);
									}
								} catch {
									/* noop */
								}
							}
							if (wantPlayingRef.current) {
								void v.play().catch(() => {});
							}
						}}
						onPlay={() => {
							playingRef.current = true;
							setPlaying(true);
						}}
						onPause={() => {
							playingRef.current = false;
							setPlaying(false);
						}}
						onEnded={() => {
							playingRef.current = false;
							setPlaying(false);
						}}
						onError={() => {
							/* les */
						}}
					/>
				) : null}

				{showOriginal && (
					<div className="absolute top-12 z-10 w-full text-center px-10 pointer-events-none">
						<span
							ref={originalOverlayRef}
							className="text-white text-[28px] font-bold leading-[30px] tracking-[-0.01em] font-inter [text-shadow:0_0_2px_rgba(0,0,0,0.95),0_1px_3px_rgba(0,0,0,0.9),0_3px_10px_rgba(0,0,0,0.75),0_6px_22px_rgba(0,0,0,0.45)]"
						>
							{'\u00A0'}
						</span>
					</div>
				)}
				<div className="absolute bottom-16 z-10 w-full text-center px-10 pointer-events-none">
					<span
						ref={translationOverlayRef}
						className="text-white text-[28px] font-bold leading-[30px] tracking-[-0.01em] font-inter [text-shadow:0_0_2px_rgba(0,0,0,0.95),0_1px_3px_rgba(0,0,0,0.9),0_3px_10px_rgba(0,0,0,0.75),0_6px_22px_rgba(0,0,0,0.45)]"
					>
						{'\u00A0'}
					</span>
				</div>

				{preparing && src ? (
					<div className="absolute inset-0 z-[6] flex items-center justify-center pointer-events-none bg-black/40">
						<span className="text-white/70 text-[12px] font-medium tracking-wide">
							{labels.preparing}
						</span>
					</div>
				) : null}

				{showEmpty ? (
					<div className="text-white/15 text-[10px] uppercase tracking-[0.2em] font-bold">
						{hasState ? labels.preview : labels.emptyTitle}
					</div>
				) : null}
			</div>

			<div className="bg-surface-panel border-t border-border-default flex flex-col shrink-0 p-3 m-0 gap-[24px]">
				<div className="w-full">
					<div
						className="relative w-full h-[4px] rounded-[2px] bg-border-default cursor-pointer overflow-hidden"
						onMouseDown={handleProgressPointerDown}
					>
						<div
							ref={progressFillRef}
							className="absolute left-0 top-0 h-full rounded-[2px] bg-[#9FA3B0]"
							style={{ width: '0%' }}
						/>
					</div>
				</div>

				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 w-full min-w-0">
					<div className="flex items-center gap-[12px] shrink-0 min-w-0">
						<button
							type="button"
							title={playing ? labels.pause : labels.play}
							aria-label={playing ? labels.pause : labels.play}
							disabled={!src}
							className={`group/vbtn ${VIDEO_CTRL_BTN_CLASS}`}
							onClick={handlePlayPauseClick}
						>
							<span
								className={VIDEO_CTRL_ICON}
								style={sidebarIconMaskStyle(playing ? iconPauseSvg : iconPlaySvg)}
								aria-hidden
							/>
						</button>
						<button
							type="button"
							title={labels.stop}
							aria-label={labels.stop}
							disabled={!src}
							className={`group/vbtn ${VIDEO_CTRL_BTN_CLASS}`}
							onClick={handleStopClick}
						>
							<span
								className={VIDEO_CTRL_ICON}
								style={sidebarIconMaskStyle(iconStopSvg)}
								aria-hidden
							/>
						</button>
						<button
							type="button"
							title={isMutedView ? labels.unmute : labels.mute}
							aria-label={isMutedView ? labels.unmute : labels.mute}
							disabled={!src}
							className={`group/vbtn ${VIDEO_CTRL_BTN_CLASS}`}
							onClick={handleMuteToggleClick}
						>
							<span
								className={VIDEO_CTRL_ICON}
								style={sidebarIconMaskStyle(isMutedView ? iconVolumeMuteSvg : iconVolumeSvg)}
								aria-hidden
							/>
						</button>

						<div
							className="w-16 h-[4px] rounded-[2px] bg-border-default relative shrink-0 cursor-pointer overflow-hidden"
							onMouseDown={handleVolumePointerDown}
						>
							<div
								ref={volumeFillRef}
								className="absolute left-0 top-0 h-full rounded-[2px] bg-primary-disabled"
								style={{ width: `${Math.max(0, Math.min(1, volume)) * 100}%` }}
							/>
						</div>
					</div>

					<div
						className="flex items-center gap-1 text-[12px] text-body-med text-text-primary shrink-0 tabular-nums whitespace-nowrap"
						style={{ fontVariantNumeric: 'tabular-nums' }}
					>
						<span ref={clockRef} className="inline-block text-right">
							{formatPlaybackClock(time)}
						</span>
						<span className="text-text-secondary/40">/</span>
						<span className="inline-block text-text-secondary">
							{formatPlaybackClock(duration)}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}
