import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Locale = 'en' | 'ru';

const LOCALE_STORAGE_KEY = 'subtitle-studio-locale';

type DeepStringRecord<T> = {
	[K in keyof T]: T[K] extends string ? string : DeepStringRecord<T[K]>;
};

const enMessages = {
	menu: {
		file: 'File',
		edit: 'Edit',
		view: 'View',
		ai: 'AI',
		help: 'Help',
		showOriginalOnVideo: 'Original subtitles on video',
		dualMonitorMode: 'Dual monitor mode',
		newProject: 'New Project',
		openProject: 'Open Project',
		importVideo: 'Import Video',
		importOriginal: 'Import Original Subtitles',
		importTranslated: 'Import Translated Subtitles',
		save: 'Save',
		exit: 'Exit',
		settings: 'Settings',
		undo: 'Undo',
		redo: 'Redo',
		delete: 'Delete',
		findAndReplace: 'Find and Replace',
		spellCheck: 'Spell check',
		transcribe: 'Transcribe',
		translate: 'Translate',
		retranscribeRange: 'Retranscribe range',
		about: 'About',
		switchToDark: 'Switch to dark theme',
		switchToLight: 'Switch to light theme'
	},
	about: {
		title: 'About Subtitle Studio',
		desc: 'Desktop app for subtitle editing, transcription, and translation.',
		developers: 'Developers',
		developersList: 'Denis Gusev, Ilya Ivanov',
		copyright: '© 2025–2026'
	},
	ai: {
		transcribeTitle: 'Transcribe',
		transcribeDesc: 'Select the source language and an optional hint for Whisper.',
		transcribeStart: 'Transcribe',
		noVideo: 'No video in the project to transcribe.',
		noOriginalText: 'No original text to translate.',
		openProjectFirst: 'Open or create a project first.',
		stageAudio: 'Extracting audio from video...',
		stageTranscribe: 'Transcribing speech...',
		stageApply: 'Applying subtitles...',
		stageTranslate: 'Translating...',
		working: 'AI is working!',
		errorTitle: 'AI error',
		ok: 'OK'
	},
	settings: {
		title: 'Settings',
		desc: 'Change the application language, theme, and other preferences.',
		language: 'Language',
		languageEn: 'English',
		languageRu: 'Russian',
		theme: 'Theme',
		themeLight: 'Light theme',
		themeDark: 'Dark theme'
	},
	app: {
		untitled: 'Untitled',
		noProject: 'No project'
	},
	sidebar: {
		newProject: 'Create new project',
		openProject: 'Open project',
		saveProject: 'Save project',
		wizard: 'Step-by-step wizard',
		export: 'Export',
		glossary: 'Glossary',
		search: 'Search'
	},
	projectTree: {
		newFile: 'New file',
		newFolder: 'New folder'
	},
	aiAgent: {
		title: 'AI-agent',
		add: 'Add',
		more: 'More',
		emptyHint: 'Chat with the agent to get tips and help.',
		thinking: 'Agent is thinking...',
		placeholder: 'Help me translate, please...',
		sendMessage: 'Send message',
		removeAttachment: 'Remove line',
		remove: 'Remove',
		noTranslation: 'No translation',
		collapse: 'Collapse',
		expand: 'Expand',
		undo: 'Undo',
		keep: 'Keep',
		kept: 'Kept',
		reverted: 'Reverted',
		change: 'change',
		changes: 'changes'
	},
	table: {
		startTime: 'Start time',
		endTime: 'End time',
		duration: 'Duration',
		speakerGender: 'Speaker',
		translation: 'Translation',
		originalText: 'Original text',
		translationPlaceholder: 'Translation...',
		originalPlaceholder: 'Original text...',
		totalLength: 'Total length',
		charsPerSec: 'Chars/sec',
		prev: '< Prev',
		next: 'Next >',
		askAgent: 'Ask agent'
	},
	video: {
		preview: 'Video Preview',
		play: 'Play',
		pause: 'Pause',
		stop: 'Stop',
		unmute: 'Unmute',
		mute: 'Mute'
	},
	timeline: {
		insert: 'Insert',
		setStart: 'Set start',
		setEnd: 'Set end',
		split: 'Split',
		insertBlockedSelection: 'Insert is unavailable while existing subtitles are selected',
		insertRange: 'Insert empty subtitle {start}s – {end}s (or clear with Esc)',
		insertPlayhead: 'Insert empty subtitle at playhead (default 1s), or drag on the timeline to set range',
		setStartBlocked: 'Set start is unavailable while a timeline range is selected',
		setEndBlocked: 'Set end is unavailable while a timeline range is selected',
		splitTitle: 'Split selected subtitle at the playhead (both parts keep the same text)',
		zoomOut: 'Zoom out',
		zoomIn: 'Zoom in',
		zoomSmooth: 'Smooth timeline zoom',
		retranscribeRange: 'Retranscribe range',
		delete: 'Delete',
		deleteCount: 'Delete ({count})',
		retranscribeSelectRange: 'Select a range on the timeline (click and drag)',
		retranscribeNoVideo: 'No video available for audio extraction',
		retranscribeHint: 'Retry a selected range.',
		deleteSelectSubtitle: 'Select subtitle(s) on the timeline',
		deleteSelectedPlural: 'Delete selected subtitles (Delete)',
		deleteSelectedSingle: 'Delete selected subtitle (Delete)'
	},
	retranscribe: {
		title: 'Retranscribe',
		desc: 'You can select the source language and write a hint prompt to help improve the re-transcription.',
		sourceLanguage: 'Source language',
		prompt: 'Prompt',
		promptPlaceholder: 'In the series Velorian Echo, characters Arlen, Siva, Toren, and Miri investigate a strange signal in an abandoned complex. It is leading to unsettling events.',
		cancel: 'Cancel',
		retranscribe: 'Start',
		working: 'AI is working!',
		stageAudio: 'Extracting audio from the selected range...',
		stageTranscribe: 'Transcribing speech...',
		stageTranslate: 'Translating...',
		stageApply: 'Replacing subtitles in the selected area...',
		errorTitle: 'Retranscription error',
		ok: 'OK'
	},
	dialog: {
		appTitle: 'Subtitle Studio',
		saveErrorTitle: 'Save error',
		saveBeforeSwitch: 'The project has unsaved changes. Save before continuing?',
		saveBeforeExit: 'Save changes before closing the project?',
		importTitle: 'Import',
		openProjectFirst: 'Open or create a project first.',
		importOriginalFailed: 'Could not import subtitles: {detail}',
		importTranslatedFailed: 'Could not import translation: {detail}',
		noSegments: 'The file contains no segments.',
		importOriginalDialog: 'Import Original Subtitles',
		importTranslatedDialog: 'Import Translated Subtitles',
		importVideoDialog: 'Import Video',
		importVideoFailed: 'Could not import video: {detail}',
		videoFilter: 'Video',
		subtitlesFilter: 'Subtitles',
		deleteEpisodeTitle: 'Delete episode',
		deleteEpisodeConfirm:
			'Delete file «{name}»?\nThe video, linked subtitles and waveform will be permanently removed.',
		deleteEpisodeFailed: 'Could not delete episode: {detail}',
		deleteFileTitle: 'Delete file',
		deleteFileConfirm: 'Delete file «{name}»?',
		deleteFailed: 'Could not delete file: {detail}',
		deleteFolderTitle: 'Delete folder',
		deleteFolderConfirm: 'Delete all files from folder «{folder}» ({count})?',
		deleteFolderFailed: 'Could not delete folder: {detail}',
		openProjectFailed:
			'Choose a Subtitle Studio project folder – it must contain project.json in the root. A regular folder without it will not work.\n\n{detail}',
		openProjectFailedTitle: 'Could not open project',
		openProjectFailedAlert: 'Could not open project. A folder with project.json is required.\n\n{detail}',
		glossaryUpdateConfirm: 'Do you want the agent to update the translation based on glossary changes?',
		glossaryUpdateTitle: 'Update subtitles'
	},
	welcome: {
		title: 'Welcome!',
		recentProjects: 'Recent projects',
		loading: 'Loading...',
		newProject: 'New project',
		openProject: 'Open a project'
	},
	activation: {
		title: 'Activate Subtitle Studio',
		desc: 'Insert your OpenAI API key to enable AI transcription and translation.',
		apiKey: 'OpenAI API key',
		apiKeyRequired: 'Please enter your OpenAI API key.',
		saving: 'Saving...',
		activate: 'Activate'
	},
	newProject: {
		title: 'Create a new project',
		desc: 'Organize your work by title. A project folder stores your videos and subtitles.',
		projectName: 'Project name',
		projectLocation: 'Project location',
		selectFolder: 'Click to select folder...',
		willBeCreated: 'Will be created at:',
		targetLanguage: 'Target language',
		creating: 'Creating...',
		create: 'Create',
		fillAllFields: 'Please fill in all fields',
		invalidName: 'Project name contains only invalid characters. Please use letters, digits, spaces or dashes.',
		createFailed: 'Failed to create project: {detail}',
		selectDirectory: 'Select Project Directory'
	},
	export: {
		title: 'Export',
		desc: 'You can batch export files with different settings.',
		selectAll: 'Select all',
		fileFormat: 'File format',
		savingLocation: 'Saving location',
		exportFiles: 'Export files',
		formatSrt: 'SRT (.srt)',
		formatAss: 'ASS (.ass)',
		formatVtt: 'VTT (.vtt)',
		formatTxt: 'TXT (.txt)',
		formatPdf: 'PDF (.pdf)',
		selectFolder: 'Select export folder',
		selectFolderPlaceholder: 'Choose a folder…',
		openProjectFirst: 'Open a project to export subtitles.',
		noSubtitleFiles: 'No subtitle files in the project.',
		noFilesSelected: 'Select at least one file to export.',
		selectFolderFirst: 'Choose a folder to save exported files.',
		exportFailed: 'Export failed: {detail}',
		successTitle: 'Export complete',
		successDesc: '{count} file(s) saved to:\n{folder}',
		successOk: 'OK'
	},
	findReplace: {
		whatToFind: 'What to find:',
		replaceWith: 'Replace with:',
		placeholder: 'Your text',
		replacePlaceholder: 'Your text',
		normal: 'Normal',
		caseSensitive: 'Case sensitive',
		find: 'Find',
		replace: 'Replace',
		replaceAll: 'Replace all',
		confirmReplaceAll: 'Found {count} occurrence(s). Replace all?',
		cancel: 'Cancel'
	},
	glossary: {
		title: 'Glossary',
		desc: 'Define how the AI agent should translate specific names or terms.',
		openProjectFirst: 'Open a project to edit the glossary.',
		original: 'Original',
		translated: 'Translated',
		context: 'Meaning / Context',
		termPlaceholder: 'Type term...',
		translationPlaceholder: 'Translation...',
		contextPlaceholder: 'Optional context...',
		saveChanges: 'Save changes'
	},
	wizard: {
		step1Title: 'Import your file',
		step1Desc: 'Select the video you want to subtitle. A wide range of audiovisual files is supported.',
		dropFile: 'Drop your file here \n (audio, video files)',
		step2Title: 'Source text',
		step2Desc:
			'How should we get the text in the original language? You can transcribe audio automatically or choose a pre-existing file, if you have it.',
		generateAi: 'Generate with AI',
		importExisting: 'Import an existing file',
		chooseSubtitle: '[Choose .srt / .vtt / .txt]',
		step3Title: 'Context and glossary',
		step3Desc:
			'Tell the AI about specific names, slang or terms to create a glossary that will keep transcription consistent.',
		prompt: 'Prompt',
		step3Placeholder:
			'In the series Velorian Echo, characters Arlen, Siva, Toren, and Miri investigate a strange signal in an abandoned complex. It is leading to unsettling events.',
		step5Title: 'Translation',
		step5Desc:
			'You can select a language and give instructions to the agent. Style, tone and context matter for the result.',
		targetLanguage: 'Target language',
		step5Placeholder: 'Professional localization for a sci-fi drama series.',
		step7Title: 'Everything is ready!',
		step7Desc: 'You can continue improving the results manually in the editor.',
		placeholder: 'PLACEHOLDER',
		working: 'AI is working!',
		importWait: 'Please wait while we import your subtitle file...',
		transcribeWait: 'Please wait while we transcribe your file. This may take some minutes...',
		translateWait: 'Please wait while we translate your text. This may take some minutes...',
		cancel: 'Cancel',
		nextStep: 'Next step >',
		prevStep: '< Prev step',
		goToEditor: 'Go to editor'
	}
} as const;

type Messages = DeepStringRecord<typeof enMessages>;

const ruMessages: Messages = {
	menu: {
		file: 'Файл',
		edit: 'Правка',
		view: 'Вид',
		ai: 'ИИ',
		help: 'Справка',
		showOriginalOnVideo: 'Оригинальные субтитры на видео',
		dualMonitorMode: 'Режим двух мониторов',
		newProject: 'Новый проект',
		openProject: 'Открыть проект',
		importVideo: 'Импорт видео',
		importOriginal: 'Импорт оригинальных субтитров',
		importTranslated: 'Импорт переведённых субтитров',
		save: 'Сохранить',
		exit: 'Выход',
		settings: 'Настройки',
		undo: 'Отменить',
		redo: 'Повторить',
		delete: 'Удалить',
		findAndReplace: 'Найти и заменить',
		spellCheck: 'Проверка орфографии',
		transcribe: 'Транскрибировать',
		translate: 'Перевести',
		retranscribeRange: 'Перетранскрибировать',
		about: 'О программе',
		switchToDark: 'Тёмная тема',
		switchToLight: 'Светлая тема'
	},
	about: {
		title: 'О Subtitle Studio',
		desc: 'Настольное приложение для редактирования субтитров, транскрипции и перевода.',
		developers: 'Разработчики',
		developersList: 'Денис Гусев, Илья Иванов',
		copyright: '© 2025–2026'
	},
	ai: {
		transcribeTitle: 'Транскрибировать',
		transcribeDesc: 'Выберите язык оригинала и при необходимости подсказку для Whisper.',
		transcribeStart: 'Транскрибировать',
		noVideo: 'В проекте нет видео для транскрипции.',
		noOriginalText: 'Нет текста в колонке оригинала для перевода.',
		openProjectFirst: 'Сначала откройте или создайте проект.',
		stageAudio: 'Извлечение аудио из видео...',
		stageTranscribe: 'Транскрипция речи...',
		stageApply: 'Применение субтитров...',
		stageTranslate: 'Перевод...',
		working: 'ИИ работает!',
		errorTitle: 'Ошибка ИИ',
		ok: 'OK'
	},
	settings: {
		title: 'Настройки',
		desc: 'Здесь можно изменить язык интерфейса, тему и другие параметры приложения.',
		language: 'Язык',
		languageEn: 'English',
		languageRu: 'Русский',
		theme: 'Тема',
		themeLight: 'Светлая тема',
		themeDark: 'Тёмная тема'
	},
	app: {
		untitled: 'Без названия',
		noProject: 'Нет проекта'
	},
	sidebar: {
		newProject: 'Создать новый проект',
		openProject: 'Открыть проект',
		saveProject: 'Сохранить проект',
		wizard: 'Пошаговый мастер',
		export: 'Экспорт',
		glossary: 'Глоссарий',
		search: 'Поиск'
	},
	projectTree: {
		newFile: 'Новый файл',
		newFolder: 'Новая папка'
	},
	aiAgent: {
		title: 'ИИ-агент',
		add: 'Добавить',
		more: 'Ещё',
		emptyHint: 'Задайте вопрос агенту или попросите изменить реплики',
		thinking: 'Агент думает...',
		placeholder: 'Помоги, пожалуйста, перевести...',
		sendMessage: 'Отправить сообщение',
		removeAttachment: 'Убрать реплику',
		remove: 'Убрать',
		noTranslation: 'Без перевода',
		collapse: 'Свернуть',
		expand: 'Развернуть',
		undo: 'Отменить',
		keep: 'Принять',
		kept: 'Принято',
		reverted: 'Отменено',
		change: 'изменение',
		changes: 'изменений'
	},
	table: {
		startTime: 'Начало',
		endTime: 'Конец',
		duration: 'Длительность',
		speakerGender: 'Пол',
		translation: 'Перевод',
		originalText: 'Оригинал',
		translationPlaceholder: 'Перевод...',
		originalPlaceholder: 'Оригинальный текст...',
		totalLength: 'Всего символов',
		charsPerSec: 'Симв/сек',
		prev: '< Назад',
		next: 'Вперёд >',
		askAgent: 'Спросить агента'
	},
	video: {
		preview: 'Просмотр видео',
		play: 'Воспроизведение',
		pause: 'Пауза',
		stop: 'Стоп',
		unmute: 'Включить звук',
		mute: 'Выключить звук'
	},
	timeline: {
		insert: 'Вставить',
		setStart: 'Начало',
		setEnd: 'Конец',
		split: 'Разделить',
		insertBlockedSelection: 'Вставка недоступна, пока выделены существующие субтитры',
		insertRange: 'Вставить пустой субтитр {start}с – {end}с (или сбросить Esc)',
		insertPlayhead:
			'Вставить пустой субтитр на позиции воспроизведения (по умолчанию 1 с) или выделите диапазон на таймлайне',
		setStartBlocked: 'Установка начала недоступна при выделении области на таймлайне',
		setEndBlocked: 'Установка конца недоступна при выделении области на таймлайне',
		splitTitle: 'Разделить выбранный субтитр на позиции воспроизведения (текст сохранится в обеих частях)',
		zoomOut: 'Уменьшить масштаб',
		zoomIn: 'Увеличить масштаб',
		zoomSmooth: 'Плавный зум таймлайна',
		retranscribeRange: 'Перетранскрибировать',
		delete: 'Удалить',
		deleteCount: 'Удалить ({count})',
		retranscribeSelectRange: 'Выделите диапазон на таймлайне (зажмите ЛКМ и протяните)',
		retranscribeNoVideo: 'Нет видео для извлечения аудио',
		retranscribeHint: 'Заново транскрибировать выделенный диапазон',
		deleteSelectSubtitle: 'Выделите субтитр(ы) на таймлайне',
		deleteSelectedPlural: 'Удалить выделенные субтитры (Delete)',
		deleteSelectedSingle: 'Удалить выбранный субтитр (Delete)'
	},
	retranscribe: {
		title: 'Перетранскрипция',
		desc: 'Выберите язык оригинала и при необходимости укажите подсказку для улучшения результата.',
		sourceLanguage: 'Язык оригинала',
		prompt: 'Подсказка',
		promptPlaceholder: 'В сериале Velorian Echo персонажи Арлен, Сива, Торен и Мири исследуют странный сигнал в заброшенном комплексе. Это приводит к тревожным событиям.',
		cancel: 'Отмена',
		retranscribe: 'Начать',
		working: 'ИИ работает!',
		stageAudio: 'Извлекаем аудио из выделенного диапазона...',
		stageTranscribe: 'Распознаём речь...',
		stageTranslate: 'Переводим...',
		stageApply: 'Заменяем субтитры в выделенной области...',
		errorTitle: 'Ошибка ретранскрипции',
		ok: 'ОК'
	},
	dialog: {
		appTitle: 'Subtitle Studio',
		saveErrorTitle: 'Ошибка сохранения',
		saveBeforeSwitch: 'В проекте есть несохранённые изменения. Сохранить перед продолжением?',
		saveBeforeExit: 'Сохранить изменения перед закрытием проекта?',
		importTitle: 'Импорт',
		openProjectFirst: 'Сначала откройте или создайте проект.',
		importOriginalFailed: 'Не удалось импортировать субтитры: {detail}',
		importTranslatedFailed: 'Не удалось импортировать перевод: {detail}',
		noSegments: 'Файл не содержит сегментов.',
		importOriginalDialog: 'Импорт оригинальных субтитров',
		importTranslatedDialog: 'Импорт переведённых субтитров',
		importVideoDialog: 'Импорт видео',
		importVideoFailed: 'Не удалось импортировать видео: {detail}',
		videoFilter: 'Видео',
		subtitlesFilter: 'Субтитры',
		deleteEpisodeTitle: 'Удаление эпизода',
		deleteEpisodeConfirm:
			'Удалить файл «{name}»?\nВидео, связанные субтитры и waveform будут удалены без возможности восстановления.',
		deleteEpisodeFailed: 'Не удалось удалить эпизод: {detail}',
		deleteFileTitle: 'Удаление файла',
		deleteFileConfirm: 'Удалить файл «{name}»?',
		deleteFailed: 'Не удалось удалить файл: {detail}',
		deleteFolderTitle: 'Удаление папки',
		deleteFolderConfirm: 'Удалить все файлы из папки «{folder}» ({count})?',
		deleteFolderFailed: 'Не удалось удалить папку: {detail}',
		openProjectFailed:
			'Укажите папку проекта Subtitle Studio – в корне должен быть файл project.json. Обычная папка без него не подойдёт.\n\n{detail}',
		openProjectFailedTitle: 'Не удалось открыть проект',
		openProjectFailedAlert: 'Не удалось открыть проект. Нужна папка с project.json.\n\n{detail}',
		glossaryUpdateConfirm: 'Хотите, чтобы агент обновил перевод по изменениям глоссария?',
		glossaryUpdateTitle: 'Обновление субтитров'
	},
	welcome: {
		title: 'Добро пожаловать!',
		recentProjects: 'Недавние проекты',
		loading: 'Загрузка...',
		newProject: 'Новый проект',
		openProject: 'Открыть проект'
	},
	activation: {
		title: 'Активация Subtitle Studio',
		desc: 'Введите ключ OpenAI API для транскрипции и перевода с помощью ИИ.',
		apiKey: 'Ключ OpenAI API',
		apiKeyRequired: 'Введите ключ OpenAI API.',
		saving: 'Сохранение...',
		activate: 'Активировать'
	},
	newProject: {
		title: 'Новый проект',
		desc: 'Организуйте работу по названию. Папка проекта хранит видео и субтитры.',
		projectName: 'Название проекта',
		projectLocation: 'Расположение проекта',
		selectFolder: 'Нажмите, чтобы выбрать папку...',
		willBeCreated: 'Будет создан в:',
		targetLanguage: 'Целевой язык',
		creating: 'Создание...',
		create: 'Создать',
		fillAllFields: 'Заполните все поля',
		invalidName:
			'Название проекта содержит только недопустимые символы. Используйте буквы, цифры, пробелы или дефисы.',
		createFailed: 'Не удалось создать проект: {detail}',
		selectDirectory: 'Выберите папку проекта'
	},
	export: {
		title: 'Экспорт',
		desc: 'Можно экспортировать файлы пакетно с разными настройками.',
		selectAll: 'Выбрать все',
		fileFormat: 'Формат файла',
		savingLocation: 'Папка сохранения',
		exportFiles: 'Экспортировать',
		formatSrt: 'SRT (.srt)',
		formatAss: 'ASS (.ass)',
		formatVtt: 'VTT (.vtt)',
		formatTxt: 'TXT (.txt)',
		formatPdf: 'PDF (.pdf)',
		selectFolder: 'Выберите папку для экспорта',
		selectFolderPlaceholder: 'Выберите папку…',
		openProjectFirst: 'Откройте проект для экспорта субтитров.',
		noSubtitleFiles: 'В проекте нет файлов субтитров.',
		noFilesSelected: 'Выберите хотя бы один файл для экспорта.',
		selectFolderFirst: 'Укажите папку для сохранения файлов.',
		exportFailed: 'Ошибка экспорта: {detail}',
		successTitle: 'Экспорт завершён',
		successDesc: 'Сохранено файлов: {count}\nПапка: {folder}',
		successOk: 'OK'
	},
	findReplace: {
		whatToFind: 'Что искать:',
		replaceWith: 'Заменить на:',
		placeholder: 'Ваш текст',
		replacePlaceholder: 'Ваш текст',
		normal: 'Обычный',
		caseSensitive: 'С учётом регистра',
		find: 'Найти',
		replace: 'Заменить',
		replaceAll: 'Заменить всё',
		confirmReplaceAll: 'Найдено: {count}. Заменить все вхождения?',
		cancel: 'Отмена'
	},
	glossary: {
		title: 'Глоссарий',
		desc: 'Укажите, как агент должен переводить имена и термины.',
		openProjectFirst: 'Откройте проект для редактирования глоссария.',
		original: 'Оригинал',
		translated: 'Перевод',
		context: 'Значение / контекст',
		termPlaceholder: 'Введите термин...',
		translationPlaceholder: 'Перевод...',
		contextPlaceholder: 'Контекст (необязательно)...',
		saveChanges: 'Сохранить'
	},
	wizard: {
		step1Title: 'Импорт файла',
		step1Desc: 'Выберите видео для субтитрирования. Поддерживается широкий спектр аудио- и видеоформатов.',
		dropFile: 'Перетащите файл сюда\n(аудио, видео)',
		step2Title: 'Исходный текст',
		step2Desc:
			'Как получить текст на языке оригинала? Можно транскрибировать аудио автоматически или выбрать готовый файл.',
		generateAi: 'Сгенерировать с ИИ',
		importExisting: 'Импортировать готовый файл',
		chooseSubtitle: '[Выберите .srt / .vtt / .txt]',
		step3Title: 'Контекст и глоссарий',
		step3Desc:
			'Укажите имена, сленг и термины – ИИ создаст глоссарий для согласованной транскрипции.',
		prompt: 'Подсказка',
		step3Placeholder:
			'В сериале Velorian Echo персонажи Арлен, Сива, Торен и Мири исследуют странный сигнал в заброшенном комплексе. Это приводит к тревожным событиям.',
		step5Title: 'Перевод',
		step5Desc:
			'Выберите язык и дайте инструкции агенту. Стиль, тон и контекст влияют на результат.',
		targetLanguage: 'Целевой язык',
		step5Placeholder: 'Профессиональная локализация научно-фантастического сериала.',
		step7Title: 'Всё готово!',
		step7Desc: 'Продолжайте улучшать результат вручную в редакторе.',
		placeholder: 'ЗАГЛУШКА',
		working: 'ИИ работает!',
		importWait: 'Подождите, импортируем файл субтитров...',
		transcribeWait: 'Подождите, идёт транскрипция. Это может занять несколько минут...',
		translateWait: 'Подождите, идёт перевод. Это может занять несколько минут...',
		cancel: 'Отмена',
		nextStep: 'Далее >',
		prevStep: '< Назад',
		goToEditor: 'В редактор'
	}
};

const catalogs: Record<Locale, Messages> = { en: enMessages, ru: ruMessages };

function getByPath(obj: Record<string, unknown>, path: string): string | undefined {
	const parts = path.split('.');
	let cur: unknown = obj;
	for (const p of parts) {
		if (cur == null || typeof cur !== 'object') return undefined;
		cur = (cur as Record<string, unknown>)[p];
	}
	return typeof cur === 'string' ? cur : undefined;
}

export function translate(
	locale: Locale,
	key: string,
	params?: Record<string, string | number>
): string {
	let s = getByPath(catalogs[locale] as unknown as Record<string, unknown>, key);
	if (s === undefined) {
		s = getByPath(catalogs.en as unknown as Record<string, unknown>, key);
	}
	if (s === undefined) return key;
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
		}
	}
	return s;
}

type I18nContextValue = {
	locale: Locale;
	setLocale: (locale: Locale) => void;
	t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
	const [locale, setLocaleState] = useState<Locale>(() => {
		const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
		return saved === 'ru' ? 'ru' : 'en';
	});

	useEffect(() => {
		localStorage.setItem(LOCALE_STORAGE_KEY, locale);
		document.documentElement.lang = locale;
	}, [locale]);

	const setLocale = useCallback((next: Locale) => {
		setLocaleState(next);
	}, []);

	const t = useCallback(
		(key: string, params?: Record<string, string | number>) => translate(locale, key, params),
		[locale]
	);

	const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
	const ctx = useContext(I18nContext);
	if (!ctx) throw new Error('useI18n must be used within I18nProvider');
	return ctx;
}
