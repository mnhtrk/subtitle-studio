import { useEffect, useRef } from 'react';
import type { ProjectFile } from '../../services/projectService';
import { sanitizeFileBaseInput, splitFileNameAndExtension } from '../../utils/fileName';

type ProjectTreeFileRowProps = {
	file: ProjectFile;
	selected: boolean;
	active: boolean;
	renaming: boolean;
	renameDraft: string;
	onRenameDraftChange: (value: string) => void;
	onClick: () => void;
	onContextMenu: (e: React.MouseEvent) => void;
	onCommitRename: () => void;
	onCancelRename: () => void;
};

export function ProjectTreeFileRow({
	file,
	selected,
	active,
	renaming,
	renameDraft,
	onRenameDraftChange,
	onClick,
	onContextMenu,
	onCommitRename,
	onCancelRename
}: ProjectTreeFileRowProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const { ext } = splitFileNameAndExtension(file.name);

	useEffect(() => {
		if (!renaming) return;
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		el.select();
	}, [renaming]);

	const textClass = `font-inter font-semibold text-[12px] leading-none tracking-normal ${
		active ? 'text-primary-main' : 'text-text-primary'
	}`;

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => {
				if (renaming) return;
				onClick();
			}}
			onContextMenu={onContextMenu}
			onKeyDown={(e) => {
				if (renaming) return;
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onClick();
				}
			}}
			className={`hover:text-primary-main cursor-pointer truncate h-4 flex items-center min-w-0 rounded-[3px] px-[2px] ${
				selected ? 'bg-inline-bg' : ''
			}`}
		>
			{renaming ? (
				<div
					className="flex items-center min-w-0 flex-1 h-4 gap-0"
					onClick={(e) => e.stopPropagation()}
					onMouseDown={(e) => e.stopPropagation()}
				>
					<input
						ref={inputRef}
						type="text"
						value={renameDraft}
						onChange={(e) => onRenameDraftChange(sanitizeFileBaseInput(e.target.value, ext))}
						onBlur={() => onCommitRename()}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === 'Enter') {
								e.preventDefault();
								onCommitRename();
							} else if (e.key === 'Escape') {
								e.preventDefault();
								onCancelRename();
							}
						}}
						className="flex-1 min-w-0 h-4 px-[2px] py-0 bg-surface-bg border border-primary-main rounded-[2px] font-inter font-semibold text-[12px] leading-none text-text-primary outline-none"
					/>
					{ext ? <span className={`${textClass} shrink-0`}>.{ext}</span> : null}
				</div>
			) : (
				<span className={`${textClass} truncate`}>{file.name}</span>
			)}
		</div>
	);
}
