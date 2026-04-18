import React, { useState, useCallback, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { WelcomeModal } from './components/modals/WelcomeModal';
import { NewProjectModal } from './components/modals/NewProjectModal';
import { WizardModal } from './components/modals/WizardModal';
import { ExportModal } from './components/modals/ExportModal';
import { GlossaryModal } from './components/modals/GlossaryModal';

const appWindow = getCurrentWindow();

import { 
  FilePlus2, 
  FolderPlus, 
  ChevronRight, 
  ChevronDown 
} from 'lucide-react';

const LIMITS = {
  SIDEBAR: 60,
  PROJECT_TREE: { MIN: 150, MAX: 250 },
  AI_AGENT: { MIN: 280, MAX: 400 },
  TABLE: 300,
  VIDEO: 400,
};

export default function App() {

	const [windowSize, setWindowSize] = useState({
		width: window.innerWidth,
		height: window.innerHeight
	});

	useEffect(() => {
		const handleResize = () => {
			setWindowSize({
				width: window.innerWidth,
				height: window.innerHeight
			});
		};

		window.addEventListener('resize', handleResize);

		return () => window.removeEventListener('resize', handleResize);
	}, []);

	useEffect(() => {
		const unlisten = appWindow.listen('tauri://resize', () => {
			setWindowSize({
				width: window.innerWidth,
				height: window.innerHeight
			});
		});

		return () => {
			unlisten.then(f => f());
		};
	}, []);


	// начальные размеры и статусы
	const [projectTreeWidth, setProjectTreeWidth] = useState(240); // начальная ширина иерархия файлов
	const [isResizing, setIsResizing] = useState(false); //проверка тянушки
	const [isVideoFolderOpen, setIsVideoFolderOpen] = useState(true); //проверка открытой папки
	const [aiAgentWidth, setAiAgentWidth] = useState(320); // Начальная ширина панели с агентом
	const [isAiAgentResizing, setIsAiAgentResizing] = useState(false); //проверка тянушки агента

	const [tablePanelWidth, setTablePanelWidth] = useState(800); //размер таблицы
  const [upperSectionHeight, setUpperSectionHeight] = useState(450); //высота панели таблицы и плеера

	// Стейт для ширин первых 4-х фиксированных колонок
  const [colWidths, setColWidths] = useState([50, 120, 120, 100]);

	// состояние для выпадающих списков верхнего меню
	const [activeMenu, setActiveMenu] = useState<string | null>(null);

	type ModalType =
		| null
		| 'welcome'
		| 'newProject'
		| 'wizardStep1'
		| 'wizardStep2'
		| 'wizardStep3'
		| 'wizardStep4'
		| 'wizardStep5'
		| 'wizardStep6'
		| 'wizardStep7'
		| 'glossary'
		| 'export'
		| 'find'
		| 'spellcheck';

	const [activeModal, setActiveModal] = useState<'welcome' | 'createProject' | 'wizard' | 'glossary' | 'export' | null>('welcome');
	const openWizard = () => setActiveModal('wizard');
	const openNewProject = () => setActiveModal('createProject');

	useEffect(() => {
		setActiveModal('welcome');
	}, []);


	// системные функции для управления окном через таури
	const handleMinimize = async () => {
		await appWindow.minimize();
	};

	const handleMaximize = async () => {
		await appWindow.toggleMaximize();
	};

	const handleClose = async () => {
		await appWindow.close();
	};

	

	// Добавить эффект для закрытия меню при клике вне его
	useEffect(() => {
		const handleClickOutside = () => setActiveMenu(null);
		if (activeMenu) {
			window.addEventListener('click', handleClickOutside);
		}
		return () => window.removeEventListener('click', handleClickOutside);
	}, [activeMenu]);

	const [isDarkTheme, setIsDarkTheme] = useState(() => {
		const saved = localStorage.getItem('theme');
		return saved === 'dark';
	});

	useEffect(() => {
		document.documentElement.classList.toggle('dark', isDarkTheme);
		localStorage.setItem('theme', isDarkTheme ? 'dark' : 'light');
	}, [isDarkTheme]);

	// Список пунктов меню наверху
	const menuItems = [
		{ label: 'File', items: [{ label: 'New Project', action: () => setActiveModal('createProject') }, { label: 'Open Project' }, { label: 'Save' }, { label: 'Exit' }] },
		{ label: 'Edit', items: [{ label: 'Undo' }, { label: 'Redo' }, { label: 'Find' }] },
		{ label: 'Tools', items: [{ label: 'Spell check' }, { label: 'Batch convert' }] },
		{ label: 'Video', items: [{ label: 'Open video file' }, { label: 'Audio track' }] },
		{
			label: 'Help',
			items: [
				{ label: 'About' },
				{ label: 'Updates' },
				{
					label: isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme',
					action: () => setIsDarkTheme(prev => !prev),
				},
			],
		},
	];
	

	// режим изменения размера
	const startResizing = useCallback(() => {
		setIsResizing(true);
	}, []);

	const stopResizing = useCallback(() => {
		setIsResizing(false);
	}, []);

	// высчитываем ширину дерева проекта при движении мышки с учетом бокового меню
	const resize = useCallback((mouseMoveEvent: MouseEvent) => {
		if (isResizing) {
			const newWidth = mouseMoveEvent.clientX - 60;
			const maxDynamic = windowSize.width - (aiAgentWidth + LIMITS.TABLE + LIMITS.VIDEO + LIMITS.SIDEBAR);
			const max = Math.min(LIMITS.PROJECT_TREE.MAX, maxDynamic);
			if (newWidth > LIMITS.PROJECT_TREE.MIN && newWidth < max) {
				setProjectTreeWidth(newWidth);
			}
		}
	}, [isResizing, windowSize, aiAgentWidth]);

	// вешаем глобальные слушатели на мышку для работы ресайза
	useEffect(() => {
		window.addEventListener("mousemove", resize);
		window.addEventListener("mouseup", stopResizing);
		return () => {
			window.removeEventListener("mousemove", resize);
			window.removeEventListener("mouseup", stopResizing);
		};
	}, [resize, stopResizing]);

	useEffect(() => {
		const totalFixed = 60 + projectTreeWidth + aiAgentWidth;

		// 👉 сколько реально можно дать таблице, чтобы видео не сломалось
		const maxTable = windowSize.width - totalFixed - LIMITS.VIDEO;

		// 👉 если таблица слишком большая — ужимаем
		if (tablePanelWidth > maxTable) {
			setTablePanelWidth(Math.max(300, maxTable));
		}

		// 👉 если наоборот таблица ок, но видео уже меньше минимума — тоже ужимаем таблицу
		const currentVideoWidth = windowSize.width - totalFixed - tablePanelWidth;

		if (currentVideoWidth < LIMITS.VIDEO) {
			const fixedTable = windowSize.width - totalFixed - LIMITS.VIDEO;
			setTablePanelWidth(Math.max(300, fixedTable));
		}

		// высота
		if (upperSectionHeight > windowSize.height - 150) {
			setUpperSectionHeight(windowSize.height - 150);
		}

	}, [windowSize, tablePanelWidth, projectTreeWidth, aiAgentWidth]);

	// логика изменения ширины панели аи агента через прямое управление событиями
	const startAiAgentResizing = useCallback((mouseDownEvent: React.MouseEvent) => {
		setIsAiAgentResizing(true);

		const startWidth = aiAgentWidth;
		const startX = mouseDownEvent.clientX;
		

		const doDrag = (mouseMoveEvent: MouseEvent) => {
			const newWidth = startWidth + (mouseMoveEvent.clientX - startX);
			const maxDynamic = windowSize.width - (LIMITS.SIDEBAR + projectTreeWidth + LIMITS.TABLE + LIMITS.VIDEO);
			const max = Math.min(LIMITS.AI_AGENT.MAX, maxDynamic);
			if (newWidth > LIMITS.AI_AGENT.MIN && newWidth < max) {
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

	// Ресайз всей панели
  const startTablePanelResizing = useCallback((direction: 'right' | 'bottom', mouseDownEvent: React.MouseEvent) => {
    const startWidth = tablePanelWidth;
    const startHeight = upperSectionHeight;
    const startX = mouseDownEvent.clientX;
    const startY = mouseDownEvent.clientY;

    const doDrag = (e: MouseEvent) => {
			if (direction === 'right') {
				const newWidth = startWidth + (e.clientX - startX);
				
				const minTableWidth = 400; 

				const maxAllowedWidth = windowSize.width 
				- (60 + projectTreeWidth + aiAgentWidth) 
				- LIMITS.VIDEO;

				if (newWidth >= minTableWidth && newWidth <= maxAllowedWidth) {
					setTablePanelWidth(newWidth);
				}
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
		}, [tablePanelWidth, upperSectionHeight, windowSize, projectTreeWidth, aiAgentWidth]);

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
    <div className="flex flex-col h-screen w-full overflow-hidden bg-surface-bg select-none">
			{/* Верхнее меню, название проекта, 3 кнопки */}
			<div 
				className="h-[32px] flex items-center justify-between shrink-0 bg-surface-bg border-b border-border-default select-none relative z-[100]"
				style={{ ['WebkitAppRegion' as any]: 'drag' }} // Вся строка по умолчанию тягабельная
			>
				
				{/* ЛЕВАЯ ЧАСТЬ Лого и Меню */}
				<div className="flex items-center px-2 gap-1" style={{ ['WebkitAppRegion' as any]: 'no-drag' }}>
					{/* Логотип */}
					<div className="w-4 h-4 bg-[#C42B1C] rounded-sm flex items-center justify-center text-[10px] text-white font-bold shrink-0 mr-1">
						SE
					</div>

					{/* Пункты меню */}
					<div className="flex items-center gap-0.5">
						{menuItems.map((menu) => (
							<div key={menu.label} className="relative">
								<button 
									onClick={(e) => {
										e.stopPropagation();
										setActiveMenu(activeMenu === menu.label ? null : menu.label);
									}}
									className={`px-2 h-[24px] flex items-center text-[12px] font-inter rounded-sm transition-colors 
										${activeMenu === menu.label 
											? 'bg-primary-main text-white' 
											: 'text-text-primary hover:bg-secondary-hover'}`}
								>
									{menu.label}
								</button>

								{/* Выпадающий список */}
								{activeMenu === menu.label && (
									<div className="rounded-[8px] absolute left-0 top-[26px] min-w-[160px] bg-surface-secondary border border-border-default shadow-lg py-1 flex flex-col z-[110]">
										{menu.items.map((subItem) => (
										<button
											key={subItem.label}
											className="px-3 h-[28px] flex items-center text-[12px] font-inter text-text-primary hover:bg-primary-main hover:text-white text-left transition-colors"
											onClick={() => {
												subItem.action?.();
												setActiveMenu(null);
											}}
										>
											{subItem.label}
										</button>
									))}
									</div>
								)}
							</div>
						))}
					</div>
				</div>

				{/* ЦЕНТРАЛЬНАЯ ЧАСТЬ Название проекта */}
				<div className="flex-1 flex justify-center items-center h-full overflow-hidden px-4">
					<span className="text-[11px] text-text-primary font-inter truncate">
						{isVideoFolderOpen ? 'S1E01.mp4' : 'Untitled'} - subtitlestudio
					</span>
				</div>

				{/* ПРАВАЯ ЧАСТЬ Системные кнопки */}
				<div className="flex items-center h-full" style={{ ['WebkitAppRegion' as any]: 'no-drag' }}>
					<button 
						onClick={() => appWindow.minimize()}
						className="w-[46px] h-full flex items-center justify-center hover:bg-secondary-hover transition-colors"
					>
						<div className="w-2.5 h-[1px] bg-text-primary" />
					</button>
					<button 
						onClick={() => appWindow.toggleMaximize()}
						className="w-[46px] h-full flex items-center justify-center hover:bg-secondary-hover transition-colors"
					>
						<div className="w-2.5 h-2.5 border border-text-primary" />
					</button>
					<button 
						onClick={() => appWindow.close()}
						className="w-[46px] h-full flex items-center justify-center hover:bg-[#E81123] group transition-colors"
					>
						<div className="relative w-3 h-3 flex items-center justify-center">
							<div className="absolute w-full h-[1px] bg-text-primary group-hover:bg-surface-secondary rotate-45" />
							<div className="absolute w-full h-[1px] bg-text-primary group-hover:bg-surface-secondary -rotate-45" />
						</div>
					</button>
				</div>
			</div>

			{/* ОСНОВНОЙ КОНТЕНТ */}
			<div className="flex h-screen w-full bg-surface-bg text-text-primary overflow-hidden font-inter min-h-0 select-none">
      
				{/* ЛЕВАЯ ПАНЕЛЬ (САЙДБАР) */}
				<div className="w-[60px] border-r border-border-default flex flex-col items-center py-6 bg-surface-panel shrink-0 h-full overflow-y-auto no-scrollbar">
					<div className="my-auto flex flex-col items-center">
						
						{/* Верхняя группа кнопок */}
						<div className="flex flex-col items-center gap-[30px]">
							<button 
									title="Создать новый проект" 
									onClick={() => setActiveModal('createProject')} // <-- Добавь это
									className="group w-7 h-7 flex items-center justify-center shrink-0"
							>
									<div className="w-7 h-7 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
							</button>
							
							<button title="Открыть проект" className="group w-7 h-7 flex items-center justify-center shrink-0">
								<div className="w-7 h-7 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
							</button>
							
							<button title="Сохранить проект" className="group w-7 h-7 flex items-center justify-center shrink-0">
								<div className="w-7 h-7 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
							</button>
						</div>

						{/* Кнопка мастера в круге */}
						<button 
								onClick={openWizard} // Добавили клик
								title="Пошаговый мастер" 
								className="w-[48px] h-[48px] bg-primary-main rounded-full flex items-center justify-center shadow-md hover:bg-primary-hover transition-all shrink-0 my-[28px]"
						>
								<div className="w-7 h-7 bg-surface-secondary/20 rounded-sm" />
						</button>

						{/* Нижняя группа кнопок */}
						<div className="flex flex-col items-center gap-[30px]">
							<button title="Экспорт" onClick={() => setActiveModal('export')} className="group w-7 h-7 flex items-center justify-center shrink-0">
								<div className="w-7 h-7 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
							</button>
							
							<button 
								title="Глоссарий" 
								onClick={() => setActiveModal('glossary')} // Открываем глоссарий
								className="group w-7 h-7 flex items-center justify-center shrink-0"
							>
								<div className="w-7 h-7 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
							</button>

							<button title="Поиск" className="group w-7 h-7 flex items-center justify-center shrink-0">
								<div className="w-7 h-7 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
							</button>
						</div>
					</div>
				</div>

				{/* ПАНЕЛЬ ИЕРАРХИЯ ПРОЕКТА */}
				<div 
					style={{ width: `${projectTreeWidth}px`, maxWidth: `${LIMITS.PROJECT_TREE.MAX}px` }}
					className="flex flex-col h-full bg-surface-bg shrink-0 min-h-0 relative select-none border-r border-border-default antialiased"
				>
					{/* Заголовок */}
					<div className="h-[44px] flex items-center justify-between px-3 bg-panel-header border-b border-border-default shrink-0 gap-[12px]">
						<span className="text-h1-heading text-text-primary truncate font-inter pr-1">
							VIMN_KALLY_20
						</span>
						
						<div className="flex items-center gap-[12px] shrink-0">

							<button title="New File" className="group w-4 h-4 flex items-center justify-center shrink-0">
								<div className="w-4 h-4 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
							</button>
							
							<button title="New Folder" className="group w-4 h-4 flex items-center justify-center shrink-0">
								<div className="w-4 h-4 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
							</button>
						</div>
					</div>

					{/* Список файлов */}
					<div className="flex-1 overflow-y-auto p-3 bg-surface-bg">
						<div className="flex flex-col gap-[8px]"> {/* Строгий вертикальный ритм 8px */}
						
							<div className="flex items-center gap-[8px] cursor-pointer group h-4">
								<ChevronRight size={12} className="text-text-primary/70 shrink-0" />
								<span className="font-inter font-semibold text-[12px] leading-none text-text-primary tracking-normal">
									.config
								</span>
							</div>

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

								{isVideoFolderOpen && (
									<div className="flex gap-[11px] ml-[5px]">
										<div className="w-[1px] bg-border-default shrink-0" />
										
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

					{/* РЕСАЙЗЕР */}
					<div 
						onMouseDown={startResizing}
						className={`absolute right-[-4px] top-0 w-[8px] h-full cursor-col-resize z-30 transition-colors ${
							isResizing ? 'bg-primary-main/20' : 'hover:bg-primary-main/10'
						}`}
					/>
				</div>

				{/* ПАНЕЛЬ ИИ-АГЕНТА */}
				<div 
					style={{ 
						width: `${aiAgentWidth || 320}px`, 
						minWidth: `${LIMITS.AI_AGENT.MIN}px`,
						maxWidth: `${LIMITS.AI_AGENT.MAX}px`
					}}
					className="flex flex-col h-full bg-surface-bg shrink-0 min-h-0 relative select-none border-r border-border-default antialiased"
				>
					{/* Заголовок */}
					<div className="h-[44px] flex items-center justify-between px-3 bg-panel-header border-b border-border-default shrink-0 gap-[12px]">
						<span className="text-h1-heading text-text-primary truncate font-inter pr-1">
							AI-agent
						</span>
						
						<div className="flex items-center gap-[12px] shrink-0">
							<button title="Add" className="group w-4 h-4 flex items-center justify-center shrink-0">
								<div className="w-4 h-4 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
							</button>
							
							<button title="Options" className="group w-4 h-4 flex items-center justify-center shrink-0">
								<div className="w-4 h-4 bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
							</button>
						</div>
					</div>

					{/* Блок чата */}
					<div className="flex-1 overflow-y-auto p-[12px] bg-surface-bg flex flex-col gap-4">
						
						{/* Сообщение пользователя Справа */}
						<div className="self-end max-w-[90%] flex flex-col items-end">
							<div className="bg-surface-secondary rounded-[10px] rounded-tr-none p-[8px] select-text">
								<p className="text-body-reg text-text-primary font-inter leading-tight">
									Помоги понять контекст этой фразы: "She's really hitting her stride with this new project."
								</p>
							</div>
						</div>

						{/* Сообщение агента Слева */}
						<div className="self-start max-w-[95%] flex flex-col items-start">
							<div className="bg-surface-panel rounded-[10px] rounded-bl-none p-[8px] select-text">
								<p className="text-body-reg text-text-primary font-inter leading-tight">
									Конечно! Эта идиома означает, что человек вошел в ритм и начал работать эффективно. Вот варианты перевода:
								</p>

								{/* Встраиваемая реплика */}
								<div className="mt-3 bg-inline-bg rounded-[10px] p-[8px] flex flex-col gap-[8px] w-full">
									<div className="flex items-center justify-between">
										<div className="w-4 h-4 bg-text-primary/20 rounded-sm flex items-center justify-center cursor-pointer hover:bg-text-primary/30 transition-colors">
											<div className="w-2 h-1 bg-text-primary/40 rounded-full" /> 
										</div>
										<div className="flex gap-[12px]">
											<button className="text-caption font-inter text-text-secondary hover:text-text-primary transition-colors">Undo</button>
											<button className="text-caption font-inter text-text-secondary hover:text-text-primary transition-colors">Keep</button>
										</div>
									</div>

									{/* Метаданные ID, Таймкод и Тонкая Линия */}
									<div className="flex items-center gap-[14px] text-caption font-inter text-text-primary/60">
										<span className="whitespace-nowrap">#152</span>
										<span className="whitespace-nowrap">[ 00:01:03 ]</span>
										<div className="flex-1 h-[1px] bg-border-default" /> {/* Тонкая линия как в Project Tree */}
									</div>

									<div className="flex flex-col gap-[4px]">
										<div className="h-[22px] bg-inline-error rounded-[2px] px-[4px] flex items-center">
											<span className="text-caption text-text-primary truncate font-inter">Поехали сегодня в Магикс!</span>
										</div>
										<div className="h-[22px] bg-inline-success rounded-[2px] px-[4px] flex items-center">
											<span className="text-caption text-text-primary truncate font-inter">Поехали сегодня в Магиксию!</span>
										</div>
									</div>
								</div>
							</div>
						</div>

						<div className="self-end max-w-[90%]">
							<div className="bg-surface-secondary rounded-[10px] rounded-tr-none p-[8px] select-text">
								<p className="text-body-reg text-text-primary font-inter leading-tight">
									Измени во всех репликах слово Магикс на Магиксия.
								</p>
							</div>
						</div>
					</div>

					{/* Нижнее поле ввода */}
					<div className="p-3 bg-surface-bg shrink-0">
						<div className="relative flex flex-col bg-surface-secondary border border-border-default rounded-[10px] group transition-all focus-within:border-primary-main/50 shadow-sm min-h-[96px]">
							
							<textarea 
								placeholder="Помоги, пожалуйста, перевести..."
								className="w-full h-full p-3 pr-[56px] bg-transparent border-none outline-none text-body-reg text-text-primary placeholder:text-primary-disabled font-inter resize-none overflow-y-auto no-scrollbar"
								rows={3}
							/>

							{/* Кнопка отправки */}
							<div className="absolute right-3 bottom-3">
								<button 
									title="Send message" 
									className="group w-[40px] h-[40px] flex items-center justify-center shrink-0"
								>
									<div className="w-[40px] h-[40px] bg-secondary-hover rounded-full group-hover:bg-primary-main transition-colors flex items-center justify-center">
										<div className="w-4 h-4 bg-surface-secondary/30 rounded-sm" />
									</div>
								</button>
							</div>

						</div>
					</div>

					{/* РЕСАЙЗЕР */}
					<div 
						onMouseDown={startAiAgentResizing} // Вам нужно добавить хэндлер в parent App
						className={`absolute right-[-4px] top-0 w-[8px] h-full cursor-col-resize z-30 transition-colors ${
							isAiAgentResizing ? 'bg-primary-main/20' : 'hover:bg-primary-main/10'
						}`}
					/>
				</div>

				{/* ПРАВАЯ ЧАСТЬ (РЕДАКТОР И ПЛЕЕР) */}
				<div className="flex-1 flex flex-col min-w-0 bg-surface-bg overflow-hidden">
					
					{/* Верх Таблица и Видео */}
					<div 
						style={{ height: `${upperSectionHeight}px` }}
						className="flex overflow-hidden border-b border-border-default min-h-0 shrink-0"
					>
						{/* ЛЕВАЯ КОЛОНКА Таблица + Панель редактирования одного субтитра */}
						<div 
							style={{ width: `${tablePanelWidth}px` }}
							className="flex flex-col bg-surface-secondary relative shrink-0 min-w-[300px] border-r border-border-default overflow-hidden"
						>
							{/* СЕКЦИЯ С ТАБЛИЦЕЙ */}
							<div className="p-3 flex-1 flex flex-col min-h-0 overflow-hidden">
								<div className="flex-1 overflow-y-auto no-scrollbar subtitle-table-scroll bg-surface-secondary">
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
												{['#', 'Start time', 'End time', 'Duration'].map((label, idx) => (
													<th 
														key={idx} 
														style={{ width: `${colWidths[idx]}px` }}
														className="relative h-[25px] py-1 px-2 text-left text-[14px] font-bold text-text-primary border-b border-border-default select-none min-w-0"
													>
														<div className="truncate w-full">{label}</div>
														<div 
															onMouseDown={(e) => startColResize(idx, e)}
															className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-primary-main/30 z-10" 
														/>
													</th>
												))}
												<th className="h-[25px] py-1 px-2 text-left text-[14px] font-bold text-text-primary border-b border-border-default min-w-0">
													<div className="truncate w-full">Translation</div>
												</th>
												<th className="h-[25px] py-1 px-2 text-left text-[14px] font-bold text-text-primary border-b border-border-default min-w-0">
													<div className="truncate w-full">Original text</div>
												</th>
											</tr>
										</thead>
										
										<tbody>
											{Array.from({ length: 25 }).map((_, i) => (
												<tr key={i} className="h-[25px] hover:bg-black/5 transition-colors group text-table">
													<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
														<div className="truncate">{i + 1}</div>
													</td>
													<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
														<div className="truncate">00:01:03,174</div>
													</td>
													<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
														<div className="truncate">00:01:03,174</div>
													</td>
													<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
														<div className="truncate">1,244</div>
													</td>
													<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 text-body-reg select-text">
														<div className="truncate">It's the biggest event of the year in Magix...</div>
													</td>
													<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 text-body-reg select-text">
														<div className="truncate">C'est le plus grand événement de l'année...</div>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>

							{/* РЕСАЙЗЕРЫ */}
							<div 
									onMouseDown={(e) => startTablePanelResizing('right', e)}
									className="absolute right-[-2px] top-0 w-[5px] h-full cursor-col-resize z-50 hover:bg-primary-main/40 transition-colors"
							/>

							{/* ПАНЕЛЬ РЕДАКТИРОВАНИЯ ОДИНОЧНОГО СУБТИТРА */}
							<div className="h-[180px] bg-surface-panel border-t border-border-default p-[12px] flex gap-1 shrink-0 min-w-0 overflow-hidden">
								
								{/* Колонна 1 Таймкоды и кнопки управления */}
								<div className="w-fit flex flex-col shrink-0 min-w-0">
									{/* Инпуты в один ряд */}
									<div className="flex gap-[4px]">
										<div className="flex flex-col gap-[4px]">
											<label className="text-caption text-text-primary">Start time</label>
											<input 
												type="text" 
												defaultValue="00:01:03,174"
												className="w-[100px] h-[24px] bg-surface-secondary border border-border-default rounded-sm px-2 text-caption text-text-primary outline-none focus:border-primary-main/50"
											/>
										</div>
										<div className="flex flex-col gap-[4px]">
											<label className="text-caption text-text-primary">Duration</label>
											<input 
												type="text" 
												defaultValue="1,244"
												className="w-[76px] h-[24px] bg-surface-secondary border border-border-default rounded-sm px-2 text-caption text-text-primary outline-none focus:border-primary-main/50"
											/>
										</div>
									</div>
									
									{/* Блок кнопок */}
									<div className="mt-[16px] flex flex-col gap-[4px] w-[124px]">
										<div className="flex gap-[4px] w-full">
											<button className="flex-1 h-[24px] px-[12px] py-[4px] bg-secondary-main hover:bg-secondary-hover  text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center">
												&lt; Prev
											</button>
											<button className="flex-1 h-[24px] px-[12px] py-[4px] bg-secondary-main hover:bg-secondary-hover text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center">
												Next &gt;
											</button>
										</div>
										<button className="w-full h-[24px] py-[4px] bg-primary-main hover:bg-primary-hover text-white text-caption rounded-sm transition-colors">
											Ask agent
										</button>
									</div>
								</div>

								{/* Колонна 2 Translation */}
								<div className="flex-1 flex flex-col gap-[4px] min-w-0 ml-[12px]">
									<label className="text-caption text-text-primary">Translation</label>
									<div className="flex-1 min-h-0 relative">
										<textarea 
											className="text-h1-heading w-full h-full bg-surface-secondary border border-border-default rounded-[8px] p-2 text-text-primary resize-none outline-none focus:border-primary-main/50 subtitle-table-scroll font-semibold"
											placeholder="Translation..."
											defaultValue="It's the biggest event of the year in Magix..."
										/>
									</div>
									{/* Вертикальная статистика */}
									<div className="flex flex-col text-caption text-text-primary overflow-hidden gap-[2px] mt-[4px]">
										<span className="truncate">Total length: 42</span>
										<span className="truncate">Chars/sec: 12.4</span>
									</div>
								</div>

								{/* Колонна 3 Original Text */}
								<div className="flex-1 flex flex-col gap-[4px] min-w-0">
									<label className="text-caption text-text-primary">Original text</label>
									<div className="flex-1 min-h-0 relative">
										<textarea 
											className="text-h1-heading w-full h-full bg-surface-secondary border border-border-default rounded-[8px] p-2 text-text-primary resize-none outline-none focus:border-primary-main/50 subtitle-table-scroll font-semibold"
											placeholder="Original text..."
											defaultValue="C'est le plus grand événement de l'année..."
										/>
									</div>
									{/* Вертикальная статистика */}
									<div className="flex flex-col text-caption text-text-primary overflow-hidden gap-[2px] mt-[4px]">
										<span className="truncate">Total length: 38</span>
										<span className="truncate">Chars/sec: 11.2</span>
									</div>
								</div>
							</div>

							
						</div>
						
						{/* ПАНЕЛЬ ВИДЕОПЛЕЕР */}
						<div className="flex-1 bg-black flex flex-col shadow-inner min-w-[400px] overflow-hidden select-none">
								
								{/* Область видео */}
								<div className="flex-1 relative flex flex-col items-center justify-center group bg-[#000000]">
										<div className="text-white/10 text-[10px] uppercase tracking-[0.2em] font-bold">
												Video Preview
										</div>
										<div className="absolute bottom-12 w-full text-center px-10">
												<span className="text-white text-[20px] font-bold drop-shadow-md leading-[20px] tracking-[-0.01em] font-inter">
														Kali, if you get an autograph, I'll...
												</span>
										</div>
								</div>

								{/* Панель управления */}
								<div className="bg-surface-panel border-t border-border-default flex flex-col shrink-0 p-3 m-0 gap-[24px]">
										<div className="w-full">
												<div className="relative w-full h-[4px] bg-border-default cursor-pointer group">
														<div className="absolute left-0 top-0 h-full bg-[#9FA3B0] w-[45%]" />
														<div className="absolute left-[45%] top-1/2 -translate-y-1/2 w-3 h-4 bg-surface-secondary border border-border-default rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity z-10" />
												</div>
										</div>

										{/* Контролы */}
										<div className="flex items-center justify-between w-full flex-nowrap">
												<div className="flex items-center gap-[12px] shrink-0">
														<button className="w-6 h-6 bg-secondary-hover rounded-md shrink-0" />
														<button className="w-6 h-6 bg-secondary-hover rounded-md shrink-0" />
														<button className="w-6 h-6 bg-secondary-hover rounded-sm shrink-0" />
														
														{/* Слайдер громкости */}
														<div className="w-16 h-[2px] bg-border-default relative shrink-0">
																<div className="absolute left-0 top-0 h-full bg-primary-disabled w-1/2" />
														</div>
												</div>

												{/* Таймкоды */}
												<div className="flex items-center gap-1 text-[12px] text-body-med text-text-primary shrink-0 ml-4">
														<span>00:01:22,165</span>
														<span className="text-text-secondary/40">/</span>
														<span className="text-text-secondary">00:23:03,306</span>
												</div>
										</div>
								</div>
								
						</div>

					</div>
					

					{/*ТАЙМЛАЙН */}
					<div 
						className="flex-1 min-h-0 bg-surface-bg flex flex-col relative"
						style={{ height: `calc(100vh - ${upperSectionHeight}px - 32px)` }} // Оставшееся место после хедера и верхней части
					>
						{/* РЕСАЙЗЕР */}
						<div 
							onMouseDown={(e) => startTablePanelResizing('bottom', e)}
							className="absolute top-[-2px] left-0 w-full h-[4px] cursor-row-resize z-50 hover:bg-primary-main/40 transition-colors"
						/>

						<div className="flex flex-1 min-h-0">
							{/* Левая панель с кнопками */}
							<div className="w-[100px] border-r border-border-default flex flex-col gap-[4px] p-2 bg-surface-panel shrink-0">
								{['Insert', 'Set start', 'Set end'].map((label) => (
									<button 
										key={label}
										className="h-[24px] px-[12px] py-[4px] bg-secondary-main hover:bg-secondary-hover text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center"
									>
										{label}
									</button>
								))}
							</div>

							{/* основная зона таймлайна */}
							<div className="flex-1 flex flex-col min-w-0 overflow-hidden">
								
								{/* Контейнер с волной и субтитрами */}
								<div className="flex-1 relative bg-[#121212] m-3 rounded-md border border-black overflow-hidden shadow-inner group">
									
									{/* Сетка */}
									<div className="absolute inset-0 opacity-10" 
										style={{ 
											backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
											backgroundSize: '20px 20px'
										}} 
									/>

									{/* Псевдо-вейвформа (имитация через CSS-mask или фон) */}
									<div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-32 opacity-80"
										style={{
											backgroundColor: '#A3E635',
											maskImage: 'url("data:image/svg+xml,%3Csvg width=\'100%27 height=\'100%25%27 viewBox=\'0 0 1000 100\' preserveAspectRatio=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 50 L10 20 L20 80 L30 40 L40 60 L50 10 L60 90 L70 30 L80 70 L90 20 L100 50 L110 10 L120 90 L130 30 L140 80 L150 40 L160 60 L170 10 L180 90 L190 30 L200 50 L210 10 L220 90 L230 30 L240 80 L250 40 L260 60 L270 10 L280 90 L290 30 L300 50 L310 10 L320 90 L330 30 L340 80 L350 40 L360 60 L370 10 L380 90 L390 30 L400 50 L410 10 L420 90 L430 30 L440 80 L450 40 L460 60 L470 10 L480 90 L490 30 L500 50 L510 10 L520 90 L530 30 L540 80 L550 40 L560 60 L570 10 L580 90 L590 30 L600 50 L610 10 L620 90 L630 30 L640 80 L650 40 L660 60 L670 10 L680 90 L690 30 L700 50 L710 10 L720 90 L730 30 L740 80 L750 40 L760 60 L770 10 L780 90 L790 30 L800 50 L810 10 L820 90 L830 30 L840 80 L850 40 L860 60 L870 10 L880 90 L890 30 L900 50 L910 10 L920 90 L930 30 L940 80 L950 40 L960 60 L970 10 L980 90 L990 30 L1000 50\' stroke=\'black\' fill=\'none\'/%3E%3C/svg%3E")',
											WebkitMaskImage: 'url("data:image/svg+xml,%3Csvg width=\'1000\' height=\'100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Crect width=\'100%25\' height=\'100%25\' fill=\'white\'/%3E%3C/svg%3E")', // Здесь можно подставить реальный SVG вейвформы
										}}
									>
										{/* Упрощенная визуализация волны полосками */}
										<div className="flex items-center gap-[1px] h-full px-2">
											{Array.from({ length: 120 }).map((_, i) => (
												<div 
													key={i} 
													className="bg-[#A3E635] w-[3px] rounded-full" 
													style={{ height: `${Math.random() * 60 + 20}%` }}
												/>
											))}
										</div>
									</div>

									{/* Субтитры на таймлайне */}
									<div className="absolute inset-0 flex items-stretch">
										{/* Субтитр 1 */}
										<div className="absolute left-[2%] w-[25%] h-full border-x border-[#A3E635] bg-surface-secondary/5 backdrop-blur-[1px] p-2 flex flex-col justify-between">
											<span className="text-[11px] text-white font-medium truncate">That's our new home!</span>
											<div className="flex gap-2 text-[10px] text-white/50 font-mono">
												<span>#232</span>
												<span>1,738</span>
											</div>
										</div>

										{/* Субтитр 2 */}
										<div className="absolute left-[35%] w-[35%] h-full border-x border-[#A3E635] bg-surface-secondary/10 backdrop-blur-[1px] p-2 flex flex-col justify-between">
											<span className="text-[11px] text-white font-medium truncate">Kali, if you get an autograph, I'll...</span>
											<div className="flex gap-2 text-[10px] text-white/50 font-mono">
												<span>#232</span>
												<span>1,520</span>
											</div>
										</div>

										{/* Субтитр 3 */}
										<div className="absolute left-[75%] w-[23%] h-full border-x border-[#A3E635] bg-surface-secondary/5 backdrop-blur-[1px] p-2 flex flex-col justify-between">
											<span className="text-[11px] text-white font-medium truncate">That's our new home!</span>
											<div className="flex gap-2 text-[10px] text-white/50 font-mono">
												<span>#232</span>
												<span>1,738</span>
											</div>
										</div>
									</div>
								</div>

								{/* Нижняя панель с зумом и скролл баром */}
								<div className="h-[32px] p-3 flex items-center gap-6 bg-surface-panel border-t border-border-default">
									
									{/* зум кнопки */}
									<div className="flex items-center gap-2">
										{/* зум аут */}
										<button className="group w-[22px] h-[22px] flex items-center justify-center shrink-0">
											<div className="w-[22px] h-[22px] bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
										</button>

										{/* выпадающее */}
										<div className="relative flex items-center h-[22px]">
											<select className="appearance-none h-full bg-surface-bg border border-border-default rounded-[4px] pl-2 pr-7 text-[12px] leading-none text-text-primary font-medium outline-none cursor-pointer hover:border-primary-main transition-colors m-0">
												<option>90%</option>
												<option>100%</option>
												<option>120%</option>
											</select>

											<div className="absolute right-2 pointer-events-none flex items-center">
												<svg width="8" height="5" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
													<path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
												</svg>
											</div>
										</div>

										{/* зум аут */}
										<button className="group w-[22px] h-[22px] flex items-center justify-center shrink-0">
											<div className="w-[22px] h-[22px] bg-secondary-hover rounded-sm group-hover:bg-primary-main transition-colors" />
										</button>
									</div>

									{/* Полоса прокрутки */}
									<div className="flex-1 h-[4px] bg-border-default rounded-full relative overflow-hidden">
										<div className="absolute left-0 top-0 h-full w-[40%] bg-primary-disabled rounded-full" />
									</div>
								</div>

							</div>
						</div>
					</div>

				</div>
			</div>

			{/* POPUPS LAYER */}
			{activeModal && (
				<div className="fixed inset-0 z-[999] flex items-center justify-center pointer-events-none">
					
					{/* Контейнер конкретного окна */}
					<div className="pointer-events-auto">
						
						{activeModal === 'welcome' && (
							<WelcomeModal 
								onClose={() => setActiveModal(null)} 
								onNewProject={() => setActiveModal('createProject')} 
							/>
						)}

						{activeModal === 'createProject' && (
							<NewProjectModal 
								onClose={() => setActiveModal(null)} 
							/>
						)}

						{activeModal === 'wizard' && <WizardModal onClose={() => setActiveModal(null)} />}

						{activeModal === 'glossary' && (
							<GlossaryModal onClose={() => setActiveModal(null)} />
						)}

						{activeModal === 'export' && (
							<ExportModal onClose={() => setActiveModal(null)} />
						)}



						

					</div>
				</div>
			)}

		</div>	
    
  );
}