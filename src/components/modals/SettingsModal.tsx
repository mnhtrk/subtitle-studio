import React from 'react';
import { useI18n, type Locale } from '../../i18n';

interface SettingsModalProps {
	onClose: () => void;
	isDarkTheme: boolean;
	onDarkThemeChange: (dark: boolean) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
	onClose,
	isDarkTheme,
	onDarkThemeChange
}) => {
	const { locale, setLocale, t } = useI18n();

	const langBtnClass = (lang: Locale) =>
		`flex-1 h-[42px] px-3 rounded-[12px] text-body-reg transition-colors border ${
			locale === lang
				? 'bg-secondary-main border-text-primary text-text-primary'
				: 'bg-secondary-disabled border-border-default text-text-secondary hover:border-primary-main'
		}`;

	return (
		<div className="fixed inset-0 flex items-center justify-center z-[10000] pointer-events-none">
			<div className="pointer-events-auto w-[780px] h-[424px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
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

				<div className="flex flex-col mb-8">
					<h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[32px] text-text-primary mb-2">
						{t('settings.title')}
					</h1>
					<p className="text-body-reg text-text-secondary">
						{t('settings.desc')}
					</p>
				</div>

				<div className="flex-1 flex flex-col gap-[24px]">
					<div className="flex flex-col gap-[8px]">
						<label className="text-caption text-text-secondary">{t('settings.language')}</label>
						<div className="flex gap-[12px]">
							<button type="button" className={langBtnClass('en')} onClick={() => setLocale('en')}>
								{t('settings.languageEn')}
							</button>
							<button type="button" className={langBtnClass('ru')} onClick={() => setLocale('ru')}>
								{t('settings.languageRu')}
							</button>
						</div>
					</div>

					<div className="flex flex-col gap-[8px]">
						<label className="text-caption text-text-secondary">{t('settings.theme')}</label>
						<button
							type="button"
							onClick={() => onDarkThemeChange(!isDarkTheme)}
							className="w-full h-[42px] px-3 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary hover:border-primary-main transition-colors text-left"
						>
							{isDarkTheme ? t('settings.themeDark') : t('settings.themeLight')}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};
