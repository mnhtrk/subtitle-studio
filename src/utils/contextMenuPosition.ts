// не даём контекстному меню уехать за край экрана
export function clampContextMenuToViewport(
	anchorX: number,
	anchorY: number,
	width: number,
	height: number,
	margin = 8
): { x: number; y: number } {
	let x = anchorX;
	let y = anchorY;

	if (x + width > window.innerWidth - margin) {
		x = anchorX - width;
	}
	if (y + height > window.innerHeight - margin) {
		y = anchorY - height;
	}

	const maxX = Math.max(margin, window.innerWidth - width - margin);
	const maxY = Math.max(margin, window.innerHeight - height - margin);

	return {
		x: Math.min(Math.max(margin, x), maxX),
		y: Math.min(Math.max(margin, y), maxY)
	};
}
