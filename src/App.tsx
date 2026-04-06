import React, { useState, useCallback, useEffect } from 'react';
import { 
  FilePlus2, 
  FolderPlus, 
  ChevronRight, 
  ChevronDown 
} from 'lucide-react';

export default function App() {

	const [projectTreeWidth, setProjectTreeWidth] = useState(240); // Начальная ширина 240px (w-60)
	const [isResizing, setIsResizing] = useState(false);
	const [isVideoFolderOpen, setIsVideoFolderOpen] = useState(true);

	const startResizing = useCallback(() => {
		setIsResizing(true);
	}, []);

	const stopResizing = useCallback(() => {
		setIsResizing(false);
	}, []);

	const resize = useCallback((mouseMoveEvent: MouseEvent) => {
		if (isResizing) {
			// Вычитаем ширину сайдбара (60px), чтобы расчет был точнее
			const newWidth = mouseMoveEvent.clientX - 60;
			if (newWidth > 150 && newWidth < 450) {
				setProjectTreeWidth(newWidth);
			}
		}
	}, [isResizing]);

	useEffect(() => {
		window.addEventListener("mousemove", resize);
		window.addEventListener("mouseup", stopResizing);
		return () => {
			window.removeEventListener("mousemove", resize);
			window.removeEventListener("mouseup", stopResizing);
		};
	}, [resize, stopResizing]);

  return (
    // Главный контейнер. Добавил min-h-0, чтобы разрешить сжатие
    <div className="flex h-screen w-full bg-surface-bg text-text-primary overflow-hidden font-inter min-h-0">
      
      {/* ЛЕВАЯ ПАНЕЛЬ (SIDEBAR) */}
			<div className="w-[60px] border-r border-border-default flex flex-col items-center py-6 bg-surface-panel shrink-0 h-full overflow-y-auto no-scrollbar">
				{/* Контейнер без gap, чтобы управлять отступами мастера вручную */}
				<div className="my-auto flex flex-col items-center">
					
					{/* Верхняя группа кнопок */}
					<div className="flex flex-col items-center gap-[30px]">
						<button title="Создать новый проект" className="group w-7 h-7 flex items-center justify-center shrink-0">
							<div className="w-7 h-7 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
						</button>
						
						<button title="Открыть проект" className="group w-7 h-7 flex items-center justify-center shrink-0">
							<div className="w-7 h-7 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
						</button>
						
						<button title="Сохранить проект" className="group w-7 h-7 flex items-center justify-center shrink-0">
							<div className="w-7 h-7 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
						</button>
					</div>

					{/* Кнопка мастера с уменьшенным визуальным отступом (22px вместо 30px) */}
					<button 
						title="Пошаговый мастер" 
						className="w-[48px] h-[48px] bg-primary-main rounded-full flex items-center justify-center shadow-md hover:bg-primary-hover transition-all shrink-0 my-[28px]"
					>
						<div className="w-7 h-7 bg-white/20 rounded-sm" />
					</button>

					{/* Нижняя группа кнопок */}
					<div className="flex flex-col items-center gap-[30px]">
						<button title="Экспорт" className="group w-7 h-7 flex items-center justify-center shrink-0">
							<div className="w-7 h-7 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
						</button>
						
						<button title="Глоссарий" className="group w-7 h-7 flex items-center justify-center shrink-0">
							<div className="w-7 h-7 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
						</button>

						<button title="Поиск" className="group w-7 h-7 flex items-center justify-center shrink-0">
							<div className="w-7 h-7 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
						</button>
					</div>
				</div>
			</div>

      {/* ПАНЕЛЬ: PROJECT TREE PANEL */}
			<div 
				style={{ width: `${projectTreeWidth}px` }} 
				className="flex flex-col h-full bg-surface-bg shrink-0 min-h-0 relative select-none border-r border-border-default antialiased"
			>
				{/* 1) Заголовок с градиентом и заглушками 16x16 */}
				<div className="h-[44px] flex items-center justify-between px-3 bg-panel-header border-b border-border-default shrink-0 gap-[12px]">
					<span className="text-[16px] font-bold tracking-[-0.01em] text-text-primary truncate font-inter pr-1">
						VIMN_KALLYS_2025
					</span>
					
					<div className="flex items-center gap-[12px] shrink-0">
						{/* Заглушка: Новый файл (16x16) */}
						<button title="New File" className="group w-4 h-4 flex items-center justify-center shrink-0">
							<div className="w-4 h-4 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
						</button>
						
						{/* Заглушка: Новая папка (16x16) */}
						<button title="New Folder" className="group w-4 h-4 flex items-center justify-center shrink-0">
							<div className="w-4 h-4 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
						</button>
					</div>
				</div>

				{/* 2) Список файлов (Project Tree) */}
				<div className="flex-1 overflow-y-auto p-3 bg-surface-bg">
					<div className="flex flex-col gap-[8px]"> {/* Строгий вертикальный ритм 8px */}
						
						{/* Элемент: .config */}
						<div className="flex items-center gap-[8px] cursor-pointer group h-4">
							<ChevronRight size={12} className="text-text-primary/70 shrink-0" />
							<span className="font-inter font-semibold text-[12px] leading-none text-text-primary tracking-normal">
								.config
							</span>
						</div>

						{/* Элемент: video (Раскрытая папка) */}
						<div className="flex flex-col gap-[8px]">
							<div 
								className="flex items-center gap-[8px] cursor-pointer h-4"
								onClick={() => setIsVideoFolderOpen(!isVideoFolderOpen)}
							>
								{isVideoFolderOpen ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
								<span className="font-inter font-semibold text-[12px] leading-none text-text-primary tracking-normal">
									video
								</span>
							</div>

							{/* Содержимое папки video */}
							{isVideoFolderOpen && (
								<div className="flex gap-[11px] ml-[5px]">
									{/* Линия иерархии */}
									<div className="w-[1px] bg-border-default shrink-0" />
									
									{/* Список файлов внутри: только gap-8, без padding у элементов */}
									<div className="flex flex-col gap-[8px] flex-1">
										{['S1E01.mp4', 'S1E02.mp4', 'S1E03.mp4', 'S1E04.mp4'].map((file) => (
											<div key={file} className="hover:text-primary-main cursor-pointer truncate h-4 flex items-center">
												<span className="font-inter font-semibold text-[12px] leading-none text-text-primary tracking-normal">
													{file}
												</span>
											</div>
										))}
									</div>
								</div>
							)}
						</div>

						{/* Элемент: subtitles */}
						<div className="flex items-center gap-[8px] cursor-pointer group h-4">
							<ChevronRight size={12} className="text-text-primary/70 shrink-0" />
							<span className="font-inter font-semibold text-[12px] leading-none text-text-primary tracking-normal">
								subtitles
							</span>
						</div>

						<div className="hover:text-primary-main cursor-pointer truncate h-4 flex items-center">
							<span className="font-inter font-semibold text-[12px] leading-none text-text-primary tracking-normal">
								vimn_license_idkidk.pdf
							</span>
						</div>

					</div>
				</div>

				{/* РЕСАЙЗЕР: Смещен на край для удобства захвата */}
				<div 
					onMouseDown={startResizing}
					className={`absolute right-[-4px] top-0 w-[8px] h-full cursor-col-resize z-30 transition-colors ${
						isResizing ? 'bg-primary-main/20' : 'hover:bg-primary-main/10'
					}`}
				/>
			</div>

      {/* ЦЕНТРАЛЬНАЯ ПАНЕЛЬ (AI-AGENT) */}
      <div className="w-80 border-r border-border-default flex flex-col bg-white shrink-0">
        <div className="p-3 h-[44px] border-b border-border-default flex justify-between items-center bg-surface-secondary">
          <span className="text-h1 font-semibold text-primary-main">AI-agent</span>
          <div className="text-primary-disabled text-xl cursor-pointer hover:text-primary-main">+</div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface-bg/50">
          <div className="bg-white border border-border-default p-3 rounded-lg shadow-sm text-body-reg ml-6">
            Помоги понять контекст этой фразы...
          </div>
          <div className="text-body-reg text-text-primary pr-6">
            Конечно! Эта идиома означает, что человек наконец-то вошел в ритм...
          </div>
        </div>
        <div className="p-4 border-t border-border-default">
          <div className="w-full h-10 px-4 bg-surface-bg rounded-full border border-border-default text-caption text-primary-disabled flex items-center">
            Помоги, пожалуйста, перевести...
          </div>
        </div>
      </div>

      {/* ПРАВАЯ ЧАСТЬ (РЕДАКТОР И ПЛЕЕР) */}
      <div className="flex-1 flex flex-col min-w-0 bg-surface-bg">
        
        {/* Верх: Таблица и Видео */}
        <div className="flex-[2] flex overflow-hidden border-b border-border-default min-h-0">
          {/* Редактор субтитров */}
          <div className="flex-1 flex flex-col bg-white overflow-hidden min-w-0">
            <div className="h-[44px] border-b border-border-default flex items-center px-4 bg-surface-secondary shrink-0">
              <span className="text-h1 font-semibold text-primary-main">Editor</span>
            </div>
            
            <div className="flex-1 overflow-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-surface-secondary border-b border-border-default z-10">
                  <tr className="text-caption font-medium text-text-secondary uppercase">
                    <th className="px-4 py-2 text-left w-12">#</th>
                    <th className="px-4 py-2 text-left w-32">Start</th>
                    <th className="px-4 py-2 text-left w-32">End</th>
                    <th className="px-4 py-2 text-left">Text</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-main">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <tr key={i} className="hover:bg-primary-surface/30 transition-colors group">
                      <td className="px-4 py-2 text-table font-medium text-text-secondary">{i}</td>
                      <td className="px-4 py-2 font-mono text-timecode text-primary-main">00:00:01,200</td>
                      <td className="px-4 py-2 font-mono text-timecode text-primary-main">00:00:04,500</td>
                      <td className="px-4 py-2 text-body-reg text-text-primary">
                        <input 
                          className="w-full bg-transparent outline-none border-none p-0 focus:ring-0" 
                          defaultValue="Тестовая строка субтитров..."
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
          {/* Видеоплеер */}
          <div className="w-[380px] bg-black flex flex-col shadow-inner shrink-0 overflow-hidden">
            <div className="flex-1 flex items-center justify-center text-white/10 text-caption uppercase tracking-widest">
              Video Preview
            </div>
            <div className="h-12 bg-white border-t border-border-default flex items-center px-4 gap-4 shrink-0">
               <div className="w-6 h-6 bg-secondary-main rounded-full"></div>
               <div className="flex-1 h-1 bg-secondary-disabled rounded"></div>
               <span className="text-timecode font-mono text-primary-main">00:01:22</span>
            </div>
          </div>
        </div>

        {/* Низ: Таймлайн (Audio Wave) */}
        {/* Заменил h-60 на flex-1 с ограничением, чтобы окно могло уменьшаться */}
        <div className="flex-1 min-h-[120px] max-h-60 bg-white p-4 shrink-0 border-t border-border-default">
          <div className="w-full h-full bg-primary-surface/30 border border-border-default rounded flex items-center justify-center relative overflow-hidden group">
             <div className="absolute inset-0 flex items-center justify-center opacity-10 group-hover:opacity-20 transition-opacity">
                <div className="w-full h-8 bg-primary-main rounded-full blur-xl"></div>
             </div>
             <span className="text-primary-main font-semibold text-caption uppercase tracking-widest">Audio Timeline Zone</span>
          </div>
        </div>

      </div>
    </div>
  );
}