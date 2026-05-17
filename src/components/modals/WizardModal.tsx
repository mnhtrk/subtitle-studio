import React, { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { DraggableModalShell } from './DraggableModalShell';
import { open } from '@tauri-apps/plugin-dialog';
import {
  projectService,
  ProjectData,
  ProjectFile,
  SubtitleSegment,
  GlossaryEntry,
  GlossaryTermGenerated
} from '../../services/projectService';

function joinProjectPath(base: string, ...parts: string[]): string {
  const a = base.replace(/[/\\]+$/, '');
  const rest = parts.map((p) => p.replace(/^[/\\]+/, '').replace(/\\/g, '/')).join('/');
  return `${a}/${rest}`;
}

/** После транскрипции: сегменты на дорожке субтитров, видео только медиа, пара связана + .srt на диске. */
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

function mergeAutoGlossary(
  existing: GlossaryEntry[],
  generated: GlossaryTermGenerated[]
): GlossaryEntry[] {
  const seen = new Set(
    existing.map((e) => e.source.trim().toLowerCase()).filter(Boolean)
  );
  const next = [...existing];
  for (const t of generated) {
    const s = t.source.trim();
    const tgt = t.target.trim();
    if (!s || !tgt) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const cat = (t.category ?? '').trim();
    const conf = Math.round(t.confidence * 100);
    const ctx = cat.length > 0 ? `auto ${conf}% (${cat})` : `auto ${conf}%`;
    next.push({
      id: crypto.randomUUID(),
      source: t.source,
      target: t.target,
      description: null,
      context: ctx
    });
  }
  return next;
}

function buildTranscriptionPrompt(
  userPrompt: string,
  glossary: GlossaryEntry[]
): string | undefined {
  const manual = userPrompt.trim();
  const glossaryOriginals = glossary
    .map((e) => e.source.trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.findIndex((x) => x.toLowerCase() === value.toLowerCase()) === index);

  if (manual.length > 0) {
    if (glossaryOriginals.length === 0) return manual;
    return `${manual}\n\nImportant names/terms to keep exactly:\n${glossaryOriginals.join(', ')}`;
  }

  if (glossaryOriginals.length === 0) return undefined;
  return `Important names/terms to keep exactly:\n${glossaryOriginals.join(', ')}`;
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

const resolveIsoLanguage = (languageOrCode: string): string | null => {
  const normalized = languageOrCode.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.length === 2) return normalized;
  if (normalized === 'english') return 'en';
  if (normalized === 'russian') return 'ru';
  if (normalized === 'spanish') return 'es';
  if (normalized === 'french') return 'fr';
  if (normalized === 'german') return 'de';
  if (normalized === 'italian') return 'it';
  if (normalized === 'portuguese') return 'pt';
  if (normalized === 'chinese') return 'zh';
  if (normalized === 'japanese') return 'ja';
  if (normalized === 'korean') return 'ko';
  if (normalized === 'arabic') return 'ar';
  if (normalized === 'hindi') return 'hi';
  if (normalized === 'turkish') return 'tr';
  if (normalized === 'polish') return 'pl';
  if (normalized === 'ukrainian') return 'uk';
  return null;
};

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
  const totalSteps = 7;

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
    setIsProcessing(true);
    setErrorText('');
    setCurrentStep(4);

    let tempAudioRel: string | null = null;
    try {
      console.log('[Wizard][subtitle-file] importing video to project');
      const importedVideo: ProjectFile = await projectService.importMedia(projectPath!, videoPath);
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

        const whisperLanguage = whisperLanguageCodes[sourceLanguage] ?? 'en';
        const projectForPrompt = await projectService.open(projectPath!);
        const whisperPrompt = buildTranscriptionPrompt(contextPrompt, projectForPrompt.glossary);
        console.log('[Wizard] Whisper language:', whisperLanguage);
        console.log('[Wizard] Calling OpenAI Whisper');
        segments = await projectService.transcribeAudio(
          audioPath,
          whisperLanguage,
          whisperPrompt,
          projectForPrompt.glossary
        );
      } else {
        if (!subtitlePath) {
          throw new Error('����� ������� ������� ���� ���������');
        }
        console.log('[Wizard][subtitle-file] parsing subtitle file:', subtitlePath);
        segments = await projectService.parseSubtitleFile(subtitlePath);
        console.log('[Wizard][subtitle-file] parsed segments:', segments.length);
      }

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
        try {
          const targetIso =
            resolveIsoLanguage(updatedProject.target_language) ??
            resolveIsoLanguage(targetLanguage) ??
            'en';
          const suggested = await projectService.autoGenerateGlossary(segments, {
            min_frequency: 2,
            max_terms: 45,
            target_language: targetIso,
            contextPrompt: contextPrompt
          });
          if (suggested.length > 0) {
            const opened = await projectService.open(projectPath!);
            const merged = mergeAutoGlossary(opened.glossary, suggested);
            const toSave: ProjectData = {
              ...opened,
              glossary: merged,
              updated_at: new Date().toISOString()
            };
            await projectService.save(toSave);
            updatedProject = toSave;
          }
        } catch (autoGlossErr) {
          console.warn('[Wizard] Auto-glossary skipped:', autoGlossErr);
        }
      }

      setWorkingSegments(segments);
      console.log('[Wizard] Transcription done, segments:', segments.length);
      setCurrentStep(5);
      onComplete({ project: updatedProject, segments, subtitleFileId });
    } finally {
      if (tempAudioRel && projectPath) {
        projectService
          .deleteProjectFileArtifact(projectPath, tempAudioRel)
          .catch((err) => console.warn('[Wizard] cleanup audio failed:', err));
      }
      setIsProcessing(false);
    }
  };

  const runTranslation = async () => {
    ensureProject();
    if (!workingSegments.length || !workingFileId) {
      throw new Error('��� ��������� ��� ��������');
    }

    console.log('[Wizard] Step 4.5: translation started');
    setIsProcessing(true);
    setErrorText('');
    setCurrentStep(6);

    try {
      const prompt = translationPrompt.trim() || contextPrompt.trim() || 'Natural subtitle translation';
      const projectForGlossary = await projectService.open(projectPath!);
      const translations = await projectService.translateBatch(
        workingSegments,
        targetLanguage,
        prompt,
        projectForGlossary.glossary
      );

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
        <div className="flex flex-col h-full min-h-0">
          <div className="flex flex-col gap-[8px] h-full min-h-0">
            <label className="text-caption text-text-primary">{t('wizard.prompt')}</label>
            <textarea 
              value={contextPrompt}
              onChange={(e) => setContextPrompt(e.target.value)}
              className="flex-1 min-h-0 w-full p-4 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary resize-none overflow-y-auto subtitle-table-scroll focus:outline-none focus:border-text-primary transition-colors placeholder:text-text-secondary/50"
              placeholder={t('wizard.step3Placeholder')}
            />
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
        </div>
      )
    },
    7: {
      title: t('wizard.step7Title'),
      desc: t('wizard.step7Desc'),
      rightCol: (
        <div className="flex-1 border border-border-default rounded-[12px] bg-secondary-main flex items-center justify-center overflow-hidden">
          <div className="text-text-secondary opacity-20 flex flex-col items-center gap-2">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" />
              <path d="M2 17L12 22L22 17" />
              <path d="M2 12L12 17L22 12" />
            </svg>
            <span className="text-caption">{t('wizard.placeholder')}</span>
          </div>
        </div>
      )
    }
  }), [t, videoPath, sourceType, sourceLanguage, subtitlePath, contextPrompt, targetLanguage, translationPrompt]);

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

        <div className="grid grid-cols-[1fr_1.2fr] gap-[32px] flex-1 min-h-0 items-start">
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
              <div className="flex flex-col h-full min-h-0 min-w-0">
                {currentContent.rightCol}
              </div>
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
                onClick={prevStep}
                disabled={isProcessing}
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
                disabled={isProcessing}
                className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors shadow-sm"
              >
                {t('wizard.nextStep')}
              </button>
            </>
          )}
        </div>
    </DraggableModalShell>
  );
};