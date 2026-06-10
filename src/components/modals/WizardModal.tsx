import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { DraggableModalShell } from './DraggableModalShell';
import { GlossaryModal } from './GlossaryModal';
import { open } from '@tauri-apps/plugin-dialog';
import {
  projectService,
  ProjectData,
  ProjectFile,
  GlossaryEntry,
  SubtitleSegment,
  isAiOperationCancelled
} from '../../services/projectService';
import {
  applyAutoGlossaryToProject,
  mergePromptHintsIntoGlossary,
  parseTranslationHintsFromPrompt,
  resolveIsoLanguage,
  translateGlossaryTargetsInProject
} from '../../utils/glossary';

function joinProjectPath(base: string, ...parts: string[]): string {
  const a = base.replace(/[/\\]+$/, '');
  const rest = parts.map((p) => p.replace(/^[/\\]+/, '').replace(/\\/g, '/')).join('/');
  return `${a}/${rest}`;
}

// после транскрипции: сегменты, srt на диск, видео+саб связаны
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

interface WizardModalProps {
  onClose: () => void;
  projectPath?: string;
  onComplete: (payload: { project: ProjectData; segments: SubtitleSegment[]; subtitleFileId: string | null }) => void;
}

const languageOptions = [
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
const whisperLanguageCodes: Record<string, string> = {
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

function resolveLanguageLabel(codeOrName: string): string {
  const raw = codeOrName.trim();
  if (!raw) return 'English';
  const byName = languageOptions.find((l) => l.toLowerCase() === raw.toLowerCase());
  if (byName) return byName;
  const byIso = languageOptions.find((l) => whisperLanguageCodes[l] === raw.toLowerCase());
  return byIso ?? raw;
}

export const WizardModal: React.FC<WizardModalProps> = ({ onClose, projectPath, onComplete }) => {
  const { t } = useI18n();
  const [currentStep, setCurrentStep] = useState(1);
  const [sourceType, setSourceType] = useState<'ai' | 'file'>('ai');
  const [sourceLanguage, setSourceLanguage] = useState('French');
  const [targetLanguage, setTargetLanguage] = useState('English');
  const [videoPath, setVideoPath] = useState('');
  const [subtitlePath, setSubtitlePath] = useState('');
  const [contextPrompt, setContextPrompt] = useState('');
  const [translationPrompt, setTranslationPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [workingSegments, setWorkingSegments] = useState<SubtitleSegment[]>([]);
  const [workingFileId, setWorkingFileId] = useState<string | null>(null);
  // глоссарий уже сгенерирован и переведён - можно открыть для ручной правки
  const [glossaryReady, setGlossaryReady] = useState<GlossaryEntry[] | null>(null);
  const [glossaryModalOpen, setGlossaryModalOpen] = useState(false);
  const [isPreparingGlossary, setIsPreparingGlossary] = useState(false);
  // активный фоновый запрос на генерацию глоссария
  // нужен чтобы не дублировать вызов если фон ещё идёт, а пользователь жмёт edit glossary
  const glossaryPromiseRef = useRef<Promise<GlossaryEntry[]> | null>(null);
  const totalSteps = 7;
  const cancelRef = useRef(false);

  // целевой язык шага перевода = язык проекта из project.json
  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    void (async () => {
      try {
        const opened = await projectService.open(projectPath);
        if (cancelled) return;
        const label = resolveLanguageLabel(opened.target_language ?? 'English');
        setTargetLanguage(label);
      } catch (e) {
        console.warn('[Wizard] load project target_language failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const isFileMode = sourceType === 'file';

  const nextStep = () => setCurrentStep((prev) => {
    let next = prev + 1;
    if (isFileMode && next === 3) next = 4;
    return Math.min(next, totalSteps);
  });
  const prevStep = () => setCurrentStep((prev) => {
    let next = prev - 1;
    if (isFileMode && next === 3) next = 2;
    return Math.max(next, 1);
  });

  const progressWidth = `${(currentStep / totalSteps) * 100}%`;
  const isLoaderStep = currentStep === 4 || currentStep === 6;

  const canProceedFromStep =
    currentStep === 1
      ? Boolean(videoPath.trim())
      : currentStep === 2 && isFileMode
        ? Boolean(subtitlePath.trim())
        : true;

  const handleCancelLoader = () => {
    cancelRef.current = true;
    void projectService.cancelAiOperation();
    setIsProcessing(false);
    setErrorText('');
    if (currentStep === 4) {
      setCurrentStep(isFileMode ? 2 : 3);
    } else if (currentStep === 6) {
      setCurrentStep(5);
    }
  };

  const ensureProject = () => {
    if (!projectPath) {
      throw new Error('������� ������ ��� ������ ������');
    }
  };

  const saveSegmentsToProject = async (segments: SubtitleSegment[], fileId: string) => {
    ensureProject();
    const project = await projectService.open(projectPath!);
    const nextFiles = project.files.map((file) =>
      file.id === fileId
        ? {
            ...file,
            subtitle_segments: segments,
            updated_at: new Date().toISOString()
          }
        : file
    );

    const updatedProject: ProjectData = {
      ...project,
      files: nextFiles,
      updated_at: new Date().toISOString()
    };

    await projectService.save(updatedProject);
    return updatedProject;
  };

  const handleSelectVideo = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      title: 'Select video file',
      filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm'] }]
    });
    if (selected && typeof selected === 'string') {
      setVideoPath(selected);
      console.log('[Wizard] Step 1: video selected', selected);
    }
  };

  const handleSelectSubtitle = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      title: 'Select subtitle file',
      filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa', 'txt'] }]
    });
    if (selected && typeof selected === 'string') {
      setSubtitlePath(selected);
      console.log('[Wizard] Step 2: subtitle file selected', selected);
    }
  };

  const runTranscription = async () => {
    ensureProject();
    if (!videoPath) {
      throw new Error('����� ������� ���������');
    }

    console.log('[Wizard] Step 3.5: transcription started');
    cancelRef.current = false;
    setIsProcessing(true);
    setErrorText('');
    setCurrentStep(4);

    let tempAudioRel: string | null = null;
    try {
      console.log('[Wizard][subtitle-file] importing video to project');
      const importedVideo: ProjectFile = await projectService.importMedia(projectPath!, videoPath);
      if (cancelRef.current) return;
      console.log('[Wizard][subtitle-file] video imported:', importedVideo.id);

      let segments: SubtitleSegment[] = [];
      if (sourceType === 'ai') {
        const hasApiKey = await projectService.getApiKeyStatus();
        if (!hasApiKey) {
          throw new Error('OpenAI API key is not set. Please activate the app first.');
        }

        const audioFileName = `wizard_audio_${Date.now()}.mp3`;
        tempAudioRel = `config/${audioFileName}`;
        const outputAudioPath = `${projectPath!}/${tempAudioRel}`;
        console.log('[Wizard] Extracting audio', outputAudioPath);
        const audioPath = await projectService.extractAudioFromVideo(videoPath, outputAudioPath);
        if (cancelRef.current) return;

        const whisperLanguage = whisperLanguageCodes[sourceLanguage] ?? 'en';
        const projectForPrompt = await projectService.open(projectPath!);
        const userPrompt = contextPrompt.trim();
        console.log('[Wizard] Whisper language:', whisperLanguage);
        console.log('[Wizard] Calling OpenAI Whisper');
        segments = await projectService.transcribeAudio(
          audioPath,
          whisperLanguage,
          userPrompt.length > 0 ? userPrompt : undefined,
          projectForPrompt.glossary ?? []
        );
      } else {
        if (!subtitlePath) {
          throw new Error('����� ������� ������� ���� ���������');
        }
        console.log('[Wizard][subtitle-file] parsing subtitle file:', subtitlePath);
        segments = await projectService.parseSubtitleFile(subtitlePath);
        if (cancelRef.current) return;
        console.log('[Wizard][subtitle-file] parsed segments:', segments.length);
      }

      if (cancelRef.current) return;

      console.log('[Wizard][subtitle-file] creating paired subtitle track');
      const { project: pairedProject, subtitleFileId } = await finalizeEpisodePairInProject(
        projectPath!,
        importedVideo.id,
        segments
      );
      console.log('[Wizard][subtitle-file] paired subtitle track:', subtitleFileId);
      setWorkingFileId(subtitleFileId);
      let updatedProject = pairedProject;

      if (sourceType === 'ai') {
        const glossaryLangIso =
          resolveIsoLanguage(sourceLanguage) ??
          resolveIsoLanguage(updatedProject.target_language) ??
          resolveIsoLanguage(targetLanguage) ??
          'en';
        // meaning_context всегда на target-языке проекта
        const meaningCtxIso =
          resolveIsoLanguage(updatedProject.target_language) ??
          resolveIsoLanguage(targetLanguage) ??
          'en';
        // шаг 1: source-термины + meaning_context (target пуст)
        updatedProject = await applyAutoGlossaryToProject(projectPath!, segments, {
          targetLanguageIso: glossaryLangIso,
          meaningContextLanguageIso: meaningCtxIso,
          contextPrompt: contextPrompt,
          fillTranslation: false
        });
        if (cancelRef.current) return;
        // шаг 2: переводим target-колонку на язык проекта (Griselda -> Гризельда и т.п.)
        // без второго auto_generate - только translate_glossary_terms
        const effectiveTargetLanguage =
          (updatedProject.target_language ?? '').trim() || targetLanguage;
        if (effectiveTargetLanguage) {
          const combinedPrompt = [translationPrompt, contextPrompt]
            .map((s) => s.trim())
            .filter(Boolean)
            .join('\n\n');
          try {
            updatedProject = await translateGlossaryTargetsInProject(
              projectPath!,
              effectiveTargetLanguage,
              combinedPrompt
            );
          } catch (err) {
            console.warn('[Wizard] translateGlossaryTargetsInProject failed', err);
          }
        }
      }

      if (cancelRef.current) return;

      setWorkingSegments(segments);
      console.log('[Wizard] Transcription done, segments:', segments.length);

      // глоссарий уже полностью готов (original + meaning_context + перевод)
      // подсасываем в state чтобы кнопка «Редактировать глоссарий» открывалась мгновенно
      const promptHints = parseTranslationHintsFromPrompt(
        [translationPrompt, contextPrompt].filter(Boolean).join('\n\n')
      );
      let readyGlossary = updatedProject.glossary ?? [];
      if (promptHints.length > 0) {
        readyGlossary = mergePromptHintsIntoGlossary(readyGlossary, promptHints);
        updatedProject = { ...updatedProject, glossary: readyGlossary };
        try {
          await projectService.save(updatedProject);
        } catch (err) {
          console.warn('[Wizard] save glossary with prompt hints failed', err);
        }
      }
      glossaryPromiseRef.current = null;
      setGlossaryReady(readyGlossary);

      setCurrentStep(5);
      onComplete({ project: updatedProject, segments, subtitleFileId });
    } catch (error) {
      if (cancelRef.current || isAiOperationCancelled(error)) return;
      throw error;
    } finally {
      if (tempAudioRel && projectPath) {
        projectService
          .deleteProjectFileArtifact(projectPath, tempAudioRel)
          .catch((err) => console.warn('[Wizard] cleanup audio failed:', err));
      }
      setIsProcessing(false);
    }
  };

  // подсосать актуальный глоссарий для runTranslation
  // если уже есть в state - отдаём как есть; иначе читаем из project.json
  // дополнительно догоняем перевод любых записей с пустым target (на случай если язык поменяли только что)
  const ensureGlossaryReady = async (): Promise<GlossaryEntry[]> => {
    if (!projectPath) throw new Error('Project path is not set');
    if (glossaryPromiseRef.current) return glossaryPromiseRef.current;
    const promise = (async (): Promise<GlossaryEntry[]> => {
      const opened = await projectService.open(projectPath);
      let glossary = (glossaryReady && glossaryReady.length > 0)
        ? glossaryReady
        : opened.glossary ?? [];
      const needsTr = glossary.some(
        (e) =>
          e.source.trim().length > 0 &&
          (!e.target.trim() || e.target.trim().toLowerCase() === e.source.trim().toLowerCase())
      );
      if (needsTr) {
        const combinedPrompt = [translationPrompt, contextPrompt]
          .map((s) => s.trim())
          .filter(Boolean)
          .join('\n\n');
        try {
          setIsPreparingGlossary(true);
          const updated = await translateGlossaryTargetsInProject(
            projectPath,
            targetLanguage,
            combinedPrompt
          );
          glossary = updated.glossary ?? glossary;
        } finally {
          setIsPreparingGlossary(false);
        }
      }
      const promptHints = parseTranslationHintsFromPrompt(
        [translationPrompt, contextPrompt].filter(Boolean).join('\n\n')
      );
      if (promptHints.length > 0) {
        glossary = mergePromptHintsIntoGlossary(glossary, promptHints);
        await projectService.save({ ...opened, glossary });
      }
      setGlossaryReady(glossary);
      return glossary;
    })();
    glossaryPromiseRef.current = promise.finally(() => {
      glossaryPromiseRef.current = null;
    });
    return promise;
  };

  const handleOpenGlossaryEditor = async () => {
    if (!projectPath) return;
    setErrorText('');
    // открываем модал МГНОВЕННО с тем что есть в state/проекте.
    // глоссарий формируется на этапе транскрипции, отдельно ничего не «готовится».
    // если перевод ещё пере-генерируется фоном после смены языка - в модале поля просто обновятся.
    if (glossaryReady === null) {
      try {
        const opened = await projectService.open(projectPath);
        setGlossaryReady(opened.glossary ?? []);
      } catch (e) {
        console.warn('[Wizard] open project for glossary failed', e);
        setGlossaryReady([]);
      }
    }
    setGlossaryModalOpen(true);
  };

  // сохранение глоссария из визарда - только на диск, без агента
  // агент проекта работает только когда глоссарий правится в основном UI, тут он не нужен
  const handleGlossarySavedFromWizard = (entries: GlossaryEntry[]) => {
    setGlossaryReady(entries);
    if (!projectPath) return;
    void (async () => {
      try {
        const opened = await projectService.open(projectPath);
        await projectService.save({
          ...opened,
          glossary: entries,
          updated_at: new Date().toISOString()
        });
      } catch (e) {
        console.warn('[Wizard] save glossary failed', e);
      }
    })();
    setGlossaryModalOpen(false);
  };

  const runTranslation = async () => {
    ensureProject();
    if (!workingSegments.length || !workingFileId) {
      throw new Error('��� ��������� ��� ��������');
    }

    console.log('[Wizard] Step 4.5: translation started');
    cancelRef.current = false;
    setIsProcessing(true);
    setErrorText('');
    setCurrentStep(6);

    try {
      const combinedPrompt = [translationPrompt, contextPrompt]
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n\n');
      const prompt = combinedPrompt || 'Natural subtitle translation';
      // если пользователь уже открывал Edit Glossary - глоссарий готов и отредактирован
      // иначе подготавливаем на лету
      const glossary = await ensureGlossaryReady();
      if (cancelRef.current) return;
      const translations = await projectService.translateBatch(
        workingSegments,
        targetLanguage,
        prompt,
        glossary
      );
      if (cancelRef.current) return;

      const translatedSegments = workingSegments.map((segment) => {
        const translation = translations.find((item) => item.id === segment.id);
        return {
          ...segment,
          translation: translation?.translated_text ?? segment.translation ?? null
        };
      });

      const updatedProject = await saveSegmentsToProject(translatedSegments, workingFileId);
      setWorkingSegments(translatedSegments);
      console.log('[Wizard] Translation done, translated segments:', translatedSegments.length);
      setCurrentStep(7);
      onComplete({ project: updatedProject, segments: translatedSegments, subtitleFileId: workingFileId });
    } catch (error) {
      if (cancelRef.current || isAiOperationCancelled(error)) return;
      throw error;
    } finally {
      setIsProcessing(false);
    }
  };

  const handleNext = async () => {
    try {
      setErrorText('');
      if (currentStep === 1) {
        if (!videoPath) {
          setErrorText('������ ��������� ��� �����������');
          return;
        }
        nextStep();
        return;
      }
      if (currentStep === 2) {
        if (sourceType === 'file' && !subtitlePath) {
          setErrorText('������ ������� ���� ���������');
          return;
        }
        if (sourceType === 'file') {
          await runTranscription();
          return;
        }
        nextStep();
        return;
      }
      if (currentStep === 3) {
        await runTranscription();
        return;
      }
      if (currentStep === 5) {
        await runTranslation();
        return;
      }
      nextStep();
    } catch (error) {
      if (cancelRef.current || isAiOperationCancelled(error)) {
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      console.error('[Wizard] Error details:', error);
      setErrorText(message);
      if (currentStep === 2 && sourceType === 'file') setCurrentStep(2);
      if (currentStep === 3) setCurrentStep(3);
      if (currentStep === 5) setCurrentStep(5);
      if (currentStep === 4) setCurrentStep(3);
      if (currentStep === 6) setCurrentStep(5);
    }
  };

  const stepData = useMemo(() => ({
    1: {
      title: t('wizard.step1Title'),
      desc: t('wizard.step1Desc'),
      rightCol: (
        <div
          onClick={handleSelectVideo}
          className="flex-1 border border-border-default rounded-[12px] bg-secondary-main flex flex-col items-center justify-center gap-4 hover:border-primary-main transition-colors cursor-pointer group"
        >
          <div className="w-12 h-12 flex items-center justify-center text-text-primary group-hover:text-primary-main transition-colors">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 5V19M5 12H19" strokeLinecap="round"/>
            </svg>
          </div>
          <p className="text-body-reg text-text-primary text-center whitespace-pre-line leading-[20px]">
            {videoPath || t('wizard.dropFile')}
          </p>
        </div>
      )
    },
    2: {
      title: t('wizard.step2Title'),
      desc: t('wizard.step2Desc'),
      rightCol: (
        <div className="flex flex-col gap-[12px] h-full min-w-0 w-full">
          <div 
            onClick={() => setSourceType('ai')}
            className={`flex-1 min-w-0 flex flex-col p-4 border rounded-[12px] cursor-pointer overflow-hidden ${
              sourceType === 'ai' 
                ? 'bg-secondary-main border-text-primary' 
                : 'bg-secondary-disabled border-secondary-hover'
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <span className="text-body-med text-text-primary">{t('wizard.generateAi')}</span>
              <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${sourceType === 'ai' ? 'border-text-primary' : 'border-secondary-hover'}`}>
                {sourceType === 'ai' && <div className="w-2.5 h-2.5 rounded-full bg-text-primary" />}
              </div>
            </div>
            <div className="flex-1 flex items-end">
              <select
                value={sourceLanguage}
                onChange={(e) => setSourceLanguage(e.target.value)}
                className="w-full h-[42px] px-3 bg-transparent border border-text-secondary rounded-[6px] text-body-reg text-text-primary"
              >
                {languageOptions.map((lang) => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>
          </div>

          <div 
            onClick={() => {
              setSourceType('file');
              handleSelectSubtitle().catch(console.error);
            }}
            className={`flex-1 min-w-0 flex flex-col p-4 border rounded-[12px] cursor-pointer overflow-hidden ${
              sourceType === 'file' 
                ? 'bg-secondary-main border-text-primary' 
                : 'bg-secondary-disabled border-secondary-hover'
            }`}
          >
            <div className="flex justify-between items-start mb-2 min-w-0">
              <span className="text-body-med text-text-primary truncate min-w-0">{t('wizard.importExisting')}</span>
              <div className={`shrink-0 w-5 h-5 rounded-full border flex items-center justify-center ${sourceType === 'file' ? 'border-text-primary' : 'border-secondary-hover'}`}>
                {sourceType === 'file' && <div className="w-2.5 h-2.5 rounded-full bg-text-primary" />}
              </div>
            </div>
            <div className="flex-1 flex items-end min-w-0 w-full">
              <span
                className="block w-full min-w-0 text-body-reg text-text-primary truncate"
                title={subtitlePath || undefined}
              >
                {subtitlePath || t('wizard.chooseSubtitle')}
              </span>
            </div>
          </div>
        </div>
      )
    },
    3: {
      title: t('wizard.step3Title'),
      desc: t('wizard.step3Desc'),
      rightCol: (
        <div className="flex flex-col gap-[12px] h-full min-h-0">
          <div className="flex-1 flex flex-col gap-[8px] min-h-0">
            <label className="text-caption text-text-primary">{t('wizard.prompt')}</label>
            <textarea 
              value={contextPrompt}
              onChange={(e) => setContextPrompt(e.target.value)}
              className="flex-1 min-h-0 w-full p-4 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary resize-none overflow-y-auto subtitle-table-scroll focus:outline-none focus:border-text-primary transition-colors placeholder:text-text-secondary/50"
              placeholder={t('wizard.step3Placeholder')}
            />
          </div>
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => {
                void handleOpenGlossaryEditor();
              }}
              disabled={isPreparingGlossary || !projectPath}
              className="w-full h-[42px] px-4 flex items-center justify-center bg-secondary-main hover:bg-secondary-hover disabled:bg-primary-disabled disabled:text-white/60 disabled:cursor-not-allowed text-text-primary text-body-reg rounded-[12px] border border-border-default transition-colors"
            >
              {isPreparingGlossary ? t('wizard.preparingGlossary') : t('wizard.editGlossary')}
            </button>
          </div>
        </div>
      )
    },
    5: {
      title: t('wizard.step5Title'),
      desc: t('wizard.step5Desc'),
      rightCol: (
        <div className="flex flex-col gap-[12px] h-full">
          <div className="flex flex-col gap-[8px]">
            <label className="text-caption text-text-primary">{t('wizard.targetLanguage')}</label>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="w-full h-[42px] px-3 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary"
            >
              {languageOptions.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 flex flex-col gap-[8px] min-h-0">
            <label className="text-caption text-text-primary">{t('wizard.prompt')}</label>
            <textarea 
              value={translationPrompt}
              onChange={(e) => setTranslationPrompt(e.target.value)}
              className="flex-1 min-h-0 w-full p-4 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary resize-none overflow-y-auto subtitle-table-scroll focus:outline-none focus:border-text-primary transition-colors placeholder:text-text-secondary/50"
              placeholder={t('wizard.step5Placeholder')}
            />
          </div>
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => {
                void handleOpenGlossaryEditor();
              }}
              disabled={isPreparingGlossary || !projectPath}
              className="w-full h-[42px] px-4 flex items-center justify-center bg-secondary-main hover:bg-secondary-hover disabled:bg-primary-disabled disabled:text-white/60 disabled:cursor-not-allowed text-text-primary text-body-reg rounded-[12px] border border-border-default transition-colors"
            >
              {isPreparingGlossary ? t('wizard.preparingGlossary') : t('wizard.editGlossary')}
            </button>
          </div>
        </div>
      )
    },
    7: {
      title: t('wizard.step7Title'),
      desc: t('wizard.step7Desc')
    }
  }), [t, videoPath, sourceType, sourceLanguage, subtitlePath, contextPrompt, targetLanguage, translationPrompt, isPreparingGlossary, projectPath]);

  const currentContent = stepData[currentStep as keyof typeof stepData] || stepData[1];

  return (
    <DraggableModalShell
      width={780}
      className="h-[424px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none"
    >
        <div className="flex items-center gap-[32px] h-6 mb-[32px]">
          <div className="flex-1 h-[4px] bg-border-default rounded-full overflow-hidden">
            <div 
              className="h-full bg-progress-bar transition-all duration-300 ease-in-out"
              style={{ width: progressWidth }}
            />
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center text-text-secondary hover:opacity-70 transition-opacity">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div
          className={`grid gap-[32px] flex-1 min-h-0 items-start ${
            currentStep === 7 ? 'grid-cols-1' : 'grid-cols-[1fr_1.2fr]'
          }`}
        >
          {isLoaderStep ? (
            <>
              <div className="flex flex-col pt-0">
                <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[20px] text-text-primary mb-[24px]">
                  {t('wizard.working')}
                </h1>
                <p className="text-body-reg text-text-secondary">
                  {currentStep === 4
                    ? isFileMode
                      ? t('wizard.importWait')
                      : t('wizard.transcribeWait')
                    : t('wizard.translateWait')}
                </p>
              </div>
              <div className="flex items-center justify-center h-full">
                <div className="w-[120px] h-[120px] border-[6px] border-border-default border-t-progress-bar rounded-full animate-spin" />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col pt-0 min-w-0">
                <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[20px] text-text-primary mb-[24px]">
                  {currentStep === 7 ? currentContent.title : `${currentStep > 4 ? currentStep - 1 : currentStep}. ${currentContent.title}`}
                </h1>
                <p className="text-body-reg text-text-secondary">
                  {currentContent.desc}
                </p>
              </div>
              {currentStep !== 7 && 'rightCol' in currentContent && currentContent.rightCol ? (
                <div className="flex flex-col h-full min-h-0 min-w-0">
                  {currentContent.rightCol}
                </div>
              ) : null}
            </>
          )}
        </div>

        {errorText && (
          <div className="text-caption text-red-400 mt-2">
            {errorText}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-[32px]">
          {isLoaderStep ? (
            <>
              <button 
                onClick={handleCancelLoader}
                className="w-[112px] h-[26px] flex items-center justify-center bg-secondary-main hover:bg-secondary-hover text-text-primary text-body-reg rounded-[5px] transition-colors"
              >
                {t('wizard.cancel')}
              </button>
              <button 
                disabled
                className="w-[112px] h-[26px] flex items-center justify-center bg-primary-disabled text-white/60 text-body-reg rounded-[5px] cursor-not-allowed"
              >
                {t('wizard.nextStep')}
              </button>
            </>
          ) : currentStep === 7 ? (
            <>
              <button 
                onClick={prevStep}
                className="w-[112px] h-[26px] flex items-center justify-center bg-secondary-main hover:bg-secondary-hover text-text-primary text-body-reg rounded-[5px] transition-colors"
              >
                {t('wizard.prevStep')}
              </button>
              <button 
                onClick={() => {
                  if (workingFileId) {
                    console.log('[Wizard] Completed, opening editor');
                  }
                  onClose();
                }}
                className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors"
              >
                {t('wizard.goToEditor')}
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={prevStep}
                disabled={currentStep === 1 || isProcessing}
                className="w-[112px] h-[26px] flex items-center justify-center bg-secondary-main hover:bg-secondary-hover disabled:bg-primary-disabled text-text-primary disabled:text-white/60 text-body-reg rounded-[5px] transition-colors"
              >
                {t('wizard.prevStep')}
              </button>
              <button 
                onClick={() => {
                  handleNext().catch(console.error);
                }}
                disabled={isProcessing || !canProceedFromStep}
                className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover disabled:bg-primary-disabled disabled:text-white/60 disabled:cursor-not-allowed text-white text-body-reg rounded-[5px] transition-colors shadow-sm"
              >
                {t('wizard.nextStep')}
              </button>
            </>
          )}
        </div>
        {glossaryModalOpen && (
          <GlossaryModal
            projectPath={projectPath ?? null}
            initialEntries={glossaryReady ?? []}
            onSaved={handleGlossarySavedFromWizard}
            onClose={() => setGlossaryModalOpen(false)}
          />
        )}
    </DraggableModalShell>
  );
};