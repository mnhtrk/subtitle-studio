/** Поля ввода / слайдеры — не перехватывать Alt и Space. */
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
	/** Сбросить подсветку меню после Alt (Windows menu mode). */
	onDismissAppMenu?: () => void;
};

/**
 * Alt+wheel зум + Space play: без перехвата Windows открывает системное меню (Alt+Space).
 * Слушатели в capture, чтобы опередить обработчик окна.
 */
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

		// Alt+Space — системное меню окна; Space — play/pause
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
