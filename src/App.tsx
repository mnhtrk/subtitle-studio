import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, open, message } from '@tauri-apps/plugin-dialog';
import {
	ChevronRight,
	ChevronDown
} from 'lucide-react';

// модалки
import { WelcomeModal } from './components/modals/WelcomeModal';
import { NewProjectModal } from './components/modals/NewProjectModal';
import { WizardModal } from './components/modals/WizardModal';
import { ExportModal } from './components/modals/ExportModal';
import { FindReplaceModal } from './components/modals/FindReplaceModal';
import type { FindMatch } from './utils/findReplace';
import { GlossaryModal, type GlossaryReplacementChange } from './components/modals/GlossaryModal';
import { ActivationModal } from './components/modals/ActivationModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { AboutModal } from './components/modals/AboutModal';
import { useI18n } from './i18n';

const appWindow = getCurrentWindow();

import {
	projectService,
	ProjectData,
	ProjectFile,
	SubtitleSegment,
	type GlossaryEntry,
	type SpeakerGender
} from './services/projectService';
import {
	agentService,
	AgentAction,
	agentSessionIdForProject,
	type ConversationTurn
} from './services/agentService';
import {
	deleteSegmentById,
	insertEmptySegment,
	splitSegmentAt,
	sortAndRenumberSubtitleIds
} from './utils/subtitleSegmentsLocal';
import {
	applyAutoGlossaryToProject,
	mergePromptHintsIntoGlossary,
	parseTranslationHintsFromPrompt,
	resolveIsoLanguage
} from './utils/glossary';

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
import iconZoomIn from './assets/icons/zoom-in.svg';
import iconZoomOut from './assets/icons/zoom-out.svg';
import iconPlay from './assets/icons/play.svg';
import iconPause from './assets/icons/pause.svg';
import iconStop from './assets/icons/stop.svg';
import iconVolume from './assets/icons/volume.svg';
import iconVolumeMute from './assets/icons/volume-mute.svg';
import appLogo from './assets/app-logo.svg';

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


const VIDEO_CTRL_BTN_CLASS =
	'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-primary-main/40 disabled:pointer-events-none disabled:opacity-40';

const VIDEO_CTRL_ICON_PLAY =
	'pointer-events-none inline-block h-6 w-6 shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/vplay:scale-110 group-active/vplay:scale-[0.92]';

const VIDEO_CTRL_ICON_STOP =
	'pointer-events-none inline-block h-6 w-6 shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/vstop:scale-110 group-active/vstop:scale-[0.92]';

const VIDEO_CTRL_ICON_VOL =
	'pointer-events-none inline-block h-6 w-6 shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/vvol:scale-110 group-active/vvol:scale-[0.92]';

const PANEL_HEADER_ICON_CLASS =
	'pointer-events-none inline-block h-4 w-4 shrink-0 origin-center transition-transform duration-200 ease-out will-change-transform group-hover:scale-110 group-active:scale-[0.92]';

const TIMELINE_ZOOM_BTN_CLASS =
	'flex h-[22px] w-[22px] shrink-0 items-center justify-center border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-primary-main/40';

const TIMELINE_ZOOM_OUT_ICON_CLASS =
	'pointer-events-none inline-block h-[22px] w-[22px] shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/tzoomout:scale-110 group-active/tzoomout:scale-[0.92]';

const TIMELINE_ZOOM_IN_ICON_CLASS =
	'pointer-events-none inline-block h-[22px] w-[22px] shrink-0 origin-center bg-text-primary transition-transform duration-200 ease-out will-change-transform group-hover/tzoomin:scale-110 group-active/tzoomin:scale-[0.92]';

function formatPlaybackClock(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00';
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const sec = Math.floor(seconds % 60);
	const ms = Math.floor((seconds % 1) * 1000);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

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

async function finalizeEpisodePairInProject(
	projectPath: string,
	videoId: string,
	segments: SubtitleSegment[]
): Promise<{ project: ProjectData; subtitleFileId: string }> {
	const project = await projectService.open(projectPath);
	const video = project.files.find((f) => f.id === videoId && f.file_type === 'Video');
	if (!video) {
		throw new Error('Video track missing after import');
	}
	const stem = video.name.replace(/\.[^/.\\]+$/, '') || 'subtitles';
	const subName = `${stem}.srt`;
	const subPath = `subtitles/${subName}`;
	const subId = crypto.randomUUID();
	const now = new Date().toISOString();
	const subFile: ProjectFile = {
		id: subId,
		name: subName,
		file_type: 'Subtitle',
		path: subPath,
		subtitle_segments: segments,
		linked_file_id: videoId,
		created_at: now,
		updated_at: now
	};
	const nextFiles = project.files.map((f) =>
		f.id === videoId
			? { ...f, subtitle_segments: null, linked_file_id: subId, updated_at: now }
			: f
	);
	nextFiles.push(subFile);
	const updated: ProjectData = {
		...project,
		files: nextFiles,
		updated_at: now
	};
	await projectService.save(updated);
	await projectService.exportSubtitles(
		projectPath,
		subId,
		'srt',
		joinProjectPath(projectPath, subPath)
	);
	return { project: updated, subtitleFileId: subId };
}

function getSourceVideoStem(project: ProjectData, activeFileId: string | null): string {
	if (!activeFileId) return 'subtitles';
	const track = project.files.find((f) => f.id === activeFileId);
	if (track?.file_type === 'Video') {
		return track.name.replace(/\.[^/.\\]+$/, '') || 'subtitles';
	}
	if (track?.file_type === 'Subtitle') {
		if (track.linked_file_id) {
			const v = project.files.find((f) => f.id === track.linked_file_id && f.file_type === 'Video');
			if (v) return v.name.replace(/\.[^/.\\]+$/, '') || 'subtitles';
		}
		return track.name.replace(/\.[^/.\\]+$/, '') || 'subtitles';
	}
	const vid = project.files.find((f) => f.file_type === 'Video');
	if (vid) return vid.name.replace(/\.[^/.\\]+$/, '') || 'subtitles';
	return 'subtitles';
}

function firstUnpairedVideoIdInProject(files: ProjectFile[]): string | null {
	for (let i = files.length - 1; i >= 0; i--) {
		const f = files[i];
		if (f.file_type !== 'Video') continue;
		const hasPartner = files.some(
			(s) => s.file_type === 'Subtitle' && s.linked_file_id === f.id
		);
		if (!hasPartner) return f.id;
	}
	return null;
}

function isCompositionTreeFileActive(
	project: ProjectData | null,
	activeSubtitleFileId: string | null,
	file: ProjectFile
): boolean {
	if (!project || !activeSubtitleFileId) return false;
	if (file.id === activeSubtitleFileId) return true;
	const activeSub = project.files.find((x) => x.id === activeSubtitleFileId);
	if (file.file_type === 'Video' && activeSub?.linked_file_id === file.id) return true;
	return false;
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
			linked_file_id: null,
			created_at: '',
			updated_at: ''
		});
	}
	return [...projectFiles, ...extra];
}

const MIN_SEGMENT_DURATION = 0.05;
const RETRANSCRIBE_LANGUAGE_OPTIONS: ReadonlyArray<string> = [
	'English',
	'Russian',
	'Spanish',
	'French',
	'German',
	'Italian',
	'Portuguese',
	'Chinese',
	'Japanese',
	'Korean',
	'Arabic',
	'Hindi',
	'Turkish',
	'Polish',
	'Ukrainian'
];
const RETRANSCRIBE_LANGUAGE_ISO: Record<string, string> = {
	English: 'en',
	Russian: 'ru',
	Spanish: 'es',
	French: 'fr',
	German: 'de',
	Italian: 'it',
	Portuguese: 'pt',
	Chinese: 'zh',
	Japanese: 'ja',
	Korean: 'ko',
	Arabic: 'ar',
	Hindi: 'hi',
	Turkish: 'tr',
	Polish: 'pl',
	Ukrainian: 'uk'
};
const MAX_SUBTITLE_UNDO = 80;
const TIMELINE_EDGE_SCROLL_MARGIN = 48;
const TIMELINE_EDGE_SCROLL_BASE = 14;
const ACTIVATION_COMPLETED_STORAGE_KEY = 'subtitle-studio-activation-completed';
const SHOW_ORIGINAL_VIDEO_SUBTITLES_KEY = 'subtitle-studio-show-original-video-subtitles';
type MenuSubItem =
	| { kind?: 'item'; label: string; action?: () => void; disabled?: boolean }
	| { kind: 'toggle'; label: string; checked: boolean; onChange: (checked: boolean) => void }
	| { kind: 'separator' };

function readShowOriginalVideoSubtitles(): boolean {
	try {
		const v = localStorage.getItem(SHOW_ORIGINAL_VIDEO_SUBTITLES_KEY);
		if (v === '0') return false;
		if (v === '1') return true;
	} catch {
		/* noop */
	}
	return true;
}

function findActiveSegmentAtTime(
	segments: SubtitleSegment[],
	currentTime: number
): SubtitleSegment | undefined {
	let active: SubtitleSegment | undefined;
	for (const s of segments) {
		if (currentTime >= s.start && currentTime < s.end) active = s;
	}
	return active;
}

/** Строка субтитра по времени воспроизведения (без привязки к выделенному сегменту). */
function subtitleLineAtActiveTime(
	segments: SubtitleSegment[],
	currentTime: number,
	field: 'text' | 'translation'
): string {
	const seg = findActiveSegmentAtTime(segments, currentTime);
	if (!seg) return '';
	if (field === 'translation') {
		return seg.translation?.trim() ?? '';
	}
	return seg.text?.trim() ?? '';
}

function cloneSubtitleSegments(segs: SubtitleSegment[]): SubtitleSegment[] {
	return segs.map((s) => ({ ...s }));
}

// волна на canvas (симметрия)
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
				// без сглаживания, иначе на зуме мыло
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

// пробел в инпуте не play/pause
function shouldIgnoreSpacebarForVideo(target: EventTarget | null): boolean {
	if (!target || !(target instanceof Element)) return false;
	const el = target as HTMLElement;
	if (el.isContentEditable) return true;
	const tag = el.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (el.closest('[contenteditable="true"]')) return true;
	/* слайдеры тоже */
	if (el.closest('input[type="range"], [role="slider"]')) return true;
	return false;
}

// лимиты ui
const LIMITS = {
  SIDEBAR: 60,
  PROJECT_TREE: { MIN: 150, MAX: 250 },
  AI_AGENT: { MIN: 280, MAX: 400 },
  TABLE: 300,
  VIDEO: 220, // мин ширина видео
};

const APP_HEADER_BAR_PX = 32;
const MIN_TIMELINE_PANE_PX = 200; // таймлайн не сжимать сильно

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
	const { t, locale } = useI18n();
	const timelineBtnPx = locale === 'ru' ? 'px-[16px]' : 'px-[12px]';

	// размер окна
	const [windowSize, setWindowSize] = useState({
		width: window.innerWidth,
		height: window.innerHeight
	});

	// resize в браузере
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

	// resize tauri
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

	// панели
	const [projectTreeWidth, setProjectTreeWidth] = useState(240);
	const [aiAgentWidth, setAiAgentWidth] = useState(320);
	const [tablePanelWidth, setTablePanelWidth] = useState(800);
	const [upperSectionHeight, setUpperSectionHeight] = useState(450);
	const [colWidths, setColWidths] = useState([50, 120, 120, 100]);

	const [isResizing, setIsResizing] = useState(false);
	const [isAiAgentResizing, setIsAiAgentResizing] = useState(false);
	const [isVideoFolderOpen, setIsVideoFolderOpen] = useState(true);

	// чат агента
	type ChatAttachedSegment = {
		id: number;
		start: number;
		end: number;
		text: string;
		translation?: string | null;
	};
	type ChatEditDiff = {
		id: number;
		start: number;
		end: number;
		field: 'translation' | 'text';
		oldText: string;
		newText: string;
	};
	type ChatEditStatus = 'pending' | 'kept' | 'reverted';
	type ChatMessage =
		| {
				id: string;
				role: 'user';
				text: string;
				attachedSegment?: ChatAttachedSegment;
		  }
		| {
				id: string;
				role: 'assistant';
				text: string;
				edits?: ChatEditDiff[];
				editSnapshot?: SubtitleSegment[];
				editStatus?: ChatEditStatus;
				isError?: boolean;
		  };

	const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
	const [chatInput, setChatInput] = useState('');
	const [pendingAttachedSegment, setPendingAttachedSegment] = useState<ChatAttachedSegment | null>(null);
	const [isAgentBusy, setIsAgentBusy] = useState(false);
	const [expandedDiffIds, setExpandedDiffIds] = useState<Set<string>>(new Set());
	const chatScrollRef = useRef<HTMLDivElement | null>(null);
	const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
	const agentSessionIdRef = useRef<string>(agentSessionIdForProject(undefined));

	// тема + меню
	const [isDarkTheme, setIsDarkTheme] = useState(() => {
		const saved = localStorage.getItem('theme');
		return saved === 'dark';
	});

	const [activeMenu, setActiveMenu] = useState<string | null>(null);

	// dark/light
	useEffect(() => {
		document.documentElement.classList.toggle('dark', isDarkTheme);
		localStorage.setItem('theme', isDarkTheme ? 'dark' : 'light');
	}, [isDarkTheme]);

	// клик мимо - закрыть меню
	useEffect(() => {
		const handleClickOutside = () => setActiveMenu(null);
		if (activeMenu) {
			window.addEventListener('click', handleClickOutside);
		}
		return () => window.removeEventListener('click', handleClickOutside);
	}, [activeMenu]);

	// модалки
	const [activeModal, setActiveModal] = useState<
		| 'activation'
		| 'welcome'
		| 'createProject'
		| 'wizard'
		| 'glossary'
		| 'export'
		| 'settings'
		| 'findReplace'
		| 'about'
		| null
	>(null);
	const [findHighlight, setFindHighlight] = useState<FindMatch | null>(null);
	const [glossaryAgentPrompt, setGlossaryAgentPrompt] = useState<GlossaryReplacementChange[] | null>(
		null
	);
	const [currentProject, setCurrentProject] = useState<ProjectData | null>(null);
	const [generatedSegments, setGeneratedSegments] = useState<SubtitleSegment[]>([]);
	const [activeSubtitleFileId, setActiveSubtitleFileId] = useState<string | null>(null);
	const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number>(-1);
	const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<number>>(() => new Set());
	const [isConfigFolderOpen, setIsConfigFolderOpen] = useState(false);
	const [isSubtitlesFolderOpen, setIsSubtitlesFolderOpen] = useState(false);
	// подсветка мастера 1 раз на проект
	const [wizardSpotlightDismissed, setWizardSpotlightDismissed] = useState(false);

	const videoRef = useRef<HTMLVideoElement | null>(null);
	const timelineScrollRef = useRef<HTMLDivElement | null>(null);
	const timelineInnerRef = useRef<HTMLDivElement | null>(null);
	const timelineWheelRef = useRef<HTMLDivElement | null>(null);
	const timelineScrollbarThumbRef = useRef<HTMLDivElement | null>(null);
	const segmentEditorPanelRef = useRef<HTMLDivElement | null>(null);
	const subtitleTableScrollRef = useRef<HTMLDivElement | null>(null);
	const currentPlaybackTimeRef = useRef(0);
	const selectedSegmentIndexRef = useRef(-1);
	const showOriginalVideoSubtitlesRef = useRef(readShowOriginalVideoSubtitles());
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
	const timelineGroupMoveRef = useRef<{
		t0: number;
		minDelta: number;
		maxDelta: number;
		origs: Map<number, { start: number; end: number }>;
	} | null>(null);
	const segmentBodyDragMovedRef = useRef(false);
	const timelineRangeSelectDragRef = useRef<{ t0: number } | null>(null);
	const selectedSegmentIdsRef = useRef<Set<number>>(new Set());
	const undoSegmentsStackRef = useRef<SubtitleSegment[][]>([]);
	const redoSegmentsStackRef = useRef<SubtitleSegment[][]>([]);
	const undoProjectStackRef = useRef<ProjectData[]>([]);
	const lastUndoDomainRef = useRef<'project' | 'subtitle' | null>(null);

	const [videoDuration, setVideoDuration] = useState(0);
	const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);
	const [volume, setVolume] = useState(1);
	const [videoMuted, setVideoMuted] = useState(false);
	const [showOriginalVideoSubtitles, setShowOriginalVideoSubtitles] = useState(
		readShowOriginalVideoSubtitles
	);
	const [dualMonitorMode, setDualMonitorMode] = useState(false);
	const [isVideoPlaying, setIsVideoPlaying] = useState(false);
	const [timelineZoomPercent, setTimelineZoomPercent] = useState(100);
	const [waveformPeaks, setWaveformPeaks] = useState<number[] | null>(null);
	const [waveformImageSrc, setWaveformImageSrc] = useState<string | null>(null);
	const [projectDiskFiles, setProjectDiskFiles] = useState<{ relative_path: string; name: string }[]>([]);
	const [probedMediaDuration, setProbedMediaDuration] = useState<number | null>(null);
	// controlled - иначе delete + blur пишет мусор
	const [segEditorTranslation, setSegEditorTranslation] = useState('');
	const [segEditorOriginal, setSegEditorOriginal] = useState('');
	const [segEditorStart, setSegEditorStart] = useState('');
	const [segEditorDuration, setSegEditorDuration] = useState('');
	// превью выделения на треке
	const [timelineRangePreview, setTimelineRangePreview] = useState<{ a: number; b: number } | null>(
		null
	);
	// insert: пустой субтитр на выделенном интервале
	const [timelineInsertRange, setTimelineInsertRange] = useState<{
		start: number;
		end: number;
	} | null>(null);
	const [timelineRubberRange, setTimelineRubberRange] = useState<{ start: number; end: number } | null>(null);
	const [timelineContextMenu, setTimelineContextMenu] = useState<{
		x: number;
		y: number;
		ids: number[];
		range: { start: number; end: number } | null;
	} | null>(null);
	const [retranscribeBusy, setRetranscribeBusy] = useState<{ stage: 'audio' | 'transcribe' | 'translate' | 'apply' } | null>(null);
	const [retranscribeError, setRetranscribeError] = useState<string | null>(null);
	const [retranscribeSetup, setRetranscribeSetup] = useState<{ range: { start: number; end: number } } | null>(null);
	const [retranscribeLanguage, setRetranscribeLanguage] = useState<string>('English');
	const [retranscribePrompt, setRetranscribePrompt] = useState<string>('');
	const [fullTranscribeSetup, setFullTranscribeSetup] = useState(false);
	const [aiTranslateSetup, setAiTranslateSetup] = useState(false);
	const [aiTranslateTargetLanguage, setAiTranslateTargetLanguage] = useState('English');
	const [aiTranslatePrompt, setAiTranslatePrompt] = useState('');
	const [aiBusy, setAiBusy] = useState<{ operation: 'transcribe' | 'translate'; stage: 'audio' | 'transcribe' | 'translate' | 'apply' } | null>(null);
	const [aiMenuError, setAiMenuError] = useState<string | null>(null);
	const [projectFileMenu, setProjectFileMenu] = useState<{ x: number; y: number; file: ProjectFile } | null>(null);
	const [selectedTreeItem, setSelectedTreeItem] = useState<
		| { kind: 'file'; id: string }
		| { kind: 'folder'; name: 'config' | 'video' | 'subtitles' }
		| null
	>(null);

	const projectDirtyRef = useRef(false);
	const markProjectDirty = useCallback(() => {
		projectDirtyRef.current = true;
	}, []);
	const clearProjectDirty = useCallback(() => {
		projectDirtyRef.current = false;
	}, []);

	const hydrateAgentChatFromProject = useCallback((project: ProjectData | null) => {
		agentSessionIdRef.current = agentSessionIdForProject(project?.id);
		setChatMessages(
			(project && Array.isArray(project.agent_chat) ? project.agent_chat : []) as ChatMessage[]
		);
		setChatInput('');
		setPendingAttachedSegment(null);
		setExpandedDiffIds(new Set());
		setIsAgentBusy(false);
	}, []);

	const formatSpeakerGenderCell = useCallback((gender?: SpeakerGender | null): string => {
		if (gender === 'male') return 'M';
		if (gender === 'female') return 'F';
		return '?';
	}, []);

	const formatChatTimecode = useCallback((sec: number): string => {
		if (!Number.isFinite(sec) || sec < 0) return '00:00:00';
		const total = Math.floor(sec);
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}, []);

	const buildAgentConversationHistory = useCallback(
		(messages: ChatMessage[]): ConversationTurn[] => {
			const turns: ConversationTurn[] = [];
			for (const msg of messages) {
				if (msg.role === 'assistant' && msg.isError) continue;
				if (msg.role === 'user') {
					let content = msg.text.trim();
					if (msg.attachedSegment) {
						const seg = msg.attachedSegment;
						content = `${content}\n\nПрикрепленная реплика:\n#${seg.id} [${formatChatTimecode(seg.start)}]\nOriginal: ${seg.text}\nTranslation: ${seg.translation ?? ''}`.trim();
					}
					if (content) turns.push({ role: 'user', content });
				} else if (msg.role === 'assistant') {
					const content = msg.text.trim();
					if (content) turns.push({ role: 'assistant', content });
				}
			}
			return turns;
		},
		[formatChatTimecode]
	);

	useEffect(() => {
		const cp = currentProjectRef.current;
		if (!cp) return;

		const previous = Array.isArray(cp.agent_chat) ? cp.agent_chat : [];
		const previousJson = JSON.stringify(previous);
		const nextJson = JSON.stringify(chatMessages);
		if (previousJson === nextJson) return;

		const nextProject: ProjectData = {
			...cp,
			agent_chat: chatMessages,
			updated_at: new Date().toISOString()
		};
		currentProjectRef.current = nextProject;
		setCurrentProject(nextProject);
		markProjectDirty();
	}, [chatMessages, markProjectDirty]);

	const activeVideoFile = useMemo(() => {
		if (!currentProject) return null;
		if (activeSubtitleFileId) {
			const t = currentProject.files.find((f) => f.id === activeSubtitleFileId);
			if (t?.file_type === 'Video') return t;
			if (t?.file_type === 'Subtitle' && t.linked_file_id) {
				const v = currentProject.files.find(
					(f) => f.id === t.linked_file_id && f.file_type === 'Video'
				);
				if (v) return v;
			}
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
	selectedSegmentIdsRef.current = selectedSegmentIds;

	useLayoutEffect(() => {
		if (selectedSegmentIndex < 0) return;
		const container = subtitleTableScrollRef.current;
		if (!container) return;
		const row = container.querySelector<HTMLElement>(
			`[data-subtitle-row-index="${selectedSegmentIndex}"]`
		);
		row?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
	}, [selectedSegmentIndex, generatedSegments]);

	const ensureTimelineCenteredAtTime = useCallback((t: number) => {
		const scr = timelineScrollRef.current;
		const inner = timelineInnerRef.current;
		if (!scr || !inner) return;
		const td = timelineTotalDurationRef.current;
		const innerW = inner.offsetWidth;
		if (td <= 0 || innerW <= 0) return;
		const x = (Math.max(0, t) / td) * innerW;
		const viewLeft = scr.scrollLeft;
		const viewRight = viewLeft + scr.clientWidth;
		const margin = 24;
		if (x < viewLeft + margin || x > viewRight - margin) {
			const target = Math.max(0, Math.min(scr.scrollWidth - scr.clientWidth, x - scr.clientWidth / 2));
			scr.scrollLeft = target;
		}
	}, []);

	const seekVideo = useCallback((time: number, opts?: { updateState?: boolean }) => {
		const nextTime = Math.max(0, time);
		if (opts?.updateState !== false) setCurrentPlaybackTime(nextTime);
		currentPlaybackTimeRef.current = nextTime;
		const v = videoRef.current;
		if (!v) return;
		try {
			v.currentTime = nextTime;
		} catch {
			/* noop */
		}
	}, []);

	const resetVideo = useCallback(() => {
		const v = videoRef.current;
		if (v) {
			try {
				v.pause();
				v.currentTime = 0;
			} catch {
				/* noop */
			}
		}
		setIsVideoPlaying(false);
		setCurrentPlaybackTime(0);
	}, []);

	const toggleVideoPlay = useCallback(() => {
		const v = videoRef.current;
		if (!v) return;
		if (v.paused) void v.play();
		else v.pause();
	}, []);

	const selectSegmentAndSeek = useCallback((idxOrUpdater: number | ((prev: number) => number)) => {
		setSelectedSegmentIndex((prev) => {
			const next = typeof idxOrUpdater === 'function' ? idxOrUpdater(prev) : idxOrUpdater;
			if (next < 0) return next;
			const seg = segmentsRef.current[next];
			if (seg) {
				const t = Math.max(0, seg.start);
				seekVideo(t);
				ensureTimelineCenteredAtTime(t);
			}
			return next;
		});
	}, [ensureTimelineCenteredAtTime, seekVideo]);
	timelineTotalDurationRef.current = timelineTotalDuration;
	currentPlaybackTimeRef.current = currentPlaybackTime;
	selectedSegmentIndexRef.current = selectedSegmentIndex;
	showOriginalVideoSubtitlesRef.current = showOriginalVideoSubtitles;

	const currentVideoTranslationLine = useMemo(
		() => subtitleLineAtActiveTime(generatedSegments, currentPlaybackTime, 'translation'),
		[generatedSegments, currentPlaybackTime]
	);

	const currentVideoOriginalLine = useMemo(
		() => subtitleLineAtActiveTime(generatedSegments, currentPlaybackTime, 'text'),
		[generatedSegments, currentPlaybackTime]
	);

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

	// перед save - сбросить редактор в проект
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
		const current = currentProjectRef.current;
		if (!current) return false;
		const cp: ProjectData = { ...current, agent_chat: chatMessages };
		currentProjectRef.current = cp;
		setCurrentProject(cp);
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
				await message(detail, { title: t('dialog.saveErrorTitle'), kind: 'error' });
			} catch {
				window.alert(`${t('dialog.saveErrorTitle')}: ${detail}`);
			}
			return false;
		}
	}, [chatMessages, clearProjectDirty, exportSrtForProject, flushSubtitleEditorToProject, t]);

	const maybeSaveBeforeSwitchingProject = useCallback(async (): Promise<boolean> => {
		flushSubtitleEditorToProject();
		if (!projectDirtyRef.current) return true;
		let saveFirst: boolean;
		try {
			saveFirst = await ask(t('dialog.saveBeforeSwitch'), {
				title: t('dialog.appTitle'),
				kind: 'warning'
			});
		} catch {
			saveFirst = window.confirm(t('dialog.saveBeforeSwitch'));
		}
		if (saveFirst) {
			return await handleSaveProject();
		}
		return true;
	}, [handleSaveProject, flushSubtitleEditorToProject, t]);

	const handleExitProject = useCallback(async () => {
		flushSubtitleEditorToProject();
		if (currentProjectRef.current && projectDirtyRef.current) {
			let saveFirst: boolean;
			try {
				saveFirst = await ask(t('dialog.saveBeforeExit'), {
					title: t('dialog.appTitle'),
					kind: 'warning'
				});
			} catch {
				saveFirst = window.confirm(t('dialog.saveBeforeExit'));
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
		setSelectedSegmentIds(new Set());
		setTimelineRubberRange(null);
		setTimelineContextMenu(null);
		hydrateAgentChatFromProject(null);
		undoSegmentsStackRef.current = [];
		redoSegmentsStackRef.current = [];
		undoProjectStackRef.current = [];
		lastUndoDomainRef.current = null;
		clearProjectDirty();
		setActiveMenu(null);
		setActiveModal(null);
	}, [handleSaveProject, clearProjectDirty, flushSubtitleEditorToProject, hydrateAgentChatFromProject, t]);

	const pushSubtitleHistorySnapshot = useCallback(() => {
		if (!activeSubtitleFileId) return;
		undoSegmentsStackRef.current.push(cloneSubtitleSegments(segmentsRef.current));
		if (undoSegmentsStackRef.current.length > MAX_SUBTITLE_UNDO) undoSegmentsStackRef.current.shift();
		redoSegmentsStackRef.current = [];
		lastUndoDomainRef.current = 'subtitle';
	}, [activeSubtitleFileId]);

	const pushProjectHistorySnapshot = useCallback(() => {
		const cp = currentProjectRef.current;
		if (!cp) return;
		undoProjectStackRef.current.push(structuredClone(cp));
		if (undoProjectStackRef.current.length > MAX_SUBTITLE_UNDO) undoProjectStackRef.current.shift();
		lastUndoDomainRef.current = 'project';
	}, []);

	const applyProjectSnapshot = useCallback((project: ProjectData) => {
		currentProjectRef.current = project;
		setCurrentProject(project);
		const active =
			activeSubtitleFileId != null
				? project.files.find((f) => f.id === activeSubtitleFileId)
				: null;
		const fallback =
			active ??
			project.files.find(
				(f) => f.file_type === 'Subtitle' && (f.subtitle_segments?.length ?? 0) > 0
			) ??
			project.files.find((f) => f.file_type === 'Subtitle') ??
			project.files.find((f) => f.file_type === 'Video') ??
			null;
		setActiveSubtitleFileId(fallback?.id ?? null);
		setGeneratedSegments(fallback?.subtitle_segments ?? []);
		setSelectedSegmentIndex((fallback?.subtitle_segments?.length ?? 0) > 0 ? 0 : -1);
		setSelectedSegmentIds(new Set());
		setTimelineRubberRange(null);
		setTimelineInsertRange(null);
		setSelectedTreeItem(null);
		markProjectDirty();
	}, [activeSubtitleFileId, markProjectDirty]);

	const performProjectUndo = useCallback(async () => {
		const prev = undoProjectStackRef.current.pop();
		if (!prev) return false;
		applyProjectSnapshot(prev);
		await projectService.save(prev);
		clearProjectDirty();
		if (undoProjectStackRef.current.length === 0) lastUndoDomainRef.current = null;
		return true;
	}, [applyProjectSnapshot, clearProjectDirty]);

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
		if (stack.length === 0) lastUndoDomainRef.current = null;
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
		const cp = currentProjectRef.current;
		if (!cp) return;
		const fileId = activeSubtitleFileId;
		const segs = segmentsRef.current;
		const multiSelIds = selectedSegmentIdsRef.current;

		if (multiSelIds.size > 0) {
			const idsToDelete = new Set<number>(multiSelIds);
			const filtered = segs.filter((s) => !idsToDelete.has(s.id));
			if (filtered.length === segs.length) return;
			const firstDeletedIdx = segs.findIndex((s) => idsToDelete.has(s.id));
			pushSubtitleHistorySnapshot();
			const segments = sortAndRenumberSubtitleIds(filtered);
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
			setSelectedSegmentIds(new Set());
			setTimelineRubberRange(null);
			setTimelineInsertRange(null);
			const newLen = segments.length;
			if (newLen === 0) setSelectedSegmentIndex(-1);
			else setSelectedSegmentIndex(Math.min(Math.max(0, firstDeletedIdx), newLen - 1));
			return;
		}

		if (selectedSegmentIndex < 0) return;
		const seg = segs[selectedSegmentIndex];
		if (!seg) return;
		pushSubtitleHistorySnapshot();
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

	const handleImportOriginalSubtitles = useCallback(async () => {
		if (!currentProjectRef.current) {
			await message(t('dialog.openProjectFirst'), { kind: 'info', title: t('dialog.importTitle') });
			return;
		}
		const selected = await open({
			multiple: false,
			directory: false,
			title: t('dialog.importOriginalDialog'),
			filters: [{ name: t('dialog.subtitlesFilter'), extensions: ['srt', 'vtt'] }]
		});
		if (!selected || typeof selected !== 'string') return;

		let parsed: SubtitleSegment[];
		try {
			parsed = await projectService.parseSubtitleFile(selected);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			await message(t('dialog.importOriginalFailed', { detail: msg }), {
				kind: 'error',
				title: t('dialog.importTitle')
			});
			return;
		}
		if (parsed.length === 0) {
			await message(t('dialog.noSegments'), { kind: 'warning', title: t('dialog.importTitle') });
			return;
		}

		const cp = currentProjectRef.current;
		if (!cp) return;
		const now = new Date().toISOString();

		if (activeSubtitleFileId) {
			const active = cp.files.find((f) => f.id === activeSubtitleFileId);
			if (active && active.file_type === 'Subtitle') {
				const existing = active.subtitle_segments ?? [];
				pushSubtitleHistorySnapshot();
				const merged: SubtitleSegment[] = parsed.map((p, i) => ({
					...p,
					translation:
						existing.length === parsed.length
							? existing[i]?.translation ?? null
							: null
				}));
				const nextProject: ProjectData = {
					...cp,
					files: cp.files.map((f) =>
						f.id === activeSubtitleFileId
							? { ...f, subtitle_segments: merged, updated_at: now }
							: f
					),
					updated_at: now
				};
				currentProjectRef.current = nextProject;
				setCurrentProject(nextProject);
				setGeneratedSegments(merged);
				setSelectedSegmentIndex(merged.length > 0 ? 0 : -1);
				markProjectDirty();
				return;
			}
		}

		const video =
			activeVideoFile ?? cp.files.find((f) => f.file_type === 'Video') ?? null;
		const stem = video ? video.name.replace(/\.[^/.\\]+$/, '') || 'subtitles' : 'subtitles';
		const subName = `${stem}.srt`;
		const subId = crypto.randomUUID();
		const newSub: ProjectFile = {
			id: subId,
			name: subName,
			file_type: 'Subtitle',
			path: `subtitles/${subName}`,
			subtitle_segments: parsed.map((p) => ({ ...p, translation: null })),
			linked_file_id: video?.id ?? null,
			created_at: now,
			updated_at: now
		} as ProjectFile;
		let nextFiles = cp.files;
		if (video) {
			nextFiles = nextFiles.map((f) =>
				f.id === video.id ? { ...f, linked_file_id: subId, updated_at: now } : f
			);
		}
		nextFiles = [...nextFiles, newSub];
		const nextProject: ProjectData = {
			...cp,
			files: nextFiles,
			updated_at: now
		};
		currentProjectRef.current = nextProject;
		setCurrentProject(nextProject);
		setActiveSubtitleFileId(subId);
		setGeneratedSegments(newSub.subtitle_segments ?? []);
		setSelectedSegmentIndex((newSub.subtitle_segments?.length ?? 0) > 0 ? 0 : -1);
		markProjectDirty();
	}, [activeSubtitleFileId, activeVideoFile, pushSubtitleHistorySnapshot, markProjectDirty, t]);

	const handleImportTranslatedSubtitles = useCallback(async () => {
		if (!currentProjectRef.current) {
			await message(t('dialog.openProjectFirst'), { kind: 'info', title: t('dialog.importTitle') });
			return;
		}
		const cp = currentProjectRef.current;
		const selected = await open({
			multiple: false,
			directory: false,
			title: t('dialog.importTranslatedDialog'),
			filters: [{ name: t('dialog.subtitlesFilter'), extensions: ['srt', 'vtt'] }]
		});
		if (!selected || typeof selected !== 'string') return;

		let parsed: SubtitleSegment[];
		try {
			parsed = await projectService.parseSubtitleFile(selected);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			await message(t('dialog.importTranslatedFailed', { detail: msg }), {
				kind: 'error',
				title: t('dialog.importTitle')
			});
			return;
		}
		if (parsed.length === 0) {
			await message(t('dialog.noSegments'), { kind: 'warning', title: t('dialog.importTitle') });
			return;
		}

		const now = new Date().toISOString();
		const active = activeSubtitleFileId
			? cp.files.find((f) => f.id === activeSubtitleFileId)
			: null;

		if (active?.file_type === 'Subtitle') {
			const existing = active.subtitle_segments ?? [];
			pushSubtitleHistorySnapshot();
			const merged: SubtitleSegment[] = existing.length > 0
				? existing.map((s, i) => {
					const p = parsed[i];
					return p ? { ...s, translation: p.text } : s;
				})
				: parsed.map((p) => ({
					...p,
					text: '',
					translation: p.text
				}));
			const nextProject: ProjectData = {
				...cp,
				files: cp.files.map((f) =>
					f.id === activeSubtitleFileId
						? { ...f, subtitle_segments: merged, updated_at: now }
						: f
				),
				updated_at: now
			};
			currentProjectRef.current = nextProject;
			setCurrentProject(nextProject);
			setGeneratedSegments(merged);
			setSelectedSegmentIndex(merged.length > 0 ? 0 : -1);
			markProjectDirty();
			return;
		}

		pushProjectHistorySnapshot();
		const video =
			active?.file_type === 'Video'
				? active
				: activeVideoFile ?? cp.files.find((f) => f.file_type === 'Video') ?? null;
		const stem = video ? video.name.replace(/\.[^/.\\]+$/, '') || 'subtitles' : 'subtitles';
		const subName = `${stem}.translated.srt`;
		const subId = crypto.randomUUID();
		const importedSegments: SubtitleSegment[] = parsed.map((p) => ({
			...p,
			text: '',
			translation: p.text
		}));
		const newSub: ProjectFile = {
			id: subId,
			name: subName,
			file_type: 'Subtitle',
			path: `subtitles/${subName}`,
			subtitle_segments: importedSegments,
			linked_file_id: video?.id ?? null,
			created_at: now,
			updated_at: now
		} as ProjectFile;
		let nextFiles = cp.files;
		if (video) {
			nextFiles = nextFiles.map((f) =>
				f.id === video.id ? { ...f, linked_file_id: subId, updated_at: now } : f
			);
		}
		nextFiles = [...nextFiles, newSub];
		const nextProject: ProjectData = {
			...cp,
			files: nextFiles,
			updated_at: now
		};
		currentProjectRef.current = nextProject;
		setCurrentProject(nextProject);
		setActiveSubtitleFileId(subId);
		setGeneratedSegments(importedSegments);
		setSelectedSegmentIndex(importedSegments.length > 0 ? 0 : -1);
		markProjectDirty();
	}, [
		activeSubtitleFileId,
		activeVideoFile,
		pushSubtitleHistorySnapshot,
		pushProjectHistorySnapshot,
		markProjectDirty,
		t
	]);

	const ensureApiKeyForAi = useCallback(async (): Promise<boolean> => {
		try {
			const has = await projectService.getApiKeyStatus();
			if (!has) {
				setActiveModal('activation');
				return false;
			}
		} catch {
			setActiveModal('activation');
			return false;
		}
		return true;
	}, []);

	const handleImportVideo = useCallback(async () => {
		if (!currentProjectRef.current) {
			await message(t('dialog.openProjectFirst'), { kind: 'info', title: t('dialog.importTitle') });
			return;
		}
		const selected = await open({
			multiple: false,
			directory: false,
			title: t('dialog.importVideoDialog'),
			filters: [{ name: t('dialog.videoFilter'), extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm'] }]
		});
		if (!selected || typeof selected !== 'string') return;
		const cp = currentProjectRef.current;
		if (!cp) return;
		try {
			const imported = await projectService.importMedia(cp.path, selected);
			const project = await projectService.open(cp.path);
			currentProjectRef.current = project;
			setCurrentProject(project);
			const videoInProject = project.files.find((f) => f.id === imported.id) ?? imported;
			setActiveSubtitleFileId(videoInProject.id);
			setGeneratedSegments([]);
			setSelectedSegmentIndex(-1);
			setSelectedSegmentIds(new Set());
			markProjectDirty();
		} catch (e: unknown) {
			const detail = e instanceof Error ? e.message : String(e);
			await message(t('dialog.importVideoFailed', { detail }), {
				kind: 'error',
				title: t('dialog.importTitle')
			});
		}
	}, [markProjectDirty, t]);

	const handleFullTranscribe = useCallback(
		async (opts: { sourceLanguage: string; userPrompt: string }) => {
			const cp = currentProjectRef.current;
			if (!cp) return;
			const videoPath = activeVideoAbsolutePath;
			if (!videoPath) {
				setAiMenuError(t('ai.noVideo'));
				return;
			}
			setAiMenuError(null);
			setAiBusy({ operation: 'transcribe', stage: 'audio' });
			const audioFileName = `transcribe_${Date.now()}.mp3`;
			const audioRelPath = `config/${audioFileName}`;
			const audioOut = joinProjectPath(cp.path, audioRelPath);
			try {
				if (!(await ensureApiKeyForAi())) {
					setAiBusy(null);
					return;
				}
				await projectService.extractAudioFromVideo(videoPath, audioOut);
				setAiBusy({ operation: 'transcribe', stage: 'transcribe' });
				const projectForPrompt = await projectService.open(cp.path);
				const isoLang =
					RETRANSCRIBE_LANGUAGE_ISO[opts.sourceLanguage] ??
					(opts.sourceLanguage.trim().length === 2
						? opts.sourceLanguage.trim().toLowerCase()
						: undefined);
				const userPrompt = opts.userPrompt.trim();
				const rawSegments = await projectService.transcribeAudio(
					audioOut,
					isoLang,
					userPrompt.length > 0 ? userPrompt : undefined,
					projectForPrompt.glossary ?? []
				);
				if (rawSegments.length === 0) {
					throw new Error('Whisper returned no segments.');
				}
				const segments = rawSegments.map((s) => ({ ...s, translation: null }));
				setAiBusy({ operation: 'transcribe', stage: 'apply' });
				const now = new Date().toISOString();
				const activeFile = activeSubtitleFileId
					? cp.files.find((f) => f.id === activeSubtitleFileId)
					: null;
				let projectWithSegments: ProjectData;
				if (activeFile?.file_type === 'Subtitle') {
					pushSubtitleHistorySnapshot();
					projectWithSegments = {
						...cp,
						files: cp.files.map((f) =>
							f.id === activeSubtitleFileId
								? { ...f, subtitle_segments: segments, updated_at: now }
								: f
						),
						updated_at: now
					};
					await projectService.save(projectWithSegments);
					if (activeSubtitleFileId) {
						await exportSrtForProject(projectWithSegments, activeSubtitleFileId);
					}
					setActiveSubtitleFileId(activeSubtitleFileId);
				} else {
					const videoId =
						activeFile?.file_type === 'Video'
							? activeFile.id
							: activeVideoFile?.id ??
								cp.files.find((f) => f.file_type === 'Video')?.id ??
								null;
					if (!videoId) {
						throw new Error(t('ai.noVideo'));
					}
					const paired = await finalizeEpisodePairInProject(cp.path, videoId, segments);
					projectWithSegments = paired.project;
					setActiveSubtitleFileId(paired.subtitleFileId);
				}
				const glossaryLangIso =
					resolveIsoLanguage(opts.sourceLanguage) ??
					resolveIsoLanguage(projectWithSegments.target_language) ??
					'en';
				const projectWithGlossary = await applyAutoGlossaryToProject(
					cp.path,
					segments,
					{
						targetLanguageIso: glossaryLangIso,
						contextPrompt: opts.userPrompt,
						fillTranslation: false
					}
				);
				const mergedProject: ProjectData = {
					...projectWithGlossary,
					files: projectWithSegments.files
				};
				await projectService.save(mergedProject);
				currentProjectRef.current = mergedProject;
				setCurrentProject(mergedProject);
				setGeneratedSegments(segments);
				setSelectedSegmentIndex(segments.length > 0 ? 0 : -1);
				markProjectDirty();
				setAiBusy(null);
			} catch (err) {
				const detail = err instanceof Error ? err.message : String(err);
				setAiMenuError(detail);
				setAiBusy(null);
			} finally {
				projectService
					.deleteProjectFileArtifact(cp.path, audioRelPath)
					.catch((err) => console.warn('cleanup transcribe audio failed:', err));
			}
		},
		[
			activeVideoAbsolutePath,
			activeSubtitleFileId,
			activeVideoFile,
			ensureApiKeyForAi,
			exportSrtForProject,
			markProjectDirty,
			pushSubtitleHistorySnapshot,
			t
		]
	);

	const resolveWizardLanguageLabel = useCallback((codeOrName: string): string => {
		const raw = codeOrName.trim();
		if (!raw) return 'English';
		const byName = RETRANSCRIBE_LANGUAGE_OPTIONS.find((l) => l.toLowerCase() === raw.toLowerCase());
		if (byName) return byName;
		const byIso = RETRANSCRIBE_LANGUAGE_OPTIONS.find((l) => RETRANSCRIBE_LANGUAGE_ISO[l] === raw.toLowerCase());
		return byIso ?? raw;
	}, []);

	const openAiTranslateSetup = useCallback(() => {
		const cp = currentProjectRef.current;
		setAiTranslateTargetLanguage(resolveWizardLanguageLabel(cp?.target_language ?? 'English'));
		setAiTranslatePrompt('');
		setAiTranslateSetup(true);
	}, [resolveWizardLanguageLabel]);

	const handleAiTranslate = useCallback(
		async (opts: { targetLanguage: string; stylePrompt: string }) => {
		const cp = currentProjectRef.current;
		const fileId = activeSubtitleFileId;
		if (!cp || !fileId) return;
		const segs = segmentsRef.current;
		const withText = segs.filter((s) => (s.text ?? '').trim().length > 0);
		if (withText.length === 0) {
			setAiMenuError(t('ai.noOriginalText'));
			return;
		}
		setAiMenuError(null);
		setAiBusy({ operation: 'translate', stage: 'translate' });
		try {
			if (!(await ensureApiKeyForAi())) {
				setAiBusy(null);
				return;
			}
			const targetLang = opts.targetLanguage.trim();
			if (!targetLang) {
				throw new Error('Target language is not set.');
			}
			const stylePrompt = opts.stylePrompt.trim() || 'Natural subtitle translation';
			const targetIso =
				resolveIsoLanguage(targetLang) ??
				resolveIsoLanguage(cp.target_language ?? '') ??
				'en';
			const promptHints = parseTranslationHintsFromPrompt(stylePrompt);
			const projectWithGlossary = await applyAutoGlossaryToProject(cp.path, withText, {
				targetLanguageIso: targetIso,
				targetLanguage: targetLang,
				contextPrompt: stylePrompt,
				fillTranslation: true
			});
			const glossary = mergePromptHintsIntoGlossary(
				projectWithGlossary.glossary ?? [],
				promptHints
			);
			const projectWithHints =
				promptHints.length > 0 ? { ...projectWithGlossary, glossary } : projectWithGlossary;
			currentProjectRef.current = projectWithHints;
			setCurrentProject(projectWithHints);
			if (promptHints.length > 0) {
				await projectService.save(projectWithHints);
			}
			const translations = await projectService.translateBatch(
				withText,
				targetLang,
				stylePrompt,
				glossary
			);
			const translatedMap = new Map(translations.map((tr) => [tr.id, tr.translated_text]));
			const nextSegments = segs.map((s) => {
				const tr = translatedMap.get(s.id);
				return tr !== undefined ? { ...s, translation: tr } : s;
			});
			setAiBusy({ operation: 'translate', stage: 'apply' });
			pushSubtitleHistorySnapshot();
			const now = new Date().toISOString();
			const next: ProjectData = {
				...projectWithHints,
				files: projectWithHints.files.map((f) =>
					f.id === fileId ? { ...f, subtitle_segments: nextSegments, updated_at: now } : f
				),
				updated_at: now
			};
			await projectService.save(next);
			currentProjectRef.current = next;
			setCurrentProject(next);
			setGeneratedSegments(nextSegments);
			markProjectDirty();
			void exportSrtForProject(next, fileId).catch((e) => console.error('SRT export after translate', e));
			setAiBusy(null);
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			setAiMenuError(detail);
			setAiBusy(null);
		}
	},
		[activeSubtitleFileId, ensureApiKeyForAi, exportSrtForProject, markProjectDirty, pushSubtitleHistorySnapshot, t]
	);

	const handleDeleteEpisode = useCallback(async (videoFile: ProjectFile) => {
		const cp = currentProjectRef.current;
		if (!cp) return;
		if (videoFile.file_type !== 'Video') return;
		const confirmed = await ask(
			t('dialog.deleteEpisodeConfirm', { name: videoFile.name }),
			{ kind: 'warning', title: t('dialog.deleteEpisodeTitle') }
		);
		if (!confirmed) return;
		pushProjectHistorySnapshot();
		try {
			const updated = await projectService.deleteEpisode(cp.path, videoFile.id);
			const linkedSubId = videoFile.linked_file_id;
			const wasActive =
				activeSubtitleFileId === videoFile.id ||
				(linkedSubId != null && activeSubtitleFileId === linkedSubId);
			currentProjectRef.current = updated;
			setCurrentProject(updated);
			if (wasActive) {
				const fallback = updated.files.find(
					(f) =>
						f.file_type === 'Subtitle' &&
						(f.subtitle_segments?.length ?? 0) > 0
				) ?? updated.files.find((f) => f.file_type === 'Subtitle')
					?? updated.files.find((f) => f.file_type === 'Video');
				setActiveSubtitleFileId(fallback?.id ?? null);
				setGeneratedSegments(fallback?.subtitle_segments ?? []);
				setSelectedSegmentIndex((fallback?.subtitle_segments?.length ?? 0) > 0 ? 0 : -1);
				setSelectedSegmentIds(new Set());
				setTimelineRubberRange(null);
				setTimelineInsertRange(null);
				undoSegmentsStackRef.current = [];
				redoSegmentsStackRef.current = [];
				resetVideo();
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			await message(t('dialog.deleteEpisodeFailed', { detail: msg }), {
				kind: 'error',
				title: t('dialog.deleteEpisodeTitle')
			});
		}
	}, [activeSubtitleFileId, pushProjectHistorySnapshot, t]);

	const handleDeleteSelectedTreeItem = useCallback(async () => {
		const cp = currentProjectRef.current;
		if (!cp) return;
		const sel = selectedTreeItem;
		if (!sel) return;

		if (sel.kind === 'file') {
			const file = cp.files.find((f) => f.id === sel.id);
			if (!file) {
				setSelectedTreeItem(null);
				return;
			}
			if (file.file_type === 'Video') {
				await handleDeleteEpisode(file);
				setSelectedTreeItem(null);
				return;
			}
			const confirmed = await ask(t('dialog.deleteFileConfirm', { name: file.name }), {
				kind: 'warning',
				title: t('dialog.deleteFileTitle')
			});
			if (!confirmed) return;
			try {
				pushProjectHistorySnapshot();
				await projectService.removeFileFromProject(cp.path, file.id, true);
				const opened = await projectService.open(cp.path);
				currentProjectRef.current = opened;
				setCurrentProject(opened);
				if (activeSubtitleFileId === file.id) {
					setActiveSubtitleFileId(null);
					setGeneratedSegments([]);
					setSelectedSegmentIndex(-1);
					setSelectedSegmentIds(new Set());
					setTimelineRubberRange(null);
					setTimelineInsertRange(null);
					undoSegmentsStackRef.current = [];
					redoSegmentsStackRef.current = [];
				}
				setSelectedTreeItem(null);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				await message(t('dialog.deleteFailed', { detail: msg }), {
					kind: 'error',
					title: t('dialog.deleteFileTitle')
				});
			}
			return;
		}

		const folder = sel.name;
		const filesInFolder = cp.files.filter((f) => {
			if (folder === 'config') return f.file_type === 'Config';
			if (folder === 'video') return f.file_type === 'Video';
			if (folder === 'subtitles') return f.file_type === 'Subtitle';
			return false;
		});
		if (filesInFolder.length === 0) {
			setSelectedTreeItem(null);
			return;
		}
		const confirmed = await ask(
			t('dialog.deleteFolderConfirm', { folder, count: filesInFolder.length }),
			{ kind: 'warning', title: t('dialog.deleteFolderTitle') }
		);
		if (!confirmed) return;
		try {
			pushProjectHistorySnapshot();
			if (folder === 'video') {
				for (const v of filesInFolder) {
					try {
						await projectService.deleteEpisode(cp.path, v.id);
					} catch (e) {
						console.warn('delete episode failed', v.id, e);
					}
				}
			} else {
				for (const f of filesInFolder) {
					try {
						await projectService.removeFileFromProject(cp.path, f.id, true);
					} catch (e) {
						console.warn('remove file failed', f.id, e);
					}
				}
			}
			const opened = await projectService.open(cp.path);
			currentProjectRef.current = opened;
			setCurrentProject(opened);
			setActiveSubtitleFileId(null);
			setGeneratedSegments([]);
			setSelectedSegmentIndex(-1);
			setSelectedSegmentIds(new Set());
			setTimelineRubberRange(null);
			setTimelineInsertRange(null);
			undoSegmentsStackRef.current = [];
			redoSegmentsStackRef.current = [];
			setSelectedTreeItem(null);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			await message(t('dialog.deleteFolderFailed', { detail: msg }), {
				kind: 'error',
				title: t('dialog.deleteFolderTitle')
			});
		}
	}, [selectedTreeItem, activeSubtitleFileId, handleDeleteEpisode, pushProjectHistorySnapshot, t]);

	const handleSelectProject = useCallback(async (path: string) => {
		const canProceed = await maybeSaveBeforeSwitchingProject();
		if (!canProceed) return;
		try {
			const projectData = await projectService.open(path);
			undoSegmentsStackRef.current = [];
			redoSegmentsStackRef.current = [];
			undoProjectStackRef.current = [];
			lastUndoDomainRef.current = null;
			setCurrentProject(projectData);
			hydrateAgentChatFromProject(projectData);
			const firstSubWithSegments = projectData.files.find(
				(file) =>
					file.file_type === 'Subtitle' &&
					file.subtitle_segments &&
					file.subtitle_segments.length > 0
			);
			const firstFileWithSegments =
				firstSubWithSegments ??
				projectData.files.find(
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
				await message(t('dialog.openProjectFailed', { detail }), {
					title: t('dialog.openProjectFailedTitle'),
					kind: 'error'
				});
			} catch {
				window.alert(t('dialog.openProjectFailedAlert', { detail }));
			}
		}
	}, [maybeSaveBeforeSwitchingProject, clearProjectDirty, hydrateAgentChatFromProject, t]);

	const activateProjectTrack = useCallback(
		async (file: ProjectFile) => {
			flushSubtitleEditorToProject();
			const cp = currentProjectRef.current;
			if (!cp) return;

			try {
				if (file.id.startsWith('disk:') && file.file_type === 'Subtitle') {
					const pathNorm = file.path.replace(/\\/g, '/');
					const abs = joinProjectPath(cp.path, pathNorm);
					const now = new Date().toISOString();
					const subId = crypto.randomUUID();
					const vid = firstUnpairedVideoIdInProject(cp.files);
					const newEntry: ProjectFile = {
						id: subId,
						name: file.name,
						file_type: 'Subtitle',
						path: pathNorm,
						linked_file_id: vid,
						created_at: now,
						updated_at: now,
						subtitle_segments: null
					};
					let files = cp.files.map((f) =>
						vid && f.id === vid ? { ...f, linked_file_id: subId, updated_at: now } : f
					);
					files = [...files, newEntry];
					const mid: ProjectData = { ...cp, files, updated_at: now };
					currentProjectRef.current = mid;
					setCurrentProject(mid);
					await projectService.save(mid);
					await projectService.importExistingSubtitles(abs, cp.path, subId);
					const opened = await projectService.open(cp.path);
					currentProjectRef.current = opened;
					setCurrentProject(opened);
					undoSegmentsStackRef.current = [];
					redoSegmentsStackRef.current = [];
					setActiveSubtitleFileId(subId);
					const loaded = opened.files.find((f) => f.id === subId)?.subtitle_segments ?? [];
					setGeneratedSegments(loaded);
					setSelectedSegmentIndex(loaded.length > 0 ? 0 : -1);
					return;
				}

				if (file.file_type === 'Subtitle') {
					let proj: ProjectData = cp;
					let segs = file.subtitle_segments ?? [];
					if (file.subtitle_segments == null && !file.id.startsWith('disk:')) {
						const abs = joinProjectPath(cp.path, file.path.replace(/\\/g, '/'));
						segs = await projectService.importExistingSubtitles(abs, cp.path, file.id);
						const opened = await projectService.open(cp.path);
						currentProjectRef.current = opened;
						setCurrentProject(opened);
						proj = opened;
					}
					undoSegmentsStackRef.current = [];
					redoSegmentsStackRef.current = [];
					setActiveSubtitleFileId(file.id);
					const finalSegs = proj.files.find((f) => f.id === file.id)?.subtitle_segments ?? segs;
					setGeneratedSegments(finalSegs);
					setSelectedSegmentIndex(finalSegs.length > 0 ? 0 : -1);
					return;
				}

				if (file.file_type === 'Video') {
					if (file.linked_file_id) {
						const sub = cp.files.find(
							(f) => f.id === file.linked_file_id && f.file_type === 'Subtitle'
						);
						if (sub) {
							let proj: ProjectData = cp;
							let segs = sub.subtitle_segments ?? [];
							if (sub.subtitle_segments == null) {
								const abs = joinProjectPath(cp.path, sub.path.replace(/\\/g, '/'));
								segs = await projectService.importExistingSubtitles(abs, cp.path, sub.id);
								const opened = await projectService.open(cp.path);
								currentProjectRef.current = opened;
								setCurrentProject(opened);
								proj = opened;
							}
							undoSegmentsStackRef.current = [];
							redoSegmentsStackRef.current = [];
							setActiveSubtitleFileId(sub.id);
							const subRef = proj.files.find((f) => f.id === sub.id);
							const finalSegs = subRef?.subtitle_segments ?? segs;
							setGeneratedSegments(finalSegs);
							setSelectedSegmentIndex(finalSegs.length > 0 ? 0 : -1);
							return;
						}
					}
					const segs = file.subtitle_segments ?? [];
					undoSegmentsStackRef.current = [];
					redoSegmentsStackRef.current = [];
					setActiveSubtitleFileId(file.id);
					setGeneratedSegments(segs);
					setSelectedSegmentIndex(segs.length > 0 ? 0 : -1);
				}
			} catch (e) {
				console.error('activateProjectTrack', e);
			}
		},
		[flushSubtitleEditorToProject]
	);

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

	const toggleDiffExpanded = useCallback((messageId: string) => {
		setExpandedDiffIds((prev) => {
			const next = new Set(prev);
			if (next.has(messageId)) next.delete(messageId);
			else next.add(messageId);
			return next;
		});
	}, []);

	const buildChatEditDiffs = useCallback(
		(
			updated: SubtitleSegment[],
			baseline: SubtitleSegment[],
			fields: 'translation' | 'both' = 'translation'
		): ChatEditDiff[] => {
			const byId = new Map(baseline.map((s) => [s.id, s] as const));
			const diffs: ChatEditDiff[] = [];
			for (const next of updated) {
				const prev = byId.get(next.id);
				if (!prev) continue;
				const textChanged = prev.text !== next.text;
				if (fields === 'both' && textChanged) {
					diffs.push({
						id: next.id,
						start: next.start,
						end: next.end,
						field: 'text',
						oldText: prev.text,
						newText: next.text
					});
				}
				const trChanged = (prev.translation ?? '') !== (next.translation ?? '');
				if (trChanged) {
					diffs.push({
						id: next.id,
						start: next.start,
						end: next.end,
						field: 'translation',
						oldText: prev.translation ?? '',
						newText: next.translation ?? ''
					});
				}
			}
			diffs.sort((a, b) => {
				if (a.start !== b.start) return a.start - b.start;
				if (a.id !== b.id) return a.id - b.id;
				return a.field === b.field ? 0 : a.field === 'text' ? -1 : 1;
			});
			return diffs;
		},
		[]
	);

	const replaceCaseInsensitive = useCallback((text: string, from: string, to: string): string => {
		if (!from) return text;
		const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		// целое слово, не подстрока
		try {
			const pattern = new RegExp(
				`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
				'giu'
			);
			return text.replace(pattern, to);
		} catch {
			return text;
		}
	}, []);

	const buildGlossaryReplacementEdits = useCallback(
		(changes: GlossaryReplacementChange[], baseline: SubtitleSegment[]): SubtitleSegment[] => {
			if (changes.length === 0) return [];
			const updated: SubtitleSegment[] = [];

			for (const segment of baseline) {
				let nextText = segment.text;
				let nextTranslation = segment.translation ?? null;

				for (const change of changes) {
					if (change.oldSource && change.newSource && change.oldSource !== change.newSource) {
						nextText = replaceCaseInsensitive(nextText, change.oldSource, change.newSource);
					}
					if (
						nextTranslation &&
						change.oldTarget &&
						change.newTarget &&
						change.oldTarget !== change.newTarget
					) {
						nextTranslation = replaceCaseInsensitive(nextTranslation, change.oldTarget, change.newTarget);
					}
				}

				if (nextText !== segment.text || (nextTranslation ?? '') !== (segment.translation ?? '')) {
					updated.push({
						...segment,
						text: nextText,
						translation: nextTranslation
					});
				}
			}

			return updated;
		},
		[replaceCaseInsensitive]
	);

	// правки сегментов + undo пары
	const applySegmentEdits = useCallback(
		(updated: SubtitleSegment[]): { applied: SubtitleSegment[]; originals: SubtitleSegment[] } => {
			const cp = currentProjectRef.current;
			if (!cp || !activeSubtitleFileId) return { applied: [], originals: [] };

			const baseline = segmentsRef.current ?? [];
			const baselineById = new Map(baseline.map((s) => [s.id, s] as const));
			const updatedById = new Map(updated.map((s) => [s.id, s] as const));

			const originals: SubtitleSegment[] = [];
			const applied: SubtitleSegment[] = [];

			const nextList = baseline.map((seg) => {
				const u = updatedById.get(seg.id);
				if (!u) return seg;
				const merged: SubtitleSegment = {
					...seg,
					text: u.text ?? seg.text,
					translation: u.translation ?? seg.translation
				};
				if (
					(merged.text ?? '') === (seg.text ?? '') &&
					(merged.translation ?? '') === (seg.translation ?? '')
				) {
					return seg;
				}
				originals.push(baselineById.get(seg.id) ?? seg);
				applied.push(merged);
				return merged;
			});

			if (applied.length === 0) return { applied: [], originals: [] };

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
			return { applied, originals };
		},
		[activeSubtitleFileId, markProjectDirty]
	);

	const applyGlossaryReplacementToSubtitles = useCallback(
		async (changes: GlossaryReplacementChange[]) => {
			const baseline = segmentsRef.current ?? [];
			const project = currentProjectRef.current;
			if (changes.length === 0 || baseline.length === 0) return;

			const mergeUpdates = (
				baseList: SubtitleSegment[],
				patches: SubtitleSegment[]
			): SubtitleSegment[] => {
				if (patches.length === 0) return baseList;
				const map = new Map(baseList.map((s) => [s.id, s] as const));
				for (const patch of patches) {
					const prev = map.get(patch.id);
					if (!prev) continue;
					const merged: SubtitleSegment = {
						...prev,
						text: patch.text ?? prev.text,
						translation: patch.translation ?? prev.translation
					};
					map.set(patch.id, merged);
				}
				return baseList.map((s) => map.get(s.id) ?? s);
			};

			const addNoMatchesMessage = () => {
				setChatMessages((prev) => [
					...prev,
					{
						id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
						role: 'assistant',
						text: 'Глоссарий сохранён, но подходящих реплик для обновления не найдено.'
					}
				]);
			};

			const applyAndShow = (
				combinedList: SubtitleSegment[],
				messageText: string
			): boolean => {
				const updated = combinedList.filter((next) => {
					const prev = baseline.find((s) => s.id === next.id);
					if (!prev) return false;
					return (
						prev.text !== next.text ||
						(prev.translation ?? '') !== (next.translation ?? '')
					);
				});
				if (updated.length === 0) return false;

				const edits = buildChatEditDiffs(updated, baseline, 'both');
				if (edits.length === 0) return false;

				const { originals } = applySegmentEdits(updated);
				if (originals.length === 0) return false;

				setChatMessages((prev) => [
					...prev,
					{
						id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
						role: 'assistant',
						text: messageText,
						edits,
						editSnapshot: originals,
						editStatus: 'pending'
					}
				]);
				return true;
			};

			const changesText = changes
				.map((change, index) => {
					const parts: string[] = [];
					if (change.oldSource && change.newSource && change.oldSource !== change.newSource) {
						parts.push(`Original text: "${change.oldSource}" -> "${change.newSource}"`);
					}
					if (change.oldTarget && change.newTarget && change.oldTarget !== change.newTarget) {
						parts.push(`Translation: "${change.oldTarget}" -> "${change.newTarget}"`);
					}
					if (parts.length === 0) return '';
					const ctx = change.newContext || change.oldContext;
					if (ctx) parts.push(`Context: ${ctx}`);
					return `${index + 1}. ${parts.join('; ')}`;
				})
				.filter((line) => line.length > 0)
				.join('\n');

			const hiddenPrompt = `Исправь реплики согласно изменениям глоссария.

Изменения глоссария:
${changesText}

Правила:
- Прочитай ВСЕ переданные сегменты от первого до последнего, не пропуская ни одного.
- Учитывай поле Context каждого термина: оно описывает, что это за слово (имя, локация, бренд), род, склоняется ли. Используй это, чтобы корректно подобрать форму при замене и не путать с похожими словами.
- Заменяй только реальные вхождения целых слов (или их падежных форм). НЕ заменяй подстроки, попавшие случайно внутрь другого слова: например, имя "Айся" не должно заменяться внутри слова "возвращайся".
- Если термин помечен как несклоняемый — оставляй замену в исходной форме. Если склоняется — подбирай корректное окончание под падеж в реплике.
- Найди в original text и translation все вхождения, включая склонения, формы с окончаниями, падежи, единственное и множественное число, разные регистры.
- Например, если термин был "Фонтеросса", учитывай формы "Фонтероссы", "Фонтероссу", "Фонтероссе", "Фонтероссой".
- Если меняется вариант original text — обнови поле text. Если меняется вариант перевода — обнови поле translation.
- Не показывай рассуждения. Верни только изменённые сегменты с полным новым текстом.`;

			setIsAgentBusy(true);
			try {
				// сначала локальная замена
				const localPatches = buildGlossaryReplacementEdits(changes, baseline);
				let combinedList = mergeUpdates(baseline, localPatches);

				// потом агент по склонениям
				const response = await agentService.chat(
					hiddenPrompt,
					{
						project_id: project?.id ?? null,
						current_segments: combinedList,
						current_glossary: project?.glossary ?? null,
						target_language: project?.target_language ?? null
					},
					{
						sessionId: agentSessionIdRef.current,
						conversationHistory: buildAgentConversationHistory(chatMessages)
					}
				);
				const actions = response.actions ?? [];
				for (const action of actions) {
					if ('EditSegments' in action) {
						combinedList = mergeUpdates(combinedList, action.EditSegments.segments);
					}
				}

				const message =
					(response.message && response.message.trim().length > 0
						? response.message.trim()
						: `Обновил реплики по изменениям в глоссарии: ${changes.length}.`);

				if (!applyAndShow(combinedList, message)) {
					addNoMatchesMessage();
				}
			} catch (err) {
				const fallbackPatches = buildGlossaryReplacementEdits(changes, baseline);
				const fallbackList = mergeUpdates(baseline, fallbackPatches);
				if (applyAndShow(fallbackList, `Обновил реплики по изменениям в глоссарии: ${changes.length}.`)) {
					return;
				}
				const detail = err instanceof Error ? err.message : String(err);
				setChatMessages((prev) => [
					...prev,
					{
						id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
						role: 'assistant',
						text: `Не удалось обновить реплики по глоссарию: ${detail}`,
						isError: true
					}
				]);
			} finally {
				setIsAgentBusy(false);
			}
		},
		[applySegmentEdits, buildChatEditDiffs, buildGlossaryReplacementEdits, buildAgentConversationHistory, chatMessages]
	);

	const handleKeepEdits = useCallback((messageId: string) => {
		setChatMessages((prev) =>
			prev.map((m) =>
				m.id === messageId && m.role === 'assistant' ? { ...m, editStatus: 'kept' } : m
			)
		);
	}, []);

	const handleUndoEdits = useCallback((messageId: string) => {
		const target = chatMessages.find((m) => m.id === messageId);
		if (!target || target.role !== 'assistant' || !target.editSnapshot) return;
		applySegmentEdits(target.editSnapshot);
		setChatMessages((prev) =>
			prev.map((m) =>
				m.id === messageId && m.role === 'assistant' ? { ...m, editStatus: 'reverted' } : m
			)
		);
	}, [chatMessages, applySegmentEdits]);

	const handleAskAgentAboutSelectedSegment = useCallback(() => {
		const seg = generatedSegments[selectedSegmentIndex];
		if (!seg) return;
		setPendingAttachedSegment({
			id: seg.id,
			start: seg.start,
			end: seg.end,
			text: seg.text,
			translation: seg.translation ?? null
		});
		requestAnimationFrame(() => chatInputRef.current?.focus());
	}, [generatedSegments, selectedSegmentIndex]);

	const mergeGlossaryAgentUpdates = useCallback(
		(
			current: GlossaryEntry[],
			updates: GlossaryEntry[]
		): { glossary: GlossaryEntry[]; changes: GlossaryReplacementChange[] } => {
			const prev = current.map((e) => ({ ...e }));
			const changes: GlossaryReplacementChange[] = [];

			for (const upd of updates) {
				const idx = prev.findIndex(
					(e) =>
						(Boolean(upd.id) && e.id === upd.id) ||
						e.source.trim().toLowerCase() === upd.source.trim().toLowerCase()
				);
				if (idx < 0) continue;
				const old = prev[idx];
				const merged: GlossaryEntry = {
					...old,
					source: upd.source.trim() || old.source,
					target: upd.target.trim() || old.target,
					description: upd.description ?? old.description,
					context: upd.context ?? old.context
				};
				const oldSource = old.source.trim();
				const newSource = merged.source.trim();
				const oldTarget = old.target.trim();
				const newTarget = merged.target.trim();
				const oldContext = (old.context ?? old.description ?? '').trim();
				const newContext = (merged.context ?? merged.description ?? '').trim();
				if (oldSource === newSource && oldTarget === newTarget) continue;
				changes.push({
					id: old.id,
					oldSource,
					newSource,
					oldTarget,
					newTarget,
					oldContext,
					newContext
				});
				prev[idx] = merged;
			}
			return { glossary: prev, changes };
		},
		[]
	);

	const mergeSegmentPatches = useCallback(
		(baseList: SubtitleSegment[], patches: SubtitleSegment[]): SubtitleSegment[] => {
			if (patches.length === 0) return baseList;
			const map = new Map(baseList.map((s) => [s.id, s] as const));
			for (const patch of patches) {
				const prev = map.get(patch.id);
				if (!prev) continue;
				map.set(patch.id, {
					...prev,
					text: patch.text ?? prev.text,
					translation: patch.translation ?? prev.translation
				});
			}
			return baseList.map((s) => map.get(s.id) ?? s);
		},
		[]
	);

	const applyAgentResponseActions = useCallback(
		async (
			actions: AgentAction[],
			baseline: SubtitleSegment[]
		): Promise<{ edits: ChatEditDiff[]; snapshot: SubtitleSegment[] } | null> => {
			if (actions.length === 0 || baseline.length === 0) return null;

			const cp = currentProjectRef.current;
			let combinedList = baseline;
			const glossaryChanges: GlossaryReplacementChange[] = [];

			for (const action of actions) {
				if ('UpdateGlossary' in action && cp) {
					const { glossary, changes } = mergeGlossaryAgentUpdates(
						cp.glossary ?? [],
						action.UpdateGlossary.entries
					);
					if (changes.length > 0) {
						glossaryChanges.push(...changes);
						const nextProject: ProjectData = { ...cp, glossary };
						currentProjectRef.current = nextProject;
						setCurrentProject(nextProject);
						markProjectDirty();
						if (cp.path) {
							try {
								await projectService.updateGlossary(cp.path, glossary);
							} catch {
								// состояние проекта уже обновлено локально
							}
						}
					}
				}
				if ('EditSegments' in action) {
					combinedList = mergeSegmentPatches(combinedList, action.EditSegments.segments);
				}
			}

			if (glossaryChanges.length > 0) {
				const patches = buildGlossaryReplacementEdits(glossaryChanges, combinedList);
				combinedList = mergeSegmentPatches(combinedList, patches);
			}

			const updated = combinedList.filter((next) => {
				const prev = baseline.find((s) => s.id === next.id);
				if (!prev) return false;
				return (
					prev.text !== next.text ||
					(prev.translation ?? '') !== (next.translation ?? '')
				);
			});
			if (updated.length === 0) return null;

			const edits = buildChatEditDiffs(updated, baseline, 'both');
			if (edits.length === 0) return null;

			const { originals } = applySegmentEdits(updated);
			if (originals.length === 0) return null;

			return { edits, snapshot: originals };
		},
		[
			applySegmentEdits,
			buildChatEditDiffs,
			buildGlossaryReplacementEdits,
			mergeGlossaryAgentUpdates,
			mergeSegmentPatches,
			markProjectDirty
		]
	);

	const handleSendChatMessage = useCallback(async () => {
		const text = chatInput.trim();
		if (!text || isAgentBusy) return;

		const userMsg: ChatMessage = {
			id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
			role: 'user',
			text,
			attachedSegment: pendingAttachedSegment ?? undefined
		};
		setChatMessages((prev) => [...prev, userMsg]);
		setChatInput('');
		setPendingAttachedSegment(null);
		setIsAgentBusy(true);

		try {
			const baseline = segmentsRef.current ?? [];
			const project = currentProjectRef.current;
			const messageForAgent = pendingAttachedSegment
				? `${text}\n\nПрикрепленная реплика:\n#${pendingAttachedSegment.id} [${formatChatTimecode(pendingAttachedSegment.start)}]\nOriginal: ${pendingAttachedSegment.text}\nTranslation: ${pendingAttachedSegment.translation ?? ''}`
				: text;
			const response = await agentService.chat(
				messageForAgent,
				{
					project_id: project?.id ?? null,
					current_segments: baseline,
					current_glossary: project?.glossary ?? null,
					target_language: project?.target_language ?? null
				},
				{
					sessionId: agentSessionIdRef.current,
					conversationHistory: buildAgentConversationHistory(chatMessages)
				}
			);

			const applied = await applyAgentResponseActions(response.actions ?? [], baseline);

			const aiMsg: ChatMessage = {
				id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
				role: 'assistant',
				text: response.message ?? '',
				edits: applied?.edits,
				editSnapshot: applied?.snapshot,
				editStatus: applied?.snapshot && applied.snapshot.length > 0 ? 'pending' : undefined
			};
			setChatMessages((prev) => [...prev, aiMsg]);
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			setChatMessages((prev) => [
				...prev,
				{
					id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
					role: 'assistant',
					text: `Не удалось получить ответ от агента: ${detail}`,
					isError: true
				}
			]);
		} finally {
			setIsAgentBusy(false);
		}
	}, [
		chatInput,
		isAgentBusy,
		pendingAttachedSegment,
		chatMessages,
		formatChatTimecode,
		applyAgentResponseActions,
		buildAgentConversationHistory
	]);

	const handleChatInputKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
				e.preventDefault();
				void handleSendChatMessage();
			}
		},
		[handleSendChatMessage]
	);

	useLayoutEffect(() => {
		const el = chatScrollRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}, [chatMessages, isAgentBusy]);

	const hasOriginalText = useMemo(
		() => generatedSegments.some((s) => (s.text ?? '').trim().length > 0),
		[generatedSegments]
	);

	const hasProjectVideo = useMemo(() => treeFiles.video.length > 0, [treeFiles.video]);

	const canRetranscribeRangeMenu = useMemo(() => {
		if (!timelineRubberRange) return false;
		return (
			timelineRubberRange.end - timelineRubberRange.start >= MIN_SEGMENT_DURATION &&
			Boolean(activeVideoAbsolutePath)
		);
	}, [timelineRubberRange, activeVideoAbsolutePath]);

	const menuItems = useMemo(
		(): Array<{ id: string; label: string; items: MenuSubItem[] }> => [
			{
				id: 'file',
				label: t('menu.file'),
				items: [
					{ label: t('menu.newProject'), action: () => setActiveModal('createProject') },
					{ label: t('menu.openProject'), action: () => void handleOpenProjectDialog() },
					{ kind: 'separator' },
					{ label: t('menu.importVideo'), action: () => void handleImportVideo() },
					{ label: t('menu.importOriginal'), action: () => void handleImportOriginalSubtitles() },
					{ label: t('menu.importTranslated'), action: () => void handleImportTranslatedSubtitles() },
					{ kind: 'separator' },
					{ label: t('menu.save'), action: () => void handleSaveProject() },
					{ kind: 'separator' },
					{ label: t('menu.settings'), action: () => setActiveModal('settings') },
					{ label: t('menu.exit'), action: () => void handleExitProject() },
				],
			},
			{
				id: 'edit',
				label: t('menu.edit'),
				items: [
					{ label: t('menu.undo'), action: () => void performSubtitleUndo() },
					{ label: t('menu.redo'), action: () => void performSubtitleRedo() },
					{ label: t('menu.delete'), action: () => void handleDeleteSelectedSubtitle() },
					{ kind: 'separator' },
					{
						label: t('menu.findAndReplace'),
						action: () => {
							if (!currentProjectRef.current) return;
							setActiveModal('findReplace');
						}
					},
					{ label: t('menu.spellCheck') },
				],
			},
			{
				id: 'view',
				label: t('menu.view'),
				items: [
					{
						kind: 'toggle',
						label: t('menu.showOriginalOnVideo'),
						checked: showOriginalVideoSubtitles,
						onChange: setShowOriginalVideoSubtitles
					},
					{
						kind: 'toggle',
						label: t('menu.dualMonitorMode'),
						checked: dualMonitorMode,
						onChange: setDualMonitorMode
					}
				]
			},
			{
				id: 'ai',
				label: t('menu.ai'),
				items: [
					{
						label: t('menu.transcribe'),
						disabled: !hasProjectVideo,
						action: () => {
							if (!hasProjectVideo) return;
							if (!currentProjectRef.current) {
								void message(t('ai.openProjectFirst'), {
									kind: 'info',
									title: t('dialog.importTitle')
								});
								return;
							}
							void ensureApiKeyForAi().then((ok) => {
								if (ok) setFullTranscribeSetup(true);
							});
						}
					},
					{
						label: t('menu.translate'),
						disabled: !hasOriginalText,
						action: () => {
							if (!hasOriginalText) return;
							void ensureApiKeyForAi().then((ok) => {
								if (ok) openAiTranslateSetup();
							});
						}
					},
					{
						label: t('menu.retranscribeRange'),
						disabled: !canRetranscribeRangeMenu,
						action: () => {
							if (!canRetranscribeRangeMenu || !timelineRubberRange) return;
							setRetranscribeError(null);
							setRetranscribeSetup({ range: timelineRubberRange });
						}
					},
				],
			},
			{
				id: 'help',
				label: t('menu.help'),
				items: [{ label: t('menu.about'), action: () => setActiveModal('about') }],
			},
		],
		[
			t,
			showOriginalVideoSubtitles,
			dualMonitorMode,
			performSubtitleUndo,
			performSubtitleRedo,
			handleDeleteSelectedSubtitle,
			handleOpenProjectDialog,
			handleSaveProject,
			handleExitProject,
			handleImportVideo,
			handleImportOriginalSubtitles,
			handleImportTranslatedSubtitles,
			hasOriginalText,
			hasProjectVideo,
			canRetranscribeRangeMenu,
			timelineRubberRange,
			ensureApiKeyForAi,
			openAiTranslateSetup
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

	const applyFindReplaceSegments = useCallback(
		(nextList: SubtitleSegment[]) => {
			if (!activeSubtitleFileId) return;
			const cp = currentProjectRef.current;
			if (!cp) return;
			pushSubtitleHistorySnapshot();
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

	const handleFindSelectMatch = useCallback(
		(match: FindMatch) => {
			setFindHighlight(match);
			selectSegmentAndSeek(match.segmentIndex);
		},
		[selectSegmentAndSeek]
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

	const handleRetranscribeRange = useCallback(
		async (
			range: { start: number; end: number },
			opts: { sourceLanguage: string; userPrompt: string }
		) => {
			const cp = currentProjectRef.current;
			const fileId = activeSubtitleFileId;
			if (!cp || !fileId) return;
			const videoFile = cp.files.find((f) => {
				if (f.id === fileId && f.file_type === 'Video') return true;
				if (f.id === fileId && f.file_type === 'Subtitle' && f.linked_file_id) {
					const v = cp.files.find((x) => x.id === f.linked_file_id && x.file_type === 'Video');
					return Boolean(v);
				}
				return false;
			});
			let videoAbsPath: string | null = null;
			if (videoFile?.file_type === 'Video') {
				videoAbsPath = joinProjectPath(cp.path, videoFile.path);
			} else if (videoFile?.file_type === 'Subtitle' && videoFile.linked_file_id) {
				const v = cp.files.find((f) => f.id === videoFile.linked_file_id && f.file_type === 'Video');
				if (v) videoAbsPath = joinProjectPath(cp.path, v.path);
			}
			if (!videoAbsPath) {
				const v = cp.files.find((f) => f.file_type === 'Video');
				if (v) videoAbsPath = joinProjectPath(cp.path, v.path);
			}
			if (!videoAbsPath) {
				setRetranscribeError('Не нашёл видеофайл проекта для извлечения аудио.');
				return;
			}

			const lo = Math.max(0, range.start);
			const hi = Math.max(lo + MIN_SEGMENT_DURATION, range.end);

			setRetranscribeError(null);
			setRetranscribeBusy({ stage: 'audio' });

			const audioFileName = `retranscribe_${Date.now()}.mp3`;
			const audioRelPath = `config/${audioFileName}`;
			const audioOut = joinProjectPath(cp.path, audioRelPath);

			try {
				const hasApiKey = await projectService.getApiKeyStatus();
				if (!hasApiKey) throw new Error('OpenAI API key не задан. Активируйте приложение.');

				await projectService.extractAudioRange(videoAbsPath, lo, hi, audioOut);

				setRetranscribeBusy({ stage: 'transcribe' });
				const isoLang =
					RETRANSCRIBE_LANGUAGE_ISO[opts.sourceLanguage] ??
					(opts.sourceLanguage.trim().length === 2 ? opts.sourceLanguage.trim().toLowerCase() : undefined);
				const userPromptTrimmed = opts.userPrompt.trim();

				const rawSegments = await projectService.transcribeAudio(
					audioOut,
					isoLang,
					userPromptTrimmed.length > 0 ? userPromptTrimmed : undefined,
					cp.glossary ?? [],
					true
				);

				if (rawSegments.length === 0) {
					throw new Error('Whisper не вернул сегментов для выделенного диапазона.');
				}

				setRetranscribeBusy({ stage: 'translate' });
				const targetLang = (cp.target_language || '').trim();
				let translatedMap = new Map<number, string>();
				if (targetLang.length > 0) {
					try {
						const translations = await projectService.translateBatch(
							rawSegments,
							targetLang,
							'Natural subtitle translation',
							cp.glossary ?? []
						);
						translatedMap = new Map(translations.map((t) => [t.id, t.translated_text]));
					} catch (e) {
						console.error('Retranscribe translate failed', e);
					}
				}

				setRetranscribeBusy({ stage: 'apply' });
				const baseList = segmentsRef.current;
				const remaining = baseList.filter((s) => !(s.start < hi && s.end > lo));
				const maxId = remaining.reduce((m, s) => Math.max(m, s.id), 0);
				const newSegments: SubtitleSegment[] = rawSegments.map((s, i) => {
					const start = Math.max(0, s.start + lo);
					const end = Math.max(start + MIN_SEGMENT_DURATION, s.end + lo);
					const tr = translatedMap.get(s.id);
					return {
						...s,
						id: maxId + 1 + i,
						start,
						end,
						duration: Math.max(0, end - start),
						translation: tr && tr.length > 0 ? tr : (s.translation ?? null)
					};
				});

				const merged = [...remaining, ...newSegments].sort((a, b) => a.start - b.start);
				pushSubtitleHistorySnapshot();
				const next: ProjectData = {
					...cp,
					files: cp.files.map((f) =>
						f.id === fileId ? { ...f, subtitle_segments: merged } : f
					)
				};
				currentProjectRef.current = next;
				setCurrentProject(next);
				setGeneratedSegments(merged);
				markProjectDirty();

				setSelectedSegmentIds(new Set());
				setTimelineRubberRange(null);
				setTimelineInsertRange(null);
				const firstNewIdx = merged.findIndex((s) => s.id === newSegments[0]?.id);
				if (firstNewIdx >= 0) setSelectedSegmentIndex(firstNewIdx);
				setRetranscribeBusy(null);
			} catch (err) {
				console.error('retranscribe range', err);
				const detail = err instanceof Error ? err.message : String(err);
				setRetranscribeError(detail);
				setRetranscribeBusy(null);
			} finally {
				projectService
					.deleteProjectFileArtifact(cp.path, audioRelPath)
					.catch((err) => console.warn('cleanup retranscribe audio failed:', err));
			}
		},
		[activeSubtitleFileId, markProjectDirty, pushSubtitleHistorySnapshot]
	);

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

	const applySegmentDeltaLocal = useCallback(
		(updates: Map<number, { start: number; end: number }>) => {
			if (updates.size === 0) return;
			const apply = (s: SubtitleSegment) => {
				const u = updates.get(s.id);
				if (!u) return s;
				return { ...s, start: u.start, end: u.end, duration: Math.max(0, u.end - u.start) };
			};
			setGeneratedSegments((prev) => prev.map(apply));
			setCurrentProject((cp) => {
				if (!cp || !activeSubtitleFileId) return cp;
				return {
					...cp,
					files: cp.files.map((f) => {
						if (f.id !== activeSubtitleFileId || !f.subtitle_segments) return f;
						return { ...f, subtitle_segments: f.subtitle_segments.map(apply) };
					})
				};
			});
		},
		[activeSubtitleFileId]
	);

	const commitSegmentBatchUpdate = useCallback(
		(updates: Map<number, { start: number; end: number }>) => {
			if (updates.size === 0) return;
			const cp = currentProjectRef.current;
			if (!cp || !activeSubtitleFileId) return;
			const apply = (s: SubtitleSegment) => {
				const u = updates.get(s.id);
				if (!u) return s;
				return { ...s, start: u.start, end: u.end, duration: Math.max(0, u.end - u.start) };
			};
			const nextList = segmentsRef.current.map(apply);
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
		[activeSubtitleFileId, markProjectDirty]
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

	const timelineScrollFromPointerNearEdge = useCallback((clientX: number) => {
		const scr = timelineScrollRef.current;
		if (!scr) return;
		const rect = scr.getBoundingClientRect();
		if (clientX < rect.left + TIMELINE_EDGE_SCROLL_MARGIN) {
			const d = rect.left + TIMELINE_EDGE_SCROLL_MARGIN - clientX;
			scr.scrollLeft = Math.max(0, scr.scrollLeft - (TIMELINE_EDGE_SCROLL_BASE + d * 0.22));
		} else if (clientX > rect.right - TIMELINE_EDGE_SCROLL_MARGIN) {
			const d = clientX - (rect.right - TIMELINE_EDGE_SCROLL_MARGIN);
			const maxScroll = Math.max(0, scr.scrollWidth - scr.clientWidth);
			scr.scrollLeft = Math.min(maxScroll, scr.scrollLeft + (TIMELINE_EDGE_SCROLL_BASE + d * 0.22));
		}
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
				timelineScrollFromPointerNearEdge(ev.clientX);
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
					const segs = segmentsRef.current;
					const insideIds: number[] = [];
					let firstIdx = -1;
					for (let i = 0; i < segs.length; i++) {
						const s = segs[i];
						if (s.start < hi && s.end > lo) {
							insideIds.push(s.id);
							if (firstIdx < 0) firstIdx = i;
						}
					}
					setTimelineRubberRange({ start: lo, end: hi });
					if (insideIds.length > 0) {
						setSelectedSegmentIds(new Set(insideIds));
						setTimelineInsertRange(null);
						setSelectedSegmentIndex(firstIdx);
						return;
					}
					setSelectedSegmentIds(new Set());
					setTimelineInsertRange({ start: lo, end: hi });
					seekVideo(lo);
				} else {
					setSelectedSegmentIds(new Set());
					setTimelineInsertRange(null);
					setTimelineRubberRange(null);
					const seekT = Math.max(0, Math.min(td, t1));
					seekVideo(seekT);
				}
			};
			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
		},
		[clientXToTimelineTime, timelineScrollFromPointerNearEdge, seekVideo]
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
				timelineScrollFromPointerNearEdge(e.clientX);
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
		[activeSubtitleFileId, clientXToTimelineTime, setSegmentStartEndLocal, timelineScrollFromPointerNearEdge, updateSegmentAtIndex]
	);

	const beginTimelineGroupMove = useCallback(
		(ev: React.MouseEvent) => {
			if (!activeSubtitleFileId) return;
			const selSet = selectedSegmentIdsRef.current;
			if (selSet.size <= 1) return false;
			ev.preventDefault();
			ev.stopPropagation();

			const segs = segmentsRef.current;
			const sorted = [...segs].sort((a, b) => a.start - b.start);
			const indexInSorted = new Map(sorted.map((s, i) => [s.id, i] as const));
			const selectedItems = sorted.filter((s) => selSet.has(s.id));
			if (selectedItems.length === 0) return false;

			const totalDur = timelineTotalDurationRef.current;
			let minDelta = -Infinity;
			let maxDelta = Infinity;
			for (const s of selectedItems) {
				const i = indexInSorted.get(s.id) ?? -1;
				let prevNonSelEnd = 0;
				for (let j = i - 1; j >= 0; j--) {
					if (!selSet.has(sorted[j].id)) { prevNonSelEnd = sorted[j].end; break; }
				}
				let nextNonSelStart = totalDur;
				for (let j = i + 1; j < sorted.length; j++) {
					if (!selSet.has(sorted[j].id)) { nextNonSelStart = sorted[j].start; break; }
				}
				minDelta = Math.max(minDelta, prevNonSelEnd - s.start);
				maxDelta = Math.min(maxDelta, nextNonSelStart - s.end);
			}
			const minStart = Math.min(...selectedItems.map((s) => s.start));
			const maxEnd = Math.max(...selectedItems.map((s) => s.end));
			minDelta = Math.max(minDelta, -minStart);
			maxDelta = Math.min(maxDelta, totalDur - maxEnd);

			const origs = new Map<number, { start: number; end: number }>();
			for (const s of selectedItems) origs.set(s.id, { start: s.start, end: s.end });

			const undoSnap = cloneSubtitleSegments(segmentsRef.current);
			const t0 = clientXToTimelineTime(ev.clientX);
			timelineGroupMoveRef.current = { t0, minDelta, maxDelta, origs };

			const onMove = (e: MouseEvent) => {
				const mv = timelineGroupMoveRef.current;
				if (!mv) return;
				timelineScrollFromPointerNearEdge(e.clientX);
				let delta = clientXToTimelineTime(e.clientX) - mv.t0;
				delta = Math.max(mv.minDelta, Math.min(mv.maxDelta, delta));
				const updates = new Map<number, { start: number; end: number }>();
				mv.origs.forEach((o, id) => {
					updates.set(id, { start: o.start + delta, end: o.end + delta });
				});
				applySegmentDeltaLocal(updates);
			};
			const onUp = () => {
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
				const mv = timelineGroupMoveRef.current;
				timelineGroupMoveRef.current = null;
				if (!mv) return;
				const cur = segmentsRef.current;
				const finalUpdates = new Map<number, { start: number; end: number }>();
				let changed = false;
				for (const s of cur) {
					const orig = mv.origs.get(s.id);
					if (!orig) continue;
					if (Math.abs(s.start - orig.start) > 1e-4 || Math.abs(s.end - orig.end) > 1e-4) {
						changed = true;
					}
					finalUpdates.set(s.id, { start: s.start, end: s.end });
				}
				if (changed) {
					segmentBodyDragMovedRef.current = true;
					undoSegmentsStackRef.current.push(undoSnap);
					if (undoSegmentsStackRef.current.length > MAX_SUBTITLE_UNDO) undoSegmentsStackRef.current.shift();
					redoSegmentsStackRef.current = [];
					commitSegmentBatchUpdate(finalUpdates);
				}
			};
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
			return true;
		},
		[activeSubtitleFileId, applySegmentDeltaLocal, clientXToTimelineTime, commitSegmentBatchUpdate, timelineScrollFromPointerNearEdge]
	);

	const beginTimelineSegmentMove = useCallback(
		(index: number, ev: React.MouseEvent) => {
			if (!activeSubtitleFileId) return;
			if ((ev.target as HTMLElement).closest('[data-tl-edge]')) return;
			const seg = segmentsRef.current[index];
			if (!seg) return;
			if (selectedSegmentIdsRef.current.has(seg.id) && selectedSegmentIdsRef.current.size > 1) {
				if (beginTimelineGroupMove(ev)) return;
			}
			ev.preventDefault();
			ev.stopPropagation();
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
				timelineScrollFromPointerNearEdge(e.clientX);
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
		[activeSubtitleFileId, clientXToTimelineTime, setSegmentStartEndLocal, timelineScrollFromPointerNearEdge, updateSegmentAtIndex]
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
			e.preventDefault();
			toggleVideoPlay();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [activeModal, videoSrc, toggleVideoPlay]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			if (activeModal !== null) return;
			if (shouldIgnoreSpacebarForVideo(e.target)) return;
			/* e.code - раскладка не важна */
			if (e.code === 'KeyZ' && !e.shiftKey) {
				e.preventDefault();
				if (lastUndoDomainRef.current === 'project') {
					void performProjectUndo();
				} else if (lastUndoDomainRef.current === 'subtitle') {
					void performSubtitleUndo();
				} else {
					void performProjectUndo().then((done) => {
						if (!done) void performSubtitleUndo();
					});
				}
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
	}, [activeModal, performSubtitleUndo, performSubtitleRedo, performProjectUndo]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== 'Delete') return;
			if (activeModal !== null) return;
			if (shouldIgnoreSpacebarForVideo(e.target)) return;
			if (selectedTreeItem) {
				e.preventDefault();
				void handleDeleteSelectedTreeItem();
				return;
			}
			const hasMulti = selectedSegmentIdsRef.current.size > 0;
			const hasSubtitleSel = activeSubtitleFileId && (hasMulti || selectedSegmentIndex >= 0);
			if (hasSubtitleSel) {
				e.preventDefault();
				void handleDeleteSelectedSubtitle();
				return;
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [
		activeModal,
		activeSubtitleFileId,
		selectedSegmentIndex,
		handleDeleteSelectedSubtitle,
		selectedTreeItem,
		handleDeleteSelectedTreeItem
	]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== 'Escape') return;
			setTimelineInsertRange(null);
			setTimelineRangePreview(null);
			setSelectedSegmentIds(new Set());
			setTimelineRubberRange(null);
			setTimelineContextMenu(null);
			setSelectedTreeItem(null);
			setProjectFileMenu(null);
			timelineRangeSelectDragRef.current = null;
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	useEffect(() => {
		if (!selectedTreeItem) return;
		const onMouseDown = (e: MouseEvent) => {
			const target = e.target as HTMLElement | null;
			if (!target) return;
			if (target.closest('[data-project-tree]')) return;
			if (target.closest('[data-project-file-menu]')) return;
			setSelectedTreeItem(null);
		};
		window.addEventListener('mousedown', onMouseDown);
		return () => window.removeEventListener('mousedown', onMouseDown);
	}, [selectedTreeItem]);

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
				selectSegmentAndSeek((i) => {
					if (i < 0) return n - 1;
					return Math.max(0, i - 1);
				});
			} else {
				selectSegmentAndSeek((i) => {
					if (i < 0) return 0;
					return Math.min(n - 1, i + 1);
				});
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [activeModal, activeSubtitleFileId, selectSegmentAndSeek]);

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
				if (disposed) return;
				const activationCompleted = localStorage.getItem(ACTIVATION_COMPLETED_STORAGE_KEY) === '1';
				if (activationCompleted) {
					setActiveModal('welcome');
					return;
				}
				setActiveModal('activation');
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

	// ffprobe duration (как у волны)
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
		const videoIdForCache = activeVideoFile?.id ?? 'shared';
		const outJson = joinProjectPath(
			currentProject.path,
			'config',
			`waveform_cache_${videoIdForCache}.json`
		);
		const outPng = joinProjectPath(
			currentProject.path,
			'config',
			`waveform_${videoIdForCache}.png`
		);
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
	}, [activeVideoAbsolutePath, currentProject?.path, activeVideoFile?.id]);

	useEffect(() => {
		if (!videoSrc) return;

		const apply = () => {
			const v = videoRef.current;
			if (!v) return;
			v.volume = volume;
			v.muted = videoMuted;
			const t = currentPlaybackTimeRef.current;
			try {
				v.currentTime = t;
			} catch {
				/* noop */
			}
			setCurrentPlaybackTime(t);
			if (isPlayingRef.current) void v.play().catch(() => undefined);
			else v.pause();
		};

		const raf = requestAnimationFrame(() => {
			const v = videoRef.current;
			if (!v) {
				requestAnimationFrame(apply);
				return;
			}
			if (v.readyState >= 1) apply();
			else v.addEventListener('loadedmetadata', apply, { once: true });
		});
		return () => cancelAnimationFrame(raf);
	}, [videoSrc, volume, videoMuted]);

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

	// скроллбар таймлайна
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

	/** Плавная полоска таймлайна */
	useEffect(() => {
		if (!videoSrc) return;
		const v = videoRef.current;
		if (!v) return;

		let rafId = 0;

		const tick = () => {
			rafId = 0;
			if (v.paused || v.ended) return;
			const t = v.currentTime;
			currentPlaybackTimeRef.current = t;
			setCurrentPlaybackTime(t);
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
			const t = v.currentTime;
			currentPlaybackTimeRef.current = t;
			setCurrentPlaybackTime(t);
		};

		const onSeeked = () => {
			const t = v.currentTime;
			currentPlaybackTimeRef.current = t;
			setCurrentPlaybackTime(t);
		};

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
			const dur = timelineTotalDuration;
			if (!dur) return;
			const rect = barEl.getBoundingClientRect();
			const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
			const t = ratio * dur;
			const v = videoRef.current;
			if (!v) return;
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

	// ресайз панелей

	// стоп drag
	const stopResizing = useCallback(() => {
		setIsResizing(false);
	}, []);

	// дерево
	const startResizing = useCallback(() => {
		setIsResizing(true);
	}, []);

	const resize = useCallback((mouseMoveEvent: MouseEvent) => {
		if (isResizing) {
			const newWidth = mouseMoveEvent.clientX - 60;
			const videoReserve = LIMITS.VIDEO;
			const maxDynamic = windowSize.width - (aiAgentWidth + LIMITS.TABLE + videoReserve + LIMITS.SIDEBAR);
			const max = Math.min(LIMITS.PROJECT_TREE.MAX, maxDynamic);
			if (newWidth > LIMITS.PROJECT_TREE.MIN && newWidth < max) {
				setProjectTreeWidth(newWidth);
			}
		}
	}, [isResizing, windowSize, aiAgentWidth]);

	// mousemove дерево
	useEffect(() => {
		window.addEventListener("mousemove", resize);
		window.addEventListener("mouseup", stopResizing);
		return () => {
			window.removeEventListener("mousemove", resize);
			window.removeEventListener("mouseup", stopResizing);
		};
	}, [resize, stopResizing]);

	// лимиты при resize окна
	useEffect(() => {
		const videoReserve = LIMITS.VIDEO;
		const totalFixed = 60 + projectTreeWidth + aiAgentWidth;
		const maxTable = windowSize.width - totalFixed - videoReserve;

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
	}, [windowSize, tablePanelWidth, projectTreeWidth, aiAgentWidth, upperSectionHeight]);

	// агент
	const startAiAgentResizing = useCallback((mouseDownEvent: React.MouseEvent) => {
		setIsAiAgentResizing(true);
		const startWidth = aiAgentWidth;
		const startX = mouseDownEvent.clientX;
		
		const doDrag = (mouseMoveEvent: MouseEvent) => {
			const newWidth = startWidth + (mouseMoveEvent.clientX - startX);
			const videoReserve = LIMITS.VIDEO;
			const maxDynamic = windowSize.width - (LIMITS.SIDEBAR + projectTreeWidth + LIMITS.TABLE + videoReserve);
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

	// таблица
	const startTablePanelResizing = useCallback((direction: 'right' | 'bottom', mouseDownEvent: React.MouseEvent) => {
		const startWidth = tablePanelWidth;
		const startHeight = upperSectionHeight;
		const startX = mouseDownEvent.clientX;
		const startY = mouseDownEvent.clientY;

		const doDrag = (e: MouseEvent) => {
			if (direction === 'right') {
				const newWidth = startWidth + (e.clientX - startX);
				const minTableWidth = 400;
				const videoReserve = LIMITS.VIDEO;
				const maxAllowedWidth = windowSize.width - (60 + projectTreeWidth + aiAgentWidth) - videoReserve;

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

	// колонки таблицы
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
					{/* лого 24x24, файл app-logo.svg */}
					<img
						src={appLogo}
						alt=""
						width={24}
						height={24}
						draggable={false}
						className="w-6 h-6 shrink-0 mr-1 rounded-[5px] object-cover border border-border-default"
					/>

					{/* Пункты меню */}
					<div className="flex items-center gap-0.5">
						{menuItems.map((menu) => (
							<div key={menu.id} className="relative">
								<button 
									onClick={(e) => {
										e.stopPropagation();
										setActiveMenu(activeMenu === menu.id ? null : menu.id);
									}}
									className={`px-2 h-[24px] flex items-center text-[12px] font-inter rounded-sm transition-colors 
										${activeMenu === menu.id 
											? 'bg-primary-main text-white' 
											: 'text-text-primary hover:bg-secondary-hover'}`}
								>
									{menu.label}
								</button>

								{/* Выпадающий список */}
								{activeMenu === menu.id && (
									<div className="rounded-[8px] absolute left-0 top-[26px] w-max min-w-[160px] bg-surface-secondary border border-border-default shadow-lg py-1 flex flex-col z-[110]">
										{menu.items.map((subItem: MenuSubItem, subIdx) =>
											subItem.kind === 'separator' ? (
												<div
													key={`${menu.id}-sep-${subIdx}`}
													className="my-1 mx-2 border-t border-border-default"
													role="separator"
												/>
											) : subItem.kind === 'toggle' ? (
												<button
													key={`${menu.id}-${subItem.label}-${subIdx}`}
													type="button"
													role="menuitemcheckbox"
													aria-checked={subItem.checked}
													className="px-3 h-[28px] flex items-center gap-2 text-[12px] font-inter whitespace-nowrap text-text-primary hover:bg-primary-main hover:text-white text-left transition-colors w-full"
													onClick={(e) => {
														e.stopPropagation();
														subItem.onChange(!subItem.checked);
													}}
												>
													<span className="w-3 shrink-0 text-center leading-none">
														{subItem.checked ? '✓' : ''}
													</span>
													<span>{subItem.label}</span>
												</button>
											) : (
												<button
													key={`${menu.id}-${subItem.label}-${subIdx}`}
													disabled={Boolean(subItem.disabled)}
													className="px-3 h-[28px] flex items-center text-[12px] font-inter whitespace-nowrap text-text-primary hover:bg-primary-main hover:text-white text-left transition-colors disabled:opacity-40 disabled:pointer-events-none"
													onClick={() => {
														if (subItem.disabled) return;
														if (subItem.action) subItem.action();
														setActiveMenu(null);
													}}
												>
													{subItem.label}
												</button>
											)
										)}
									</div>
								)}
							</div>
						))}
					</div>
				</div>

				{/* ЦЕНТРАЛЬНАЯ ЧАСТЬ Название проекта */}
				<div className="flex-1 flex justify-center items-center h-full overflow-hidden px-4">
					<span className="text-[11px] text-text-primary font-inter truncate">
						{currentProject?.name ?? t('app.untitled')} - subtitlestudio
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
									title={t('sidebar.newProject')}
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
									title={t('sidebar.openProject')}
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
									title={t('sidebar.saveProject')}
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

						{/* мастер - свечение снаружи overflow */}
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
								title={t('sidebar.wizard')}
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
									title={t('sidebar.export')}
									disabled={!currentProject}
									onClick={() => setActiveModal('export')}
									className="group w-7 h-7 flex items-center justify-center shrink-0 disabled:opacity-40 disabled:pointer-events-none"
								>
									<span
										className={`${SIDEBAR_ICON_CLASS} bg-text-primary`}
										style={sidebarIconMaskStyle(iconExport)}
										aria-hidden
									/>
								</button>

								<button
									type="button"
									title={t('sidebar.glossary')}
									disabled={!currentProject}
									onClick={() => setActiveModal('glossary')}
									className="group w-7 h-7 flex items-center justify-center shrink-0 disabled:opacity-40 disabled:pointer-events-none"
								>
									<span
										className={`${SIDEBAR_ICON_CLASS} bg-text-primary`}
										style={sidebarIconMaskStyle(iconGlossary)}
										aria-hidden
									/>
								</button>

								<button
									type="button"
									title={t('sidebar.search')}
									disabled={!currentProject}
									onClick={() => setActiveModal('findReplace')}
									className="group w-7 h-7 flex items-center justify-center shrink-0 disabled:opacity-40 disabled:pointer-events-none"
								>
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
					data-project-tree
					style={{ width: `${projectTreeWidth}px`, maxWidth: `${LIMITS.PROJECT_TREE.MAX}px` }}
					className="flex flex-col h-full bg-surface-bg shrink-0 min-h-0 relative select-none border-r border-border-default antialiased"
				>
					{/* Заголовок */}
					<div className="h-[44px] flex items-center justify-between px-3 bg-panel-header border-b border-border-default shrink-0 gap-[12px]">
						<span className="text-h1-heading text-text-primary truncate font-inter pr-1">
							{currentProject?.name ?? t('app.noProject')}
						</span>
						
						<div className="flex items-center gap-[12px] shrink-0">
							<button
								type="button"
								title={t('projectTree.newFile')}
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
								title={t('projectTree.newFolder')}
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
					<div
						className="flex-1 min-w-0 overflow-y-auto p-3 bg-surface-bg subtitle-table-scroll project-tree-scroll"
						onMouseDown={(e) => {
							if (e.target === e.currentTarget) setSelectedTreeItem(null);
						}}
					>
						<div
							className="flex flex-col gap-[8px] min-h-full"
							onMouseDown={(e) => {
								if (e.target === e.currentTarget) setSelectedTreeItem(null);
							}}
						>
						
							<div 
								className={`flex items-center gap-[8px] cursor-pointer group h-4 rounded-[3px] ${
									selectedTreeItem?.kind === 'folder' && selectedTreeItem.name === 'config'
										? 'bg-primary-main/15 ring-1 ring-primary-main/40'
										: ''
								}`}
								onClick={() => {
									setIsConfigFolderOpen(!isConfigFolderOpen);
									setSelectedTreeItem({ kind: 'folder', name: 'config' });
								}}
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
											<div
												key={file.id}
												onClick={() => setSelectedTreeItem({ kind: 'file', id: file.id })}
												className={`hover:text-primary-main cursor-pointer truncate h-4 flex items-center rounded-[3px] px-[2px] ${
													selectedTreeItem?.kind === 'file' && selectedTreeItem.id === file.id
														? 'bg-primary-main/15 ring-1 ring-primary-main/40'
														: ''
												}`}
											>
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
									className={`flex items-center gap-[8px] cursor-pointer h-4 rounded-[3px] ${
										selectedTreeItem?.kind === 'folder' && selectedTreeItem.name === 'video'
											? 'bg-primary-main/15 ring-1 ring-primary-main/40'
											: ''
									}`}
									onClick={() => {
										setIsVideoFolderOpen(!isVideoFolderOpen);
										setSelectedTreeItem({ kind: 'folder', name: 'video' });
									}}
								>
									{isVideoFolderOpen ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
									<span className="font-inter font-semibold text-[12px] leading-none text-text-primary tracking-normal">
										video
									</span>
								</div>

								{isVideoFolderOpen && treeFiles.video.length > 0 && (
									<div className="flex gap-[11px] ml-[5px]">
										<div className="w-[1px] bg-border-default shrink-0" />
										
										<div className="flex flex-col gap-[8px] flex-1">
											{treeFiles.video.map((file) => (
												<div
													key={file.id}
													role="button"
													tabIndex={0}
													onClick={() => {
														setSelectedTreeItem({ kind: 'file', id: file.id });
														void activateProjectTrack(file);
													}}
													onContextMenu={(e) => {
														e.preventDefault();
														e.stopPropagation();
														setSelectedTreeItem({ kind: 'file', id: file.id });
														setProjectFileMenu({ x: e.clientX, y: e.clientY, file });
													}}
													onKeyDown={(e) => {
														if (e.key === 'Enter' || e.key === ' ') {
															e.preventDefault();
															void activateProjectTrack(file);
														}
													}}
													className={`hover:text-primary-main cursor-pointer truncate h-4 flex items-center rounded-[3px] px-[2px] ${
														selectedTreeItem?.kind === 'file' && selectedTreeItem.id === file.id
															? 'bg-primary-main/15 ring-1 ring-primary-main/40'
															: ''
													}`}
												>
													<span
														className={`font-inter font-semibold text-[12px] leading-none tracking-normal ${
															isCompositionTreeFileActive(currentProject, activeSubtitleFileId, file)
																? 'text-primary-main'
																: 'text-text-primary'
														}`}
													>
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
									className={`flex items-center gap-[8px] cursor-pointer group h-4 rounded-[3px] ${
										selectedTreeItem?.kind === 'folder' && selectedTreeItem.name === 'subtitles'
											? 'bg-primary-main/15 ring-1 ring-primary-main/40'
											: ''
									}`}
									onClick={() => {
										setIsSubtitlesFolderOpen(!isSubtitlesFolderOpen);
										setSelectedTreeItem({ kind: 'folder', name: 'subtitles' });
									}}
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
												<div
													key={file.id}
													role="button"
													tabIndex={0}
													onClick={() => {
														setSelectedTreeItem({ kind: 'file', id: file.id });
														void activateProjectTrack(file);
													}}
													onKeyDown={(e) => {
														if (e.key === 'Enter' || e.key === ' ') {
															e.preventDefault();
															void activateProjectTrack(file);
														}
													}}
													className={`hover:text-primary-main cursor-pointer truncate h-4 flex items-center rounded-[3px] px-[2px] ${
														selectedTreeItem?.kind === 'file' && selectedTreeItem.id === file.id
															? 'bg-primary-main/15 ring-1 ring-primary-main/40'
															: ''
													}`}
												>
													<span
														className={`font-inter font-semibold text-[12px] leading-none tracking-normal ${
															isCompositionTreeFileActive(currentProject, activeSubtitleFileId, file)
																? 'text-primary-main'
																: 'text-text-primary'
														}`}
													>
														{file.name}
													</span>
												</div>
											))}
										</div>
									</div>
								)}
							</div>

							{treeFiles.root.map((file) => (
								<div
									key={file.id}
									onClick={() => setSelectedTreeItem({ kind: 'file', id: file.id })}
									className={`hover:text-primary-main cursor-pointer truncate h-4 flex items-center rounded-[3px] px-[2px] ${
										selectedTreeItem?.kind === 'file' && selectedTreeItem.id === file.id
											? 'bg-primary-main/15 ring-1 ring-primary-main/40'
											: ''
									}`}
								>
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
							{t('aiAgent.title')}
						</span>
						
						<div className="flex items-center gap-[12px] shrink-0">
							<button
								type="button"
								title={t('aiAgent.add')}
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
								title={t('aiAgent.more')}
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
					<div
						ref={chatScrollRef}
						className="flex-1 overflow-auto p-[12px] bg-surface-bg flex flex-col gap-4 subtitle-table-scroll"
					>
						{chatMessages.length === 0 && !isAgentBusy && (
							<div className="m-auto text-center text-caption font-inter text-text-primary/50 px-4">
								{t('aiAgent.emptyHint')}
							</div>
						)}

						{chatMessages.map((msg) => {
							if (msg.role === 'user') {
								return (
									<div key={msg.id} className="self-end max-w-[90%] flex flex-col items-end">
										<div className="bg-surface-secondary rounded-[10px] rounded-tr-none p-[10px] select-text">
											<p className="text-body-reg text-text-primary font-inter leading-tight whitespace-pre-wrap">
												{msg.text}
											</p>
											{msg.attachedSegment && (
												<div className="mt-3 bg-inline-bg rounded-[10px] p-[8px] flex flex-col gap-[8px] w-full">
													<div className="flex items-center gap-[14px] text-caption font-inter text-text-primary/60">
														<span className="whitespace-nowrap">#{msg.attachedSegment.id}</span>
														<span className="whitespace-nowrap">
															[ {formatChatTimecode(msg.attachedSegment.start)} ]
														</span>
														<div className="flex-1 h-[1px] bg-border-default" />
													</div>
													<div className="flex flex-col gap-[4px]">
														<div className="min-h-[22px] bg-surface-secondary rounded-[2px] p-[4px] flex items-center">
															<span className="text-caption text-text-primary font-inter break-words">
																{msg.attachedSegment.translation || t('aiAgent.noTranslation')}
															</span>
														</div>
														<div className="min-h-[22px] bg-panel-header rounded-[2px] p-[4px] flex items-center">
															<span className="text-caption text-text-primary font-inter break-words">
																{msg.attachedSegment.text}
															</span>
														</div>
													</div>
												</div>
											)}
										</div>
									</div>
								);
							}

							const expanded = expandedDiffIds.has(msg.id);
							return (
								<div key={msg.id} className="self-start max-w-[95%] flex flex-col items-start">
									<div
										className={`rounded-[10px] rounded-bl-none p-[10px] select-text ${
											msg.isError ? 'bg-inline-error' : 'bg-surface-panel'
										}`}
									>
										{msg.text && (
											<p className="text-body-reg text-text-primary font-inter leading-tight whitespace-pre-wrap">
												{msg.text}
											</p>
										)}

										{msg.edits && msg.edits.length > 0 && (
											<div
												className={`bg-inline-bg rounded-[10px] p-[8px] flex flex-col gap-[8px] w-full ${
													msg.text ? 'mt-3' : ''
												}`}
											>
												<div className="flex items-center justify-between gap-2">
													<button
														type="button"
														title={expanded ? t('aiAgent.collapse') : t('aiAgent.expand')}
														aria-expanded={expanded}
														onClick={() => toggleDiffExpanded(msg.id)}
														className="group flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-text-primary transition-colors hover:bg-text-primary/15"
													>
														<span
															className={`${PANEL_HEADER_ICON_CLASS} bg-text-primary`}
															style={sidebarIconMaskStyle(expanded ? iconArrowUp : iconArrowDown)}
															aria-hidden
														/>
													</button>
													<div className="flex gap-[12px] shrink-0 items-center">
														{msg.editStatus === 'pending' && (
															<>
																<button
																	type="button"
																	onClick={() => handleUndoEdits(msg.id)}
																	className="text-caption font-inter text-text-secondary px-[8px] py-[2px] rounded-[6px] transition-all duration-150 hover:bg-inline-error hover:text-text-primary active:scale-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inline-error/60"
																>
																	{t('aiAgent.undo')}
																</button>
																<button
																	type="button"
																	onClick={() => handleKeepEdits(msg.id)}
																	className="text-caption font-inter text-text-secondary px-[8px] py-[2px] rounded-[6px] transition-all duration-150 hover:bg-inline-success hover:text-text-primary active:scale-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inline-success/60"
																>
																	{t('aiAgent.keep')}
																</button>
															</>
														)}
														{msg.editStatus === 'kept' && (
															<span className="text-caption font-inter text-text-primary/60">
																{t('aiAgent.kept')}
															</span>
														)}
														{msg.editStatus === 'reverted' && (
															<span className="text-caption font-inter text-text-primary/60">
																{t('aiAgent.reverted')}
															</span>
														)}
													</div>
												</div>

												{!expanded && (
													<p className="text-caption font-inter text-text-primary/70">
														{msg.edits.length}{' '}
														{msg.edits.length === 1 ? t('aiAgent.change') : t('aiAgent.changes')}
													</p>
												)}

												{expanded && (
													<div className="flex flex-col gap-[10px]">
														{msg.edits.map((d) => (
															<div key={`${d.id}-${d.field}`} className="flex flex-col gap-[6px]">
																<div className="flex items-center gap-[14px] text-caption font-inter text-text-primary/60">
																	<span className="whitespace-nowrap">#{d.id}</span>
																	<span className="whitespace-nowrap">
																		[ {formatChatTimecode(d.start)} ]
																	</span>
																	<div className="flex-1 h-[1px] bg-border-default" />
																</div>
																<div className="flex flex-col gap-[4px]">
																	<div className="min-h-[22px] bg-inline-error rounded-[2px] p-[4px] flex items-center">
																		<span className="text-caption text-text-primary font-inter break-words">
																			{d.oldText}
																		</span>
																	</div>
																	<div className="min-h-[22px] bg-inline-success rounded-[2px] p-[4px] flex items-center">
																		<span className="text-caption text-text-primary font-inter break-words">
																			{d.newText}
																		</span>
																	</div>
																</div>
															</div>
														))}
													</div>
												)}
											</div>
										)}
									</div>
								</div>
							);
						})}

						{isAgentBusy && (
							<div className="self-start max-w-[95%]">
								<div className="bg-surface-panel rounded-[10px] rounded-bl-none p-[8px]">
									<p className="text-body-reg text-text-primary/60 font-inter leading-tight">
										{t('aiAgent.thinking')}
									</p>
								</div>
							</div>
						)}
					</div>

					{/* Нижнее поле ввода */}
					<div className="p-3 bg-surface-bg shrink-0">
						<div className="relative flex flex-col bg-surface-secondary border border-border-default rounded-[10px] group transition-all focus-within:border-primary-main/50 shadow-sm min-h-[96px]">
							{pendingAttachedSegment && (
								<div className="mx-3 mt-3 mb-1 bg-inline-bg rounded-[10px] p-[8px] flex flex-col gap-[8px]">
									<div className="flex items-center gap-[14px] text-caption font-inter text-text-primary/60">
										<span className="whitespace-nowrap">#{pendingAttachedSegment.id}</span>
										<span className="whitespace-nowrap">
											[ {formatChatTimecode(pendingAttachedSegment.start)} ]
										</span>
										<div className="flex-1 h-[1px] bg-border-default" />
										<button
											type="button"
											title={t('aiAgent.removeAttachment')}
											onClick={() => setPendingAttachedSegment(null)}
											className="text-caption font-inter text-text-secondary hover:text-text-primary transition-colors"
										>
											{t('aiAgent.remove')}
										</button>
									</div>
									<div className="flex flex-col gap-[4px]">
										<div className="min-h-[22px] bg-surface-secondary rounded-[2px] p-[4px] flex items-center">
											<span className="text-caption text-text-primary font-inter break-words">
												{pendingAttachedSegment.translation || t('aiAgent.noTranslation')}
											</span>
										</div>
										<div className="min-h-[22px] bg-panel-header rounded-[2px] p-[4px] flex items-center">
											<span className="text-caption text-text-primary font-inter break-words">
												{pendingAttachedSegment.text}
											</span>
										</div>
									</div>
								</div>
							)}

							<textarea
								ref={chatInputRef}
								value={chatInput}
								onChange={(e) => setChatInput(e.target.value)}
								onKeyDown={handleChatInputKeyDown}
								disabled={isAgentBusy}
								placeholder={t('aiAgent.placeholder')}
								className="w-full h-full p-3 pr-[56px] bg-transparent border-none outline-none text-body-reg text-text-primary placeholder:text-primary-disabled font-inter resize-none overflow-y-auto no-scrollbar disabled:opacity-60"
								rows={3}
							/>

							<div className="absolute right-3 bottom-3">
								<button
									type="button"
									title={t('aiAgent.sendMessage')}
									onClick={() => void handleSendChatMessage()}
									disabled={isAgentBusy || chatInput.trim().length === 0}
									className="group/send flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-secondary-hover p-0 outline-none transition-colors hover:bg-primary-main focus-visible:ring-2 focus-visible:ring-primary-main/40 disabled:pointer-events-none disabled:opacity-50"
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
							className="flex flex-col bg-surface-secondary relative min-w-[300px] border-r border-border-default overflow-hidden shrink-0"
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
												{['#', t('table.startTime'), t('table.endTime'), t('table.duration')].map((label, idx) => (
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
												<th className="hidden h-[25px] py-1 px-2 text-left text-[14px] font-bold text-text-primary border-b border-border-default min-w-0">
													<div className="truncate w-full">{t('table.speakerGender')}</div>
												</th>
												<th className="h-[25px] py-1 px-2 text-left text-[14px] font-bold text-text-primary border-b border-border-default min-w-0">
													<div className="truncate w-full">{t('table.translation')}</div>
												</th>
												<th className="h-[25px] py-1 px-2 text-left text-[14px] font-bold text-text-primary border-b border-border-default min-w-0">
													<div className="truncate w-full">{t('table.originalText')}</div>
												</th>
											</tr>
										</thead>
										
										<tbody>
											{generatedSegments.map((segment, idx) => (
												<tr
													key={`${segment.id}-${idx}`}
													data-subtitle-row-index={idx}
													onClick={() => selectSegmentAndSeek(idx)}
													className={`h-[25px] hover:bg-black/5 transition-colors group text-table cursor-pointer scroll-mt-[25px] ${
														selectedSegmentIndex === idx ? 'bg-black/10' : ''
													} ${findHighlight?.segmentIndex === idx ? 'bg-primary-main/15 ring-1 ring-inset ring-primary-main' : ''}`}
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
													<td className="hidden py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 select-text text-[11px] text-text-secondary">
														<div className="truncate" title={segment.speaker_gender ?? ''}>
															{formatSpeakerGenderCell(segment.speaker_gender)}
														</div>
													</td>
													<td
														className={`py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 text-body-reg select-text ${
															findHighlight?.segmentIndex === idx && findHighlight.field === 'translation'
																? 'bg-primary-main/25'
																: ''
														}`}
													>
														<div className="truncate">{segment.translation || '-'}</div>
													</td>
													<td
														className={`py-1 px-2 border-b border-border-default whitespace-nowrap overflow-hidden text-overflow-ellipsis min-w-0 text-body-reg select-text ${
															findHighlight?.segmentIndex === idx && findHighlight.field === 'text'
																? 'bg-primary-main/25'
																: ''
														}`}
													>
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
											<label className="text-caption text-text-primary">{t('table.startTime')}</label>
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
											<label className="text-caption text-text-primary">{t('table.duration')}</label>
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
												onClick={() => selectSegmentAndSeek((i) => Math.max(0, i - 1))}
												className="flex-1 h-[24px] px-[12px] py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center"
											>
												{t('table.prev')}
											</button>
											<button
												type="button"
												disabled={selectedSegmentIndex < 0 || selectedSegmentIndex >= generatedSegments.length - 1}
												onClick={() =>
													selectSegmentAndSeek((i) =>
														Math.min(generatedSegments.length - 1, i + 1)
													)
												}
												className="flex-1 h-[24px] px-[12px] py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center"
											>
												{t('table.next')}
											</button>
										</div>
										<button
											type="button"
											onClick={handleAskAgentAboutSelectedSegment}
											disabled={selectedSegmentIndex < 0 || !generatedSegments[selectedSegmentIndex]}
											className="w-full h-[24px] py-[4px] bg-primary-main hover:bg-primary-hover disabled:opacity-40 text-white text-caption rounded-sm transition-colors"
										>
											{t('table.askAgent')}
										</button>
									</div>
								</div>

								{/* Колонна 2 Translation */}
								<div className="flex-1 flex flex-col gap-[4px] min-w-0 ml-[12px]">
									<label className="text-caption text-text-primary">{t('table.translation')}</label>
									<div className="flex-1 min-h-0 relative">
										<textarea 
											className="text-h1-heading w-full h-full bg-surface-secondary border border-border-default rounded-[8px] p-2 text-text-primary resize-none outline-none focus:border-primary-main/50 subtitle-table-scroll font-semibold"
											placeholder={t('table.translationPlaceholder')}
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
											{t('table.totalLength')}: {segEditorTranslation.length}
										</span>
										<span className="truncate">
											{t('table.charsPerSec')}:{' '}
											{(() => {
												const d = parseFloat(segEditorDuration.replace(',', '.'));
												return Number.isFinite(d) && d > 0
													? (segEditorTranslation.length / d).toFixed(1)
													: '–';
											})()}
										</span>
									</div>
								</div>

								{/* Колонна 3 Original Text */}
								<div className="flex-1 flex flex-col gap-[4px] min-w-0">
									<label className="text-caption text-text-primary">{t('table.originalText')}</label>
									<div className="flex-1 min-h-0 relative">
										<textarea 
											className="text-h1-heading w-full h-full bg-surface-secondary border border-border-default rounded-[8px] p-2 text-text-primary resize-none outline-none focus:border-primary-main/50 subtitle-table-scroll font-semibold"
											placeholder={t('table.originalPlaceholder')}
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
											{t('table.totalLength')}: {segEditorOriginal.length}
										</span>
										<span className="truncate">
											{t('table.charsPerSec')}:{' '}
											{(() => {
												const d = parseFloat(segEditorDuration.replace(',', '.'));
												return Number.isFinite(d) && d > 0
													? (segEditorOriginal.length / d).toFixed(1)
													: '–';
											})()}
										</span>
									</div>
								</div>
							</div>

							
						</div>
						
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
												{t('video.preview')}
											</div>
										)}
										{showOriginalVideoSubtitles && (
											<div className="absolute top-12 z-10 w-full text-center px-10 pointer-events-none">
												<span className="text-white text-[17px] font-bold leading-[17px] tracking-[-0.01em] font-inter [text-shadow:0_0_1px_rgba(0,0,0,0.95),0_1px_2px_rgba(0,0,0,0.9),0_2px_8px_rgba(0,0,0,0.75),0_4px_20px_rgba(0,0,0,0.45)]">
													{currentVideoOriginalLine || '\u00A0'}
												</span>
											</div>
										)}
										<div className="absolute bottom-12 z-10 w-full text-center px-10 pointer-events-none">
												<span
													className="text-white text-[17px] font-bold leading-[17px] tracking-[-0.01em] font-inter [text-shadow:0_0_1px_rgba(0,0,0,0.95),0_1px_2px_rgba(0,0,0,0.9),0_2px_8px_rgba(0,0,0,0.75),0_4px_20px_rgba(0,0,0,0.45)]"
												>
														{currentVideoTranslationLine || '\u00A0'}
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
															title={isVideoPlaying ? t('video.pause') : t('video.play')}
															aria-label={isVideoPlaying ? t('video.pause') : t('video.play')}
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
															title={t('video.stop')}
															aria-label={t('video.stop')}
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
																	? t('video.unmute')
																	: t('video.mute')
															}
															aria-label={
																videoMuted || volume < 1e-4
																	? t('video.unmute')
																	: t('video.mute')
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
												<div
													className="flex items-center gap-1 text-[12px] text-body-med text-text-primary shrink-0 tabular-nums whitespace-nowrap"
													style={{ fontVariantNumeric: 'tabular-nums' }}
												>
														<span className="inline-block text-right">
															{formatPlaybackClock(currentPlaybackTime)}
														</span>
														<span className="text-text-secondary/40">/</span>
														<span className="inline-block text-text-secondary">
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
									disabled={!currentProject || !activeSubtitleFileId || selectedSegmentIds.size > 0}
									title={
										selectedSegmentIds.size > 0
											? t('timeline.insertBlockedSelection')
											: timelineInsertRange
												? t('timeline.insertRange', {
														start: timelineInsertRange.start.toFixed(2),
														end: timelineInsertRange.end.toFixed(2)
													})
												: t('timeline.insertPlayhead')
									}
									onClick={() => void handleTimelineInsert()}
									className={`h-[24px] ${timelineBtnPx} py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 disabled:pointer-events-none text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center`}
								>
									{t('timeline.insert')}
								</button>
								<button
									type="button"
									disabled={selectedSegmentIndex < 0 || selectedSegmentIds.size > 0}
									title={
										selectedSegmentIds.size > 0 ? t('timeline.setStartBlocked') : undefined
									}
									onClick={() => handleTimelineSetStart()}
									className={`h-[24px] ${timelineBtnPx} py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 disabled:pointer-events-none text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center`}
								>
									{t('timeline.setStart')}
								</button>
								<button
									type="button"
									disabled={selectedSegmentIndex < 0 || selectedSegmentIds.size > 0}
									title={
										selectedSegmentIds.size > 0 ? t('timeline.setEndBlocked') : undefined
									}
									onClick={() => handleTimelineSetEnd()}
									className={`h-[24px] ${timelineBtnPx} py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 disabled:pointer-events-none text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center`}
								>
									{t('timeline.setEnd')}
								</button>
								<button
									type="button"
									disabled={!currentProject || !activeSubtitleFileId || !canSplitAtPlayhead}
									title={t('timeline.splitTitle')}
									onClick={() => void handleTimelineSplit()}
									className={`h-[24px] ${timelineBtnPx} py-[4px] bg-secondary-main hover:bg-secondary-hover disabled:opacity-40 disabled:pointer-events-none text-caption text-text-primary rounded-sm transition-colors font-medium whitespace-nowrap flex items-center justify-center`}
								>
									{t('timeline.split')}
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
										onContextMenu={(e) => {
											e.preventDefault();
											const ids = Array.from(selectedSegmentIdsRef.current);
											setTimelineContextMenu({
												x: e.clientX,
												y: e.clientY,
												ids,
												range: timelineRubberRange
											});
										}}
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
												const isMultiSel = selectedSegmentIds.has(seg.id);
												const tr = seg.translation?.trim() ?? '';
												return (
													<div
														key={seg.id}
														data-tl-segment
														className={`absolute top-0 z-[11] h-full flex flex-col justify-between pointer-events-auto cursor-pointer ${
															isMultiSel
																? 'border-x-2 border-primary-main bg-primary-main/20'
																: `border-x border-[#A3E635] ${isSel ? 'bg-surface-secondary/10' : 'bg-surface-secondary/5'}`
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
															setSelectedSegmentIds(new Set());
															setTimelineRubberRange(null);
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
											title={t('timeline.zoomOut')}
											aria-label={t('timeline.zoomOut')}
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
											aria-label={t('timeline.zoomSmooth')}
											title={t('timeline.zoomSmooth')}
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
											title={t('timeline.zoomIn')}
											aria-label={t('timeline.zoomIn')}
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

			{/* модалки, z-index сами */}
			{activeModal && (
				<>
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
								onComplete={({ project, segments, subtitleFileId }) => {
									undoSegmentsStackRef.current = [];
									redoSegmentsStackRef.current = [];
									currentProjectRef.current = project;
									setCurrentProject(project);
									setGeneratedSegments(segments);
									const newSub =
										(subtitleFileId
											? project.files.find((f) => f.id === subtitleFileId)
											: null) ?? null;
									const withSeg =
										newSub ??
										project.files.find(
											(f) =>
												f.file_type === 'Subtitle' &&
												f.subtitle_segments &&
												f.subtitle_segments.length > 0
										) ??
										project.files.find(
											(f) => (f.subtitle_segments?.length ?? 0) > 0
										) ??
										null;
									setActiveSubtitleFileId(withSeg?.id ?? null);
									setSelectedSegmentIndex(segments.length > 0 ? 0 : -1);
									resetVideo();
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
								initialEntries={currentProject?.glossary ?? []}
								onSaved={(glossary, changes) => {
									setCurrentProject((p) => {
										if (!p) return null;
										const next = { ...p, glossary };
										currentProjectRef.current = next;
										return next;
									});
									markProjectDirty();

									if (changes.length === 0) return;
									if ((segmentsRef.current ?? []).length === 0) return;
									setGlossaryAgentPrompt(changes);
								}}
								onClose={() => {
									setGlossaryAgentPrompt(null);
									setActiveModal(null);
								}}
							/>
						)}

						{activeModal === 'export' && (
							<ExportModal
								onClose={() => setActiveModal(null)}
								projectPath={currentProject?.path ?? null}
								subtitleFiles={treeFiles.subtitles}
								onPrepareExport={async () => {
									flushSubtitleEditorToProject();
									const cp = currentProjectRef.current;
									if (!cp) return;
									const next: ProjectData = { ...cp, agent_chat: chatMessages };
									currentProjectRef.current = next;
									setCurrentProject(next);
									await projectService.save(next);
								}}
							/>
						)}

						{activeModal === 'settings' && (
							<SettingsModal
								onClose={() => setActiveModal(null)}
								isDarkTheme={isDarkTheme}
								onDarkThemeChange={setIsDarkTheme}
							/>
						)}

						{activeModal === 'findReplace' && (
							<FindReplaceModal
								onClose={() => {
									setFindHighlight(null);
									setActiveModal(null);
								}}
								segments={generatedSegments}
								onSelectMatch={handleFindSelectMatch}
								onSegmentsChange={applyFindReplaceSegments}
							/>
						)}

						{activeModal === 'about' && (
							<AboutModal onClose={() => setActiveModal(null)} />
						)}
				</>
			)}

			{glossaryAgentPrompt && (
				<div className="fixed inset-0 z-[10001] flex items-center justify-center pointer-events-none">
					<div className="pointer-events-auto w-[420px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
						<h2 className="text-[18px] font-semibold text-text-primary mb-2">
							{t('dialog.glossaryUpdateTitle')}
						</h2>
						<p className="text-body-reg text-text-secondary mb-8">{t('dialog.glossaryUpdateConfirm')}</p>
						<div className="flex justify-end gap-3">
							<button
								type="button"
								onClick={() => setGlossaryAgentPrompt(null)}
								className="w-[112px] h-[26px] flex items-center justify-center bg-secondary-main hover:bg-secondary-hover text-text-primary text-body-reg rounded-[5px] transition-colors"
							>
								{t('findReplace.cancel')}
							</button>
							<button
								type="button"
								onClick={() => {
									const changes = glossaryAgentPrompt;
									setGlossaryAgentPrompt(null);
									void applyGlossaryReplacementToSubtitles(changes);
								}}
								className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors shadow-sm"
							>
								{t('findReplace.replace')}
							</button>
						</div>
					</div>
				</div>
			)}

			{timelineContextMenu && (() => {
				const m = timelineContextMenu;
				const hasRange = Boolean(m.range && m.range.end - m.range.start >= MIN_SEGMENT_DURATION);
				const canRetranscribe = hasRange && Boolean(activeVideoAbsolutePath);
				const selectedCount = selectedSegmentIds.size;
				const canDelete = Boolean(activeSubtitleFileId) && (selectedCount > 0 || selectedSegmentIndex >= 0);
				const deleteLabel =
					selectedCount > 1
						? t('timeline.deleteCount', { count: selectedCount })
						: t('timeline.delete');
				return (
					<>
						<div
							className="fixed inset-0 z-[10500]"
							onMouseDown={() => setTimelineContextMenu(null)}
							onContextMenu={(e) => { e.preventDefault(); setTimelineContextMenu(null); }}
						/>
						<div
							className="fixed z-[10501] min-w-[220px] py-1 bg-surface-secondary border border-border-default rounded-[8px] shadow-2xl"
							style={{ left: m.x, top: m.y }}
							onMouseDown={(e) => e.stopPropagation()}
						>
							<button
								type="button"
								disabled={!canRetranscribe}
								onClick={() => {
									if (!canRetranscribe || !m.range) return;
									setTimelineContextMenu(null);
									setRetranscribeError(null);
									setRetranscribeSetup({ range: m.range });
								}}
								className="w-full text-left px-3 py-[6px] text-body-reg text-text-primary hover:bg-secondary-hover disabled:opacity-40 disabled:pointer-events-none"
								title={
									!hasRange
										? t('timeline.retranscribeSelectRange')
										: !activeVideoAbsolutePath
											? t('timeline.retranscribeNoVideo')
											: t('timeline.retranscribeHint')
								}
							>
								{t('timeline.retranscribeRange')}
							</button>
							<button
								type="button"
								disabled={!canDelete}
								onClick={() => {
									if (!canDelete) return;
									setTimelineContextMenu(null);
									void handleDeleteSelectedSubtitle();
								}}
								className="w-full text-left px-3 py-[6px] text-body-reg text-text-primary hover:bg-secondary-hover disabled:opacity-40 disabled:pointer-events-none"
								title={
									!canDelete
										? t('timeline.deleteSelectSubtitle')
										: selectedCount > 0
											? t('timeline.deleteSelectedPlural')
											: t('timeline.deleteSelectedSingle')
								}
							>
								{deleteLabel}
							</button>
						</div>
					</>
				);
			})()}

			{projectFileMenu && (
				<>
					<div
						className="fixed inset-0 z-[10500]"
						onMouseDown={() => setProjectFileMenu(null)}
						onContextMenu={(e) => { e.preventDefault(); setProjectFileMenu(null); }}
					/>
					<div
						data-project-file-menu
						className="fixed z-[10501] min-w-[160px] py-1 bg-surface-secondary border border-border-default rounded-[8px] shadow-2xl"
						style={{ left: projectFileMenu.x, top: projectFileMenu.y }}
						onMouseDown={(e) => e.stopPropagation()}
					>
						<button
							type="button"
							onClick={() => {
								const f = projectFileMenu.file;
								setProjectFileMenu(null);
								void handleDeleteEpisode(f);
							}}
							className="w-full text-left px-3 py-[6px] text-body-reg text-text-primary hover:bg-secondary-hover"
						>
							{t('timeline.delete')}
						</button>
					</div>
				</>
			)}

			{fullTranscribeSetup && (
				<div className="fixed inset-0 flex items-center justify-center z-[10550] pointer-events-none">
					<div className="pointer-events-auto w-[780px] h-[424px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
						<div className="flex items-center justify-end h-6 mb-[24px]">
							<button
								type="button"
								onClick={() => setFullTranscribeSetup(false)}
								className="w-6 h-6 flex items-center justify-center text-text-secondary hover:opacity-70 transition-opacity"
							>
								<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<path d="M18 6L6 18M6 6l12 12" />
								</svg>
							</button>
						</div>
						<div className="grid grid-cols-[1fr_1.2fr] gap-[32px] flex-1 min-h-0 items-start">
							<div className="flex flex-col pt-0">
								<h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[20px] text-text-primary mb-[24px]">
									{t('wizard.step3Title')}
								</h1>
								<p className="text-body-reg text-text-secondary">{t('wizard.step3Desc')}</p>
							</div>
							<div className="flex flex-col gap-[12px] h-full">
								<div className="flex flex-col gap-[8px]">
									<label className="text-caption text-text-primary">{t('retranscribe.sourceLanguage')}</label>
									<select
										value={retranscribeLanguage}
										onChange={(e) => setRetranscribeLanguage(e.target.value)}
										className="w-full h-[42px] px-3 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary"
									>
										{RETRANSCRIBE_LANGUAGE_OPTIONS.map((lang) => (
											<option key={lang} value={lang}>{lang}</option>
										))}
									</select>
								</div>
								<div className="flex-1 flex flex-col gap-[8px] min-h-0">
									<label className="text-caption text-text-primary">{t('wizard.prompt')}</label>
									<textarea
										value={retranscribePrompt}
										onChange={(e) => setRetranscribePrompt(e.target.value)}
										className="flex-1 min-h-0 w-full p-4 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary resize-none overflow-y-auto subtitle-table-scroll focus:outline-none focus:border-text-primary transition-colors placeholder:text-text-secondary/50"
										placeholder={t('wizard.step3Placeholder')}
									/>
								</div>
							</div>
						</div>
						<div className="flex justify-end gap-3 mt-[32px]">
							<button
								type="button"
								onClick={() => setFullTranscribeSetup(false)}
								className="w-[112px] h-[26px] flex items-center justify-center bg-secondary-main hover:bg-secondary-hover text-text-primary text-body-reg rounded-[5px] transition-colors"
							>
								{t('wizard.cancel')}
							</button>
							<button
								type="button"
								onClick={() => {
									setFullTranscribeSetup(false);
									void handleFullTranscribe({
										sourceLanguage: retranscribeLanguage,
										userPrompt: retranscribePrompt
									});
								}}
								className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors shadow-sm"
							>
								{t('menu.transcribe')}
							</button>
						</div>
					</div>
				</div>
			)}

			{aiTranslateSetup && (
				<div className="fixed inset-0 flex items-center justify-center z-[10550] pointer-events-none">
					<div className="pointer-events-auto w-[780px] h-[424px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
						<div className="flex items-center justify-end h-6 mb-[24px]">
							<button
								type="button"
								onClick={() => setAiTranslateSetup(false)}
								className="w-6 h-6 flex items-center justify-center text-text-secondary hover:opacity-70 transition-opacity"
							>
								<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<path d="M18 6L6 18M6 6l12 12" />
								</svg>
							</button>
						</div>
						<div className="grid grid-cols-[1fr_1.2fr] gap-[32px] flex-1 min-h-0 items-start">
							<div className="flex flex-col pt-0">
								<h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[20px] text-text-primary mb-[24px]">
									{t('wizard.step5Title')}
								</h1>
								<p className="text-body-reg text-text-secondary">{t('wizard.step5Desc')}</p>
							</div>
							<div className="flex flex-col gap-[12px] h-full">
								<div className="flex flex-col gap-[8px]">
									<label className="text-caption text-text-primary">{t('wizard.targetLanguage')}</label>
									<select
										value={aiTranslateTargetLanguage}
										onChange={(e) => setAiTranslateTargetLanguage(e.target.value)}
										className="w-full h-[42px] px-3 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary"
									>
										{RETRANSCRIBE_LANGUAGE_OPTIONS.map((lang) => (
											<option key={lang} value={lang}>{lang}</option>
										))}
									</select>
								</div>
								<div className="flex-1 flex flex-col gap-[8px] min-h-0">
									<label className="text-caption text-text-primary">{t('wizard.prompt')}</label>
									<textarea
										value={aiTranslatePrompt}
										onChange={(e) => setAiTranslatePrompt(e.target.value)}
										className="flex-1 min-h-0 w-full p-4 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary resize-none overflow-y-auto subtitle-table-scroll focus:outline-none focus:border-text-primary transition-colors placeholder:text-text-secondary/50"
										placeholder={t('wizard.step5Placeholder')}
									/>
								</div>
							</div>
						</div>
						<div className="flex justify-end gap-3 mt-[32px]">
							<button
								type="button"
								onClick={() => setAiTranslateSetup(false)}
								className="w-[112px] h-[26px] flex items-center justify-center bg-secondary-main hover:bg-secondary-hover text-text-primary text-body-reg rounded-[5px] transition-colors"
							>
								{t('wizard.cancel')}
							</button>
							<button
								type="button"
								onClick={() => {
									setAiTranslateSetup(false);
									void handleAiTranslate({
										targetLanguage: aiTranslateTargetLanguage,
										stylePrompt: aiTranslatePrompt
									});
								}}
								className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors shadow-sm"
							>
								{t('menu.translate')}
							</button>
						</div>
					</div>
				</div>
			)}

			{retranscribeSetup && (
				<div className="fixed inset-0 flex items-center justify-center z-[10550] pointer-events-none">
					<div className="pointer-events-auto w-[780px] h-[424px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
						<div className="flex items-center justify-end h-6 mb-[24px]">
							<button
								type="button"
								onClick={() => setRetranscribeSetup(null)}
								className="w-6 h-6 flex items-center justify-center text-text-secondary hover:opacity-70 transition-opacity"
							>
								<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<path d="M18 6L6 18M6 6l12 12" />
								</svg>
							</button>
						</div>

						<div className="grid grid-cols-[1fr_1.2fr] gap-[32px] flex-1 min-h-0 items-start">
							<div className="flex flex-col pt-0">
								<h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[20px] text-text-primary mb-[24px]">
									{t('retranscribe.title')}
								</h1>
								<p className="text-body-reg text-text-secondary">
									{t('retranscribe.desc')}
								</p>
							</div>
							<div className="flex flex-col gap-[12px] h-full">
								<div className="flex flex-col gap-[8px]">
									<label className="text-caption text-text-primary">{t('retranscribe.sourceLanguage')}</label>
									<select
										value={retranscribeLanguage}
										onChange={(e) => setRetranscribeLanguage(e.target.value)}
										className="w-full h-[42px] px-3 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary"
									>
										{RETRANSCRIBE_LANGUAGE_OPTIONS.map((lang) => (
											<option key={lang} value={lang}>{lang}</option>
										))}
									</select>
								</div>
								<div className="flex-1 flex flex-col gap-[8px] min-h-0">
									<label className="text-caption text-text-primary">{t('retranscribe.prompt')}</label>
									<textarea
										value={retranscribePrompt}
										onChange={(e) => setRetranscribePrompt(e.target.value)}
										className="flex-1 min-h-0 w-full p-4 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary resize-none overflow-y-auto subtitle-table-scroll focus:outline-none focus:border-text-primary transition-colors placeholder:text-text-secondary/50"
										placeholder={t('retranscribe.promptPlaceholder')}
									/>
								</div>
							</div>
						</div>

						<div className="flex justify-end gap-3 mt-[32px]">
							<button
								type="button"
								onClick={() => setRetranscribeSetup(null)}
								className="w-[112px] h-[26px] flex items-center justify-center bg-secondary-main hover:bg-secondary-hover text-text-primary text-body-reg rounded-[5px] transition-colors"
							>
								{t('retranscribe.cancel')}
							</button>
							<button
								type="button"
								onClick={() => {
									const range = retranscribeSetup.range;
									setRetranscribeSetup(null);
									void handleRetranscribeRange(range, {
										sourceLanguage: retranscribeLanguage,
										userPrompt: retranscribePrompt
									});
								}}
								className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors shadow-sm"
							>
								{t('retranscribe.retranscribe')}
							</button>
						</div>
					</div>
				</div>
			)}

			{retranscribeBusy && (
				<div className="fixed inset-0 flex items-center justify-center z-[10600] pointer-events-none">
					<div className="pointer-events-auto w-[780px] h-[300px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
						<div className="grid grid-cols-[1fr_1.2fr] gap-[32px] flex-1 min-h-0 items-start">
							<div className="flex flex-col pt-0">
								<h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[20px] text-text-primary mb-[24px]">
									{t('retranscribe.working')}
								</h1>
								<p className="text-body-reg text-text-secondary">
									{retranscribeBusy.stage === 'audio' && t('retranscribe.stageAudio')}
									{retranscribeBusy.stage === 'transcribe' && t('retranscribe.stageTranscribe')}
									{retranscribeBusy.stage === 'translate' && t('retranscribe.stageTranslate')}
									{retranscribeBusy.stage === 'apply' && t('retranscribe.stageApply')}
								</p>
							</div>
							<div className="flex items-center justify-center h-full">
								<div className="w-[120px] h-[120px] border-[6px] border-border-default border-t-progress-bar rounded-full animate-spin" />
							</div>
						</div>
					</div>
				</div>
			)}

			{retranscribeError && (
				<div className="fixed inset-0 flex items-center justify-center z-[10600] pointer-events-none">
					<div className="pointer-events-auto w-[480px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-6 flex flex-col gap-4 select-none">
						<h2 className="text-[18px] font-semibold text-text-primary">{t('retranscribe.errorTitle')}</h2>
						<p className="text-body-reg text-text-secondary whitespace-pre-wrap break-words">
							{retranscribeError}
						</p>
						<div className="flex justify-end">
							<button
								type="button"
								onClick={() => setRetranscribeError(null)}
								className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors"
							>
								{t('retranscribe.ok')}
							</button>
						</div>
					</div>
				</div>
			)}

			{aiBusy && (
				<div className="fixed inset-0 flex items-center justify-center z-[10600] pointer-events-none">
					<div className="pointer-events-auto w-[780px] h-[300px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
						<div className="grid grid-cols-[1fr_1.2fr] gap-[32px] flex-1 min-h-0 items-start">
							<div className="flex flex-col pt-0">
								<h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[20px] text-text-primary mb-[24px]">
									{t('wizard.working')}
								</h1>
								<p className="text-body-reg text-text-secondary">
									{aiBusy.operation === 'translate'
										? t('wizard.translateWait')
										: t('wizard.transcribeWait')}
								</p>
							</div>
							<div className="flex items-center justify-center h-full">
								<div className="w-[120px] h-[120px] border-[6px] border-border-default border-t-progress-bar rounded-full animate-spin" />
							</div>
						</div>
					</div>
				</div>
			)}

			{aiMenuError && (
				<div className="fixed inset-0 flex items-center justify-center z-[10600] pointer-events-none">
					<div className="pointer-events-auto w-[480px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-6 flex flex-col gap-4 select-none">
						<h2 className="text-[18px] font-semibold text-text-primary">{t('ai.errorTitle')}</h2>
						<p className="text-body-reg text-text-secondary whitespace-pre-wrap break-words">
							{aiMenuError}
						</p>
						<div className="flex justify-end">
							<button
								type="button"
								onClick={() => setAiMenuError(null)}
								className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors"
							>
								{t('ai.ok')}
							</button>
						</div>
					</div>
				</div>
			)}

		</div>	
    
  );
}