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
	const [aiAgentWidth, setAiAgentWidth] = useState(320); // Начальная ширина
	const [isAiAgentResizing, setIsAiAgentResizing] = useState(false);

	const [tablePanelWidth, setTablePanelWidth] = useState(800);
  const [upperSectionHeight, setUpperSectionHeight] = useState(450);

	// Стейт для ширин первых 4-х фиксированных колонок
  const [colWidths, setColWidths] = useState([50, 120, 120, 100]);

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

	const startAiAgentResizing = useCallback((mouseDownEvent: React.MouseEvent) => {
  setIsAiAgentResizing(true);

  const startWidth = aiAgentWidth;
  const startX = mouseDownEvent.clientX;

  const doDrag = (mouseMoveEvent: MouseEvent) => {
    // Вычисляем новую ширину: начальная + разница координат
    const newWidth = startWidth + (mouseMoveEvent.clientX - startX);
    
    // Ограничиваем минимальную и максимальную ширину
    if (newWidth > 200 && newWidth < 600) {
      setAiAgentWidth(newWidth);
    }
  };

  const stopDrag = () => {
    setIsAiAgentResizing(false);
    window.removeEventListener('mousemove', doDrag);
    window.removeEventListener('mouseup', stopDrag);
  };

  window.addEventListener('mousemove', doDrag);
  window.addEventListener('mouseup', stopDrag);
}, [aiAgentWidth]);

	// Ресайз всей панели (Края: право и низ)
  const startTablePanelResizing = useCallback((direction: 'right' | 'bottom', mouseDownEvent: React.MouseEvent) => {
    const startWidth = tablePanelWidth;
    const startHeight = upperSectionHeight;
    const startX = mouseDownEvent.clientX;
    const startY = mouseDownEvent.clientY;

    const doDrag = (e: MouseEvent) => {
      if (direction === 'right') {
        const newWidth = startWidth + (e.clientX - startX);
        if (newWidth > 450 && newWidth < window.innerWidth - 400) setTablePanelWidth(newWidth);
      } else {
        const newHeight = startHeight + (e.clientY - startY);
        if (newHeight > 200 && newHeight < window.innerHeight - 150) setUpperSectionHeight(newHeight);
      }
    };

    const stopDrag = () => {
      window.removeEventListener('mousemove', doDrag);
      window.removeEventListener('mouseup', stopDrag);
    };
    window.addEventListener('mousemove', doDrag);
    window.addEventListener('mouseup', stopDrag);
  }, [tablePanelWidth, upperSectionHeight]);

  // Ресайз колонок таблицы
  const startColResize = useCallback((index: number, mouseDownEvent: React.MouseEvent) => {
    const startWidth = colWidths[index];
    const startX = mouseDownEvent.clientX;

    const doDrag = (e: MouseEvent) => {
      const newWidth = Math.max(40, startWidth + (e.clientX - startX));
      const newWidths = [...colWidths];
      newWidths[index] = newWidth;
      setColWidths(newWidths);
    };

    const stopDrag = () => {
      window.removeEventListener('mousemove', doDrag);
      window.removeEventListener('mouseup', stopDrag);
    };
    window.addEventListener('mousemove', doDrag);
    window.addEventListener('mouseup', stopDrag);
  }, [colWidths]);


  return (
    // Главный контейнер. Добавил min-h-0, чтобы разрешить сжатие
    <div className="flex h-screen w-full bg-surface-bg text-text-primary overflow-hidden font-inter min-h-0 select-none">
      
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
					<span className="text-h1-heading text-text-primary truncate font-inter pr-1">
						VIMN_KALLY_20
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

      {/* ПАНЕЛЬ (AI-AGENT) - Теперь ресайзится */}
			<div 
				// w-80 (320px) заменяем на динамическую ширину из стейта
				style={{ width: `${aiAgentWidth || 320}px` }} 
				className="flex flex-col h-full bg-surface-bg shrink-0 min-h-0 relative select-none border-r border-border-default antialiased"
			>
				{/* 1) Заголовок (идентичен Project Tree) */}
				<div className="h-[44px] flex items-center justify-between px-3 bg-panel-header border-b border-border-default shrink-0 gap-[12px]">
					<span className="text-h1-heading text-text-primary truncate font-inter pr-1">
						AI-agent
					</span>
					
					<div className="flex items-center gap-[12px] shrink-0">
						{/* Заглушка: Плюс (16x16) */}
						<button title="Add" className="group w-4 h-4 flex items-center justify-center shrink-0">
							<div className="w-4 h-4 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
						</button>
						
						{/* Заглушка: Три точки (16x16) */}
						<button title="Options" className="group w-4 h-4 flex items-center justify-center shrink-0">
							<div className="w-4 h-4 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
						</button>
					</div>
				</div>

				{/* 2) Блок чата - Исправлена толщина обводки (убраны border-t/r/b) */}
				<div className="flex-1 overflow-y-auto p-[12px] bg-surface-bg flex flex-col gap-4">
					
					{/* Сообщение пользователя (Справа) */}
					<div className="self-end max-w-[90%] flex flex-col items-end">
						<div className="bg-surface-secondary rounded-[10px] rounded-tr-none p-[8px] select-text">
							<p className="text-body-reg text-text-primary font-inter leading-tight">
								Помоги понять контекст этой фразы: "She's really hitting her stride with this new project."
							</p>
						</div>
					</div>

					{/* Сообщение агента (Слева) */}
					<div className="self-start max-w-[95%] flex flex-col items-start">
						<div className="bg-surface-panel rounded-[10px] rounded-bl-none p-[8px] select-text">
							<p className="text-body-reg text-text-primary font-inter leading-tight">
								Конечно! Эта идиома означает, что человек вошел в ритм и начал работать эффективно. Вот варианты перевода:
							</p>

							{/* Встраиваемая реплика (Весь текст Caption) */}
							<div className="mt-3 bg-[#E9ECF0] rounded-[10px] p-[8px] flex flex-col gap-[8px] w-full">
								{/* Верхняя строка: Стрелочка (16x16) и кнопки */}
								<div className="flex items-center justify-between">
									<div className="w-4 h-4 bg-text-primary/20 rounded-sm flex items-center justify-center cursor-pointer hover:bg-text-primary/30 transition-colors">
										<div className="w-2 h-1 bg-text-primary/40 rounded-full" /> 
									</div>
									<div className="flex gap-[12px]">
										<button className="text-caption font-inter text-text-secondary hover:text-text-primary transition-colors">Undo</button>
										<button className="text-caption font-inter text-text-secondary hover:text-text-primary transition-colors">Keep</button>
									</div>
								</div>

								{/* Метаданные: ID, Таймкод и Тонкая Линия 1px */}
								<div className="flex items-center gap-[14px] text-caption font-inter text-text-primary/60">
									<span className="whitespace-nowrap">#152</span>
									<span className="whitespace-nowrap">[ 00:01:03 ]</span>
									<div className="flex-1 h-[1px] bg-border-default" /> {/* Тонкая линия как в Project Tree */}
								</div>

								{/* Полоски реплик (Высота 22px, padding 4px, corner 2px) */}
								<div className="flex flex-col gap-[4px]">
									<div className="h-[22px] bg-[#f8d7da] rounded-[2px] px-[4px] flex items-center">
										<span className="text-caption text-text-primary truncate font-inter">Поехали сегодня в Магикс!</span>
									</div>
									<div className="h-[22px] bg-[#d4edda] rounded-[2px] px-[4px] flex items-center">
										<span className="text-caption text-text-primary truncate font-inter">Поехали сегодня в Магиксию!</span>
									</div>
								</div>
							</div>
						</div>
					</div>

					{/* Еще одно сообщение пользователя */}
					<div className="self-end max-w-[90%]">
						<div className="bg-surface-secondary rounded-[10px] rounded-tr-none p-[8px] select-text">
							<p className="text-body-reg text-text-primary font-inter leading-tight">
								Измени во всех репликах слово Магикс на Магиксия.
							</p>
						</div>
					</div>
				</div>

				{/* Нижнее поле ввода (Chat Input) */}
				{/* Нижнее поле ввода (Chat Input) */}
				<div className="p-3 bg-surface-bg shrink-0">
					<div className="relative flex flex-col bg-surface-secondary border border-border-default rounded-[10px] group transition-all focus-within:border-primary-main/50 shadow-sm min-h-[96px]">
						
						{/* Textarea — добавлен pr-[56px], чтобы текст не затекал под кнопку */}
						<textarea 
							placeholder="Помоги, пожалуйста, перевести..."
							className="w-full h-full p-3 pr-[56px] bg-transparent border-none outline-none text-body-reg text-text-primary placeholder:text-primary-disabled font-inter resize-none overflow-y-auto no-scrollbar"
							rows={3}
						/>

						{/* Кнопка отправки — теперь она никогда не перекроет текст */}
						<div className="absolute right-3 bottom-3">
							<button 
								title="Send message" 
								className="group w-[40px] h-[40px] flex items-center justify-center shrink-0"
							>
								<div className="w-[40px] h-[40px] bg-secondary-hover rounded-full group-hover:bg-primary-main transition-colors flex items-center justify-center">
									<div className="w-4 h-4 bg-white/30 rounded-sm" />
								</div>
							</button>
						</div>

					</div>
				</div>

				{/* РЕСАЙЗЕР: Копия из Project Tree (Смещен на край) */}
				<div 
					onMouseDown={startAiAgentResizing} // Вам нужно добавить хэндлер в parent App
					className={`absolute right-[-4px] top-0 w-[8px] h-full cursor-col-resize z-30 transition-colors ${
						isAiAgentResizing ? 'bg-primary-main/20' : 'hover:bg-primary-main/10'
					}`}
				/>
			</div>

      {/* ПРАВАЯ ЧАСТЬ (РЕДАКТОР И ПЛЕЕР) */}
      <div className="flex-1 flex flex-col min-w-0 bg-surface-bg">
        
        {/* Верх: Таблица и Видео */}
        {/* Верх: Таблица и Видео */}
        <div 
          style={{ height: `${upperSectionHeight}px` }}
          className="flex overflow-hidden border-b border-border-default min-h-0 shrink-0"
        >
          <div 
            style={{ width: `${tablePanelWidth}px` }}
            className="flex flex-col bg-surface-secondary relative shrink-0 min-w-0"
          >
            <div className="p-3 flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto no-scrollbar subtitle-table-scroll bg-surface-secondary">
                <table className="w-full border-collapse table-fixed">
                  <thead className="sticky top-0 bg-surface-secondary z-20">
                    <tr className="h-[25px]">
                      {['#', 'Start time', 'End time', 'Duration'].map((label, idx) => (
                        <th 
                          key={idx} 
                          style={{ width: `${colWidths[idx]}px` }}
                          className="relative h-[25px] py-1 px-2 text-left text-[14px] font-bold text-text-primary border-b border-[#F0F0F0] select-none min-w-0"
                        >
                          <div className="truncate w-full">{label}</div>
                          <div 
                            onMouseDown={(e) => startColResize(idx, e)}
                            className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-primary-main/30 z-10" 
                          />
                        </th>
                      ))}
                      <th className="h-[25px] py-1 px-2 text-left text-[14px] font-bold text-text-primary border-b border-[#F0F0F0] min-w-0">
                        <div className="truncate w-full">Translation</div>
                      </th>
                      <th className="h-[25px] py-1 px-2 text-left text-[14px] font-bold text-text-primary border-b border-[#F0F0F0] min-w-0">
                        <div className="truncate w-full">Original text</div>
                      </th>
                    </tr>
                  </thead>
                  
                  <tbody>
                    {Array.from({ length: 25 }).map((_, i) => (
                      <tr key={i} className="h-[25px] hover:bg-black/5 transition-colors group text-table">
                        <td className="py-1 px-2 border-b border-[#F0F0F0] whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
                          <div className="truncate">{i + 1}</div>
                        </td>
                        <td className="py-1 px-2 border-b border-[#F0F0F0] whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
                          <div className="truncate">00:01:03,174</div>
                        </td>
                        <td className="py-1 px-2 border-b border-[#F0F0F0] whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
                          <div className="truncate">00:01:03,174</div>
                        </td>
                        <td className="py-1 px-2 border-b border-[#F0F0F0] whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
                          <div className="truncate">1,244</div>
                        </td>
                        <td className="py-1 px-2 border-b border-[#F0F0F0] whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 text-body-reg select-text">
                          <div className="truncate">It's the biggest event of the year in Magix...</div>
                        </td>
                        <td className="py-1 px-2 border-b border-[#F0F0F0] whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 text-body-reg select-text">
                          <div className="truncate">C'est le plus grand événement de l'année...</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* РЕСАЙЗЕРЫ ПАНЕЛИ */}
            {/* Правый край — оставляем подсветку для удобства */}
            <div 
              onMouseDown={(e) => startTablePanelResizing('right', e)}
              className="absolute right-0 top-0 w-1 h-full cursor-col-resize z-50 hover:bg-primary-main/20 transition-colors"
            />
            {/* Нижний край — УБРАНА подсветка hover, чтобы не было "полосы" */}
            <div 
              onMouseDown={(e) => startTablePanelResizing('bottom', e)}
              className="absolute bottom-0 left-0 w-full h-1.5 cursor-row-resize z-50 bg-transparent"
            />
          </div>
          
          {/* Видеоплеер */}
          <div className="flex-1 bg-black flex flex-col shadow-inner min-w-[300px] overflow-hidden">
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