import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import type { SubtitleSegment } from '../../services/projectService';
import {
	applyReplaceAll,
	applyReplaceAt,
	collectFindMatches,
	type FindMatch
} from '../../utils/findReplace';
import { DraggableModalShell } from './DraggableModalShell';

const TIMELINE_BTN =
	'h-[24px] px-[12px] py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 disabled:pointer-events-none text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center';

const WIZARD_BTN_SECONDARY =
	'w-[112px] h-[26px] flex items-center justify-center bg-secondary-main hover:bg-secondary-hover text-text-primary text-body-reg rounded-[5px] transition-colors';

const WIZARD_BTN_PRIMARY =
	'w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors shadow-sm';

const INPUT_CLASS =
	'w-full px-[12px] py-[10px] bg-secondary-main border border-border-default rounded-[8px] text-body-reg text-text-primary focus:outline-none focus:border-primary-main transition-colors placeholder:text-text-secondary/50';

interface FindReplaceModalProps {
	onClose: () => void;
	segments: SubtitleSegment[];
	onSelectMatch: (match: FindMatch) => void;
	onSegmentsChange: (segments: SubtitleSegment[]) => void;
}

export const FindReplaceModal: React.FC<FindReplaceModalProps> = ({
	onClose,
	segments,
	onSelectMatch,
	onSegmentsChange
}) => {
	const { t } = useI18n();
	const [findText, setFindText] = useState('');
	const [replaceText, setReplaceText] = useState('');
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [confirmReplaceAll, setConfirmReplaceAll] = useState<number | null>(null);

	const matchesRef = useRef<FindMatch[]>([]);
	const matchIndexRef = useRef(-1);
	const segmentsRef = useRef(segments);

	useEffect(() => {
		segmentsRef.current = segments;
	}, [segments]);

	const refreshMatches = useCallback(() => {
		const list = collectFindMatches(segmentsRef.current, findText, caseSensitive);
		matchesRef.current = list;
		return list;
	}, [findText, caseSensitive]);

	useEffect(() => {
		matchIndexRef.current = -1;
		refreshMatches();
	}, [findText, caseSensitive, refreshMatches]);

	const handleFind = () => {
		const list = refreshMatches();
		if (list.length === 0) return;
		matchIndexRef.current = (matchIndexRef.current + 1) % list.length;
		const match = list[matchIndexRef.current];
		onSelectMatch(match);
	};

	const handleReplace = () => {
		if (!findText) return;
		let list = matchesRef.current;
		if (list.length === 0) list = refreshMatches();
		if (list.length === 0) return;

		if (matchIndexRef.current < 0 || matchIndexRef.current >= list.length) {
			matchIndexRef.current = 0;
		}
		const match = list[matchIndexRef.current];
		const next = applyReplaceAt(segmentsRef.current, match, replaceText);
		segmentsRef.current = next;
		onSegmentsChange(next);

		const updatedList = collectFindMatches(next, findText, caseSensitive);
		matchesRef.current = updatedList;
		if (updatedList.length === 0) {
			matchIndexRef.current = -1;
			return;
		}
		matchIndexRef.current = Math.min(matchIndexRef.current, updatedList.length - 1);
		const nextMatch = updatedList[matchIndexRef.current];
		onSelectMatch(nextMatch);
	};

	const handleReplaceAllClick = () => {
		if (!findText.trim()) return;
		const count = collectFindMatches(segmentsRef.current, findText, caseSensitive).length;
		if (count === 0) return;
		setConfirmReplaceAll(count);
	};

	const confirmReplaceAllAction = () => {
		if (confirmReplaceAll === null) return;
		const next = applyReplaceAll(segmentsRef.current, findText, replaceText, caseSensitive);
		segmentsRef.current = next;
		onSegmentsChange(next);
		matchesRef.current = [];
		matchIndexRef.current = -1;
		setConfirmReplaceAll(null);
	};

	return (
		<>
		<DraggableModalShell
			width={560}
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

			<div className="grid grid-cols-[1fr_auto] gap-[24px] flex-1 min-h-0">
				<div className="flex flex-col gap-[16px] min-w-0">
					<div className="flex flex-col gap-[8px]">
						<label className="text-caption text-text-secondary">{t('findReplace.whatToFind')}</label>
						<input
							type="text"
							value={findText}
							onChange={(e) => setFindText(e.target.value)}
							placeholder={t('findReplace.placeholder')}
							className={INPUT_CLASS}
						/>
					</div>
					<div className="flex flex-col gap-[8px]">
						<label className="text-caption text-text-secondary">{t('findReplace.replaceWith')}</label>
						<input
							type="text"
							value={replaceText}
							onChange={(e) => setReplaceText(e.target.value)}
							placeholder={t('findReplace.replacePlaceholder')}
							className={INPUT_CLASS}
						/>
					</div>
					<div className="flex flex-col gap-[8px]">
						<label className="flex items-center gap-2 cursor-pointer">
							<input
								type="radio"
								name="find-mode"
								checked={!caseSensitive}
								onChange={() => setCaseSensitive(false)}
								className="find-replace-radio"
							/>
							<span className="text-body-reg text-text-primary">{t('findReplace.normal')}</span>
						</label>
						<label className="flex items-center gap-2 cursor-pointer">
							<input
								type="radio"
								name="find-mode"
								checked={caseSensitive}
								onChange={() => setCaseSensitive(true)}
								className="find-replace-radio"
							/>
							<span className="text-body-reg text-text-primary">{t('findReplace.caseSensitive')}</span>
						</label>
					</div>
				</div>

				<div className="flex flex-col gap-[8px] w-[100px] shrink-0">
					<button
						type="button"
						disabled={!findText.trim()}
						onClick={handleFind}
						className={TIMELINE_BTN}
					>
						{t('findReplace.find')}
					</button>
					<button
						type="button"
						disabled={!findText.trim()}
						onClick={handleReplace}
						className={TIMELINE_BTN}
					>
						{t('findReplace.replace')}
					</button>
					<button
						type="button"
						disabled={!findText.trim()}
						onClick={handleReplaceAllClick}
						className={TIMELINE_BTN}
					>
						{t('findReplace.replaceAll')}
					</button>
				</div>
			</div>

		</DraggableModalShell>

		{confirmReplaceAll !== null && (
			<div className="fixed inset-0 z-[10001] flex items-center justify-center pointer-events-none">
				<div className="pointer-events-auto w-[420px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
					<div className="flex flex-col mb-8">
						<p className="text-body-reg text-text-secondary whitespace-pre-line">
							{t('findReplace.confirmReplaceAll', { count: confirmReplaceAll })}
						</p>
					</div>
					<div className="flex justify-end gap-3">
						<button
							type="button"
							onClick={() => setConfirmReplaceAll(null)}
							className={WIZARD_BTN_SECONDARY}
						>
							{t('findReplace.cancel')}
						</button>
						<button
							type="button"
							onClick={confirmReplaceAllAction}
							className={WIZARD_BTN_PRIMARY}
						>
							{t('findReplace.replace')}
						</button>
					</div>
				</div>
			</div>
		)}
		</>
	);
};
