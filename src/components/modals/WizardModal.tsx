import React, { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  projectService,
  ProjectData,
  ProjectFile,
  SubtitleSegment,
  GlossaryEntry,
  GlossaryTermGenerated
} from '../../services/projectService';

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

interface WizardModalProps {
  onClose: () => void;
  projectPath?: string;
  onComplete: (payload: { project: ProjectData; segments: SubtitleSegment[] }) => void;
}

const languageOptions = ['English', 'Russian', 'Spanish', 'French', 'German'];
const whisperLanguageCodes: Record<string, string> = {
  English: 'en',
  Russian: 'ru',
  Spanish: 'es',
  French: 'fr',
  German: 'de'
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
  return null;
};

export const WizardModal: React.FC<WizardModalProps> = ({ onClose, projectPath, onComplete }) => {
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

  const nextStep = () => setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
  const prevStep = () => setCurrentStep((prev) => Math.max(prev - 1, 1));

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

    try {
      console.log('[Wizard] Importing video to project');
      const importedVideo: ProjectFile = await projectService.importMedia(projectPath!, videoPath);
      setWorkingFileId(importedVideo.id);

      let segments: SubtitleSegment[] = [];
      if (sourceType === 'ai') {
        const hasApiKey = await projectService.getApiKeyStatus();
        if (!hasApiKey) {
          throw new Error('OpenAI API key is not set. Please activate the app first.');
        }

        const outputAudioPath = `${projectPath!}/config/wizard_audio_${Date.now()}.mp3`;
        console.log('[Wizard] Extracting audio', outputAudioPath);
        const audioPath = await projectService.extractAudioFromVideo(videoPath, outputAudioPath);

        const whisperLanguage = whisperLanguageCodes[sourceLanguage] ?? 'en';
        console.log('[Wizard] Whisper language:', whisperLanguage);
        console.log('[Wizard] Calling OpenAI Whisper');
        segments = await projectService.transcribeAudio(audioPath, whisperLanguage, contextPrompt);
      } else {
        if (!subtitlePath) {
          throw new Error('����� ������� ������� ���� ���������');
        }
        console.log('[Wizard] Importing existing subtitles');
        segments = await projectService.importExistingSubtitles(subtitlePath, projectPath!, importedVideo.id);
      }

      let updatedProject = await saveSegmentsToProject(segments, importedVideo.id);

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

      setWorkingSegments(segments);
      console.log('[Wizard] Transcription done, segments:', segments.length);
      setCurrentStep(5);
      onComplete({ project: updatedProject, segments });
    } finally {
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
      onComplete({ project: updatedProject, segments: translatedSegments });
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
      if (currentStep === 4) setCurrentStep(3);
      if (currentStep === 6) setCurrentStep(5);
    }
  };

  const stepData = {
    1: {
      title: "Import your file",
      desc: "Select the video you want to subtitle. A wide range of audiovisual files is supported.",
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
            {videoPath || 'Drop your file here \n (audio, video files)'}
          </p>
        </div>
      )
    },
    2: {
      title: "Source text",
      desc: "How should we get the text in the original language? You can transcribe audio automatically or choose a pre-existing file, if you have it.",
      rightCol: (
        <div className="flex flex-col gap-[12px] h-full">
          <div 
            onClick={() => setSourceType('ai')}
            className={`flex-1 flex flex-col p-4 border rounded-[12px] cursor-pointer ${
              sourceType === 'ai' 
                ? 'bg-secondary-main border-text-primary' 
                : 'bg-secondary-disabled border-secondary-hover'
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <span className="text-body-med text-text-primary">Generate with AI</span>
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
            onClick={() => setSourceType('file')}
            className={`flex-1 flex flex-col p-4 border rounded-[12px] cursor-pointer ${
              sourceType === 'file' 
                ? 'bg-secondary-main border-text-primary' 
                : 'bg-secondary-disabled border-secondary-hover'
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <span className="text-body-med text-text-primary">Import an existing file</span>
              <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${sourceType === 'file' ? 'border-text-primary' : 'border-secondary-hover'}`}>
                {sourceType === 'file' && <div className="w-2.5 h-2.5 rounded-full bg-text-primary" />}
              </div>
            </div>
            <div className="flex-1 flex items-end">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelectSubtitle().catch(console.error);
                }}
                className="text-body-reg text-text-primary"
              >
                {subtitlePath || '[Choose .srt / .vtt / .txt]'}
              </button>
            </div>
          </div>
        </div>
      )
    },
    3: {
      title: "Context and glossary",
      desc: "Tell the AI about specific names, slang or terms to create a glossary that will keep transcription consistent.",
      rightCol: (
        <div className="flex flex-col h-full min-h-0">
          <div className="flex flex-col gap-[8px] h-full min-h-0">
            <label className="text-caption text-text-primary">Prompt</label>
            <textarea 
              value={contextPrompt}
              onChange={(e) => setContextPrompt(e.target.value)}
              className="flex-1 min-h-0 w-full p-4 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary resize-none overflow-y-auto subtitle-table-scroll focus:outline-none focus:border-text-primary transition-colors placeholder:text-text-secondary/50"
              placeholder="Arcane, Saison 1. Personnages : Vi, Jinx, Jayce, Viktor, Silco, Caitlyn, Mel Medarda, Ekko, Heimerdinger..."
            />
          </div>
        </div>
      )
    },
    5: {
      title: "Translation",
      desc: "You can select a language and give instructions to the agent. Style, tone and context matter for the result.",
      rightCol: (
        <div className="flex flex-col gap-[12px] h-full">
          <div className="flex flex-col gap-[8px]">
            <label className="text-caption text-text-primary">Target language</label>
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
            <label className="text-caption text-text-primary">Prompt</label>
            <textarea 
              value={translationPrompt}
              onChange={(e) => setTranslationPrompt(e.target.value)}
              className="flex-1 min-h-0 w-full p-4 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary resize-none overflow-y-auto subtitle-table-scroll focus:outline-none focus:border-text-primary transition-colors placeholder:text-text-secondary/50"
              placeholder="Professional localization for a sci-fi drama series..."
            />
          </div>
        </div>
      )
    },
    7: {
      title: "Everything is ready!",
      desc: "You can continue improving the results manually in the editor.",
      rightCol: (
        <div className="flex-1 border border-border-default rounded-[12px] bg-secondary-main flex items-center justify-center overflow-hidden">
          <div className="text-text-secondary opacity-20 flex flex-col items-center gap-2">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" />
              <path d="M2 17L12 22L22 17" />
              <path d="M2 12L12 17L22 12" />
            </svg>
            <span className="text-caption">PLACEHOLDER</span>
          </div>
        </div>
      )
    }
  };

  const currentContent = stepData[currentStep as keyof typeof stepData] || stepData[1];

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[10000] pointer-events-none">
      <div className="pointer-events-auto w-[780px] h-[424px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
        
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
                  AI is working!
                </h1>
                <p className="text-body-reg text-text-secondary">
                  {currentStep === 4 
                    ? "Please wait while we transcribe your file. This may take some minutes..."
                    : "Please wait while we translate your text. This may take some minutes..."}
                </p>
              </div>
              <div className="flex items-center justify-center h-full">
                <div className="w-[120px] h-[120px] border-[6px] border-border-default border-t-progress-bar rounded-full animate-spin" />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col pt-0">
                <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[20px] text-text-primary mb-[24px]">
                  {currentStep === 7 ? currentContent.title : `${currentStep > 4 ? currentStep - 1 : currentStep}. ${currentContent.title}`}
                </h1>
                <p className="text-body-reg text-text-secondary">
                  {currentContent.desc}
                </p>
              </div>
              <div className="flex flex-col h-full min-h-0">
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
                Cancel
              </button>
              <button 
                disabled
                className="w-[112px] h-[26px] flex items-center justify-center bg-primary-disabled text-white/60 text-body-reg rounded-[5px] cursor-not-allowed"
              >
                Next step &gt;
              </button>
            </>
          ) : currentStep === 7 ? (
            <>
              <button 
                onClick={prevStep}
                className="w-[112px] h-[26px] flex items-center justify-center bg-secondary-main hover:bg-secondary-hover text-text-primary text-body-reg rounded-[5px] transition-colors"
              >
                &lt; Prev step
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
                Go to editor
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={prevStep}
                disabled={currentStep === 1 || isProcessing}
                className="w-[112px] h-[26px] flex items-center justify-center bg-secondary-main hover:bg-secondary-hover disabled:bg-primary-disabled text-text-primary disabled:text-white/60 text-body-reg rounded-[5px] transition-colors"
              >
                &lt; Prev step
              </button>
              <button 
                onClick={() => {
                  handleNext().catch(console.error);
                }}
                disabled={isProcessing}
                className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors shadow-sm"
              >
                Next step &gt;
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};