export const SUBTITLE_CLIPBOARD_MARKER = '__subtitle-studio:subtitle-clip__';

export type SubtitleClipSegment = {
	text: string;
	translation?: string | null;
};

export type SubtitleClipboardPayload =
	| { kind: 'segment'; segment: SubtitleClipSegment }
	| { kind: 'range'; range: { segments: SubtitleClipSegment[] } };

export function formatSubtitleClipboardPlainText(
	clip: SubtitleClipboardPayload | null,
	column: 'translation' | 'text' = 'translation'
): string {
	if (!clip) return '';
	const line = (s: SubtitleClipSegment) => {
		const tr = (s.translation ?? '').trim();
		const orig = (s.text ?? '').trim();
		if (column === 'translation') return tr || orig;
		return orig || tr;
	};
	if (clip.kind === 'segment') return line(clip.segment);
	return clip.range.segments.map(line).filter(Boolean).join('\n');
}

export function isSubtitleClipboardSystemText(txt: string, clip: SubtitleClipboardPayload | null): boolean {
	if (txt === SUBTITLE_CLIPBOARD_MARKER || txt.length === 0) return true;
	if (!clip) return false;
	const plain = formatSubtitleClipboardPlainText(clip);
	return plain.length > 0 && txt === plain;
}

export function insertTextAtTextareaSelection(
	el: HTMLTextAreaElement,
	currentValue: string,
	insert: string
): { next: string; caret: number } {
	const start = el.selectionStart ?? currentValue.length;
	const end = el.selectionEnd ?? currentValue.length;
	const next = currentValue.slice(0, start) + insert + currentValue.slice(end);
	return { next, caret: start + insert.length };
}
