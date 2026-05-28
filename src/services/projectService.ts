import { invoke } from '@tauri-apps/api/core';

export const AI_OPERATION_CANCELLED = 'AI_OPERATION_CANCELLED';

export function isAiOperationCancelled(error: unknown): boolean {
  const msg =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';
  return msg === AI_OPERATION_CANCELLED || msg.includes(AI_OPERATION_CANCELLED);
}

export interface RecentProject {
  path: string;
  name: string;
  last_opened: string;
}

export type SpeakerGender = 'male' | 'female' | 'unknown';

export interface SubtitleSegment {
  id: number;
  start: number;
  end: number;
  duration: number;
  text: string;
  translation?: string | null;
  speaker_gender?: SpeakerGender | null; // авто после транскрибации
}

export interface ProjectFile {
  id: string;
  name: string;
  file_type: 'Video' | 'Subtitle' | 'Config';
  path: string;
  duration?: number | null;
  subtitle_segments?: SubtitleSegment[] | null;
  linked_file_id?: string | null; // видео <-> саб
  // краткий пересказ эпизода (3-4 предложения), нужен агенту для контекста
  summary?: string | null;
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
  agent_chat?: unknown[];
  created_at: string;
  updated_at: string;
}

// черновик глоссария от auto_generate
export interface GlossaryTermGenerated {
  source: string;
  target: string;
  frequency: number;
  confidence: number;
  category?: string;
  meaning_context?: string | null;
}

export interface AutoGlossaryOptions {
  min_frequency?: number;
  max_terms?: number;
  target_language: string;
  contextPrompt?: string;
  // язык поля meaning_context (если не задан - совпадает с target_language)
  meaningContextLanguage?: string;
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

  // недавние проекты
  getRecent: async (): Promise<RecentProject[]> => {
    return await invoke('list_recent_projects');
  },

  // открыть проект
  open: async (path: string): Promise<ProjectData> => {
    return await invoke('open_project', { path });
  },

  // новый проект
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

  extractAudioRange: async (
    videoPath: string,
    startSeconds: number,
    endSeconds: number,
    outputPath: string
  ): Promise<string> => {
    return await invoke('extract_audio_range', { videoPath, startSeconds, endSeconds, outputPath });
  },

  transcribeAudio: async (
    filePath: string,
    language?: string,
    prompt?: string,
    glossary?: GlossaryEntry[],
    skipVad?: boolean
  ): Promise<SubtitleSegment[]> => {
    return await invoke('transcribe_audio', { filePath, language, prompt, glossary, skipVad });
  },

  transcribeAudioGpt4o: async (
    filePath: string,
    language?: string,
    prompt?: string,
    glossary?: GlossaryEntry[]
  ): Promise<string> => {
    return await invoke('transcribe_audio_gpt4o', { filePath, language, prompt, glossary });
  },

  cancelAiOperation: async (): Promise<void> => {
    await invoke('cancel_ai_operation');
  },

  importExistingSubtitles: async (
    subtitlePath: string,
    projectPath: string,
    fileId: string
  ): Promise<SubtitleSegment[]> => {
    return await invoke('import_existing_subtitles', { subtitlePath, format: null, projectPath, fileId });
  },

  parseSubtitleFile: async (filePath: string): Promise<SubtitleSegment[]> => {
    return await invoke('parse_subtitle_file', { filePath, format: null });
  },

  deleteEpisode: async (projectPath: string, videoId: string): Promise<ProjectData> => {
    return await invoke('delete_episode_from_project', { projectPath, videoId });
  },

  removeFileFromProject: async (
    projectPath: string,
    fileId: string,
    deletePhysicalFile: boolean
  ): Promise<void> => {
    return await invoke('remove_file_from_project', { projectPath, fileId, deletePhysicalFile });
  },

  renameProjectFile: async (
    projectPath: string,
    fileId: string,
    newBaseName: string
  ): Promise<ProjectData> => {
    return await invoke('rename_project_file', { projectPath, fileId, newBaseName });
  },

  deleteProjectFileArtifact: async (
    projectPath: string,
    relativePath: string
  ): Promise<boolean> => {
    return await invoke('delete_project_file_artifact', { projectPath, relativePath });
  },

  getGlossary: async (projectPath: string): Promise<GlossaryEntry[]> => {
    return await invoke('get_glossary', { projectPath });
  },

  updateGlossary: async (projectPath: string, entries: GlossaryEntry[]): Promise<void> => {
    return await invoke('update_glossary', { projectPath, entries });
  },

  // черновик глоссария (gpt)
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
          : {}),
        ...(options.meaningContextLanguage?.trim()
          ? { meaning_context_language: options.meaningContextLanguage.trim() }
          : {})
      }
    });
  },

  // пересказ эпизода (3-4 предложения) на target language
  // нужен агенту чтобы не выгружать полный текст эпизода в каждый запрос
  summarizeEpisode: async (
    segments: SubtitleSegment[],
    targetLanguage: string | null
  ): Promise<string> => {
    return await invoke('summarize_episode', {
      segments,
      targetLanguage: targetLanguage ?? null
    });
  },

  // явный перевод/транслитерация терминов глоссария
  // translate_batch на одиночных словах оставлял имена в латинице, отдельная команда надёжнее
  translateGlossaryTerms: async (
    terms: { source: string; context?: string | null }[],
    targetLanguage: string,
    stylePrompt?: string | null
  ): Promise<{ source: string; target: string }[]> => {
    return await invoke('translate_glossary_terms', {
      terms,
      targetLanguage,
      stylePrompt: stylePrompt ?? null
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

  insertSubtitleSegment: async (
    projectPath: string,
    fileId: string,
    start: number,
    end: number
  ): Promise<{ segments: SubtitleSegment[]; inserted_id: number }> => {
    return await invoke('insert_subtitle_segment', { projectPath, fileId, start, end });
  },

  deleteSubtitleSegment: async (
    projectPath: string,
    fileId: string,
    segmentId: number
  ): Promise<{ segments: SubtitleSegment[] }> => {
    return await invoke('delete_subtitle_segment', { projectPath, fileId, segmentId });
  },

  exportSubtitles: async (
    projectPath: string,
    fileId: string,
    format: string,
    outputPath: string
  ): Promise<string> => {
    return await invoke('export_subtitles', { projectPath, fileId, format, outputPath });
  },

  getCachedWaveform: async (
    mediaPath: string,
    cacheJsonPath: string,
    cachePngPath: string
  ): Promise<{ peaks: number[]; sample_rate: number; duration: number } | null> => {
    return await invoke('get_cached_waveform', {
      mediaPath,
      cacheJsonPath,
      cachePngPath
    });
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

  extractVideoPreviewFrame: async (videoPath: string, timeSecs: number): Promise<string> => {
    return await invoke('extract_video_preview_frame', { videoPath, timeSecs });
  },

  ensureFaststartPlaybackProxy: async (videoPath: string): Promise<string> => {
    return await invoke('ensure_faststart_playback_proxy', { videoPath });
  },

  listProjectDirectoryFiles: async (
    projectPath: string
  ): Promise<{ relative_path: string; name: string; is_dir?: boolean }[]> => {
    return await invoke('list_project_directory_files', { projectPath });
  }
};