import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

const DEFAULT_DRAG_ZONE_HEIGHT = 56;

interface DraggableModalShellProps {
	width: number;
	className?: string;
	children: React.ReactNode;
	dragZoneHeight?: number;
}

export const DraggableModalShell: React.FC<DraggableModalShellProps> = ({
	width,
	className = '',
	children,
	dragZoneHeight = DEFAULT_DRAG_ZONE_HEIGHT
}) => {
	const panelRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
	} | null>(null);

	const centerPanel = useCallback(() => {
		const el = panelRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		setPosition({
			x: Math.max(8, (window.innerWidth - rect.width) / 2),
			y: Math.max(8, (window.innerHeight - rect.height) / 2)
		});
	}, []);

	useLayoutEffect(() => {
		if (position !== null) return;
		centerPanel();
	}, [position, centerPanel]);

	const onDragPointerDown = (e: React.PointerEvent) => {
		if (e.button !== 0) return;
		if (position === null) return;
		dragRef.current = {
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			originX: position.x,
			originY: position.y
		};
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	};

	const onPointerMove = (e: React.PointerEvent) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== e.pointerId) return;
		setPosition({
			x: drag.originX + (e.clientX - drag.startX),
			y: drag.originY + (e.clientY - drag.startY)
		});
	};

	const onPointerUp = (e: React.PointerEvent) => {
		if (dragRef.current?.pointerId === e.pointerId) {
			dragRef.current = null;
		}
	};

	return (
		<div className="fixed inset-0 z-[10000] pointer-events-none">
			<div
				ref={panelRef}
				className={`pointer-events-auto absolute flex flex-col select-none ${className}`}
				style={
					position
						? { left: position.x, top: position.y, width }
						: { left: '50%', top: '50%', width, transform: 'translate(-50%, -50%)', visibility: 'hidden' }
				}
			>
				{dragZoneHeight > 0 && (
					<div
						data-modal-drag-handle
						className="absolute left-0 right-0 top-0 z-[1]"
						style={{ height: dragZoneHeight }}
						aria-hidden
						onPointerDown={onDragPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
						onPointerCancel={onPointerUp}
					/>
				)}
				<div className="relative z-[2] flex flex-col flex-1 min-h-0 h-full w-full min-w-0">{children}</div>
			</div>
		</div>
	);
};
