import { memo, type CSSProperties, type Ref, type RefObject } from 'react';
import { VideoPlayer } from '../VideoPlayer';
import { sidebarIconMaskStyle } from '../../utils/iconMask';
import { formatPlaybackClock } from '../../utils/playbackClock';

const VIDEO_CTRL_BTN_CLASS =
	'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-primary-main/40 disabled:pointer-events-none disabled:opacity-40';

const VIDEO_CTRL_ICON_PLAY =
	'pointer-events-none inline-block h-6 w-6 shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/vplay:scale-110 group-active/vplay:scale-[0.92]';

const VIDEO_CTRL_ICON_STOP =
	'pointer-events-none inline-block h-6 w-6 shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/vstop:scale-110 group-active/vstop:scale-[0.92]';

const VIDEO_CTRL_ICON_VOL =
	'pointer-events-none inline-block h-6 w-6 shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/vvol:scale-110 group-active/vvol:scale-[0.92]';

// режим двух мониторов
const HIDDEN_OFFSCREEN_STYLE: CSSProperties = {
	position: 'fixed',
	top: 0,
	left: 0,
	width: '2px',
	height: '2px',
	opacity: 0,
	pointerEvents: 'none',
	overflow: 'hidden',
	zIndex: -1
};

export type EditorVideoPaneProps = {
	videoSrc: string | null;
	playbackVideoPath: string | null;
	activeVideoAbsolutePath: string | null;
	previewFrameSrc: string | null;
	playbackPreparing: boolean;
	volume: number;
	videoMuted: boolean;
	isVideoPlaying: boolean;
	currentPlaybackTime: number;
	timelineTotalDuration: number;
	showOriginalVideoSubtitles: boolean;
	videoRef: RefObject<HTMLVideoElement | null>;
	videoProgressFillRef: RefObject<HTMLDivElement | null>;
	playbackClockRef: RefObject<HTMLSpanElement | null>;
	videoTranslationOverlayRef: RefObject<HTMLSpanElement | null>;
	videoOriginalOverlayRef: RefObject<HTMLSpanElement | null>;
	iconPlay: string;
	iconPause: string;
	iconStop: string;
	iconVolume: string;
	iconVolumeMute: string;
	labels: {
		preparing: string;
		preview: string;
		play: string;
		pause: string;
		stop: string;
		mute: string;
		unmute: string;
	};
	dualMonitorMode?: boolean;
	// Перебивает реальные volume/muted для скрытого video в режиме двух моников
	hiddenVolumeOverride?: number;
	hiddenMutedOverride?: boolean;
	onDuration: (seconds: number) => void;
	onPlayingChange: (playing: boolean) => void;
	onVolumeFromElement: (volume: number) => void;
	onVideoError: () => void;
	onFrameTime: (time: number) => void;
	onSeeked: (time: number) => void;
	onPlayStart: () => void;
	onProgressPointerDown: (e: React.MouseEvent<HTMLDivElement>) => void;
	onVolumePointerDown: (e: React.MouseEvent<HTMLDivElement>) => void;
	onPlayPauseClick: () => void;
	onStopClick: () => void;
	onMuteToggleClick: () => void;
};

function EditorVideoPaneInner({
	videoSrc,
	playbackVideoPath,
	activeVideoAbsolutePath,
	previewFrameSrc,
	playbackPreparing,
	volume,
	videoMuted,
	isVideoPlaying,
	currentPlaybackTime,
	timelineTotalDuration,
	showOriginalVideoSubtitles,
	videoRef,
	videoProgressFillRef,
	playbackClockRef,
	videoTranslationOverlayRef,
	videoOriginalOverlayRef,
	iconPlay,
	iconPause,
	iconStop,
	iconVolume,
	iconVolumeMute,
	labels,
	dualMonitorMode = false,
	hiddenVolumeOverride,
	hiddenMutedOverride,
	onDuration,
	onPlayingChange,
	onVolumeFromElement,
	onVideoError,
	onFrameTime,
	onSeeked,
	onPlayStart,
	onProgressPointerDown,
	onVolumePointerDown,
	onPlayPauseClick,
	onStopClick,
	onMuteToggleClick
}: EditorVideoPaneProps) {
	const effectiveVolume = dualMonitorMode ? hiddenVolumeOverride ?? 0 : volume;
	const effectiveMuted = dualMonitorMode ? hiddenMutedOverride ?? true : videoMuted;

	const outerClassName = dualMonitorMode
		? ''
		: 'flex-1 bg-black flex flex-col shadow-inner min-w-[220px] overflow-hidden select-none';
	const outerStyle: CSSProperties | undefined = dualMonitorMode ? HIDDEN_OFFSCREEN_STYLE : undefined;

	return (
		<div className={outerClassName} style={outerStyle} aria-hidden={dualMonitorMode || undefined}>
			<div className="flex-1 relative flex flex-col items-center justify-center group bg-[#000000]">
				<VideoPlayer
					src={videoSrc}
					sourceKey={playbackVideoPath ?? activeVideoAbsolutePath}
					previewSrc={previewFrameSrc}
					preparing={playbackPreparing}
					volume={effectiveVolume}
					muted={effectiveMuted}
					videoRef={videoRef}
					emptyLabel={playbackPreparing ? labels.preparing : labels.preview}
					onDuration={onDuration}
					onPlayingChange={onPlayingChange}
					onVolumeFromElement={onVolumeFromElement}
					onError={onVideoError}
					onFrameTime={onFrameTime}
					onSeeked={onSeeked}
					onPlayStart={onPlayStart}
				>
					{showOriginalVideoSubtitles && (
						<div className="absolute top-12 z-10 w-full text-center px-10 pointer-events-none">
							<span
								ref={videoOriginalOverlayRef as Ref<HTMLSpanElement>}
								className="text-white text-[17px] font-bold leading-[17px] tracking-[-0.01em] font-inter [text-shadow:0_0_1px_rgba(0,0,0,0.95),0_1px_2px_rgba(0,0,0,0.9),0_2px_8px_rgba(0,0,0,0.75),0_4px_20px_rgba(0,0,0,0.45)]"
							>
								{'\u00A0'}
							</span>
						</div>
					)}
					<div className="absolute bottom-12 z-10 w-full text-center px-10 pointer-events-none">
						<span
							ref={videoTranslationOverlayRef as Ref<HTMLSpanElement>}
							className="text-white text-[17px] font-bold leading-[17px] tracking-[-0.01em] font-inter [text-shadow:0_0_1px_rgba(0,0,0,0.95),0_1px_2px_rgba(0,0,0,0.9),0_2px_8px_rgba(0,0,0,0.75),0_4px_20px_rgba(0,0,0,0.45)]"
						>
							{'\u00A0'}
						</span>
					</div>
				</VideoPlayer>
			</div>

			{!dualMonitorMode && (
				<div className="bg-surface-panel border-t border-border-default flex flex-col shrink-0 p-3 m-0 gap-[24px]">
					<div className="w-full">
						<div
							className="relative w-full h-[4px] rounded-[2px] bg-border-default cursor-pointer overflow-hidden"
							onMouseDown={onProgressPointerDown}
						>
							<div
								ref={videoProgressFillRef as Ref<HTMLDivElement>}
								className="absolute left-0 top-0 h-full rounded-[2px] bg-[#9FA3B0]"
								style={{ width: '0%' }}
							/>
						</div>
					</div>

					<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 w-full min-w-0">
						<div className="flex items-center gap-[12px] shrink-0 min-w-0">
							<button
								type="button"
								title={isVideoPlaying ? labels.pause : labels.play}
								aria-label={isVideoPlaying ? labels.pause : labels.play}
								disabled={!videoSrc}
								className={`group/vplay ${VIDEO_CTRL_BTN_CLASS}`}
								onClick={onPlayPauseClick}
							>
								<span
									className={VIDEO_CTRL_ICON_PLAY}
									style={sidebarIconMaskStyle(isVideoPlaying ? iconPause : iconPlay)}
									aria-hidden
								/>
							</button>
							<button
								type="button"
								title={labels.stop}
								aria-label={labels.stop}
								disabled={!videoSrc}
								className={`group/vstop ${VIDEO_CTRL_BTN_CLASS}`}
								onClick={onStopClick}
							>
								<span
									className={VIDEO_CTRL_ICON_STOP}
									style={sidebarIconMaskStyle(iconStop)}
									aria-hidden
								/>
							</button>
							<button
								type="button"
								title={videoMuted || volume < 1e-4 ? labels.unmute : labels.mute}
								aria-label={videoMuted || volume < 1e-4 ? labels.unmute : labels.mute}
								disabled={!videoSrc}
								className={`group/vvol ${VIDEO_CTRL_BTN_CLASS}`}
								onClick={onMuteToggleClick}
							>
								<span
									className={VIDEO_CTRL_ICON_VOL}
									style={sidebarIconMaskStyle(
										videoMuted || volume < 1e-4 ? iconVolumeMute : iconVolume
									)}
									aria-hidden
								/>
							</button>

							<div
								className="w-16 h-[4px] rounded-[2px] bg-border-default relative shrink-0 cursor-pointer overflow-hidden"
								onMouseDown={onVolumePointerDown}
							>
								<div
									className="absolute left-0 top-0 h-full rounded-[2px] bg-primary-disabled"
									style={{
										width: `${volume * 100}%`
									}}
								/>
							</div>
						</div>

						<div
							className="flex items-center gap-1 text-[12px] text-body-med text-text-primary shrink-0 tabular-nums whitespace-nowrap"
							style={{ fontVariantNumeric: 'tabular-nums' }}
						>
							<span ref={playbackClockRef as Ref<HTMLSpanElement>} className="inline-block text-right">
								{formatPlaybackClock(currentPlaybackTime)}
							</span>
							<span className="text-text-secondary/40">/</span>
							<span className="inline-block text-text-secondary">
								{formatPlaybackClock(timelineTotalDuration)}
							</span>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

export const EditorVideoPane = memo(EditorVideoPaneInner);
