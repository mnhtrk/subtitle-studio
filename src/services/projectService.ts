import { invoke } from '@tauri-apps/api/core';

export interface RecentProject {
  path: string;
  name: string;
  last_opened: string;
}

export interface SubtitleSegment {
  id: number;
  start: number;
  end: number;
  duration: number;
  text: string;
  translation?: string | null;
}

export interface ProjectFile {
  id: string;
  name: string;
  file_type: 'Video' | 'Subtitle' | 'Config';
  path: string;
  duration?: number | null;
  subtitle_segments?: SubtitleSegment[] | null;
  created_at: string;
  updated_at: string;
}

export interface GlossaryEntry {
  id: string;
  source: string;
  target: string;
  description?: string | null;
  context?: string | null;
}

export interface ProjectData {
  id: string;
  name: string;
  path: string;
  target_language: string;
  files: ProjectFile[];
  glossary: GlossaryEntry[];
  created_at: string;
  updated_at: string;
}

/** Ответ `auto_generate_glossary` (черновые термины перед слиянием в проект). */
export interface GlossaryTermGenerated {
  source: string;
  target: string;
  frequency: number;
  confidence: number;
  /** character | location | organization | concept | title | other */
  category?: string;
}

export interface AutoGlossaryOptions {
  min_frequency?: number;
  max_terms?: number;
  target_language: string;
  /** Промпт шага «Context» в мастере (персонажи, сеттинг) — учитывается при автоглоссарии. */
  contextPrompt?: string;
}

export interface TranslationResult {
  id: number;
  translated_text: string;
}

export interface SegmentUpdates {
  text?: string;
  translation?: string;
  start?: number;
  end?: number;
}

export const projectService = {
  getApiKeyStatus: async (): Promise<boolean> => {
    return await invoke('get_api_key_status');
  },

  saveApiKey: async (key: string): Promise<void> => {
    return await invoke('save_api_key', { key });
  },

  // Get recent projects for welcome modal
  getRecent: async (): Promise<RecentProject[]> => {
    return await invoke('list_recent_projects');
  },

  // Open existing project
  open: async (path: string): Promise<ProjectData> => {
    return await invoke('open_project', { path });
  },

  // Create new project
  create: async (name: string, path: string, targetLanguage: string) => {
    return await invoke('create_project', { 
      name, 
      path, 
      targetLanguage
    });
  },

  save: async (project: ProjectData): Promise<void> => {
    return await invoke('save_project', { project });
  },

  importMedia: async (projectPath: string, filePath: string): Promise<ProjectFile> => {
    return await invoke('import_media', { projectPath, filePath });
  },

  extractAudioFromVideo: async (videoPath: string, outputPath: string): Promise<string> => {
    return await invoke('extract_audio_from_video', { videoPath, outputPath });
  },

  transcribeAudio: async (filePath: string, language?: string, prompt?: string): Promise<SubtitleSegment[]> => {
    return await invoke('transcribe_audio', { filePath, language, prompt });
  },

  importExistingSubtitles: async (
    subtitlePath: string,
    projectPath: string,
    fileId: string
  ): Promise<SubtitleSegment[]> => {
    return await invoke('import_existing_subtitles', { subtitlePath, format: null, projectPath, fileId });
  },

  getGlossary: async (projectPath: string): Promise<GlossaryEntry[]> => {
    return await invoke('get_glossary', { projectPath });
  },

  updateGlossary: async (projectPath: string, entries: GlossaryEntry[]): Promise<void> => {
    return await invoke('update_glossary', { projectPath, entries });
  },

  /** Черновой глоссарий по частым словам + GPT (нужен API key). */
  autoGenerateGlossary: async (
    segments: SubtitleSegment[],
    options: AutoGlossaryOptions
  ): Promise<GlossaryTermGenerated[]> => {
    return await invoke('auto_generate_glossary', {
      segments,
      options: {
        min_frequency: options.min_frequency ?? 2,
        max_terms: options.max_terms ?? 45,
        target_language: options.target_language,
        ...(options.contextPrompt?.trim()
          ? { context_prompt: options.contextPrompt.trim() }
          : {})
      }
    });
  },

  translateBatch: async (
    segments: SubtitleSegment[],
    targetLanguage: string,
    stylePrompt: string,
    glossary: GlossaryEntry[] = []
  ): Promise<TranslationResult[]> => {
    return await invoke('translate_batch', {
      segments,
      targetLanguage,
      glossary,
      stylePrompt
    });
  },

  updateSubtitleSegment: async (
    projectPath: string,
    fileId: string,
    segmentId: number,
    updates: SegmentUpdates
  ): Promise<void> => {
    return await invoke('update_subtitle_segment', {
      projectPath,
      fileId,
      segmentId,
      updates
    });
  },

  /** Вставить пустой сегмент [start, end], список на диске пересортирован по времени. */
  insertSubtitleSegment: async (
    projectPath: string,
    fileId: string,
    start: number,
    end: number
  ): Promise<{ segments: SubtitleSegment[]; inserted_id: number }> => {
    return await invoke('insert_subtitle_segment', { projectPath, fileId, start, end });
  },

  exportSubtitles: async (
    projectPath: string,
    fileId: string,
    format: string,
    outputPath: string
  ): Promise<string> => {
    return await invoke('export_subtitles', { projectPath, fileId, format, outputPath });
  },

  generateWaveform: async (
    audioPath: string,
    outputPath: string,
    resolution?: number
  ): Promise<{ peaks: number[]; sample_rate: number; duration: number }> => {
    return await invoke('generate_waveform', { audioPath, outputPath, resolution });
  },

  generateWaveformPng: async (
    mediaPath: string,
    outputPngPath: string,
    width?: number,
    height?: number
  ): Promise<void> => {
    await invoke('generate_waveform_png', {
      mediaPath,
      outputPngPath,
      width,
      height
    });
  },

  probeMediaDuration: async (mediaPath: string): Promise<number> => {
    return await invoke('probe_media_duration', { mediaPath });
  },

  listProjectDirectoryFiles: async (
    projectPath: string
  ): Promise<{ relative_path: string; name: string }[]> => {
    return await invoke('list_project_directory_files', { projectPath });
  }
};