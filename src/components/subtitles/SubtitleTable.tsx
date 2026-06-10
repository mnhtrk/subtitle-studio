import { memo, useCallback, useEffect, useRef, useState, type Ref, type RefObject } from 'react';
import type { SubtitleSegment, SpeakerGender } from '../../services/projectService';
import type { FindMatch } from '../../utils/findReplace';

function formatSpeakerGenderCell(gender?: SpeakerGender | null): string {
	if (gender === 'male') return 'M';
	if (gender === 'female') return 'F';
	return '?';
}

function formatSrtTimeCell(seconds: number): string {
	if (!Number.isFinite(seconds)) return '00:00:00,000';
	const totalMs = Math.round(seconds * 1000);
	const ms = totalMs % 1000;
	const totalSec = Math.floor(totalMs / 1000);
	const s = totalSec % 60;
	const totalMin = Math.floor(totalSec / 60);
	const m = totalMin % 60;
	const h = Math.floor(totalMin / 60);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function sanitizeSrtTimeInputCell(raw: string): string {
	return raw.replace(/[^0-9:,.]/g, '');
}

function sanitizeDurationInputCell(raw: string): string {
	return raw.replace(/[^0-9.,]/g, '');
}

export type SubtitleCellField = 'start' | 'end' | 'duration' | 'translation' | 'text';

export type SubtitleCellCommitValue =
	| { field: 'start' | 'end'; valueText: string }
	| { field: 'duration'; valueText: string }
	| { field: 'translation' | 'text'; valueText: string };

export type SubtitleTableProps = {
	scrollRef: RefObject<HTMLDivElement | null>;
	colWidths: number[];
	segments: SubtitleSegment[];
	selectedSegmentIndex: number;
	selectedSegmentIds: Set<number>;
	findHighlight: FindMatch | null;
	onSelectRow: (index: number) => void;
	onMultiSelectChange: (ids: Set<number>) => void;
	onColResizeStart: (columnIndex: number, event: React.MouseEvent) => void;
	onCellCommit: (index: number, payload: SubtitleCellCommitValue) => void;
	onRowContextMenu: (event: React.MouseEvent, index: number) => void;
	labels: {
		startTime: string;
		endTime: string;
		duration: string;
		speakerGender: string;
		translation: string;
		originalText: string;
	};
};

type EditingCell = { index: number; field: SubtitleCellField } | null;

const COMMON_CELL_CLASS =
	'h-[25px] py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-none';

const EDIT_INPUT_CLASS =
	'block w-full h-[17px] leading-[17px] bg-transparent border-0 outline-none p-0 m-0 text-table text-text-primary focus:bg-surface-bg';

function SubtitleTableInner({
	scrollRef,
	colWidths,
	segments,
	selectedSegmentIndex,
	selectedSegmentIds,
	findHighlight,
	onSelectRow,
	onMultiSelectChange,
	onColResizeStart,
	onCellCommit,
	onRowContextMenu,
	labels
}: SubtitleTableProps) {
	const [editingCell, setEditingCell] = useState<EditingCell>(null);
	const [editValue, setEditValue] = useState('');
	const editInputRef = useRef<HTMLInputElement | null>(null);
	const dragRef = useRef<{ startIndex: number; lastIndex: number; pointerId: number } | null>(null);
	const [dragActive, setDragActive] = useState(false);

	useEffect(() => {
		if (!editingCell) return;
		const el = editInputRef.current;
		if (!el) return;
		el.focus();
		try {
			const len = el.value.length;
			el.setSelectionRange(len, len);
		} catch {
			/* noop */
		}
	}, [editingCell]);

	useEffect(() => {
		if (!editingCell) return;
		if (editingCell.index < 0 || editingCell.index >= segments.length) {
			setEditingCell(null);
		}
	}, [editingCell, segments.length]);

	const beginEdit = useCallback((index: number, field: SubtitleCellField, initialText: string) => {
		setEditingCell({ index, field });
		setEditValue(initialText);
	}, []);

	const commitEdit = useCallback(() => {
		const cell = editingCell;
		if (!cell) return;
		if (cell.field === 'start' || cell.field === 'end') {
			onCellCommit(cell.index, { field: cell.field, valueText: editValue });
		} else if (cell.field === 'duration') {
			onCellCommit(cell.index, { field: 'duration', valueText: editValue });
		} else {
			onCellCommit(cell.index, { field: cell.field, valueText: editValue });
		}
		setEditingCell(null);
	}, [editingCell, editValue, onCellCommit]);

	const cancelEdit = useCallback(() => {
		setEditingCell(null);
	}, []);

	const handleEditKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				e.currentTarget.blur();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				cancelEdit();
			}
		},
		[cancelEdit]
	);

	const handleEditChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const cell = editingCell;
			if (!cell) return;
			const raw = e.target.value;
			if (cell.field === 'start' || cell.field === 'end') {
				setEditValue(sanitizeSrtTimeInputCell(raw));
			} else if (cell.field === 'duration') {
				setEditValue(sanitizeDurationInputCell(raw));
			} else {
				setEditValue(raw);
			}
		},
		[editingCell]
	);

	const handleCellDoubleClick = useCallback(
		(index: number, field: SubtitleCellField, e: React.MouseEvent) => {
			e.stopPropagation();
			e.preventDefault();
			const seg = segments[index];
			if (!seg) return;
			if (field === 'start') beginEdit(index, field, formatSrtTimeCell(seg.start));
			else if (field === 'end') beginEdit(index, field, formatSrtTimeCell(seg.end));
			else if (field === 'duration') beginEdit(index, field, seg.duration.toFixed(3));
			else if (field === 'translation') beginEdit(index, field, seg.translation ?? '');
			else if (field === 'text') beginEdit(index, field, seg.text ?? '');
		},
		[beginEdit, segments]
	);

	const updateDragSelection = useCallback(
		(startIndex: number, endIndex: number) => {
			const lo = Math.min(startIndex, endIndex);
			const hi = Math.max(startIndex, endIndex);
			if (lo === hi) {
				onMultiSelectChange(new Set());
				return;
			}
			const next = new Set<number>();
			for (let i = lo; i <= hi; i++) {
				const s = segments[i];
				if (s) next.add(s.id);
			}
			onMultiSelectChange(next);
		},
		[onMultiSelectChange, segments]
	);

	const getRowIndexFromTarget = useCallback((target: EventTarget | null): number | null => {
		if (!(target instanceof Element)) return null;
		const row = target.closest('[data-subtitle-row-index]');
		if (!row) return null;
		const v = (row as HTMLElement).dataset.subtitleRowIndex;
		if (v === undefined) return null;
		const n = parseInt(v, 10);
		return Number.isFinite(n) ? n : null;
	}, []);

	const handleRowPointerDown = useCallback(
		(e: React.PointerEvent<HTMLTableRowElement>, index: number) => {
			if (e.button !== 0) return;
			if ((e.target as HTMLElement).closest('[data-subtitle-edit-cell]')) return;
			dragRef.current = { startIndex: index, lastIndex: index, pointerId: e.pointerId };
			setDragActive(false);
		},
		[]
	);

	useEffect(() => {
		const onMove = (e: PointerEvent) => {
			const drag = dragRef.current;
			if (!drag) return;
			const idx = getRowIndexFromTarget(e.target);
			if (idx == null) return;
			if (idx === drag.lastIndex) return;
			if (!dragActive) setDragActive(true);
			drag.lastIndex = idx;
			updateDragSelection(drag.startIndex, idx);
		};
		const onUp = () => {
			const drag = dragRef.current;
			if (!drag) return;
			dragRef.current = null;
			if (!dragActive) {
				onSelectRow(drag.startIndex);
				onMultiSelectChange(new Set());
			}
			setDragActive(false);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
		return () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		};
	}, [dragActive, getRowIndexFromTarget, onMultiSelectChange, onSelectRow, updateDragSelection]);

	const handleRowContextMenu = useCallback(
		(e: React.MouseEvent<HTMLTableRowElement>, index: number) => {
			onRowContextMenu(e, index);
		},
		[onRowContextMenu]
	);

	const renderEditableCellContent = (
		index: number,
		field: SubtitleCellField,
		displayText: string
	) => {
		if (editingCell && editingCell.index === index && editingCell.field === field) {
			return (
				<input
					ref={(el) => {
						editInputRef.current = el;
					}}
					type="text"
					value={editValue}
					onChange={handleEditChange}
					onKeyDown={handleEditKeyDown}
					onBlur={commitEdit}
					className={EDIT_INPUT_CLASS}
					onMouseDown={(e) => e.stopPropagation()}
					onPointerDown={(e) => e.stopPropagation()}
					onDoubleClick={(e) => e.stopPropagation()}
				/>
			);
		}
		return <div className="truncate">{displayText}</div>;
	};

	return (
		<div className="p-3 flex-1 flex flex-col min-h-0 overflow-hidden">
			<div
				ref={scrollRef as Ref<HTMLDivElement>}
				className="flex-1 overflow-y-auto subtitle-table-scroll bg-surface-secondary"
			>
				<table className="w-full border-collapse table-fixed bg-surface-secondary">
					<colgroup>
						{colWidths.map((w, i) => (
							<col key={i} style={{ width: w }} />
						))}
						<col style={{ width: 'auto', minWidth: 50 }} />
						<col style={{ width: 'auto', minWidth: 50 }} />
					</colgroup>
					<thead className="sticky top-0 bg-surface-secondary z-20">
						<tr className="h-[25px]">
							{['#', labels.startTime, labels.endTime, labels.duration].map((label, idx) => (
								<th
									key={idx}
									style={{ width: `${colWidths[idx]}px` }}
									className="relative h-[25px] py-1 px-2 text-left text-[14px] font-bold text-text-primary border-b border-border-default select-none min-w-0"
								>
									<div className="truncate w-full">{label}</div>
									<div
										onMouseDown={(e) => onColResizeStart(idx, e)}
										className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-primary-main/30 z-10"
									/>
								</th>
							))}
							<th className="hidden h-[25px] py-1 px-2 text-left text-[14px] font-bold text-text-primary border-b border-border-default min-w-0">
								<div className="truncate w-full">{labels.speakerGender}</div>
							</th>
							<th className="h-[25px] py-1 px-2 text-left text-[14px] font-bold text-text-primary border-b border-border-default min-w-0">
								<div className="truncate w-full">{labels.translation}</div>
							</th>
							<th className="h-[25px] py-1 px-2 text-left text-[14px] font-bold text-text-primary border-b border-border-default min-w-0">
								<div className="truncate w-full">{labels.originalText}</div>
							</th>
						</tr>
					</thead>

					<tbody>
						{segments.map((segment, idx) => {
							const isMultiSelected = selectedSegmentIds.has(segment.id);
							const isSingleSelected = selectedSegmentIndex === idx;
							const isHighlighted = isSingleSelected || isMultiSelected;
							const isFindMatch = findHighlight?.segmentIndex === idx;
							const editingThisRow = editingCell?.index === idx;
							return (
								<tr
									key={`${segment.id}-${idx}`}
									data-subtitle-row-index={idx}
									onPointerDown={(e) => handleRowPointerDown(e, idx)}
									onContextMenu={(e) => handleRowContextMenu(e, idx)}
									className={`h-[25px] hover:bg-black/5 transition-colors group text-table cursor-pointer scroll-mt-[25px] ${
										isHighlighted ? 'bg-inline-bg' : ''
									} ${isFindMatch ? 'bg-primary-main/15 ring-1 ring-inset ring-primary-main' : ''}`}
								>
									<td className={COMMON_CELL_CLASS}>
										<div className="truncate">{segment.id}</div>
									</td>
									<td
										className={COMMON_CELL_CLASS}
										data-subtitle-edit-cell={editingThisRow && editingCell?.field === 'start' ? 'true' : undefined}
										onDoubleClick={(e) => handleCellDoubleClick(idx, 'start', e)}
									>
										{renderEditableCellContent(idx, 'start', segment.start.toFixed(3))}
									</td>
									<td
										className={COMMON_CELL_CLASS}
										data-subtitle-edit-cell={editingThisRow && editingCell?.field === 'end' ? 'true' : undefined}
										onDoubleClick={(e) => handleCellDoubleClick(idx, 'end', e)}
									>
										{renderEditableCellContent(idx, 'end', segment.end.toFixed(3))}
									</td>
									<td
										className={COMMON_CELL_CLASS}
										data-subtitle-edit-cell={editingThisRow && editingCell?.field === 'duration' ? 'true' : undefined}
										onDoubleClick={(e) => handleCellDoubleClick(idx, 'duration', e)}
									>
										{renderEditableCellContent(idx, 'duration', segment.duration.toFixed(3))}
									</td>
									<td className="hidden h-[25px] py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-none text-[11px] text-text-secondary">
										<div className="truncate" title={segment.speaker_gender ?? ''}>
											{formatSpeakerGenderCell(segment.speaker_gender)}
										</div>
									</td>
									<td
										data-subtitle-edit-cell={editingThisRow && editingCell?.field === 'translation' ? 'true' : undefined}
										onDoubleClick={(e) => handleCellDoubleClick(idx, 'translation', e)}
										className={`h-[25px] py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 text-body-reg select-none ${
											findHighlight?.segmentIndex === idx && findHighlight.field === 'translation'
												? 'bg-primary-main/25'
												: ''
										}`}
									>
										{renderEditableCellContent(idx, 'translation', segment.translation || '-')}
									</td>
									<td
										data-subtitle-edit-cell={editingThisRow && editingCell?.field === 'text' ? 'true' : undefined}
										onDoubleClick={(e) => handleCellDoubleClick(idx, 'text', e)}
										className={`h-[25px] py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 text-body-reg select-none ${
											findHighlight?.segmentIndex === idx && findHighlight.field === 'text'
												? 'bg-primary-main/25'
												: ''
										}`}
									>
										{renderEditableCellContent(idx, 'text', segment.text)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export const SubtitleTable = memo(SubtitleTableInner);
