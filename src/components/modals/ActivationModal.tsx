import React, { useState } from 'react';
import { projectService } from '../../services/projectService';

interface ActivationModalProps {
  onActivated: () => void;
}

export const ActivationModal: React.FC<ActivationModalProps> = ({ onActivated }) => {
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleActivate = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setErrorText('Please enter your OpenAI API key.');
      return;
    }

    setIsSaving(true);
    setErrorText(null);
    try {
      await projectService.saveApiKey(trimmed);
      onActivated();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorText(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[10000] pointer-events-none">
      <div className="pointer-events-auto w-[780px] h-[424px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
        <div className="flex flex-col mb-8">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[32px] text-text-primary mb-2">
            Activate Subtitle Studio
          </h1>
          <p className="text-body-reg text-text-secondary">
            Insert your OpenAI API key to enable AI transcription and translation.
          </p>
        </div>

        <div className="flex-1 flex flex-col justify-end">
          <div className="flex flex-col gap-[8px]">
            <label className="text-caption text-text-secondary">OpenAI API key</label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              autoFocus
              className="w-full px-[12px] py-[10px] bg-secondary-main border border-border-default rounded-[8px] text-body-reg text-text-primary focus:outline-none focus:border-primary-main transition-colors"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleActivate();
                }
              }}
            />
            {errorText && <p className="text-caption text-red-400">{errorText}</p>}
          </div>

          <div className="flex justify-end mt-8">
            <button
              type="button"
              onClick={() => void handleActivate()}
              disabled={isSaving}
              className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover disabled:opacity-40 disabled:pointer-events-none text-white text-body-reg rounded-[5px] transition-colors shadow-sm"
            >
              {isSaving ? 'Saving...' : 'Activate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
