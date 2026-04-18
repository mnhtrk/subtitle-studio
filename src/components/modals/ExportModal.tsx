import React from 'react';

interface ExportModalProps {
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ onClose }) => {
  // Пример списка файлов для пакетной обработки
  const files = Array(12).fill('ep01.srt');

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[10000] pointer-events-none">
      <div className="pointer-events-auto w-[840px] h-[560px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
        
        {/* РЯД 1: Хедер с кнопкой закрытия */}
        <div className="flex justify-end h-5 mb-2"> 
          <button onClick={onClose} className="text-text-secondary hover:opacity-70 transition-opacity">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Заголовки окна */}
        <div className="flex flex-col mb-8">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[32px] text-text-primary mb-2">
            Export
          </h1>
          <p className="text-body-reg text-text-secondary">
            You can batch export files with different settings.
          </p>
        </div>

        {/* РЯД 2: Основной контент (Сетка: Таблица + Поля) */}
        <div className="grid grid-cols-[1fr_1.1fr] gap-[32px] flex-1 min-h-0">
          
          {/* Левая часть: Список файлов */}
          <div className="flex flex-col min-h-0 border border-border-default rounded-[8px] bg-secondary-main overflow-hidden">
             <div className="h-[40px] border-b border-border-default flex items-center px-4 gap-3 bg-secondary-main sticky top-0 z-10">
                <input type="checkbox" className="w-4 h-4 rounded border-border-default accent-primary-main" />
                <span className="text-caption text-text-secondary">Select all</span>
             </div>
             
             {/* Тот самый скроллбар */}
             <div className="flex-1 overflow-y-auto subtitle-table-scroll">
                {files.map((file, i) => (
                  <div key={i} className="h-[40px] border-b border-border-default last:border-0 flex items-center px-4 gap-3 hover:bg-black/5 transition-colors">
                    <input type="checkbox" className="w-4 h-4 rounded border-border-default accent-primary-main" />
                    <span className="text-body-reg text-text-primary">{file}</span>
                  </div>
                ))}
             </div>
          </div>

          {/* Правая часть: Настройки */}
          <div className="flex flex-col gap-[24px]">
            <div className="flex flex-col gap-[8px]">
              <label className="text-caption text-text-secondary">File format</label>
              <div className="w-full px-[12px] py-[10px] bg-secondary-main border border-border-default rounded-[8px] flex items-center justify-between text-body-reg text-text-primary cursor-pointer hover:border-primary-main transition-colors">
                <span>PDF (.pdf)</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
              </div>
            </div>

            <div className="flex flex-col gap-[8px]">
              <label className="text-caption text-text-secondary">Encoding</label>
              <div className="w-full px-[12px] py-[10px] bg-secondary-main border border-border-default rounded-[8px] flex items-center justify-between text-body-reg text-text-primary cursor-pointer hover:border-primary-main transition-colors">
                <span>UTF-8 with BOM</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
              </div>
            </div>

            <div className="flex flex-col gap-[8px]">
              <label className="text-caption text-text-secondary">Saving location</label>
              <div className="relative">
                <input 
                  type="text" 
                  readOnly
                  value="C:/Users/Admin/Projects/VIMN_work/Exports"
                  className="w-full px-[12px] py-[10px] pr-[40px] bg-secondary-main border border-border-default rounded-[8px] text-body-reg text-text-secondary overflow-hidden text-ellipsis"
                />
                <div className="absolute right-[12px] top-1/2 -translate-y-1/2 text-text-primary cursor-pointer hover:text-primary-main">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* РЯД 3: Нижняя кнопка действия */}
        <div className="flex justify-end mt-8">
          <button className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors shadow-sm">
            Export files
          </button>
        </div>

      </div>
    </div>
  );
};