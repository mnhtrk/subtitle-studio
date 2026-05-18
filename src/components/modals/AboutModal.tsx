import React from 'react';
import { useI18n } from '../../i18n';
import { DraggableModalShell } from './DraggableModalShell';

interface AboutModalProps {
	onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ onClose }) => {
	const { t } = useI18n();

	return (
		<DraggableModalShell
			width={480}
			className="bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none"
		>
			<div className="flex justify-end h-5 mb-2">
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
			<div className="flex flex-col mb-6">
				<h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[32px] text-text-primary mb-2">
					{t('about.title')}
				</h1>
				<p className="text-body-reg text-text-secondary">{t('about.desc')}</p>
			</div>
			<div className="flex flex-col gap-3 text-body-reg text-text-primary">
				<div>
					<span className="text-caption text-text-secondary">{t('about.developers')}</span>
					<p className="mt-1">{t('about.developersList')}</p>
				</div>
				<p className="text-text-secondary">{t('about.copyright')}</p>
			</div>
		</DraggableModalShell>
	);
};
