import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import type { SubtitleSegment } from '../../services/projectService';
import {
	applyFieldText,
	applyWordReplacement,
	collectSpellIssues,
	firstSuggestion,
	getIssueLineText,
	loadSpellCheckers,
	type SpellCheckers,
	type SpellIssue
} from '../../utils/spellcheck';
import { DraggableModalShell } from './DraggableModalShell';

/** Как кнопки «Найти / Заменить» в FindReplaceModal */
const FR_ACTION_BTN =
	'h-[24px] px-[12px] py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 disabled:pointer-events-none text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center';

/** Как «Спросить агента» */
const CHANGE_BTN =
	'w-full h-[24px] py-[4px] bg-primary-main hover:bg-primary-hover disabled:opacity-40 disabled:pointer-events-none text-white text-caption rounded-sm transition-colors font-medium flex items-center justify-center';

const INPUT_CLASS =
	'w-full px-[12px] py-[10px] bg-secondary-main border border-border-default rounded-[8px] text-body-reg text-text-primary focus:outline-none focus:border-primary-main transition-colors placeholder:text-text-secondary/50';

const TEXT_PANEL_CLASS =
	'w-full min-h-[120px] max-h-[200px] overflow-y-auto px-[12px] py-[10px] bg-secondary-main border border-border-default rounded-[8px] text-body-reg text-text-primary subtitle-table-scroll whitespace-pre-wrap break-words';

interface SpellCheckModalProps {
	onClose: () => void;
	segments: SubtitleSegment[];
	initialIssues: SpellIssue[];
	onSelectIssue: (issue: SpellIssue) => void;
	onSegmentsChange: (segments: SubtitleSegment[]) => void;
}

function HighlightedLine({
	text,
	offset,
	length
}: {
	text: string;
	offset: number;
	length: number;
}) {
	const before = text.slice(0, offset);
	const word = text.slice(offset, offset + length);
	const after = text.slice(offset + length);
	return (
		<>
			{before}
			<span className="text-red-600 font-medium">{word}</span>
			{after}
		</>
	);
}

export const SpellCheckModal: React.FC<SpellCheckModalProps> = ({
	onClose,
	segments,
	initialIssues,
	onSelectIssue,
	onSegmentsChange
}) => {
	const { t } = useI18n();
	const [issues, setIssues] = useState<SpellIssue[]>(initialIssues);
	const [issueIndex, setIssueIndex] = useState(0);
	const [replacement, setReplacement] = useState('');
	const [editWholeText, setEditWholeText] = useState(false);
	const [wholeTextDraft, setWholeTextDraft] = useState('');
	const [rescanning, setRescanning] = useState(false);
	const [checkers, setCheckers] = useState<SpellCheckers | null>(null);

	const segmentsRef = useRef(segments);

	useEffect(() => {
		segmentsRef.current = segments;
	}, [segments]);

	useEffect(() => {
		setIssues(initialIssues);
		setIssueIndex(0);
	}, [initialIssues]);

	useEffect(() => {
		void loadSpellCheckers().then(setCheckers);
	}, []);

	const currentIssue = issues[issueIndex] ?? null;

	const lineText = useMemo(() => {
		if (!currentIssue) return '';
		return getIssueLineText(segmentsRef.current, currentIssue);
	}, [currentIssue, segments]);

	useEffect(() => {
		if (!currentIssue) return;
		onSelectIssue(currentIssue);
	}, [currentIssue, onSelectIssue]);

	useEffect(() => {
		if (!currentIssue) return;
		setWholeTextDraft(getIssueLineText(segmentsRef.current, currentIssue));
		setEditWholeText(false);
		if (!checkers) {
			setReplacement('');
			return;
		}
		setReplacement(firstSuggestion(checkers, currentIssue.word));
	}, [
		checkers,
		currentIssue?.segmentIndex,
		currentIssue?.field,
		currentIssue?.offset,
		currentIssue?.word
	]);

	const rescan = useCallback(
		async (list: SubtitleSegment[], startAt = 0) => {
			setRescanning(true);
			try {
				const loaded = checkers ?? (await loadSpellCheckers());
				if (!checkers) setCheckers(loaded);
				const nextIssues = collectSpellIssues(list, loaded);
				setIssues(nextIssues);
				if (nextIssues.length === 0) {
					onClose();
					return;
				}
				setIssueIndex(Math.min(startAt, nextIssues.length - 1));
			} finally {
				setRescanning(false);
			}
		},
		[checkers, onClose]
	);

	const handleChange = () => {
		if (!currentIssue) return;
		const next = editWholeText
			? applyFieldText(segmentsRef.current, currentIssue, wholeTextDraft)
			: applyWordReplacement(segmentsRef.current, currentIssue, replacement.trim() || replacement);
		segmentsRef.current = next;
		onSegmentsChange(next);
		void rescan(next, issueIndex);
	};

	const handleSkipOne = () => {
		if (issues.length === 0) return;
		const next = issueIndex + 1;
		if (next >= issues.length) {
			onClose();
			return;
		}
		setIssueIndex(next);
	};

	const handleSkipAll = () => {
		onClose();
	};

	if (!currentIssue) {
		return null;
	}

	return (
		<DraggableModalShell
			width={520}
			className="bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col"
		>
			<div className="flex justify-end h-5 mb-6">
				<button
					type="button"
					onClick={onClose}
					className="text-text-secondary hover:opacity-70 transition-opacity"
				>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div className="flex flex-col gap-[16px] min-w-0">
				<div className="flex flex-col gap-[8px]">
					<label className="text-caption text-text-secondary">{t('spellCheck.fullText')}</label>
					{editWholeText ? (
						<textarea
							value={wholeTextDraft}
							onChange={(e) => setWholeTextDraft(e.target.value)}
							className={`${TEXT_PANEL_CLASS} resize-y focus:outline-none focus:border-primary-main`}
							rows={5}
						/>
					) : (
						<div className={TEXT_PANEL_CLASS}>
							<HighlightedLine
								text={lineText}
								offset={currentIssue.offset}
								length={currentIssue.length}
							/>
						</div>
					)}
				</div>

				<div className="flex items-center justify-between gap-3">
					<span className="text-caption text-text-secondary tabular-nums">
						{t('spellCheck.lineOf', {
							current: issueIndex + 1,
							total: issues.length
						})}
					</span>
					<button
						type="button"
						className={FR_ACTION_BTN}
						onClick={() => {
							if (!editWholeText) {
								setWholeTextDraft(lineText);
							}
							setEditWholeText((v) => !v);
						}}
					>
						{t('spellCheck.editWholeText')}
					</button>
				</div>

				<div className="flex flex-col pt-2">
					<input
						type="text"
						value={replacement}
						onChange={(e) => setReplacement(e.target.value)}
						disabled={editWholeText || rescanning || !checkers}
						className={`${INPUT_CLASS} disabled:opacity-50`}
					/>
					<div className="mt-[8px] flex flex-col gap-[4px]">
					<button
						type="button"
						onClick={handleChange}
						disabled={rescanning || !checkers || (!editWholeText && !replacement.trim())}
						className={CHANGE_BTN}
					>
						{t('spellCheck.change')}
					</button>
					<div className="flex gap-[6px]">
						<button
							type="button"
							onClick={handleSkipOne}
							disabled={rescanning}
							className={`${FR_ACTION_BTN} flex-1`}
						>
							{t('spellCheck.skipOne')}
						</button>
						<button
							type="button"
							onClick={handleSkipAll}
							disabled={rescanning}
							className={`${FR_ACTION_BTN} flex-1`}
						>
						{t('spellCheck.skipAll')}
					</button>
					</div>
					</div>
				</div>
			</div>
		</DraggableModalShell>
	);
};

/** Показать индикатор загрузки во время предварительного сканирования. */
export function SpellCheckLoadingOverlay({
	progress
}: {
	progress: { done: number; total: number; found: number } | null;
}) {
	const { t } = useI18n();
	const pct =
		progress && progress.total > 0
			? Math.min(100, Math.round((progress.done / progress.total) * 100))
			: null;

	return (
		<div className="fixed inset-0 z-[10001] flex items-center justify-center pointer-events-none">
			<div className="pointer-events-auto w-[360px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-6 flex flex-col gap-3 select-none">
				<p className="text-body-reg text-text-primary">{t('spellCheck.scanning')}</p>
				<p className="text-caption text-text-secondary">{t('spellCheck.scanningHint')}</p>
				{progress && progress.total > 0 && (
					<>
						<p className="text-caption text-text-primary tabular-nums">
							{t('spellCheck.scanProgress', {
								done: progress.done,
								total: progress.total,
								found: progress.found
							})}
						</p>
						<div className="h-[4px] w-full rounded-full bg-border-default overflow-hidden">
							<div
								className="h-full bg-primary-main transition-[width] duration-150"
								style={{ width: `${pct ?? 0}%` }}
							/>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
