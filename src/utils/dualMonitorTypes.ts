// Общие типы и константы для синхронизации режима двух мониторов

export const MAIN_WINDOW_LABEL = 'main';
export const VIEWER_WINDOW_LABEL = 'viewer-window';

// События main -> viewer-window
export const VIEWER_EVENT_STATE = 'viewer://state';
export const VIEWER_EVENT_TICK = 'viewer://tick';
export const VIEWER_EVENT_OVERLAY = 'viewer://overlay';
export const VIEWER_EVENT_SEEK = 'viewer://seek';

// События viewer-window -> main
export const VIEWER_EVENT_READY = 'viewer://ready';
export const VIEWER_CMD_PLAY_PAUSE = 'viewer://cmd/playpause';
export const VIEWER_CMD_STOP = 'viewer://cmd/stop';
export const VIEWER_CMD_SEEK = 'viewer://cmd/seek';
export const VIEWER_CMD_VOLUME = 'viewer://cmd/volume';
export const VIEWER_CMD_MUTE_TOGGLE = 'viewer://cmd/mutetoggle';

export type ViewerLabels = {
	preparing: string;
	preview: string;
	play: string;
	pause: string;
	stop: string;
	mute: string;
	unmute: string;
	emptyTitle: string;
};

export type ViewerStatePayload = {
	src: string | null;
	sourceKey: string | null;
	time: number;
	duration: number;
	playing: boolean;
	volume: number;
	muted: boolean;
	showOriginal: boolean;
	preparing: boolean;
	overlay: {
		translation: string;
		original: string;
	};
	labels: ViewerLabels;
};

export type ViewerTickPayload = {
	time: number;
	duration: number;
	playing: boolean;
};

export type ViewerOverlayPayload = {
	translation: string;
	original: string;
	showOriginal: boolean;
};

export type ViewerSeekPayload = {
	time: number;
};

export type ViewerSeekCmdPayload = {
	ratio: number;
	final: boolean;
};

export type ViewerVolumeCmdPayload = {
	volume: number;
};
