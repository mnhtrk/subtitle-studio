import React from 'react';

interface NewProjectModalProps {
  onClose: () => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-[10000] pointer-events-none">
      {/* p-8 дает ровно 32px со всех сторон. Убрал gap-[24px], чтобы он не толкал контент вниз от хедера */}
      <div className="pointer-events-auto w-[780px] h-[424px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
        
        {/* Хедер модалки: mb-auto прижмет основной контент к центру/низу, если будет место, 
            но здесь мы полагаемся на flex-1 ниже */}
        <div className="flex justify-end h-5"> 
          <button onClick={onClose} className="text-text-secondary hover:opacity-70 transition-opacity">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Основной контентный блок: mt-4 компенсирует высоту хедера, чтобы визуально 
            центральная часть была выровнена, flex-1 заставляет блок занять все пространство до низа p-8 */}
        <div className="grid grid-cols-[1fr_1.2fr] gap-[32px] flex-1 mt-4">
          
          {/* Левая колонна */}
          <div className="flex flex-col">
            <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[20px] text-text-primary mb-[24px]">
              Create a new project
            </h1>
            <p className="text-body-reg text-text-secondary">
              Organize your work by title. A project folder stores your videos and subtitles.
            </p>
          </div>

          {/* Правая колонна: Убрал pb-2, так как он создавал лишний отступ снизу */}
          <div className="flex flex-col justify-between h-full">
            
            <div className="flex flex-col gap-[24px]">
              <div className="flex flex-col gap-[8px]">
                <label className="text-caption text-text-secondary">Project name</label>
                <input 
                  type="text" 
                  placeholder="My Awesome Series/Film"
                  className="w-full px-[12px] py-[10px] bg-secondary-main border border-border-default rounded-[8px] text-body-reg text-text-primary focus:outline-none focus:border-primary-main transition-colors"
                />
              </div>

              <div className="flex flex-col gap-[8px]">
                <label className="text-caption text-text-secondary">Project location</label>
                <div className="relative">
                  <input 
                    type="text" 
                    readOnly
                    value="C:/Users/Admin/Projects/VIMN_work"
                    className="w-full px-[12px] py-[10px] pr-[40px] bg-secondary-main border border-border-default rounded-[8px] text-body-reg text-text-secondary"
                  />
                  <div className="absolute right-[12px] top-1/2 -translate-y-1/2 text-text-primary">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z"/>
                    </svg>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-[8px]">
                <label className="text-caption text-text-secondary">Target language</label>
                <div className="w-full px-[12px] py-[10px] bg-secondary-main border border-border-default rounded-[8px] flex items-center justify-between text-body-reg text-text-primary">
                  <span>English</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
                </div>
              </div>
            </div>

            {/* Кнопка Create: теперь она стоит ровно в углу, ограниченном только p-8 (32px) */}
            <div className="flex justify-end">
              <button className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors shadow-sm">
                Create
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};