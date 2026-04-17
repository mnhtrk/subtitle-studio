import React from 'react';

interface WelcomeModalProps {
  onClose: () => void;
  onNewProject: () => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ onClose, onNewProject }) => {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-[9999] pointer-events-none">
      <div className="pointer-events-auto w-[780px] h-[424px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col gap-[24px] select-none">
        
        {/* Кнопки управления */}
        <div className="flex justify-end gap-[16px]">
          <button onClick={onClose} className="text-text-secondary hover:opacity-70 transition-opacity">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-[32px] flex-1">
          {/* Левая колонна */}
          <div className="flex flex-col">
            {/* ПРАВКА 1: Заголовок 24px Semi-bold */}
            <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[20px] text-text-primary mb-[24px]">Welcome!</h1>
            
            <div className="flex flex-col">
              {/* ПРАВКА 2: Стиль заголовка Recent projects */}
              <h3 className="text-body-reg text-text-secondary mb-[8px]">Recent projects</h3>
              
              {/* ПРАВКА 3: Настройки кнопок проектов (gap 4px) */}
              <div className="flex flex-col gap-[4px]">
                {['Pop_EN.sbt', 'FINAL_VIMN_WC_fr.sbt', 'Spy_kids_3d.sbt'].map((file, i) => (
                  <button 
										key={i} 
										className="w-full text-left px-[8px] py-[4px] rounded-[5px] bg-secondary-main hover:bg-secondary-hover transition-colors flex flex-col gap-[4px]"
									>
										<div className="text-body-reg text-text-primary leading-[18px]">
											{file}
										</div>
										<div className="text-caption text-text-secondary leading-[14px]">
											2 hours ago
										</div>
									</button>
                ))}
              </div>
            </div>
          </div>

          {/* Правая колонна (без изменений) */}
          <div className="flex flex-col gap-[4px]">
            <button 
							onClick={onNewProject} // <--- Добавить событие клика
							className="flex items-center justify-between px-[32px] py-[12px] rounded-[10px] bg-secondary-main hover:bg-secondary-hover transition-all flex-1 group"
						>
							<span className="text-h1-heading font-semibold tracking-[-0.01em] text-text-primary">New project</span>
							<div className="w-[48px] h-[48px] bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors shrink-0" />
						</button>
            <button className="flex items-center justify-between px-[32px] py-[12px] rounded-[10px] bg-secondary-main hover:bg-secondary-hover transition-all flex-1 group">
							<span className="text-h1-heading font-semibold tracking-[-0.01em] text-text-primary">Open a project</span>
							<div className="w-[48px] h-[48px] bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors shrink-0" />
						</button>
          </div>
        </div>
      </div>
    </div>
  );
};