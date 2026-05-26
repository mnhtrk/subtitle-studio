// в полях ввода и слайдерах не перехватываем alt и space
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
	if (!target || !(target instanceof Element)) return false;
	const el = target as HTMLElement;
	if (el.isContentEditable) return true;
	const tag = el.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (el.closest('[contenteditable="true"]')) return true;
	if (el.closest('input[type="range"], [role="slider"]')) return true;
	return false;
}

export type VideoKeyboardHandlers = {
	isModalOpen: () => boolean;
	hasVideo: () => boolean;
	onTogglePlay: () => void;
	// сброс подсветки меню после alt - windows menu mode
	onDismissAppMenu?: () => void;
};

// alt+wheel это зум, space это play
// без перехвата винда откроет системное меню по alt+space
// слушаем в capture чтобы опередить обработчик окна
function isAltKey(e: KeyboardEvent): boolean {
	return e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight';
}

export function installVideoEditorKeyboardHandlers(handlers: VideoKeyboardHandlers): () => void {
	const onKeyDown = (e: KeyboardEvent) => {
		if (isAltKey(e)) {
			if (!isEditableKeyboardTarget(e.target)) {
				e.preventDefault();
				handlers.onDismissAppMenu?.();
			}
			return;
		}

		if (e.code !== 'Space') return;
		if (handlers.isModalOpen()) return;
		if (isEditableKeyboardTarget(e.target)) return;
		if (!handlers.hasVideo()) return;

		// alt+space - системное меню окна, space - play/pause
		e.preventDefault();
		e.stopImmediatePropagation();
		handlers.onTogglePlay();
	};

	const onKeyUp = (e: KeyboardEvent) => {
		if (!isAltKey(e)) return;
		handlers.onDismissAppMenu?.();
	};

	window.addEventListener('keydown', onKeyDown, true);
	window.addEventListener('keyup', onKeyUp, true);
	return () => {
		window.removeEventListener('keydown', onKeyDown, true);
		window.removeEventListener('keyup', onKeyUp, true);
	};
}
