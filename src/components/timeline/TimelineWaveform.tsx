import { memo, useLayoutEffect, useRef } from 'react';

const WAVEFORM_CANVAS_WIDTH = 2048;

// canvas волна - рисуем один раз по пикам, дальше зум через css, без перерисовки
function TimelineWaveformInner({
	peaks,
	className
}: {
	peaks: number[] | null;
	className?: string;
}) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const peaksRef = useRef(peaks);
	peaksRef.current = peaks;

	useLayoutEffect(() => {
		const wrap = wrapRef.current;
		const canvas = canvasRef.current;
		if (!wrap || !canvas) return;

		let rafTries = 0;
		const draw = () => {
			const h = wrap.clientHeight;
			if (h < 4) {
				if (rafTries < 24) {
					rafTries += 1;
					requestAnimationFrame(draw);
				}
				return;
			}

			const w = WAVEFORM_CANVAS_WIDTH;
			const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
			canvas.width = Math.floor(w * dpr);
			canvas.height = Math.floor(h * dpr);
			canvas.style.width = '100%';
			canvas.style.height = `${h}px`;

			const ctx = canvas.getContext('2d');
			if (!ctx) return;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, w, h);

			const mid = h / 2;
			const maxHalf = Math.max(2, mid - 1);
			const ampGain = 1.42;
			const peaksNow = peaksRef.current;

			if (!peaksNow || peaksNow.length === 0) {
				ctx.strokeStyle = 'rgba(173, 255, 47, 0.35)';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(0, mid);
				ctx.lineTo(w, mid);
				ctx.stroke();
				return;
			}

			let mx = 0;
			for (let i = 0; i < peaksNow.length; i++) {
				const a = Math.abs(peaksNow[i]);
				if (a > mx) mx = a;
			}
			const norm = mx > 1e-9 ? 1 / mx : 1;

			const n = peaksNow.length;
			ctx.fillStyle = '#ADFF2F';
			for (let col = 0; col < w; col++) {
				const t = w <= 1 ? 0 : col / (w - 1);
				const idx = Math.round(t * (n - 1));
				const v = Math.abs(peaksNow[Math.max(0, Math.min(n - 1, idx))]) * norm;
				const amp = Math.min(maxHalf, v * maxHalf * ampGain);
				const half = Math.max(1, amp);
				ctx.fillRect(col, mid - half, 1, half * 2);
			}
		};

		draw();
		const ro = new ResizeObserver(() => {
			rafTries = 0;
			draw();
		});
		ro.observe(wrap);
		return () => ro.disconnect();
	}, [peaks]);

	return (
		<div
			ref={wrapRef}
			className={
				className ??
				'absolute inset-x-0 top-[5%] bottom-[5%] w-full pointer-events-none'
			}
		>
			<canvas ref={canvasRef} className="block h-full w-full min-h-0" aria-hidden />
		</div>
	);
}

export const TimelineWaveform = memo(TimelineWaveformInner);
