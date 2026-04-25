import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, open, message } from '@tauri-apps/plugin-dialog';
import { 
  ChevronRight, 
  ChevronDown 
} from 'lucide-react';

// компоненты модальных окон
import { WelcomeModal } from './components/modals/WelcomeModal';
import { NewProjectModal } from './components/modals/NewProjectModal';
import { WizardModal } from './components/modals/WizardModal';
import { ExportModal } from './components/modals/ExportModal';
import { GlossaryModal } from './components/modals/GlossaryModal';
import { ActivationModal } from './components/modals/ActivationModal';

const appWindow = getCurrentWindow();

import { projectService, ProjectData, ProjectFile, SubtitleSegment } from './services/projectService';
import {
	deleteSegmentById,
	insertEmptySegment,
	splitSegmentAt
} from './utils/subtitleSegmentsLocal';

import iconNewProject from './assets/icons/new-project.svg';
import iconNewFile from './assets/icons/new-file.svg';
import iconOpenProject from './assets/icons/open-project.svg';
import iconSave from './assets/icons/save.svg';
import iconWizard from './assets/icons/wizard.svg';
import iconExport from './assets/icons/export.svg';
import iconGlossary from './assets/icons/glossary.svg';
import iconSearch from './assets/icons/search.svg';
import iconNewFolder from './assets/icons/new-folder.svg';
import iconAdd from './assets/icons/add.svg';
import iconMore from './assets/icons/more.svg';
import iconArrowUp from './assets/icons/arrow-up.svg';
import iconArrowDown from './assets/icons/arrow-down.svg';
import iconSend from './assets/icons/send.svg';
import iconPlay from './assets/icons/play.svg';
import iconPause from './assets/icons/pause.svg';
import iconStop from './assets/icons/stop.svg';
import iconVolume from './assets/icons/volume.svg';
import iconVolumeMute from './assets/icons/volume-mute.svg';
import iconZoomIn from './assets/icons/zoom-in.svg';
import iconZoomOut from './assets/icons/zoom-out.svg';

/** SVG как CSS-mask: цвет задаётся фоном (text-primary / white), тема переключается автоматически. */
function sidebarIconMaskStyle(src: string): React.CSSProperties {
	return {
		maskImage: `url(${src})`,
		WebkitMaskImage: `url(${src})`,
		maskSize: 'contain',
		maskRepeat: 'no-repeat',
		maskPosition: 'center'
	};
}

const SIDEBAR_ICON_CLASS =
	'pointer-events-none inline-block h-7 w-7 shrink-0 origin-center transition-transform duration-200 ease-out will-change-transform group-hover:scale-110 group-active:scale-[0.92]';


const PANEL_HEADER_ICON_CLASS =
	'pointer-events-none inline-block h-4 w-4 shrink-0 origin-center transition-transform duration-200 ease-out will-change-transform group-hover:scale-110 group-active:scale-[0.92]';

/** Видеоплеер 24×24, именованные group/* чтобы не цеплять чужие group-hover */
const VIDEO_CTRL_BTN_CLASS =
	'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-primary-main/40 disabled:pointer-events-none disabled:opacity-40';

const VIDEO_CTRL_ICON_PLAY =
	'pointer-events-none inline-block h-6 w-6 shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/vplay:scale-110 group-active/vplay:scale-[0.92]';

const VIDEO_CTRL_ICON_STOP =
	'pointer-events-none inline-block h-6 w-6 shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/vstop:scale-110 group-active/vstop:scale-[0.92]';

const VIDEO_CTRL_ICON_VOL =
	'pointer-events-none inline-block h-6 w-6 shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/vvol:scale-110 group-active/vvol:scale-[0.92]';

/** Таймлайн zoom 22×22, без фона при hover */
const TIMELINE_ZOOM_BTN_CLASS =
	'flex h-[22px] w-[22px] shrink-0 items-center justify-center border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-primary-main/40';

const TIMELINE_ZOOM_OUT_ICON_CLASS =
	'pointer-events-none inline-block h-[22px] w-[22px] shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/tzoomout:scale-110 group-active/tzoomout:scale-[0.92]';

const TIMELINE_ZOOM_IN_ICON_CLASS =
	'pointer-events-none inline-block h-[22px] w-[22px] shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/tzoomin:scale-110 group-active/tzoomin:scale-[0.92]';

function formatSrtTime(seconds: number): string {
	if (!Number.isFinite(seconds)) return '00:00:00,000';
	const totalMs = Math.round(seconds * 1000);
	const ms = totalMs % 1000;
	const totalSec = Math.floor(totalMs / 1000);
	const s = totalSec % 60;
	const totalMin = Math.floor(totalSec / 60);
	const m = totalMin % 60;
	const h = Math.floor(totalMin / 60);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function parseSrtTime(t: string): number | null {
	const m = t.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
	if (!m) return null;
	const h = parseInt(m[1], 10);
	const mi = parseInt(m[2], 10);
	const s = parseInt(m[3], 10);
	const ms = parseInt(m[4].padEnd(3, '0').slice(0, 3), 10);
	return h * 3600 + mi * 60 + s + ms / 1000;
}

function sanitizeSrtTimeInput(raw: string): string {
	return raw.replace(/[^0-9:,.]/g, '');
}

function sanitizeDurationInput(raw: string): string {
	return raw.replace(/[^0-9.,]/g, '');
}

function joinProjectPath(base: string, ...parts: string[]): string {
	const a = base.replace(/[/\\]+$/, '');
	const rest = parts.map((p) => p.replace(/^[/\\]+/, '').replace(/\\/g, '/')).join('/');
	return `${a}/${rest}`;
}

function getSourceVideoStem(project: ProjectData, activeFileId: string | null): string {
	if (!activeFileId) return 'subtitles';
	const track = project.files.find((f) => f.id === activeFileId);
	if (track?.file_type === 'Video') {
		return track.name.replace(/\.[^/.\\]+$/, '') || 'subtitles';
	}
	const vid = project.files.find((f) => f.file_type === 'Video');
	if (vid) return vid.name.replace(/\.[^/.\\]+$/, '') || 'subtitles';
	return track?.name.replace(/\.[^/.\\]+$/, '') || 'subtitles';
}

function mergeProjectFilesWithDisk(
	projectFiles: ProjectFile[],
	disk: { relative_path: string; name: string }[]
): ProjectFile[] {
	const seen = new Set(projectFiles.map((f) => f.path.replace(/\\/g, '/').toLowerCase()));
	const extra: ProjectFile[] = [];
	for (const d of disk) {
		const key = d.relative_path.replace(/\\/g, '/').toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const folder = d.relative_path.split('/')[0]?.toLowerCase() ?? '';
		const file_type: ProjectFile['file_type'] =
			folder === 'video' ? 'Video' : folder === 'subtitles' ? 'Subtitle' : 'Config';
		extra.push({
			id: `disk:${d.relative_path}`,
			name: d.name,
			file_type,
			path: d.relative_path,
			duration: null,
			subtitle_segments: null,
			created_at: '',
			updated_at: ''
		});
	}
	return [...projectFiles, ...extra];
}

function formatPlaybackClock(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00';
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const ms = Math.floor((seconds % 1) * 1000);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

const MIN_SEGMENT_DURATION = 0.05;
const MAX_SUBTITLE_UNDO = 80;
const ACTIVATION_COMPLETED_STORAGE_KEY = 'subtitle-studio-activation-completed';

function cloneSubtitleSegments(segs: SubtitleSegment[]): SubtitleSegment[] {
	return segs.map((s) => ({ ...s }));
}

/** Симметричная аудиоволна генерация */
function TimelineSymmetricWaveform({
	peaks,
	className
}: {
	peaks: number[] | null;
	className?: string;
}) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useLayoutEffect(() => {
		const wrap = wrapRef.current;
		const canvas = canvasRef.current;
		if (!wrap || !canvas) return;

		let rafTries = 0;
		const draw = () => {
			const w = wrap.clientWidth;
			const h = wrap.clientHeight;
			if (w < 2 || h < 4) {
				if (rafTries < 24) {
					rafTries += 1;
					requestAnimationFrame(draw);
				}
				return;
			}

			const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
			canvas.width = Math.floor(w * dpr);
			canvas.height = Math.floor(h * dpr);
			canvas.style.width = `${w}px`;
			canvas.style.height = `${h}px`;

			const ctx = canvas.getContext('2d');
			if (!ctx) return;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, w, h);

			const mid = h / 2;
			const maxHalf = Math.max(2, mid - 1);
			const ampGain = 1.42;

			if (!peaks || peaks.length === 0) {
				ctx.strokeStyle = 'rgba(173, 255, 47, 0.35)';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(0, mid);
				ctx.lineTo(w, mid);
				ctx.stroke();
				return;
			}

			let mx = 0;
			for (let i = 0; i < peaks.length; i++) {
				const a = Math.abs(peaks[i]);
				if (a > mx) mx = a;
			}
			const norm = mx > 1e-9 ? 1 / mx : 1;

			const n = peaks.length;
			ctx.fillStyle = '#ADFF2F';
			for (let col = 0; col < w; col++) {
				const t = w <= 1 ? 0 : col / (w - 1);
				// Nearest-neighbor sampling keeps waveform edges crisp at high zoom.
				const idx = Math.round(t * (n - 1));
				const v = Math.abs(peaks[Math.max(0, Math.min(n - 1, idx))]) * norm;
				const amp = Math.min(maxHalf, v * maxHalf * ampGain);
				const half = Math.max(1, amp);
				ctx.fillRect(col, mid - half, 1, half * 2);
			}
		};

		draw();
		const ro = new ResizeObserver(() => {
			rafTries = 0;
			draw();
		});
		ro.observe(wrap);
		return () => ro.disconnect();
	}, [peaks]);

	return (
		<div
			ref={wrapRef}
			className={
				className ??
				'absolute inset-x-0 top-[5%] bottom-[5%] w-full pointer-events-none'
			}
		>
			<canvas ref={canvasRef} className="block h-full w-full min-h-0" aria-hidden />
		</div>
	);
}

/** Пробел не должен запускать видео, когда фокус в поле ввода, слайдере */
function shouldIgnoreSpacebarForVideo(target: EventTarget | null): boolean {
	if (!target || !(target instanceof Element)) return false;
	const el = target as HTMLElement;
	if (el.isContentEditable) return true;
	const tag = el.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (el.closest('[contenteditable="true"]')) return true;
	/* range / number inputs часто используют пробел */
	if (el.closest('input[type="range"], [role="slider"]')) return true;
	return false;
}

// константы ограничений интерфейса
const LIMITS = {
  SIDEBAR: 60,
  PROJECT_TREE: { MIN: 150, MAX: 250 },
  AI_AGENT: { MIN: 280, MAX: 400 },
  TABLE: 300,
  /** Минимальная ширина колонки видео (контролы переносятся — можно уже прежних ~400px) */
  VIDEO: 220,
};

/** Верхняя строка меню */
const APP_HEADER_BAR_PX = 32;
/**
 * Минимальная высота области таймлайна
 */
const MIN_TIMELINE_PANE_PX = 200;

const TIMELINE_ZOOM_MIN = 100;
const TIMELINE_ZOOM_MAX = 10000;
const TIMELINE_ZOOM_FACTOR = 1.08;
const TIMELINE_ZOOM_SLIDER_MIN = 0;
const TIMELINE_ZOOM_SLIDER_MAX = 1000;

function clampTimelineZoom(value: number): number {
	if (!Number.isFinite(value)) return TIMELINE_ZOOM_MIN;
	return Math.max(TIMELINE_ZOOM_MIN, Math.min(TIMELINE_ZOOM_MAX, Math.round(value)));
}

function timelineZoomToSliderValue(zoom: number): number {
	const clamped = clampTimelineZoom(zoom);
	const minLog = Math.log(TIMELINE_ZOOM_MIN);
	const maxLog = Math.log(TIMELINE_ZOOM_MAX);
	const ratio = (Math.log(clamped) - minLog) / (maxLog - minLog);
	return Math.round(TIMELINE_ZOOM_SLIDER_MIN + ratio * (TIMELINE_ZOOM_SLIDER_MAX - TIMELINE_ZOOM_SLIDER_MIN));
}

function sliderValueToTimelineZoom(slider: number): number {
	const sliderClamped = Math.max(TIMELINE_ZOOM_SLIDER_MIN, Math.min(TIMELINE_ZOOM_SLIDER_MAX, slider));
	const ratio = (sliderClamped - TIMELINE_ZOOM_SLIDER_MIN) / (TIMELINE_ZOOM_SLIDER_MAX - TIMELINE_ZOOM_SLIDER_MIN);
	const minLog = Math.log(TIMELINE_ZOOM_MIN);
	const maxLog = Math.log(TIMELINE_ZOOM_MAX);
	return clampTimelineZoom(Math.exp(minLog + ratio * (maxLog - minLog)));
}

function timelineZoomToFillPercent(zoom: number): number {
	const sliderValue = timelineZoomToSliderValue(zoom);
	const ratio =
		(sliderValue - TIMELINE_ZOOM_SLIDER_MIN) /
		(TIMELINE_ZOOM_SLIDER_MAX - TIMELINE_ZOOM_SLIDER_MIN);
	return Math.max(0, Math.min(100, ratio * 100));
}

function stepTimelineZoom(current: number, direction: 1 | -1): number {
	if (direction > 0) return clampTimelineZoom(current * TIMELINE_ZOOM_FACTOR);
	return clampTimelineZoom(current / TIMELINE_ZOOM_FACTOR);
}

export default function App() {

	// СОСТОЯНИЕ ОКНА И РАЗМЕРОВ ЭКРАНА 
	const [windowSize, setWindowSize] = useState({
		width: window.innerWidth,
		height: window.innerHeight
	});

	// отслеживание изменения размера окна браузера
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

	// отслеживание изменения размера окна через tauri
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

	// СОСТОЯНИЕ ПАНЕЛЕЙ И ИНТЕРФЕЙСА
	const [projectTreeWidth, setProjectTreeWidth] = useState(240); // ширина иерархии файлов
	const [aiAgentWidth, setAiAgentWidth] = useState(320); // ширина панели с агентом
	const [tablePanelWidth, setTablePanelWidth] = useState(800); // ширина таблицы
	const [upperSectionHeight, setUpperSectionHeight] = useState(450); // высота верхней части (таблица + плеер)
	const [colWidths, setColWidths] = useState([50, 120, 120, 100]); // ширины колонок таблицы

	const [isResizing, setIsResizing] = useState(false); // состояние ресайза дерева проекта
	const [isAiAgentResizing, setIsAiAgentResizing] = useState(false); // состояние ресайза агента
	const [isVideoFolderOpen, setIsVideoFolderOpen] = useState(true); // открыта ли папка в дереве
	const [agentEmbedDiffExpanded, setAgentEmbedDiffExpanded] = useState(true);

	// --- ТЕМА И МЕНЮ ---
	const [isDarkTheme, setIsDarkTheme] = useState(() => {
		const saved = localStorage.getItem('theme');
		return saved === 'dark';
	});

	const [activeMenu, setActiveMenu] = useState<string | null>(null);

	// применение темы
	useEffect(() => {
		document.documentElement.classList.toggle('dark', isDarkTheme);
		localStorage.setItem('theme', isDarkTheme ? 'dark' : 'light');
	}, [isDarkTheme]);

	// закрытие меню при клике вне его
	useEffect(() => {
		const handleClickOutside = () => setActiveMenu(null);
		if (activeMenu) {
			window.addEventListener('click', handleClickOutside);
		}
		return () => window.removeEventListener('click', handleClickOutside);
	}, [activeMenu]);

	// --- МОДАЛЬНЫЕ ОКНА ---
	const [activeModal, setActiveModal] = useState<
		'activation' | 'welcome' | 'createProject' | 'wizard' | 'glossary' | 'export' | null
	>(null);
	const [currentProject, setCurrentProject] = useState<ProjectData | null>(null);
	const [generatedSegments, setGeneratedSegments] = useState<SubtitleSegment[]>([]);
	const [activeSubtitleFileId, setActiveSubtitleFileId] = useState<string | null>(null);
	const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number>(-1);
	const [isConfigFolderOpen, setIsConfigFolderOpen] = useState(false);
	const [isSubtitlesFolderOpen, setIsSubtitlesFolderOpen] = useState(false);
	/** Затемнение/подсветка мастера для пустого проекта — только один раз за «сессию» этого проекта (сброс при смене path). */
	const [wizardSpotlightDismissed, setWizardSpotlightDismissed] = useState(false);

	const videoRef = useRef<HTMLVideoElement | null>(null);
	const timelineScrollRef = useRef<HTMLDivElement | null>(null);
	const timelineInnerRef = useRef<HTMLDivElement | null>(null);
	const timelineWheelRef = useRef<HTMLDivElement | null>(null);
	const timelineScrollbarThumbRef = useRef<HTMLDivElement | null>(null);
	const segmentEditorPanelRef = useRef<HTMLDivElement | null>(null);
	const subtitleTableScrollRef = useRef<HTMLDivElement | null>(null);
	const currentPlaybackTimeRef = useRef(0);
	const zoomAnchorRef = useRef<{ ratio: number; scrollLeft: number; innerW: number } | null>(null);
	const isPlayingRef = useRef(false);
	const volumeBeforeMuteRef = useRef(1);
	const segmentsRef = useRef<SubtitleSegment[]>([]);
	const currentProjectRef = useRef<ProjectData | null>(null);
	const timelineTotalDurationRef = useRef(1);
	const timelineEdgeDragRef = useRef<{
		edge: 'start' | 'end';
		index: number;
		start: number;
		end: number;
	} | null>(null);
	const timelineSegmentMoveRef = useRef<{
		index: number;
		origStart: number;
		origEnd: number;
		t0: number;
	} | null>(null);
	const segmentBodyDragMovedRef = useRef(false);
	const timelineRangeSelectDragRef = useRef<{ t0: number } | null>(null);
	const undoSegmentsStackRef = useRef<SubtitleSegment[][]>([]);
	const redoSegmentsStackRef = useRef<SubtitleSegment[][]>([]);

	const [videoDuration, setVideoDuration] = useState(0);
	const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);
	const [volume, setVolume] = useState(1);
	const [videoMuted, setVideoMuted] = useState(false);
	const [isVideoPlaying, setIsVideoPlaying] = useState(false);
	const [timelineZoomPercent, setTimelineZoomPercent] = useState(100);
	const [waveformPeaks, setWaveformPeaks] = useState<number[] | null>(null);
	const [waveformImageSrc, setWaveformImageSrc] = useState<string | null>(null);
	const [projectDiskFiles, setProjectDiskFiles] = useState<{ relative_path: string; name: string }[]>([]);
	const [probedMediaDuration, setProbedMediaDuration] = useState<number | null>(null);
	/** Контролируемые поля панели одного субтитра - иначе после Delete остаётся старый DOM и onBlur пишет в новый сегмент. */
	const [segEditorTranslation, setSegEditorTranslation] = useState('');
	const [segEditorOriginal, setSegEditorOriginal] = useState('');
	const [segEditorStart, setSegEditorStart] = useState('');
	const [segEditorDuration, setSegEditorDuration] = useState('');
	/** Выделение ЛКМ на треке: превью при перетаскивании */
	const [timelineRangePreview, setTimelineRangePreview] = useState<{ a: number; b: number } | null>(
		null
	);
	/** Зафиксированный интервал для Insert (пустой субтитр на [start, end]) */
	const [timelineInsertRange, setTimelineInsertRange] = useState<{
		start: number;
		end: number;
	} | null>(null);

	const projectDirtyRef = useRef(false);
	const markProjectDirty = useCallback(() => {
		projectDirtyRef.current = true;
	}, []);
	const clearProjectDirty = useCallback(() => {
		projectDirtyRef.current = false;
	}, []);

	const activeVideoFile = useMemo(() => {
		if (!currentProject) return null;
		if (activeSubtitleFileId) {
			const t = currentProject.files.find((f) => f.id === activeSubtitleFileId);
			if (t?.file_type === 'Video') return t;
		}
		return currentProject.files.find((f) => f.file_type === 'Video') ?? null;
	}, [currentProject, activeSubtitleFileId]);

	const activeVideoAbsolutePath = useMemo(() => {
		if (!currentProject || !activeVideoFile) return null;
		return joinProjectPath(currentProject.path, activeVideoFile.path);
	}, [currentProject, activeVideoFile]);

	const videoSrc = useMemo(() => {
		if (!activeVideoAbsolutePath) return null;
		const normalized = activeVideoAbsolutePath.replace(/\\/g, '/');
		return convertFileSrc(normalized);
	}, [activeVideoAbsolutePath]);

	const maxSegmentEnd = useMemo(
		() => (generatedSegments.length > 0 ? Math.max(...generatedSegments.map((s) => s.end)) : 0),
		[generatedSegments]
	);
	const shouldHighlightWizardCta = useMemo(() => {
		if (!currentProject || wizardSpotlightDismissed) return false;
		const hasProjectSegments = currentProject.files.some(
			(file) => (file.subtitle_segments?.length ?? 0) > 0
		);
		return !hasProjectSegments && generatedSegments.length === 0;
	}, [currentProject, generatedSegments.length, wizardSpotlightDismissed]);

	const mediaLengthHint = useMemo(() => {
		const vd = videoDuration > 0 && Number.isFinite(videoDuration) ? videoDuration : 0;
		const fd =
			activeVideoFile?.duration != null && activeVideoFile.duration > 0 ? activeVideoFile.duration : 0;
		const pr = probedMediaDuration != null && probedMediaDuration > 0 ? probedMediaDuration : 0;
		return Math.max(vd, fd, pr);
	}, [videoDuration, activeVideoFile?.duration, probedMediaDuration]);

	const timelineTotalDuration = useMemo(() => {
		return Math.max(mediaLengthHint, maxSegmentEnd, 1);
	}, [mediaLengthHint, maxSegmentEnd]);

	segmentsRef.current = generatedSegments;
	currentProjectRef.current = currentProject;

	useLayoutEffect(() => {
		if (selectedSegmentIndex < 0) return;
		const container = subtitleTableScrollRef.current;
		if (!container) return;
		const row = container.querySelector<HTMLElement>(
			`[data-subtitle-row-index="${selectedSegmentIndex}"]`
		);
		row?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
	}, [selectedSegmentIndex, generatedSegments]);
	timelineTotalDurationRef.current = timelineTotalDuration;
	currentPlaybackTimeRef.current = currentPlaybackTime;

	const currentVideoSubtitleLine = useMemo(() => {
		const t = currentPlaybackTime;
		const seg = generatedSegments.find((s) => t >= s.start && t < s.end);
		if (!seg) return '';
		const tr = seg.translation?.trim();
		return tr ?? '';
	}, [generatedSegments, currentPlaybackTime]);

	const timelineSegmentsSorted = useMemo(
		() =>
			[...generatedSegments].sort((a, b) => {
				if (a.start !== b.start) return a.start - b.start;
				return a.id - b.id;
			}),
		[generatedSegments]
	);

	const treeFiles = useMemo(() => {
		const empty = {
			config: [] as ProjectFile[],
			video: [] as ProjectFile[],
			subtitles: [] as ProjectFile[],
			root: [] as ProjectFile[]
		};
		if (!currentProject) return empty;
		const merged = mergeProjectFilesWithDisk(currentProject.files, projectDiskFiles);
		const out = { ...empty };
		for (const f of merged) {
			const p = f.path.replace(/\\/g, '/').toLowerCase();
			if (p.startsWith('config/')) out.config.push(f);
			else if (p.startsWith('video/')) out.video.push(f);
			else if (p.startsWith('subtitles/')) out.subtitles.push(f);
			else out.root.push(f);
		}
		return out;
	}, [currentProject, projectDiskFiles]);

	const editorSegmentSig = useMemo(() => {
		const s =
			selectedSegmentIndex >= 0 && selectedSegmentIndex < generatedSegments.length
				? generatedSegments[selectedSegmentIndex]
				: null;
		if (!s) return '';
		return `${s.id}|${s.start}|${s.end}|${s.translation ?? ''}|${s.text}`;
	}, [selectedSegmentIndex, generatedSegments]);

	useEffect(() => {
		const seg =
			selectedSegmentIndex >= 0 && selectedSegmentIndex < generatedSegments.length
				? generatedSegments[selectedSegmentIndex]
				: null;
		if (!seg) {
			setSegEditorTranslation('');
			setSegEditorOriginal('');
			setSegEditorStart('');
			setSegEditorDuration('');
			return;
		}
		setSegEditorTranslation(seg.translation ?? '');
		setSegEditorOriginal(seg.text ?? '');
		setSegEditorStart(formatSrtTime(seg.start));
		setSegEditorDuration(seg.duration.toFixed(3));
	}, [editorSegmentSig, selectedSegmentIndex]);

	/** Без onBlur изменения остаются только в полях панели — синхронизируем в проект перед Save / Exit / сменой проекта. */
	const flushSubtitleEditorToProject = useCallback(() => {
		if (!activeSubtitleFileId || selectedSegmentIndex < 0) return;
		const cp = currentProjectRef.current;
		if (!cp) return;
		const seg = segmentsRef.current[selectedSegmentIndex];
		if (!seg) return;

		const st = parseSrtTime(segEditorStart);
		const baseStart = st !== null ? st : seg.start;
		const d = parseFloat(segEditorDuration.replace(',', '.'));
		const end =
			Number.isFinite(d) && d >= 0 ? baseStart + d : seg.end;

		const text = segEditorOriginal;
		const translation = segEditorTranslation;
		const changed =
			text !== seg.text ||
			(translation ?? '') !== (seg.translation ?? '') ||
			Math.abs(baseStart - seg.start) > 1e-6 ||
			Math.abs(end - seg.end) > 1e-6;

		if (!changed) return;

		const next: SubtitleSegment = {
			...seg,
			text,
			translation: translation || null,
			start: baseStart,
			end,
			duration: Math.max(0, end - baseStart)
		};
		const nextList = segmentsRef.current.map((s, i) => (i === selectedSegmentIndex ? next : s));
		const nextProject: ProjectData = {
			...cp,
			files: cp.files.map((f) =>
				f.id === activeSubtitleFileId ? { ...f, subtitle_segments: nextList } : f
			)
		};
		currentProjectRef.current = nextProject;
		setCurrentProject(nextProject);
		setGeneratedSegments(nextList);
		markProjectDirty();
	}, [
		activeSubtitleFileId,
		selectedSegmentIndex,
		segEditorStart,
		segEditorDuration,
		segEditorOriginal,
		segEditorTranslation,
		markProjectDirty
	]);

	const exportSrtForProject = useCallback(async (project: ProjectData, fileId: string) => {
		const stem = getSourceVideoStem(project, fileId);
		const out = joinProjectPath(project.path, 'subtitles', `${stem}.srt`);
		await projectService.exportSubtitles(project.path, fileId, 'srt', out);
	}, []);

	const handleSaveProject = useCallback(async (): Promise<boolean> => {
		flushSubtitleEditorToProject();
		const cp = currentProjectRef.current;
		if (!cp) return false;
		try {
			await projectService.save(cp);
			for (const f of cp.files) {
				if (f.file_type !== 'Subtitle') continue;
				await exportSrtForProject(cp, f.id);
			}
			clearProjectDirty();
			return true;
		} catch (e) {
			console.error('save project', e);
			const detail = e instanceof Error ? e.message : String(e);
			try {
				await message(detail, { title: 'Ошибка сохранения', kind: 'error' });
			} catch {
				window.alert(`Ошибка сохранения: ${detail}`);
			}
			return false;
		}
	}, [clearProjectDirty, exportSrtForProject, flushSubtitleEditorToProject]);

	const maybeSaveBeforeSwitchingProject = useCallback(async (): Promise<boolean> => {
		flushSubtitleEditorToProject();
		if (!projectDirtyRef.current) return true;
		let saveFirst: boolean;
		try {
			saveFirst = await ask('В проекте есть несохранённые изменения. Сохранить перед продолжением?', {
				title: 'Subtitle Studio',
				kind: 'warning'
			});
		} catch {
			saveFirst = window.confirm(
				'В проекте есть несохранённые изменения. Сохранить перед продолжением?'
			);
		}
		if (saveFirst) {
			return await handleSaveProject();
		}
		return true;
	}, [handleSaveProject, flushSubtitleEditorToProject]);

	const handleExitProject = useCallback(async () => {
		flushSubtitleEditorToProject();
		if (currentProjectRef.current && projectDirtyRef.current) {
			let saveFirst: boolean;
			try {
				saveFirst = await ask('Сохранить изменения перед закрытием проекта?', {
					title: 'Subtitle Studio',
					kind: 'warning'
				});
			} catch {
				saveFirst = window.confirm('Сохранить изменения перед закрытием проекта?');
			}
			if (saveFirst) {
				const ok = await handleSaveProject();
				if (!ok) return;
			}
		}
		setCurrentProject(null);
		currentProjectRef.current = null;
		setGeneratedSegments([]);
		setActiveSubtitleFileId(null);
		setSelectedSegmentIndex(-1);
		undoSegmentsStackRef.current = [];
		redoSegmentsStackRef.current = [];
		clearProjectDirty();
		setActiveMenu(null);
		setActiveModal(null);
	}, [handleSaveProject, clearProjectDirty, flushSubtitleEditorToProject]);

	const pushSubtitleHistorySnapshot = useCallback(() => {
		if (!activeSubtitleFileId) return;
		undoSegmentsStackRef.current.push(cloneSubtitleSegments(segmentsRef.current));
		if (undoSegmentsStackRef.current.length > MAX_SUBTITLE_UNDO) undoSegmentsStackRef.current.shift();
		redoSegmentsStackRef.current = [];
	}, [activeSubtitleFileId]);

	const applySubtitleSegmentsSnapshot = useCallback(
		(segments: SubtitleSegment[]) => {
			if (!activeSubtitleFileId) return;
			const cp = currentProjectRef.current;
			if (!cp) return;
			const nextProject: ProjectData = {
				...cp,
				files: cp.files.map((f) =>
					f.id === activeSubtitleFileId ? { ...f, subtitle_segments: segments } : f
				)
			};
			currentProjectRef.current = nextProject;
			setCurrentProject(nextProject);
			setGeneratedSegments(segments);
			markProjectDirty();
			setSelectedSegmentIndex((idx) => {
				if (segments.length === 0) return -1;
				return Math.min(Math.max(0, idx), segments.length - 1);
			});
		},
		[activeSubtitleFileId, markProjectDirty]
	);

	const performSubtitleUndo = useCallback(() => {
		if (!activeSubtitleFileId) return;
		const stack = undoSegmentsStackRef.current;
		if (stack.length === 0) return;
		const prev = stack.pop()!;
		redoSegmentsStackRef.current.push(cloneSubtitleSegments(segmentsRef.current));
		applySubtitleSegmentsSnapshot(prev);
	}, [activeSubtitleFileId, applySubtitleSegmentsSnapshot]);

	const performSubtitleRedo = useCallback(() => {
		if (!activeSubtitleFileId) return;
		const stack = redoSegmentsStackRef.current;
		if (stack.length === 0) return;
		const next = stack.pop()!;
		undoSegmentsStackRef.current.push(cloneSubtitleSegments(segmentsRef.current));
		applySubtitleSegmentsSnapshot(next);
	}, [activeSubtitleFileId, applySubtitleSegmentsSnapshot]);

	const handleDeleteSelectedSubtitle = useCallback(() => {
		if (!activeSubtitleFileId) return;
		if (selectedSegmentIndex < 0) return;
		const seg = segmentsRef.current[selectedSegmentIndex];
		if (!seg) return;
		const cp = currentProjectRef.current;
		if (!cp) return;
		pushSubtitleHistorySnapshot();
		const fileId = activeSubtitleFileId;
		const deletedIndex = selectedSegmentIndex;
		try {
			const segments = deleteSegmentById(segmentsRef.current, seg.id);
			const nextProject: ProjectData = {
				...cp,
				files: cp.files.map((f) =>
					f.id === fileId ? { ...f, subtitle_segments: segments } : f
				)
			};
			currentProjectRef.current = nextProject;
			setGeneratedSegments(segments);
			setCurrentProject(nextProject);
			markProjectDirty();
			const newLen = segments.length;
			if (newLen === 0) {
				setSelectedSegmentIndex(-1);
			} else {
				setSelectedSegmentIndex(Math.min(deletedIndex, newLen - 1));
			}
		} catch (e) {
			console.error('delete subtitle', e);
		}
	}, [activeSubtitleFileId, selectedSegmentIndex, pushSubtitleHistorySnapshot, markProjectDirty]);

	const handleSelectProject = useCallback(async (path: string) => {
		const canProceed = await maybeSaveBeforeSwitchingProject();
		if (!canProceed) return;
		try {
			const projectData = await projectService.open(path);
			undoSegmentsStackRef.current = [];
			redoSegmentsStackRef.current = [];
			setCurrentProject(projectData);
			const firstFileWithSegments = projectData.files.find(
				(file) => file.subtitle_segments && file.subtitle_segments.length > 0
			);
			const segs = firstFileWithSegments?.subtitle_segments ?? [];
			setGeneratedSegments(segs);
			setActiveSubtitleFileId(firstFileWithSegments?.id ?? null);
			setSelectedSegmentIndex(segs.length > 0 ? 0 : -1);
			setActiveModal(null);
			clearProjectDirty();
		} catch (error: unknown) {
			console.error('open project', error);
			const detail =
				typeof error === 'string'
					? error
					: error instanceof Error
						? error.message
						: String(error);
			try {
				await message(
					`Укажите папку проекта Subtitle Studio — в корне должен быть файл project.json. Обычная папка без него не подойдёт.\n\n${detail}`,
					{ title: 'Не удалось открыть проект', kind: 'error' }
				);
			} catch {
				window.alert(
					`Не удалось открыть проект. Нужна папка с project.json.\n\n${detail}`
				);
			}
		}
	}, [maybeSaveBeforeSwitchingProject, clearProjectDirty]);

	const handleOpenProjectDialog = useCallback(async () => {
		try {
			const selected = await open({
				directory: true,
				multiple: false,
				title: 'Открыть папку проекта'
			});
			if (selected && typeof selected === 'string') {
				await handleSelectProject(selected);
			}
		} catch (e) {
			console.error('open project dialog', e);
		}
	}, [handleSelectProject]);

	const handleProjectTreeNewFile = useCallback(() => {
		if (!currentProject) return;
		// TODO: новый файл в выбранной папке дерева проекта
	}, [currentProject]);

	const handleProjectTreeNewFolder = useCallback(() => {
		if (!currentProject) return;
		// TODO: новая папка в выбранном месте дерева
	}, [currentProject]);

	const handleAiAgentAdd = useCallback(() => {
		// TODO: действие кнопки «Добавить» в чате агента
	}, []);

	const handleAiAgentMore = useCallback(() => {
		// TODO: дополнительные опции чата
	}, []);

	const menuItems = useMemo(
		() => [
			{
				label: 'File',
				items: [
					{ label: 'New Project', action: () => setActiveModal('createProject') },
					{ label: 'Open Project', action: () => void handleOpenProjectDialog() },
					{ label: 'Save', action: () => void handleSaveProject() },
					{ label: 'Exit', action: () => void handleExitProject() },
				],
			},
			{
				label: 'Edit',
				items: [
					{ label: 'Undo', action: () => void performSubtitleUndo() },
					{ label: 'Redo', action: () => void performSubtitleRedo() },
					{ label: 'Delete', action: () => void handleDeleteSelectedSubtitle() },
					{ label: 'Find' },
				],
			},
			{ label: 'Tools', items: [{ label: 'Spell check' }, { label: 'Batch convert' }] },
			{ label: 'Video', items: [{ label: 'Open video file' }, { label: 'Audio track' }] },
			{
				label: 'Help',
				items: [
					{ label: 'About' },
					{ label: 'Updates' },
					{
						label: isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme',
						action: () => setIsDarkTheme((prev) => !prev),
					},
				],
			},
		],
		[
			performSubtitleUndo,
			performSubtitleRedo,
			handleDeleteSelectedSubtitle,
			isDarkTheme,
			handleOpenProjectDialog,
			handleSaveProject,
			handleExitProject
		]
	);

	const updateSegmentAtIndex = useCallback(
		(index: number, patch: Partial<SubtitleSegment>, opts?: { skipHistory?: boolean }) => {
			if (!activeSubtitleFileId || index < 0) return;
			const cp = currentProjectRef.current;
			if (!cp) return;
			const segs = segmentsRef.current;
			const seg = segs[index];
			if (!seg) return;
			if (!opts?.skipHistory) pushSubtitleHistorySnapshot();
			let next: SubtitleSegment = { ...seg, ...patch };
			if (patch.start !== undefined || patch.end !== undefined) {
				next.duration = Math.max(0, next.end - next.start);
			}
			const nextList = segs.map((s, i) => (i === index ? next : s));
			const nextProject: ProjectData = {
				...cp,
				files: cp.files.map((f) =>
					f.id === activeSubtitleFileId ? { ...f, subtitle_segments: nextList } : f
				)
			};
			currentProjectRef.current = nextProject;
			setCurrentProject(nextProject);
			setGeneratedSegments(nextList);
			markProjectDirty();
		},
		[activeSubtitleFileId, pushSubtitleHistorySnapshot, markProjectDirty]
	);

	const commitSegEditorStart = useCallback(() => {
		if (selectedSegmentIndex < 0) return;
		const t = parseSrtTime(segEditorStart);
		if (t === null) return;
		const seg = generatedSegments[selectedSegmentIndex];
		if (!seg) return;
		const dur = seg.end - seg.start;
		void updateSegmentAtIndex(selectedSegmentIndex, { start: t, end: t + dur });
	}, [selectedSegmentIndex, segEditorStart, generatedSegments, updateSegmentAtIndex]);

	const commitSegEditorDuration = useCallback(() => {
		if (selectedSegmentIndex < 0) return;
		const d = parseFloat(segEditorDuration.replace(',', '.'));
		if (!Number.isFinite(d) || d < 0) return;
		const seg = generatedSegments[selectedSegmentIndex];
		if (!seg) return;
		const st = parseSrtTime(segEditorStart);
		const baseStart = st !== null ? st : seg.start;
		void updateSegmentAtIndex(selectedSegmentIndex, { end: baseStart + d });
	}, [selectedSegmentIndex, segEditorDuration, segEditorStart, generatedSegments, updateSegmentAtIndex]);

	/* Клик по видео/таймлайну не забирает фокус с input/textarea */
	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			const panel = segmentEditorPanelRef.current;
			if (!panel) return;
			if (panel.contains(e.target as Node)) return;
			const ae = document.activeElement;
			if (
				ae &&
				panel.contains(ae) &&
				(ae instanceof HTMLTextAreaElement || ae instanceof HTMLInputElement)
			) {
				(ae as HTMLElement).blur();
			}
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	}, []);

	const handleTimelineInsert = useCallback(() => {
		const cp = currentProjectRef.current;
		if (!cp || !activeSubtitleFileId) return;
		const td = Math.max(timelineTotalDuration, MIN_SEGMENT_DURATION);
		let start: number;
		let end: number;
		if (timelineInsertRange) {
			start = Math.max(0, Math.min(timelineInsertRange.start, td - MIN_SEGMENT_DURATION));
			end = Math.max(start + MIN_SEGMENT_DURATION, Math.min(timelineInsertRange.end, td));
		} else {
			start = Math.max(0, Math.min(currentPlaybackTime, td - MIN_SEGMENT_DURATION));
			end = Math.min(start + 1, td);
		}
		if (end - start < MIN_SEGMENT_DURATION) return;
		pushSubtitleHistorySnapshot();
		const fileId = activeSubtitleFileId;
		try {
			const { segments, insertedId } = insertEmptySegment(segmentsRef.current, start, end);
			const nextProject: ProjectData = {
				...cp,
				files: cp.files.map((f) =>
					f.id === fileId ? { ...f, subtitle_segments: segments } : f
				)
			};
			currentProjectRef.current = nextProject;
			setGeneratedSegments(segments);
			setCurrentProject(nextProject);
			setTimelineInsertRange(null);
			const newIdx = segments.findIndex((s) => s.id === insertedId);
			if (newIdx >= 0) setSelectedSegmentIndex(newIdx);
			markProjectDirty();
		} catch (e) {
			console.error('insert subtitle', e);
		}
	}, [
		activeSubtitleFileId,
		timelineTotalDuration,
		currentPlaybackTime,
		timelineInsertRange,
		pushSubtitleHistorySnapshot,
		markProjectDirty
	]);

	const handleTimelineSplit = useCallback(() => {
		const cp0 = currentProjectRef.current;
		if (!cp0 || !activeSubtitleFileId) return;
		const t = currentPlaybackTime;
		const segs = segmentsRef.current;
		const idx = segs.findIndex(
			(s) => t > s.start + MIN_SEGMENT_DURATION && t < s.end - MIN_SEGMENT_DURATION
		);
		if (idx < 0) return;
		const seg = segs[idx];
		const splitT = Math.max(
			seg.start + MIN_SEGMENT_DURATION,
			Math.min(t, seg.end - MIN_SEGMENT_DURATION)
		);
		const origStart = seg.start;

		pushSubtitleHistorySnapshot();
		const fileId = activeSubtitleFileId;

		try {
			const merged = splitSegmentAt(segs, idx, splitT);
			const nextProject: ProjectData = {
				...cp0,
				files: cp0.files.map((f) =>
					f.id === fileId ? { ...f, subtitle_segments: merged } : f
				)
			};
			currentProjectRef.current = nextProject;
			setCurrentProject(nextProject);
			setGeneratedSegments(merged);
			markProjectDirty();
			const firstIdx = merged.findIndex(
				(s) =>
					Math.abs(s.start - origStart) < 1e-3 && Math.abs(s.end - splitT) < 1e-3
			);
			if (firstIdx >= 0) setSelectedSegmentIndex(firstIdx);
		} catch (e) {
			console.error('split subtitle', e);
		}
	}, [activeSubtitleFileId, currentPlaybackTime, pushSubtitleHistorySnapshot, markProjectDirty]);

	const handleTimelineSetStart = useCallback(() => {
		if (selectedSegmentIndex < 0) return;
		const seg = generatedSegments[selectedSegmentIndex];
		if (!seg) return;
		const prev = selectedSegmentIndex > 0 ? generatedSegments[selectedSegmentIndex - 1] : null;
		const t = currentPlaybackTime;
		const newStart = Math.max(
			prev?.end ?? 0,
			Math.min(t, seg.end - MIN_SEGMENT_DURATION)
		);
		if (newStart >= seg.end - MIN_SEGMENT_DURATION) return;
		void updateSegmentAtIndex(selectedSegmentIndex, { start: newStart });
	}, [selectedSegmentIndex, generatedSegments, currentPlaybackTime, updateSegmentAtIndex]);

	const handleTimelineSetEnd = useCallback(() => {
		if (selectedSegmentIndex < 0) return;
		const seg = generatedSegments[selectedSegmentIndex];
		if (!seg) return;
		const next =
			selectedSegmentIndex < generatedSegments.length - 1
				? generatedSegments[selectedSegmentIndex + 1]
				: null;
		const t = currentPlaybackTime;
		const maxEnd = next?.start ?? timelineTotalDuration;
		const newEnd = Math.min(maxEnd, Math.max(t, seg.start + MIN_SEGMENT_DURATION));
		if (newEnd <= seg.start + MIN_SEGMENT_DURATION) return;
		void updateSegmentAtIndex(selectedSegmentIndex, { end: newEnd });
	}, [selectedSegmentIndex, generatedSegments, currentPlaybackTime, timelineTotalDuration, updateSegmentAtIndex]);

	const setSegmentStartEndLocal = useCallback(
		(index: number, start: number, end: number) => {
			const dur = Math.max(0, end - start);
			setGeneratedSegments((prev) => {
				const seg = prev[index];
				if (!seg) return prev;
				const next = { ...seg, start, end, duration: dur };
				return prev.map((s, i) => (i === index ? next : s));
			});
			setCurrentProject((cp) => {
				if (!cp || !activeSubtitleFileId) return cp;
				return {
					...cp,
					files: cp.files.map((f) => {
						if (f.id !== activeSubtitleFileId || !f.subtitle_segments) return f;
						const segs = [...f.subtitle_segments];
						const seg = segs[index];
						if (!seg) return f;
						segs[index] = { ...seg, start, end, duration: dur };
						return { ...f, subtitle_segments: segs };
					})
				};
			});
		},
		[activeSubtitleFileId]
	);

	const clientXToTimelineTime = useCallback((clientX: number): number => {
		const inner = timelineInnerRef.current;
		const scr = timelineScrollRef.current;
		if (!inner || !scr) return 0;
		const scrRect = scr.getBoundingClientRect();
		const x = clientX - scrRect.left + scr.scrollLeft;
		const td = timelineTotalDurationRef.current;
		const w = inner.offsetWidth;
		if (w <= 0 || td <= 0) return 0;
		return Math.max(0, Math.min(td, (x / w) * td));
	}, []);

	const beginTimelineRangeSelect = useCallback(
		(e: React.PointerEvent) => {
			if (e.button !== 0) return;
			const el = e.target as HTMLElement;
			if (el.closest('[data-tl-segment]')) return;
			if (el.closest('[data-tl-edge]')) return;
			e.preventDefault();
			setTimelineInsertRange(null);
			const t0 = clientXToTimelineTime(e.clientX);
			timelineRangeSelectDragRef.current = { t0 };
			setTimelineRangePreview({ a: t0, b: t0 });

			const onMove = (ev: PointerEvent) => {
				if (!timelineRangeSelectDragRef.current) return;
				const t = clientXToTimelineTime(ev.clientX);
				const d = timelineRangeSelectDragRef.current;
				setTimelineRangePreview({ a: d.t0, b: t });
			};
			const onUp = (ev: PointerEvent) => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				const d = timelineRangeSelectDragRef.current;
				timelineRangeSelectDragRef.current = null;
				const t0 = d?.t0 ?? clientXToTimelineTime(ev.clientX);
				const t1 = clientXToTimelineTime(ev.clientX);
				setTimelineRangePreview(null);
				const td = timelineTotalDurationRef.current;
				const lo = Math.min(t0, t1);
				const hi = Math.max(t0, t1);
				if (hi - lo >= MIN_SEGMENT_DURATION) {
					setTimelineInsertRange({ start: lo, end: hi });
					setCurrentPlaybackTime(lo);
					const v = videoRef.current;
					if (v) v.currentTime = lo;
				} else {
					setTimelineInsertRange(null);
					const seekT = Math.max(0, Math.min(td, t1));
					setCurrentPlaybackTime(seekT);
					const v = videoRef.current;
					if (v) v.currentTime = seekT;
				}
			};
			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
		},
		[clientXToTimelineTime]
	);

	const canSplitAtPlayhead = useMemo(() => {
		const t = currentPlaybackTime;
		return generatedSegments.some(
			(s) => t > s.start + MIN_SEGMENT_DURATION && t < s.end - MIN_SEGMENT_DURATION
		);
	}, [generatedSegments, currentPlaybackTime]);

	const beginTimelineEdgeDrag = useCallback(
		(edge: 'start' | 'end', index: number, ev: React.MouseEvent) => {
			ev.preventDefault();
			ev.stopPropagation();
			const seg = segmentsRef.current[index];
			if (!seg || !activeSubtitleFileId) return;
			const undoSnap = cloneSubtitleSegments(segmentsRef.current);
			timelineEdgeDragRef.current = {
				edge,
				index,
				start: seg.start,
				end: seg.end
			};
			const onMove = (e: MouseEvent) => {
				const drag = timelineEdgeDragRef.current;
				if (!drag) return;
				const segs = segmentsRef.current;
				const t = clientXToTimelineTime(e.clientX);
				const maxT = timelineTotalDurationRef.current;
				const prev = drag.index > 0 ? segs[drag.index - 1] : null;
				const next = drag.index < segs.length - 1 ? segs[drag.index + 1] : null;
				let start = drag.start;
				let end = drag.end;
				if (drag.edge === 'start') {
					start = Math.max(prev?.end ?? 0, Math.min(t, end - MIN_SEGMENT_DURATION));
				} else {
					end = Math.min(next?.start ?? maxT, Math.max(t, start + MIN_SEGMENT_DURATION));
				}
				drag.start = start;
				drag.end = end;
				setSegmentStartEndLocal(drag.index, start, end);
			};
			const onUp = () => {
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
				const drag = timelineEdgeDragRef.current;
				timelineEdgeDragRef.current = null;
				if (drag) {
					undoSegmentsStackRef.current.push(undoSnap);
					if (undoSegmentsStackRef.current.length > MAX_SUBTITLE_UNDO) undoSegmentsStackRef.current.shift();
					redoSegmentsStackRef.current = [];
					void updateSegmentAtIndex(drag.index, { start: drag.start, end: drag.end }, { skipHistory: true });
				}
			};
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		},
		[activeSubtitleFileId, clientXToTimelineTime, setSegmentStartEndLocal, updateSegmentAtIndex]
	);

	const beginTimelineSegmentMove = useCallback(
		(index: number, ev: React.MouseEvent) => {
			if (!activeSubtitleFileId) return;
			if ((ev.target as HTMLElement).closest('[data-tl-edge]')) return;
			ev.preventDefault();
			ev.stopPropagation();
			const seg = segmentsRef.current[index];
			if (!seg) return;
			const undoSnap = cloneSubtitleSegments(segmentsRef.current);
			const t0 = clientXToTimelineTime(ev.clientX);
			timelineSegmentMoveRef.current = {
				index,
				origStart: seg.start,
				origEnd: seg.end,
				t0
			};
			const onMove = (e: MouseEvent) => {
				const mv = timelineSegmentMoveRef.current;
				if (!mv) return;
				const segs = segmentsRef.current;
				const prev = mv.index > 0 ? segs[mv.index - 1] : null;
				const next = mv.index < segs.length - 1 ? segs[mv.index + 1] : null;
				const maxT = timelineTotalDurationRef.current;
				const deltaT = clientXToTimelineTime(e.clientX) - mv.t0;
				const dur = mv.origEnd - mv.origStart;
				const pEnd = prev?.end ?? 0;
				const nStart = next?.start ?? maxT;
				let s = mv.origStart + deltaT;
				s = Math.max(pEnd, Math.min(s, nStart - dur));
				const en = s + dur;
				setSegmentStartEndLocal(mv.index, s, en);
			};
			const onUp = () => {
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
				const mv = timelineSegmentMoveRef.current;
				timelineSegmentMoveRef.current = null;
				if (!mv) return;
				const cur = segmentsRef.current[mv.index];
				const changed =
					cur &&
					(Math.abs(cur.start - mv.origStart) > 1e-4 ||
						Math.abs(cur.end - mv.origEnd) > 1e-4);
				if (changed && cur) {
					segmentBodyDragMovedRef.current = true;
					undoSegmentsStackRef.current.push(undoSnap);
					if (undoSegmentsStackRef.current.length > MAX_SUBTITLE_UNDO) undoSegmentsStackRef.current.shift();
					redoSegmentsStackRef.current = [];
					void updateSegmentAtIndex(mv.index, { start: cur.start, end: cur.end }, { skipHistory: true });
				}
			};
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		},
		[activeSubtitleFileId, clientXToTimelineTime, setSegmentStartEndLocal, updateSegmentAtIndex]
	);
	
	const openWizard = async () => {
		setWizardSpotlightDismissed(true);
		try {
			const hasApiKey = await projectService.getApiKeyStatus();
			if (!hasApiKey) {
				setActiveModal('activation');
				return;
			}
		} catch (error) {
			console.error('Failed to check API key status before wizard', error);
		}
		setActiveModal('wizard');
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== 'Space') return;
			if (activeModal !== null) return;
			if (shouldIgnoreSpacebarForVideo(e.target)) return;
			if (!videoSrc) return;
			const v = videoRef.current;
			if (!v) return;
			e.preventDefault();
			if (v.paused) void v.play();
			else v.pause();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [activeModal, videoSrc]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			if (activeModal !== null) return;
			if (shouldIgnoreSpacebarForVideo(e.target)) return;
			/* e.code — физическая клавиша (KeyZ и т.д.), работает в любой раскладке */
			if (e.code === 'KeyZ' && !e.shiftKey) {
				e.preventDefault();
				void performSubtitleUndo();
				return;
			}
			if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) {
				e.preventDefault();
				void performSubtitleRedo();
				return;
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [activeModal, performSubtitleUndo, performSubtitleRedo]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== 'Delete') return;
			if (activeModal !== null) return;
			if (shouldIgnoreSpacebarForVideo(e.target)) return;
			if (!activeSubtitleFileId || selectedSegmentIndex < 0) return;
			e.preventDefault();
			void handleDeleteSelectedSubtitle();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [activeModal, activeSubtitleFileId, selectedSegmentIndex, handleDeleteSelectedSubtitle]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== 'Escape') return;
			setTimelineInsertRange(null);
			setTimelineRangePreview(null);
			timelineRangeSelectDragRef.current = null;
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
			if (activeModal !== null) return;
			if (shouldIgnoreSpacebarForVideo(e.target)) return;
			if (!activeSubtitleFileId) return;
			const n = segmentsRef.current.length;
			if (n === 0) return;
			e.preventDefault();
			if (e.code === 'ArrowLeft') {
				setSelectedSegmentIndex((i) => {
					if (i < 0) return n - 1;
					return Math.max(0, i - 1);
				});
			} else {
				setSelectedSegmentIndex((i) => {
					if (i < 0) return 0;
					return Math.min(n - 1, i + 1);
				});
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [activeModal, activeSubtitleFileId]);

	useEffect(() => {
		let disposed = false;
		const resolveStartupModal = async () => {
			try {
				const activationCompleted = localStorage.getItem(ACTIVATION_COMPLETED_STORAGE_KEY) === '1';
				const hasApiKey = await projectService.getApiKeyStatus();
				if (disposed) return;
				if (!activationCompleted || !hasApiKey) {
					setActiveModal('activation');
					return;
				}
				setActiveModal('welcome');
			} catch (error) {
				console.error('Failed to resolve startup modal', error);
				if (!disposed) {
					setActiveModal('activation');
				}
			}
		};
		void resolveStartupModal();
		return () => {
			disposed = true;
		};
	}, []);

	useEffect(() => {
		setWizardSpotlightDismissed(false);
	}, [currentProject?.path]);

	useEffect(() => {
		setVideoDuration(0);
		setCurrentPlaybackTime(0);
		setWaveformPeaks(null);
		setWaveformImageSrc(null);
		setProbedMediaDuration(null);
	}, [activeVideoAbsolutePath]);

	useEffect(() => {
		if (!currentProject?.path) {
			setProjectDiskFiles([]);
			return;
		}
		const projectPath = currentProject.path;
		let cancelled = false;
		const refreshDiskList = () => {
			void projectService.listProjectDirectoryFiles(projectPath).then((list) => {
				if (!cancelled) setProjectDiskFiles(list);
			}).catch(() => {
				if (!cancelled) setProjectDiskFiles([]);
			});
		};
		refreshDiskList();
		const intervalId = window.setInterval(refreshDiskList, 2000);
		const onFocus = () => refreshDiskList();
		const onVisibility = () => {
			if (document.visibilityState === 'visible') refreshDiskList();
		};
		window.addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}, [currentProject?.path]);

	useEffect(() => {
		undoSegmentsStackRef.current = [];
		redoSegmentsStackRef.current = [];
	}, [activeSubtitleFileId]);

	/**
	 * Длительность через ffprobe совпадает с тем, что ffmpeg кладёт в пнг вейвформы
	 */
	useEffect(() => {
		setProbedMediaDuration(null);
		if (!activeVideoAbsolutePath) return;
		let cancelled = false;
		void projectService.probeMediaDuration(activeVideoAbsolutePath).then((d) => {
			if (!cancelled && Number.isFinite(d) && d > 0) setProbedMediaDuration(d);
		}).catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [activeVideoAbsolutePath]);

	useEffect(() => {
		if (!activeVideoAbsolutePath || !currentProject) return;
		let cancelled = false;
		const outJson = joinProjectPath(currentProject.path, 'config', 'waveform_cache.json');
		const outPng = joinProjectPath(currentProject.path, 'config', 'waveform.png');
		(async () => {
			setWaveformImageSrc(null);
			try {
				await projectService.generateWaveformPng(activeVideoAbsolutePath, outPng, 4096, 1024);
				if (!cancelled) {
					const url = convertFileSrc(outPng.replace(/\\/g, '/'));
					setWaveformImageSrc(`${url}?t=${Date.now()}`);
				}
			} catch (e) {
				console.warn('[waveform] PNG (ffmpeg showwavespic):', e);
			}
			try {
				const data = await projectService.generateWaveform(activeVideoAbsolutePath, outJson, 48);
				if (!cancelled && data) {
					if (data.peaks?.length) {
						setWaveformPeaks(data.peaks.map((p) => Number(p)));
					}
					if (Number.isFinite(data.duration) && data.duration > 0) {
						setProbedMediaDuration((prev) =>
							prev != null && prev > 0 ? Math.max(prev, data.duration) : data.duration
						);
					}
				}
			} catch (e) {
				console.warn('[waveform] peaks:', e);
				if (!cancelled) setWaveformPeaks(null);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [activeVideoAbsolutePath, currentProject?.path]);

	useEffect(() => {
		const v = videoRef.current;
		if (v) v.volume = volume;
	}, [volume]);

	useEffect(() => {
		const v = videoRef.current;
		if (v) v.muted = videoMuted;
	}, [videoMuted]);

	useEffect(() => {
		if (!videoSrc) setIsVideoPlaying(false);
	}, [videoSrc]);

	/** Плавная полоска таймлайна */
	useEffect(() => {
		if (!videoSrc) return;
		const v = videoRef.current;
		if (!v) return;

		let rafId = 0;

		const tick = () => {
			rafId = 0;
			if (v.paused || v.ended) return;
			setCurrentPlaybackTime(v.currentTime);
			rafId = requestAnimationFrame(tick);
		};

		const startLoop = () => {
			if (rafId) cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(tick);
		};

		const onPause = () => {
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			}
			setCurrentPlaybackTime(v.currentTime);
		};

		const onSeeked = () => setCurrentPlaybackTime(v.currentTime);

		v.addEventListener('play', startLoop);
		v.addEventListener('pause', onPause);
		v.addEventListener('seeked', onSeeked);

		if (!v.paused) startLoop();

		return () => {
			v.removeEventListener('play', startLoop);
			v.removeEventListener('pause', onPause);
			v.removeEventListener('seeked', onSeeked);
			if (rafId) cancelAnimationFrame(rafId);
		};
	}, [videoSrc]);

	/** Ползунок нижнего скроллбара */
	const syncTimelineScrollbarThumb = useCallback(() => {
		const el = timelineScrollRef.current;
		const thumb = timelineScrollbarThumbRef.current;
		if (!el || !thumb) return;
		const sl = el.scrollLeft;
		const sw = el.scrollWidth;
		const cw = el.clientWidth;
		if (!sw || sw <= cw) {
			thumb.style.width = '100%';
			thumb.style.left = '0%';
			return;
		}
		const thumbW = Math.max((cw / sw) * 100, 8);
		const maxScroll = sw - cw;
		const travel = 100 - thumbW;
		thumb.style.width = `${thumbW}%`;
		thumb.style.left = `${(sl / maxScroll) * travel}%`;
	}, []);

	useLayoutEffect(() => {
		const el = timelineScrollRef.current;
		if (!el) return;
		let raf = 0;
		const schedule = () => {
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				syncTimelineScrollbarThumb();
			});
		};
		el.addEventListener('scroll', schedule, { passive: true });
		schedule();
		return () => {
			el.removeEventListener('scroll', schedule);
			if (raf) cancelAnimationFrame(raf);
		};
	}, [syncTimelineScrollbarThumb, timelineZoomPercent, generatedSegments.length, timelineTotalDuration]);

	useEffect(() => {
		const panel = timelineWheelRef.current;
		if (!panel) return;

		const onWheel = (e: WheelEvent) => {
			if (e.altKey) {
				e.preventDefault();
				const dir: 1 | -1 = e.deltaY > 0 ? -1 : 1;
				const scr = timelineScrollRef.current;
				const inner = timelineInnerRef.current;
				const td = timelineTotalDurationRef.current;
				if (scr && inner && td > 0) {
					const r = Math.max(0, Math.min(1, currentPlaybackTimeRef.current / td));
					zoomAnchorRef.current = { ratio: r, scrollLeft: scr.scrollLeft, innerW: inner.offsetWidth };
				} else {
					zoomAnchorRef.current = null;
				}
				setTimelineZoomPercent((z) => {
					const zNext = stepTimelineZoom(z, dir);
					if (zNext === z) zoomAnchorRef.current = null;
					return zNext;
				});
				requestAnimationFrame(() => syncTimelineScrollbarThumb());
				return;
			}
			const scr = timelineScrollRef.current;
			if (!scr) return;
			const scrollDelta =
				Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
			if (scrollDelta === 0) return;
			e.preventDefault();
			scr.scrollLeft += scrollDelta;
			requestAnimationFrame(() => syncTimelineScrollbarThumb());
		};

		panel.addEventListener('wheel', onWheel, { passive: false });
		return () => panel.removeEventListener('wheel', onWheel);
	}, [syncTimelineScrollbarThumb]);

	useLayoutEffect(() => {
		const a = zoomAnchorRef.current;
		if (!a) return;
		zoomAnchorRef.current = null;
		const scr = timelineScrollRef.current;
		const inner = timelineInnerRef.current;
		if (!scr || !inner) return;
		const wAfter = inner.offsetWidth;
		const sNew = a.ratio * wAfter - (a.ratio * a.innerW - a.scrollLeft);
		const maxSl = Math.max(0, scr.scrollWidth - scr.clientWidth);
		scr.scrollLeft = Math.max(0, Math.min(sNew, maxSl));
		syncTimelineScrollbarThumb();
	}, [timelineZoomPercent, syncTimelineScrollbarThumb]);

	const seekVideoFromClientX = useCallback(
		(clientX: number, barEl: HTMLElement) => {
			const v = videoRef.current;
			if (!v) return;
			const dur = timelineTotalDuration;
			if (!dur) return;
			const rect = barEl.getBoundingClientRect();
			const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
			const t = ratio * dur;
			v.currentTime = Math.min(t, Number.isFinite(v.duration) && v.duration > 0 ? v.duration : t);
			setCurrentPlaybackTime(v.currentTime);
		},
		[timelineTotalDuration]
	);

	const handleVideoProgressPointerDown = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			e.preventDefault();
			const bar = e.currentTarget;
			seekVideoFromClientX(e.clientX, bar);
			const onMove = (ev: MouseEvent) => seekVideoFromClientX(ev.clientX, bar);
			const onUp = () => {
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
			};
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		},
		[seekVideoFromClientX]
	);

	const handleTimelineScrubPointerDown = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			e.preventDefault();
			const bar = e.currentTarget;
			const el = timelineScrollRef.current;
			if (!el) return;
			let moveRaf = 0;
			const apply = (clientX: number) => {
				const maxScroll = el.scrollWidth - el.clientWidth;
				if (maxScroll <= 0) return;
				const rect = bar.getBoundingClientRect();
				const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
				el.scrollLeft = ratio * maxScroll;
				if (moveRaf) return;
				moveRaf = requestAnimationFrame(() => {
					moveRaf = 0;
					syncTimelineScrollbarThumb();
				});
			};
			apply(e.clientX);
			const onMove = (ev: MouseEvent) => apply(ev.clientX);
			const onUp = () => {
				if (moveRaf) cancelAnimationFrame(moveRaf);
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
				syncTimelineScrollbarThumb();
			};
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		},
		[syncTimelineScrollbarThumb]
	);

	const handleVolumePointerDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
		e.preventDefault();
		const bar = e.currentTarget;
		const apply = (clientX: number) => {
			const v = videoRef.current;
			if (!v) return;
			const rect = bar.getBoundingClientRect();
			const r = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
			v.volume = r;
			setVolume(r);
			if (r < 1e-4) {
				v.muted = true;
				setVideoMuted(true);
			} else {
				v.muted = false;
				setVideoMuted(false);
			}
		};
		apply(e.clientX);
		const onMove = (ev: MouseEvent) => apply(ev.clientX);
		const onUp = () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}, []);

	useLayoutEffect(() => {
		requestAnimationFrame(() => syncTimelineScrollbarThumb());
	}, [timelineZoomPercent, generatedSegments.length, timelineTotalDuration, syncTimelineScrollbarThumb]);

	useEffect(() => {
		if (!isPlayingRef.current) return;
		const el = timelineScrollRef.current;
		const inner = timelineInnerRef.current;
		if (!el || !inner || timelineTotalDuration <= 0) return;
		const playheadX = (currentPlaybackTime / timelineTotalDuration) * inner.offsetWidth;
		const target = playheadX - el.clientWidth * 0.35;
		el.scrollLeft = Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth));
		requestAnimationFrame(() => syncTimelineScrollbarThumb());
	}, [currentPlaybackTime, timelineTotalDuration, syncTimelineScrollbarThumb]);

	// --- ЛОГИКА РЕШАЙЗА пАНЕЛЕЙ ---

	// остановка любого ресайза
	const stopResizing = useCallback(() => {
		setIsResizing(false);
	}, []);

	// ресайз дерева проекта
	const startResizing = useCallback(() => {
		setIsResizing(true);
	}, []);

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

	// слушатели для ресайза дерева
	useEffect(() => {
		window.addEventListener("mousemove", resize);
		window.addEventListener("mouseup", stopResizing);
		return () => {
			window.removeEventListener("mousemove", resize);
			window.removeEventListener("mouseup", stopResizing);
		};
	}, [resize, stopResizing]);

	// контроль ограничений при изменении окна
	useEffect(() => {
		const totalFixed = 60 + projectTreeWidth + aiAgentWidth;
		const maxTable = windowSize.width - totalFixed - LIMITS.VIDEO;

		if (tablePanelWidth > maxTable) {
			setTablePanelWidth(Math.max(300, maxTable));
		}

		const currentVideoWidth = windowSize.width - totalFixed - tablePanelWidth;
		if (currentVideoWidth < LIMITS.VIDEO) {
			const fixedTable = windowSize.width - totalFixed - LIMITS.VIDEO;
			setTablePanelWidth(Math.max(300, fixedTable));
		}

		const maxUpper = windowSize.height - APP_HEADER_BAR_PX - MIN_TIMELINE_PANE_PX;
		if (upperSectionHeight > maxUpper) {
			setUpperSectionHeight(maxUpper);
		}
	}, [windowSize, tablePanelWidth, projectTreeWidth, aiAgentWidth]);

	// ресайз панели аи агента
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
	}, [aiAgentWidth, windowSize.width, projectTreeWidth]);

	// ресайз таблицы (ширина и высота верхней части)
	const startTablePanelResizing = useCallback((direction: 'right' | 'bottom', mouseDownEvent: React.MouseEvent) => {
		const startWidth = tablePanelWidth;
		const startHeight = upperSectionHeight;
		const startX = mouseDownEvent.clientX;
		const startY = mouseDownEvent.clientY;

		const doDrag = (e: MouseEvent) => {
			if (direction === 'right') {
				const newWidth = startWidth + (e.clientX - startX);
				const minTableWidth = 400; 
				const maxAllowedWidth = windowSize.width - (60 + projectTreeWidth + aiAgentWidth) - LIMITS.VIDEO;

				if (newWidth >= minTableWidth && newWidth <= maxAllowedWidth) {
					setTablePanelWidth(newWidth);
				}
			} else {
				const newHeight = startHeight + (e.clientY - startY);
				const maxUpper = window.innerHeight - APP_HEADER_BAR_PX - MIN_TIMELINE_PANE_PX;
				if (newHeight > 200 && newHeight <= maxUpper) setUpperSectionHeight(newHeight);
			}
		};

		const stopDrag = () => {
			window.removeEventListener('mousemove', doDrag);
			window.removeEventListener('mouseup', stopDrag);
		};
		window.addEventListener('mousemove', doDrag);
		window.addEventListener('mouseup', stopDrag);
	}, [tablePanelWidth, upperSectionHeight, windowSize, projectTreeWidth, aiAgentWidth]);

	// ресайз отдельных колонок таблицы
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

	const handleProjectCreated = async (project: ProjectData) => {
		try {
			await handleSelectProject(project.path);
		} catch (error) {
			console.error("Ошибка открытия нового проекта:", error);
		}
	};



  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-surface-bg select-none">
			{/* Верхнее меню, название проекта, 3 кнопки */}
			<div 
				className="h-[32px] flex items-center justify-between shrink-0 bg-surface-bg border-b border-border-default select-none relative z-[100]"
				style={{ ['WebkitAppRegion' as any]: 'drag' }}
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
						{currentProject?.name ?? 'Untitled'} - subtitlestudio
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
      
				{/* ЛЕВАЯ ПАНЕЛЬ (САЙДБАР): overflow-visible, чтобы свечение кнопки мастера не резалось; скролл только у верх/ниж блоков */}
				<div className="w-[60px] border-r border-border-default flex flex-col items-center py-6 bg-surface-panel shrink-0 h-full min-h-0 overflow-visible">
					<div className="flex flex-1 min-h-0 w-full flex-col items-center overflow-visible">
						<div className="flex flex-1 min-h-0 w-full flex-col items-center justify-end overflow-y-auto no-scrollbar pb-[14px]">
							<div className="flex flex-col items-center gap-[30px]">
								<button
									type="button"
									title="Создать новый проект"
									onClick={() => setActiveModal('createProject')}
									className="group w-7 h-7 flex items-center justify-center shrink-0"
								>
									<span
										className={`${SIDEBAR_ICON_CLASS} bg-text-primary`}
										style={sidebarIconMaskStyle(iconNewProject)}
										aria-hidden
									/>
								</button>

								<button
									type="button"
									title="Открыть проект"
									onClick={() => void handleOpenProjectDialog()}
									className="group w-7 h-7 flex items-center justify-center shrink-0"
								>
									<span
										className={`${SIDEBAR_ICON_CLASS} bg-text-primary`}
										style={sidebarIconMaskStyle(iconOpenProject)}
										aria-hidden
									/>
								</button>

								<button
									type="button"
									title="Сохранить проект"
									onClick={() => void handleSaveProject()}
									disabled={!currentProject}
									className="group w-7 h-7 flex items-center justify-center shrink-0 disabled:opacity-40 disabled:pointer-events-none"
								>
									<span
										className={`${SIDEBAR_ICON_CLASS} bg-text-primary`}
										style={sidebarIconMaskStyle(iconSave)}
										aria-hidden
									/>
								</button>
							</div>
						</div>

						{/* Кнопка мастера в круге — вне overflow-y, свечение не обрезается */}
						<div
							className={`relative flex h-[76px] w-[76px] shrink-0 items-center justify-center overflow-visible py-[14px] ${
								shouldHighlightWizardCta ? 'z-[60]' : ''
							}`}
						>
							{shouldHighlightWizardCta && (
								<span
									aria-hidden
									className="pointer-events-none absolute left-1/2 top-1/2 h-[92px] w-[92px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35 blur-2xl"
								/>
							)}
							<button
								type="button"
								onClick={openWizard}
								title="Пошаговый мастер"
								className={`group relative z-[1] h-[48px] w-[48px] shrink-0 rounded-full flex items-center justify-center transition-colors ${
									shouldHighlightWizardCta
										? 'bg-primary-hover shadow-[0_0_28px_rgba(255,255,255,0.45),0_0_56px_rgba(255,255,255,0.22)]'
										: 'bg-primary-main shadow-md hover:bg-primary-hover'
								}`}
							>
								<span
									className={`${SIDEBAR_ICON_CLASS} bg-white`}
									style={sidebarIconMaskStyle(iconWizard)}
									aria-hidden
								/>
							</button>
						</div>

						<div className="flex flex-1 min-h-0 w-full flex-col items-center justify-start overflow-y-auto no-scrollbar pt-[14px]">
							<div className="flex flex-col items-center gap-[30px]">
								<button
									type="button"
									title="Экспорт"
									onClick={() => setActiveModal('export')}
									className="group w-7 h-7 flex items-center justify-center shrink-0"
								>
									<span
										className={`${SIDEBAR_ICON_CLASS} bg-text-primary`}
										style={sidebarIconMaskStyle(iconExport)}
										aria-hidden
									/>
								</button>

								<button
									type="button"
									title="Глоссарий"
									onClick={() => setActiveModal('glossary')}
									className="group w-7 h-7 flex items-center justify-center shrink-0"
								>
									<span
										className={`${SIDEBAR_ICON_CLASS} bg-text-primary`}
										style={sidebarIconMaskStyle(iconGlossary)}
										aria-hidden
									/>
								</button>

								<button type="button" title="Поиск" className="group w-7 h-7 flex items-center justify-center shrink-0">
									<span
										className={`${SIDEBAR_ICON_CLASS} bg-text-primary`}
										style={sidebarIconMaskStyle(iconSearch)}
										aria-hidden
									/>
								</button>
							</div>
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
							{currentProject?.name ?? 'No project'}
						</span>
						
						<div className="flex items-center gap-[12px] shrink-0">
							<button
								type="button"
								title="Новый файл"
								onClick={handleProjectTreeNewFile}
								disabled={!currentProject}
								className="group w-4 h-4 flex items-center justify-center shrink-0 disabled:opacity-40 disabled:pointer-events-none"
							>
								<span
									className={`${PANEL_HEADER_ICON_CLASS} bg-text-primary`}
									style={sidebarIconMaskStyle(iconNewFile)}
									aria-hidden
								/>
							</button>

							<button
								type="button"
								title="Новая папка"
								onClick={handleProjectTreeNewFolder}
								disabled={!currentProject}
								className="group w-4 h-4 flex items-center justify-center shrink-0 disabled:opacity-40 disabled:pointer-events-none"
							>
								<span
									className={`${PANEL_HEADER_ICON_CLASS} bg-text-primary`}
									style={sidebarIconMaskStyle(iconNewFolder)}
									aria-hidden
								/>
							</button>
						</div>
					</div>

					{/* Список файлов */}
					<div className="flex-1 min-w-0 overflow-y-auto p-3 bg-surface-bg subtitle-table-scroll project-tree-scroll">
						<div className="flex flex-col gap-[8px]">
						
							<div 
								className="flex items-center gap-[8px] cursor-pointer group h-4"
								onClick={() => setIsConfigFolderOpen(!isConfigFolderOpen)}
							>
								{isConfigFolderOpen ? <ChevronDown size={12} className="text-text-primary/70 shrink-0" /> : <ChevronRight size={12} className="text-text-primary/70 shrink-0" />}
								<span className="font-inter font-semibold text-[12px] leading-none text-text-primary tracking-normal">
									.config
								</span>
							</div>

							{isConfigFolderOpen && treeFiles.config.length > 0 && (
								<div className="flex gap-[11px] ml-[5px]">
									<div className="w-[1px] bg-border-default shrink-0" />
									<div className="flex flex-col gap-[8px] flex-1">
										{treeFiles.config.map((file) => (
											<div key={file.id} className="hover:text-primary-main cursor-pointer truncate h-4 flex items-center">
												<span className="font-inter font-semibold text-[12px] leading-none text-text-primary tracking-normal">
													{file.name}
												</span>
											</div>
										))}
									</div>
								</div>
							)}

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
											{treeFiles.video.map((file) => (
												<div key={file.id} className="hover:text-primary-main cursor-pointer truncate h-4 flex items-center">
													<span className="font-inter font-semibold text-[12px] leading-none text-text-primary tracking-normal">
														{file.name}
													</span>
												</div>
											))}
										</div>
									</div>
								)}
							</div>

							<div className="flex flex-col gap-[8px]">
								<div 
									className="flex items-center gap-[8px] cursor-pointer group h-4"
									onClick={() => setIsSubtitlesFolderOpen(!isSubtitlesFolderOpen)}
								>
									{isSubtitlesFolderOpen ? <ChevronDown size={12} className="text-text-primary/70 shrink-0" /> : <ChevronRight size={12} className="text-text-primary/70 shrink-0" />}
									<span className="font-inter font-semibold text-[12px] leading-none text-text-primary tracking-normal">
										subtitles
									</span>
								</div>

								{isSubtitlesFolderOpen && treeFiles.subtitles.length > 0 && (
									<div className="flex gap-[11px] ml-[5px]">
										<div className="w-[1px] bg-border-default shrink-0" />
										<div className="flex flex-col gap-[8px] flex-1">
											{treeFiles.subtitles.map((file) => (
												<div key={file.id} className="hover:text-primary-main cursor-pointer truncate h-4 flex items-center">
													<span className="font-inter font-semibold text-[12px] leading-none text-text-primary tracking-normal">
														{file.name}
													</span>
												</div>
											))}
										</div>
									</div>
								)}
							</div>

							{treeFiles.root.map((file) => (
								<div key={file.id} className="hover:text-primary-main cursor-pointer truncate h-4 flex items-center">
									<span className="font-inter font-semibold text-[12px] leading-none text-text-primary tracking-normal">
										{file.name}
									</span>
								</div>
							))}

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
							<button
								type="button"
								title="Добавить"
								onClick={handleAiAgentAdd}
								className="group w-4 h-4 flex items-center justify-center shrink-0"
							>
								<span
									className={`${PANEL_HEADER_ICON_CLASS} bg-text-primary`}
									style={sidebarIconMaskStyle(iconAdd)}
									aria-hidden
								/>
							</button>

							<button
								type="button"
								title="Ещё"
								onClick={handleAiAgentMore}
								className="group w-4 h-4 flex items-center justify-center shrink-0"
							>
								<span
									className={`${PANEL_HEADER_ICON_CLASS} bg-text-primary`}
									style={sidebarIconMaskStyle(iconMore)}
									aria-hidden
								/>
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

								{/* Встраиваемая реплика (diff-карточка) */}
								<div className="mt-3 bg-inline-bg rounded-[10px] p-[8px] flex flex-col gap-[8px] w-full">
									<div className="flex items-center justify-between gap-2">
										<button
											type="button"
											title={agentEmbedDiffExpanded ? 'Свернуть' : 'Развернуть'}
											aria-expanded={agentEmbedDiffExpanded}
											onClick={() => setAgentEmbedDiffExpanded((v) => !v)}
											className="group flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-text-primary transition-colors hover:bg-text-primary/15"
										>
											<span
												className={`${PANEL_HEADER_ICON_CLASS} bg-text-primary`}
												style={sidebarIconMaskStyle(
													agentEmbedDiffExpanded ? iconArrowUp : iconArrowDown
												)}
												aria-hidden
											/>
										</button>
										<div className="flex gap-[12px] shrink-0">
											<button
												type="button"
												className="text-caption font-inter text-text-secondary hover:text-text-primary transition-colors"
											>
												Undo
											</button>
											<button
												type="button"
												className="text-caption font-inter text-text-secondary hover:text-text-primary transition-colors"
											>
												Keep
											</button>
										</div>
									</div>

									{!agentEmbedDiffExpanded && (
										<p className="text-caption font-inter text-text-primary/70">1 change</p>
									)}

									{agentEmbedDiffExpanded && (
										<>
											{/* Метаданные ID, Таймкод и Тонкая Линия */}
											<div className="flex items-center gap-[14px] text-caption font-inter text-text-primary/60">
												<span className="whitespace-nowrap">#152</span>
												<span className="whitespace-nowrap">[ 00:01:03 ]</span>
												<div className="flex-1 h-[1px] bg-border-default" />
											</div>

											<div className="flex flex-col gap-[4px]">
												<div className="h-[22px] bg-inline-error rounded-[2px] px-[4px] flex items-center">
													<span className="text-caption text-text-primary truncate font-inter">
														Поехали сегодня в Магикс!
													</span>
												</div>
												<div className="h-[22px] bg-inline-success rounded-[2px] px-[4px] flex items-center">
													<span className="text-caption text-text-primary truncate font-inter">
														Поехали сегодня в Магиксию!
													</span>
												</div>
											</div>
										</>
									)}
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

							{/* Кнопка отправки: hitbox = круг 40×40; анимации только от group/send, не от group на поле ввода */}
							<div className="absolute right-3 bottom-3">
								<button
									type="button"
									title="Send message"
									className="group/send flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-secondary-hover p-0 outline-none transition-colors hover:bg-primary-main focus-visible:ring-2 focus-visible:ring-primary-main/40"
								>
									<span
										className="pointer-events-none inline-block h-6 w-6 shrink-0 origin-center bg-white transition-transform duration-200 ease-out will-change-transform group-hover/send:scale-110 group-active/send:scale-[0.92]"
										style={sidebarIconMaskStyle(iconSend)}
										aria-hidden
									/>
								</button>
							</div>

						</div>
					</div>

					{/* РЕСАЙЗЕР */}
					<div 
						onMouseDown={startAiAgentResizing}
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
								<div
									ref={subtitleTableScrollRef}
									className="flex-1 overflow-y-auto no-scrollbar subtitle-table-scroll bg-surface-secondary"
								>
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
											{generatedSegments.map((segment, idx) => (
												<tr
													key={`${segment.id}-${idx}`}
													data-subtitle-row-index={idx}
													onClick={() => setSelectedSegmentIndex(idx)}
													className={`h-[25px] hover:bg-black/5 transition-colors group text-table cursor-pointer scroll-mt-[25px] ${
														selectedSegmentIndex === idx ? 'bg-black/10' : ''
													}`}
												>
													<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
														<div className="truncate">{segment.id}</div>
													</td>
													<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
														<div className="truncate">{segment.start.toFixed(3)}</div>
													</td>
													<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
														<div className="truncate">{segment.end.toFixed(3)}</div>
													</td>
													<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text">
														<div className="truncate">{segment.duration.toFixed(3)}</div>
													</td>
													<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 text-body-reg select-text">
														<div className="truncate">{segment.translation || '-'}</div>
													</td>
													<td className="py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 text-body-reg select-text">
														<div className="truncate">{segment.text}</div>
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
							<div
								ref={segmentEditorPanelRef}
								className="h-[180px] bg-surface-panel border-t border-border-default p-[12px] flex gap-1 shrink-0 min-w-0 overflow-hidden"
							>
								
								{/* Колонна 1 Таймкоды и кнопки управления */}
								<div className="w-fit flex flex-col shrink-0 min-w-0">
									{/* Инпуты в один ряд */}
									<div className="flex gap-[4px]">
										<div className="flex flex-col gap-[4px]">
											<label className="text-caption text-text-primary">Start time</label>
											<input 
												type="text"
												inputMode="text"
												autoComplete="off"
												spellCheck={false}
												value={segEditorStart}
												onChange={(e) => setSegEditorStart(sanitizeSrtTimeInput(e.target.value))}
												onBlur={commitSegEditorStart}
												onKeyDown={(e) => {
													if (e.key === 'Enter') {
														e.preventDefault();
														e.currentTarget.blur();
													}
												}}
												className="w-[100px] h-[24px] bg-surface-secondary border border-border-default rounded-sm px-2 text-caption text-text-primary outline-none focus:border-primary-main/50"
											/>
										</div>
										<div className="flex flex-col gap-[4px]">
											<label className="text-caption text-text-primary">Duration</label>
											<input 
												type="text"
												inputMode="decimal"
												autoComplete="off"
												spellCheck={false}
												value={segEditorDuration}
												onChange={(e) => setSegEditorDuration(sanitizeDurationInput(e.target.value))}
												onBlur={commitSegEditorDuration}
												onKeyDown={(e) => {
													if (e.key === 'Enter') {
														e.preventDefault();
														e.currentTarget.blur();
													}
												}}
												className="w-[76px] h-[24px] bg-surface-secondary border border-border-default rounded-sm px-2 text-caption text-text-primary outline-none focus:border-primary-main/50"
											/>
										</div>
									</div>
									
									{/* Блок кнопок */}
									<div className="mt-[16px] flex flex-col gap-[4px] w-[124px]">
										<div className="flex gap-[4px] w-full">
											<button
												type="button"
												disabled={selectedSegmentIndex <= 0}
												onClick={() => setSelectedSegmentIndex((i) => Math.max(0, i - 1))}
												className="flex-1 h-[24px] px-[12px] py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center"
											>
												&lt; Prev
											</button>
											<button
												type="button"
												disabled={selectedSegmentIndex < 0 || selectedSegmentIndex >= generatedSegments.length - 1}
												onClick={() =>
													setSelectedSegmentIndex((i) =>
														Math.min(generatedSegments.length - 1, i + 1)
													)
												}
												className="flex-1 h-[24px] px-[12px] py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center"
											>
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
											value={segEditorTranslation}
											onChange={(e) => setSegEditorTranslation(e.target.value)}
											onBlur={() => {
												if (selectedSegmentIndex < 0) return;
												void updateSegmentAtIndex(selectedSegmentIndex, {
													translation: segEditorTranslation
												});
											}}
										/>
									</div>
									{/* Вертикальная статистика */}
									<div className="flex flex-col text-caption text-text-primary overflow-hidden gap-[2px] mt-[4px]">
										<span className="truncate">
											Total length: {segEditorTranslation.length}
										</span>
										<span className="truncate">
											Chars/sec:{' '}
											{(() => {
												const d = parseFloat(segEditorDuration.replace(',', '.'));
												return Number.isFinite(d) && d > 0
													? (segEditorTranslation.length / d).toFixed(1)
													: '—';
											})()}
										</span>
									</div>
								</div>

								{/* Колонна 3 Original Text */}
								<div className="flex-1 flex flex-col gap-[4px] min-w-0">
									<label className="text-caption text-text-primary">Original text</label>
									<div className="flex-1 min-h-0 relative">
										<textarea 
											className="text-h1-heading w-full h-full bg-surface-secondary border border-border-default rounded-[8px] p-2 text-text-primary resize-none outline-none focus:border-primary-main/50 subtitle-table-scroll font-semibold"
											placeholder="Original text..."
											value={segEditorOriginal}
											onChange={(e) => setSegEditorOriginal(e.target.value)}
											onBlur={() => {
												if (selectedSegmentIndex < 0) return;
												void updateSegmentAtIndex(selectedSegmentIndex, { text: segEditorOriginal });
											}}
										/>
									</div>
									{/* Вертикальная статистика */}
									<div className="flex flex-col text-caption text-text-primary overflow-hidden gap-[2px] mt-[4px]">
										<span className="truncate">
											Total length: {segEditorOriginal.length}
										</span>
										<span className="truncate">
											Chars/sec:{' '}
											{(() => {
												const d = parseFloat(segEditorDuration.replace(',', '.'));
												return Number.isFinite(d) && d > 0
													? (segEditorOriginal.length / d).toFixed(1)
													: '—';
											})()}
										</span>
									</div>
								</div>
							</div>

							
						</div>
						
						{/* ПАНЕЛЬ ВИДЕОПЛЕЕР */}
						<div className="flex-1 bg-black flex flex-col shadow-inner min-w-[220px] overflow-hidden select-none">
								
								{/* Область видео */}
								<div className="flex-1 relative flex flex-col items-center justify-center group bg-[#000000]">
										{videoSrc ? (
											<video
												key={activeVideoAbsolutePath ?? 'v'}
												ref={videoRef}
												src={videoSrc}
												className="absolute inset-0 z-0 w-full h-full object-contain"
												playsInline
												muted={videoMuted}
												preload="metadata"
												onLoadedMetadata={(e) => {
													const d = e.currentTarget.duration;
													setVideoDuration(Number.isFinite(d) ? d : 0);
													e.currentTarget.volume = volume;
													e.currentTarget.muted = videoMuted;
												}}
												onDurationChange={(e) => {
													const d = e.currentTarget.duration;
													if (Number.isFinite(d) && d > 0) setVideoDuration(d);
												}}
												onPlay={() => {
													isPlayingRef.current = true;
													setIsVideoPlaying(true);
												}}
												onPause={() => {
													isPlayingRef.current = false;
													setIsVideoPlaying(false);
												}}
												onEnded={() => {
													isPlayingRef.current = false;
													setIsVideoPlaying(false);
												}}
												onVolumeChange={(e) => {
													const vol = e.currentTarget.volume;
													setVolume(vol);
													if (vol < 1e-4) setVideoMuted(true);
												}}
												onError={() => {
													console.error('Video load/playback error', activeVideoAbsolutePath, videoSrc);
												}}
											/>
										) : (
											<div className="text-white/10 text-[10px] uppercase tracking-[0.2em] font-bold">
												Video Preview
											</div>
										)}
										<div className="absolute bottom-12 z-10 w-full text-center px-10 pointer-events-none">
												<span
													className="text-white text-[20px] font-bold leading-[20px] tracking-[-0.01em] font-inter [text-shadow:0_0_1px_rgba(0,0,0,0.95),0_1px_2px_rgba(0,0,0,0.9),0_2px_8px_rgba(0,0,0,0.75),0_4px_20px_rgba(0,0,0,0.45)]"
												>
														{currentVideoSubtitleLine || '\u00A0'}
												</span>
										</div>
								</div>

								{/* Панель управления */}
								<div className="bg-surface-panel border-t border-border-default flex flex-col shrink-0 p-3 m-0 gap-[24px]">
										<div className="w-full">
												<div
													className="relative w-full h-[4px] rounded-[2px] bg-border-default cursor-pointer overflow-hidden"
													onMouseDown={handleVideoProgressPointerDown}
												>
														<div
															className="absolute left-0 top-0 h-full rounded-[2px] bg-[#9FA3B0]"
															style={{
																width: `${timelineTotalDuration ? Math.min(100, (currentPlaybackTime / timelineTotalDuration) * 100) : 0}%`
															}}
														/>
												</div>
										</div>

										{/* Контролы: при узкой панели таймкод переносится вниз и выравнивается слева */}
										<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 w-full min-w-0">
												<div className="flex items-center gap-[12px] shrink-0 min-w-0">
														<button
															type="button"
															title={isVideoPlaying ? 'Пауза' : 'Воспроизведение'}
															aria-label={isVideoPlaying ? 'Пауза' : 'Воспроизведение'}
															disabled={!videoSrc}
															className={`group/vplay ${VIDEO_CTRL_BTN_CLASS}`}
															onClick={() => {
																const v = videoRef.current;
																if (!v) return;
																if (v.paused) void v.play();
																else v.pause();
															}}
														>
															<span
																className={VIDEO_CTRL_ICON_PLAY}
																style={sidebarIconMaskStyle(
																	isVideoPlaying ? iconPause : iconPlay
																)}
																aria-hidden
															/>
														</button>
														<button
															type="button"
															title="Стоп"
															aria-label="Стоп"
															disabled={!videoSrc}
															className={`group/vstop ${VIDEO_CTRL_BTN_CLASS}`}
															onClick={() => {
																const v = videoRef.current;
																if (!v) return;
																v.pause();
																v.currentTime = 0;
																setCurrentPlaybackTime(0);
															}}
														>
															<span
																className={VIDEO_CTRL_ICON_STOP}
																style={sidebarIconMaskStyle(iconStop)}
																aria-hidden
															/>
														</button>
														<button
															type="button"
															title={
																videoMuted || volume < 1e-4
																	? 'Включить звук'
																	: 'Выключить звук'
															}
															aria-label={
																videoMuted || volume < 1e-4
																	? 'Включить звук'
																	: 'Выключить звук'
															}
															disabled={!videoSrc}
															className={`group/vvol ${VIDEO_CTRL_BTN_CLASS}`}
															onClick={() => {
																const v = videoRef.current;
																if (!v) return;
																const next = !videoMuted;
																if (next) {
																	volumeBeforeMuteRef.current = v.volume;
																	v.volume = 0;
																	setVolume(0);
																	v.muted = true;
																	setVideoMuted(true);
																} else {
																	const restore = Math.max(
																		1e-3,
																		volumeBeforeMuteRef.current
																	);
																	v.volume = restore;
																	setVolume(restore);
																	v.muted = false;
																	setVideoMuted(false);
																}
															}}
														>
															<span
																className={VIDEO_CTRL_ICON_VOL}
																style={sidebarIconMaskStyle(
																	videoMuted || volume < 1e-4
																		? iconVolumeMute
																		: iconVolume
																)}
																aria-hidden
															/>
														</button>
														
														{/* Слайдер громкости */}
														<div
															className="w-16 h-[4px] rounded-[2px] bg-border-default relative shrink-0 cursor-pointer overflow-hidden"
															onMouseDown={handleVolumePointerDown}
														>
																<div
																	className="absolute left-0 top-0 h-full rounded-[2px] bg-primary-disabled"
																	style={{
																		width: `${volume * 100}%`
																	}}
																/>
														</div>
												</div>

												{/* Таймкоды */}
												<div className="flex items-center gap-1 text-[12px] text-body-med text-text-primary shrink-0">
														<span>{formatPlaybackClock(currentPlaybackTime)}</span>
														<span className="text-text-secondary/40">/</span>
														<span className="text-text-secondary">
															{formatPlaybackClock(timelineTotalDuration)}
														</span>
												</div>
										</div>
								</div>
								
						</div>

					</div>
					

					{/*ТАЙМЛАЙН */}
					<div 
						className="flex-1 min-h-0 bg-surface-bg flex flex-col relative"
						style={{
							height: `calc(100vh - ${upperSectionHeight}px - ${APP_HEADER_BAR_PX}px)`,
							minHeight: MIN_TIMELINE_PANE_PX
						}}
					>
						{/* РЕСАЙЗЕР */}
						<div 
							onMouseDown={(e) => startTablePanelResizing('bottom', e)}
							className="absolute top-[-2px] left-0 w-full h-[4px] cursor-row-resize z-50 hover:bg-primary-main/40 transition-colors"
						/>

						<div className="flex flex-1 min-h-0">
							{/* Левая панель с кнопками */}
							<div className="w-[100px] border-r border-border-default flex flex-col gap-[4px] p-2 bg-surface-panel shrink-0">
								<button
									type="button"
									disabled={!currentProject || !activeSubtitleFileId}
									title={
										timelineInsertRange
											? `Insert empty subtitle ${timelineInsertRange.start.toFixed(2)}s – ${timelineInsertRange.end.toFixed(2)}s (or clear with Esc)`
											: 'Insert empty subtitle at playhead (default 1s), or drag on the timeline to set range'
									}
									onClick={() => void handleTimelineInsert()}
									className="h-[24px] px-[12px] py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 disabled:pointer-events-none text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center"
								>
									Insert
								</button>
								<button
									type="button"
									disabled={selectedSegmentIndex < 0}
									onClick={() => handleTimelineSetStart()}
									className="h-[24px] px-[12px] py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 disabled:pointer-events-none text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center"
								>
									Set start
								</button>
								<button
									type="button"
									disabled={selectedSegmentIndex < 0}
									onClick={() => handleTimelineSetEnd()}
									className="h-[24px] px-[12px] py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 disabled:pointer-events-none text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center"
								>
									Set end
								</button>
								<button
									type="button"
									disabled={!currentProject || !activeSubtitleFileId || !canSplitAtPlayhead}
									title="Split selected subtitle at the playhead (both parts keep the same text)"
									onClick={() => void handleTimelineSplit()}
									className="h-[24px] px-[12px] py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 disabled:pointer-events-none text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center"
								>
									Split
								</button>
							</div>

							{/* основная зона таймлайна (wheel: горизонтальный скролл; Alt+wheel: зум) — общий паддинг 12px, между таймлайном и зум+скролл gap 12px без разделителя */}
							<div
								ref={timelineWheelRef}
								className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-surface-panel p-3"
							>
								{/* Контейнер с волной и субтитрами */}
								<div
									ref={timelineScrollRef}
									className="timeline-pan-no-scrollbar relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-md border border-black bg-[#121212] shadow-inner group [overflow-anchor:none]"
								>
									<div
										ref={timelineInnerRef}
										className="relative h-full min-h-0 select-none"
										style={{ width: `${Math.max(100, timelineZoomPercent)}%` }}
										onPointerDown={beginTimelineRangeSelect}
									>
										{/* Сетка */}
										<div
											className="absolute inset-0 opacity-10"
											style={{
												backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
												backgroundSize: '20px 20px'
											}}
										/>
										{(() => {
											const td = timelineTotalDuration;
											if (td <= 0) return null;
											if (timelineRangePreview) {
												const lo = Math.min(timelineRangePreview.a, timelineRangePreview.b);
												const hi = Math.max(timelineRangePreview.a, timelineRangePreview.b);
												const left = (lo / td) * 100;
												const w = Math.max(((hi - lo) / td) * 100, 0.04);
												return (
													<div
														className="absolute top-0 bottom-0 z-[8] rounded-sm bg-primary-main/30 pointer-events-none"
														style={{ left: `${left}%`, width: `${w}%` }}
													/>
												);
											}
											if (
												timelineInsertRange &&
												timelineInsertRange.end - timelineInsertRange.start >= MIN_SEGMENT_DURATION
											) {
												const { start: rs, end: re } = timelineInsertRange;
												const left = (rs / td) * 100;
												const w = ((re - rs) / td) * 100;
												return (
													<div
														className="absolute top-0 bottom-0 z-[8] rounded-sm bg-primary-main/25 pointer-events-none"
														style={{ left: `${left}%`, width: `${w}%` }}
													/>
												);
											}
											return null;
										})()}

										{/* Волна: PNG (showwavespic) или canvas по пикам */}
										{waveformImageSrc ? (
											<div
												key={waveformImageSrc}
												className="absolute inset-x-0 top-2 bottom-2 z-[5] overflow-hidden pointer-events-none"
											>
												<img
													src={waveformImageSrc}
													alt=""
													draggable={false}
													className="h-full w-full min-h-0 select-none object-fill opacity-95 [image-rendering:pixelated]"
													style={{ imageRendering: 'pixelated' }}
												/>
											</div>
										) : (
											<TimelineSymmetricWaveform
												peaks={waveformPeaks}
												className="absolute inset-x-0 top-2 bottom-2 z-[5] w-full min-w-0 opacity-95 pointer-events-none"
											/>
										)}

										{/* Субтитры на таймлайне */}
										<div className="absolute inset-0 flex items-stretch pointer-events-none">
											{timelineSegmentsSorted.map((seg, orderIdx) => {
												const idx = generatedSegments.findIndex((s) => s.id === seg.id);
												if (idx < 0) return null;
												const left = (seg.start / timelineTotalDuration) * 100;
												const w = Math.max(0, ((seg.end - seg.start) / timelineTotalDuration) * 100);
												const isSel = idx === selectedSegmentIndex;
												const tr = seg.translation?.trim() ?? '';
												return (
													<div
														key={seg.id}
														data-tl-segment
														className={`absolute top-0 z-[11] h-full border-x border-[#A3E635] flex flex-col justify-between pointer-events-auto cursor-pointer ${
															isSel ? 'bg-surface-secondary/10' : 'bg-surface-secondary/5'
														}`}
														style={{ left: `${left}%`, width: `${w}%` }}
														onClick={(e) => {
															if ((e.target as HTMLElement).closest('[data-tl-edge]')) return;
															if (segmentBodyDragMovedRef.current) {
																segmentBodyDragMovedRef.current = false;
																return;
															}
															e.stopPropagation();
															const t = clientXToTimelineTime(e.clientX);
															const v = videoRef.current;
															if (v) v.currentTime = t;
															setCurrentPlaybackTime(t);
															setSelectedSegmentIndex(idx);
														}}
													>
														<div
															data-tl-body
															className="relative z-[10] flex flex-col justify-between p-2 min-h-0 flex-1 min-w-0 cursor-grab active:cursor-grabbing"
															onMouseDown={(e) => beginTimelineSegmentMove(idx, e)}
														>
															<span className="text-[12px] font-bold font-inter text-white/85 truncate">
																{tr || '\u00A0'}
															</span>
															<div className="text-[12px] font-bold font-inter text-white/70 truncate min-w-0 w-full shrink tabular-nums">
																#{orderIdx + 1} {seg.duration.toFixed(2)}s
															</div>
														</div>
														<div
															data-tl-edge="start"
															className="absolute left-0 top-0 bottom-0 w-2 z-[35] cursor-ew-resize hover:bg-white/25"
															onMouseDown={(e) => beginTimelineEdgeDrag('start', idx, e)}
														/>
														<div
															data-tl-edge="end"
															className="absolute right-0 top-0 bottom-0 w-2 z-[35] cursor-ew-resize hover:bg-white/25"
															onMouseDown={(e) => beginTimelineEdgeDrag('end', idx, e)}
														/>
													</div>
												);
											})}
											<div
												className="absolute top-0 bottom-0 w-px bg-primary-main z-20 pointer-events-none"
												style={{
													left: `${Math.min(100, (currentPlaybackTime / timelineTotalDuration) * 100)}%`
												}}
											/>
										</div>
									</div>
								</div>

								{/* Зум + скроллбар: фон как у левой панели (Insert…) — задаётся родителем timelineWheelRef */}
								<div className="flex shrink-0 items-center gap-[24px]">
									<div className="flex items-center gap-3">
										<button
											type="button"
											title="Уменьшить масштаб"
											aria-label="Уменьшить масштаб"
											className={`group/tzoomout ${TIMELINE_ZOOM_BTN_CLASS}`}
											onClick={() =>
												setTimelineZoomPercent((z) => stepTimelineZoom(z, -1))
											}
										>
											<span
												className={TIMELINE_ZOOM_OUT_ICON_CLASS}
												style={sidebarIconMaskStyle(iconZoomOut)}
												aria-hidden
											/>
										</button>

										{/* непрерывный (логарифмический) зум как в NLE */}
										<input
											type="range"
											min={TIMELINE_ZOOM_SLIDER_MIN}
											max={TIMELINE_ZOOM_SLIDER_MAX}
											step={1}
											aria-label="Масштаб таймлайна"
											title="Плавный зум таймлайна"
											className="timeline-zoom-slider h-[22px] w-[160px] cursor-pointer"
											style={
												{
													'--timeline-zoom-fill': `${timelineZoomToFillPercent(timelineZoomPercent)}%`
												} as React.CSSProperties
											}
											value={timelineZoomToSliderValue(timelineZoomPercent)}
											onChange={(e) => {
												const slider = Number(e.target.value);
												setTimelineZoomPercent(sliderValueToTimelineZoom(slider));
											}}
										/>

										<button
											type="button"
											title="Увеличить масштаб"
											aria-label="Увеличить масштаб"
											className={`group/tzoomin ${TIMELINE_ZOOM_BTN_CLASS}`}
											onClick={() =>
												setTimelineZoomPercent((z) => stepTimelineZoom(z, 1))
											}
										>
											<span
												className={TIMELINE_ZOOM_IN_ICON_CLASS}
												style={sidebarIconMaskStyle(iconZoomIn)}
												aria-hidden
											/>
										</button>
									</div>

									<div
										className="relative h-[4px] min-w-0 flex-1 cursor-pointer overflow-hidden rounded-full bg-border-default"
										onMouseDown={handleTimelineScrubPointerDown}
									>
										<div
											ref={timelineScrollbarThumbRef}
											className="absolute top-0 h-full rounded-full bg-primary-disabled"
											style={{ width: '100%', left: '0%' }}
										/>
									</div>
								</div>
							</div>
						</div>
					</div>

				</div>
			</div>

			{shouldHighlightWizardCta && activeModal === null && (
				<div className="fixed inset-0 z-[50] bg-black/55 pointer-events-none" />
			)}

			{/* POPUPS LAYER */}
			{activeModal && (
				<div className="fixed inset-0 z-[999] flex items-center justify-center pointer-events-none">
					
					{/* Контейнер конкретного окна */}
					<div className="pointer-events-auto">
						
						{activeModal === 'welcome' && (
							<WelcomeModal 
								onClose={() => setActiveModal(null)} 
								onNewProject={() => setActiveModal('createProject')}
								onOpenProject={handleOpenProjectDialog}
								onSelectProject={handleSelectProject}
							/>
						)}

						{activeModal === 'activation' && (
							<ActivationModal
								onActivated={() => {
									localStorage.setItem(ACTIVATION_COMPLETED_STORAGE_KEY, '1');
									setActiveModal('welcome');
								}}
							/>
						)}

						{activeModal === 'createProject' && (
							<NewProjectModal 
								onClose={() => setActiveModal(null)} 
								onProjectCreated={handleProjectCreated}
							/>
						)}

						{activeModal === 'wizard' && (
							<WizardModal
								onClose={() => setActiveModal(null)}
								projectPath={currentProject?.path}
								onComplete={({ project, segments }) => {
									undoSegmentsStackRef.current = [];
									redoSegmentsStackRef.current = [];
									setCurrentProject(project);
									setGeneratedSegments(segments);
									const withSeg = project.files.find(
										(f) => f.subtitle_segments && f.subtitle_segments.length > 0
									);
									setActiveSubtitleFileId(withSeg?.id ?? null);
									setSelectedSegmentIndex(segments.length > 0 ? 0 : -1);
									if (withSeg?.id) {
										const stem = getSourceVideoStem(project, withSeg.id);
										void projectService
											.exportSubtitles(
												project.path,
												withSeg.id,
												'srt',
												joinProjectPath(project.path, 'subtitles', `${stem}.srt`)
											)
											.catch((e) => console.error('Initial SRT export failed', e));
									}
								}}
							/>
						)}

						{activeModal === 'glossary' && (
							<GlossaryModal
								projectPath={currentProject?.path ?? null}
								onSaved={(glossary) => {
									setCurrentProject((p) => (p ? { ...p, glossary } : null));
								}}
								onClose={() => setActiveModal(null)}
							/>
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