import React, { useState, useEffect } from 'react';

interface WizardModalProps {
  onClose: () => void;
}

export const WizardModal: React.FC<WizardModalProps> = ({ onClose }) => {
  const [currentStep, setCurrentStep] = useState(1); 
  const [sourceType, setSourceType] = useState<'ai' | 'file'>('ai');
  const totalSteps = 7; // Увеличено общее количество шагов для учета второй загрузки и финала

  useEffect(() => {
    // Автоматический переход для первого (4) и второго (6) этапов загрузки
    if (currentStep === 4 || currentStep === 6) {
      const timer = setTimeout(() => {
        setCurrentStep((prev) => prev + 1);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [currentStep]);

  const nextStep = () => setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
  const prevStep = () => setCurrentStep((prev) => Math.max(prev - 1, 1));

  const progressWidth = `${(currentStep / totalSteps) * 100}%`;

  const stepData = {
    1: {
      title: "Import your file",
      desc: "Select the video you want to subtitle. A wide range of audiovisual files is supported.",
      rightCol: (
        <div className="flex-1 border border-border-default rounded-[12px] bg-secondary-main flex flex-col items-center justify-center gap-4 hover:border-primary-main transition-colors cursor-pointer group">
          <div className="w-12 h-12 flex items-center justify-center text-text-primary group-hover:text-primary-main transition-colors">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 5V19M5 12H19" strokeLinecap="round"/>
            </svg>
          </div>
          <p className="text-body-reg text-text-primary text-center whitespace-pre-line leading-[20px]">
            Drop your file here {"\n"} (audio, video files)
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
              <div className="w-full h-[42px] px-3 bg-transparent border border-text-secondary rounded-[6px] flex items-center justify-between text-body-reg text-text-primary">
                <span>French</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
              </div>
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
              <p className="text-body-reg text-text-primary">[Choose .srt / .vtt / .txt]</p>
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
          <div className="flex flex-col gap-[8px] h-full">
            <label className="text-caption text-text-primary">Prompt</label>
            <textarea 
              className="flex-1 w-full p-4 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary resize-none focus:outline-none focus:border-text-primary transition-colors placeholder:text-text-secondary/50"
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
            <div className="w-full h-[42px] px-3 bg-secondary-main border border-border-default rounded-[12px] flex items-center justify-between text-body-reg text-text-primary cursor-pointer">
              <span>English</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-[8px] min-h-0">
            <label className="text-caption text-text-primary">Prompt</label>
            <textarea 
              className="flex-1 w-full p-4 bg-secondary-main border border-border-default rounded-[12px] text-body-reg text-text-primary resize-none focus:outline-none focus:border-text-primary transition-colors placeholder:text-text-secondary/50"
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
          {/* Плейсхолдер для картинки */}
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
  const isLoaderStep = currentStep === 4 || currentStep === 6;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[10000] pointer-events-none">
      <div className="pointer-events-auto w-[780px] h-[424px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
        
        {/* РЯД 1 Прогресс-бар и крестик */}
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

        {/* РЯД 2 Контент */}
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

        {/* РЯД 3 Навигация */}
        <div className="flex justify-end gap-3 mt-[32px]">
          {isLoaderStep ? (
            <>
              <button 
                onClick={prevStep}
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
                onClick={onClose}
                className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors"
              >
                Go to editor
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={prevStep}
                disabled={currentStep === 1}
                className="w-[112px] h-[26px] flex items-center justify-center bg-secondary-main hover:bg-secondary-hover disabled:bg-primary-disabled text-text-primary disabled:text-white/60 text-body-reg rounded-[5px] transition-colors"
              >
                &lt; Prev step
              </button>
              <button 
                onClick={nextStep}
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