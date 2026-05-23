import { memo, type Ref, type RefObject } from 'react';
import type { SubtitleSegment, SpeakerGender } from '../../services/projectService';
import type { FindMatch } from '../../utils/findReplace';

function formatSpeakerGenderCell(gender?: SpeakerGender | null): string {
	if (gender === 'male') return 'M';
	if (gender === 'female') return 'F';
	return '?';
}

export type SubtitleTableProps = {
	scrollRef: RefObject<HTMLDivElement | null>;
	colWidths: number[];
	segments: SubtitleSegment[];
	selectedSegmentIndex: number;
	findHighlight: FindMatch | null;
	onSelectRow: (index: number) => void;
	onColResizeStart: (columnIndex: number, event: React.MouseEvent) => void;
	labels: {
		startTime: string;
		endTime: string;
		duration: string;
		speakerGender: string;
		translation: string;
		originalText: string;
	};
};

function SubtitleTableInner({
	scrollRef,
	colWidths,
	segments,
	selectedSegmentIndex,
	findHighlight,
	onSelectRow,
	onColResizeStart,
	labels
}: SubtitleTableProps) {
	return (
		<div className="p-3 flex-1 flex flex-col min-h-0 overflow-hidden">
			<div
				ref={scrollRef as Ref<HTMLDivElement>}
				className="flex-1 overflow-y-auto no-scrollbar subtitle-table-scroll bg-surface-secondary"
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
						{segments.map((segment, idx) => (
							<tr
								key={`${segment.id}-${idx}`}
								data-subtitle-row-index={idx}
								onClick={() => onSelectRow(idx)}
								className={`h-[25px] hover:bg-black/5 transition-colors group text-table cursor-pointer scroll-mt-[25px] ${
									selectedSegmentIndex === idx ? 'bg-black/10' : ''
								} ${findHighlight?.segmentIndex === idx ? 'bg-primary-main/15 ring-1 ring-inset ring-primary-main' : ''}`}
							>
								<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
									<div className="truncate">{segment.id}</div>
								</td>
								<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
									<div className="truncate">{segment.start.toFixed(3)}</div>
								</td>
								<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
									<div className="truncate">{segment.end.toFixed(3)}</div>
								</td>
								<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
									<div className="truncate">{segment.duration.toFixed(3)}</div>
								</td>
								<td className="hidden py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text text-[11px] text-text-secondary">
									<div className="truncate" title={segment.speaker_gender ?? ''}>
										{formatSpeakerGenderCell(segment.speaker_gender)}
									</div>
								</td>
								<td
									className={`py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 text-body-reg select-text ${
										findHighlight?.segmentIndex === idx && findHighlight.field === 'translation'
											? 'bg-primary-main/25'
											: ''
									}`}
								>
									<div className="truncate">{segment.translation || '-'}</div>
								</td>
								<td
									className={`py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 text-body-reg select-text ${
										findHighlight?.segmentIndex === idx && findHighlight.field === 'text'
											? 'bg-primary-main/25'
											: ''
									}`}
								>
									<div className="truncate">{segment.text}</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export const SubtitleTable = memo(SubtitleTableInner);
