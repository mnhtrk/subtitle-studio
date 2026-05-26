import React, { memo, useEffect, useRef } from 'react';

export type VideoPlayerProps = {
	src: string | null;
	sourceKey: string | null;
	previewSrc: string | null;
	preparing?: boolean;
	volume: number;
	muted: boolean;
	videoRef: React.RefObject<HTMLVideoElement | null>;
	onDuration: (seconds: number) => void;
	onPlayingChange: (playing: boolean) => void;
	onVolumeFromElement: (volume: number) => void;
	onError: () => void;
	// синхронизация UI с реальным кадром (requestVideoFrameCallback или raf)
	onFrameTime: (time: number) => void;
	onSeeked: (time: number) => void;
	onPlayStart?: () => void;
	emptyLabel: string;
	children?: React.ReactNode;
};

function VideoPlayerInner({
	src,
	sourceKey,
	previewSrc,
	preparing,
	volume,
	muted,
	videoRef,
	onDuration,
	onPlayingChange,
	onVolumeFromElement,
	onError,
	onFrameTime,
	onSeeked,
	onPlayStart,
	emptyLabel,
	children
}: VideoPlayerProps) {
	const onFrameTimeRef = useRef(onFrameTime);
	const onSeekedRef = useRef(onSeeked);
	const onPlayingChangeRef = useRef(onPlayingChange);
	onFrameTimeRef.current = onFrameTime;
	onSeekedRef.current = onSeeked;
	onPlayingChangeRef.current = onPlayingChange;

	useEffect(() => {
		const v = videoRef.current;
		if (!v || !src) return;

		let vfcId = 0;
		let rafId = 0;

		const tickRaf = () => {
			rafId = 0;
			if (v.paused || v.ended) return;
			onFrameTimeRef.current(v.currentTime);
			rafId = requestAnimationFrame(tickRaf);
		};

		const tickVfc: VideoFrameRequestCallback = (_now, metadata) => {
			if (v.paused || v.ended) return;
			const t = metadata.mediaTime;
			if (Number.isFinite(t)) onFrameTimeRef.current(t);
			vfcId = v.requestVideoFrameCallback(tickVfc);
		};

		const startLoop = () => {
			if (vfcId) {
				v.cancelVideoFrameCallback(vfcId);
				vfcId = 0;
			}
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			}
			if (typeof v.requestVideoFrameCallback === 'function') {
				vfcId = v.requestVideoFrameCallback(tickVfc);
			} else {
				rafId = requestAnimationFrame(tickRaf);
			}
		};

		const stopLoop = () => {
			if (vfcId) {
				v.cancelVideoFrameCallback(vfcId);
				vfcId = 0;
			}
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			}
		};

		const onPause = () => {
			stopLoop();
			onFrameTimeRef.current(v.currentTime);
		};

		const onSeeked = () => {
			onSeekedRef.current(v.currentTime);
		};

		v.addEventListener('play', startLoop);
		v.addEventListener('pause', onPause);
		v.addEventListener('seeked', onSeeked);
		if (!v.paused) startLoop();

		return () => {
			v.removeEventListener('play', startLoop);
			v.removeEventListener('pause', onPause);
			v.removeEventListener('seeked', onSeeked);
			stopLoop();
		};
	}, [src, sourceKey, videoRef]);

	useEffect(() => {
		const v = videoRef.current;
		if (!v) return;
		v.volume = volume;
	}, [volume, videoRef]);

	useEffect(() => {
		const v = videoRef.current;
		if (!v) return;
		v.muted = muted;
	}, [muted, videoRef]);

	return (
		<>
			{src ? (
				<video
					key={sourceKey ?? 'v'}
					ref={videoRef as React.RefObject<HTMLVideoElement>}
					src={src}
					className="absolute inset-0 z-0 h-full w-full object-contain [transform:translateZ(0)] [backface-visibility:hidden]"
					style={{ willChange: 'contents' }}
					playsInline
					muted={muted}
					preload="auto"
					disablePictureInPicture
					onLoadedMetadata={(e) => {
						const d = e.currentTarget.duration;
						onDuration(Number.isFinite(d) ? d : 0);
						e.currentTarget.volume = volume;
						e.currentTarget.muted = muted;
					}}
					onDurationChange={(e) => {
						const d = e.currentTarget.duration;
						if (Number.isFinite(d) && d > 0) onDuration(d);
					}}
					onPlay={() => {
						onPlayStart?.();
						onPlayingChangeRef.current(true);
					}}
					onPause={() => onPlayingChangeRef.current(false)}
					onEnded={() => onPlayingChangeRef.current(false)}
					onVolumeChange={(e) => onVolumeFromElement(e.currentTarget.volume)}
					onError={onError}
				/>
			) : null}
			{previewSrc ? (
				<img
					src={previewSrc}
					alt=""
					draggable={false}
					className="absolute inset-0 z-[5] h-full w-full object-contain pointer-events-none bg-black [transform:translateZ(0)]"
				/>
			) : null}
			{preparing && src ? (
				<div className="absolute inset-0 z-[6] flex items-center justify-center pointer-events-none bg-black/40">
					<span className="text-white/70 text-[11px] font-medium tracking-wide">
						{emptyLabel}
					</span>
				</div>
			) : null}
			{!src && !preparing ? (
				<div className="text-white/10 text-[10px] uppercase tracking-[0.2em] font-bold">
					{emptyLabel}
				</div>
			) : null}
			{children}
		</>
	);
}

export const VideoPlayer = memo(VideoPlayerInner);
