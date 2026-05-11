import React, { useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog'; //выбор папки
import { projectService } from '../../services/projectService';

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

interface NewProjectModalProps {
  onClose: () => void;
  onProjectCreated: (project: any) => void;
}

function sanitizeProjectFolderName(raw: string): string {
  return raw
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
}

function joinPath(parent: string, child: string): string {
  if (!parent) return child;
  const trimmed = parent.replace(/[\\/]+$/g, '');
  const sep = trimmed.includes('\\') && !trimmed.includes('/') ? '\\' : '/';
  return `${trimmed}${sep}${child}`;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ onClose, onProjectCreated }) => {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [targetLang, setTargetLang] = useState('English');
  const [isCreating, setIsCreating] = useState(false);

  const sanitizedFolderName = useMemo(() => sanitizeProjectFolderName(name), [name]);
  const previewPath = useMemo(
    () => (location && sanitizedFolderName ? joinPath(location, sanitizedFolderName) : ''),
    [location, sanitizedFolderName]
  );

  const handleSelectFolder = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Project Directory'
      });
      if (selected && typeof selected === 'string') {
        setLocation(selected);
      }
    } catch (err) {
      console.error('Ошибка диалога:', err);
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !location) {
      alert('Please fill in all fields');
      return;
    }
    if (!sanitizedFolderName) {
      alert('Project name contains only invalid characters. Please use letters, digits, spaces or dashes.');
      return;
    }

    const finalPath = joinPath(location, sanitizedFolderName);

    setIsCreating(true);
    try {
      const newProject = await projectService.create(name.trim(), finalPath, targetLang);
      onProjectCreated(newProject);
      onClose();
    } catch (err) {
      console.error(err);
      const detail = err instanceof Error ? err.message : String(err);
      alert(`Failed to create project: ${detail}`);
    } finally {
      setIsCreating(false);
    }
  };
	
	
	return (
    <div className="fixed inset-0 flex items-center justify-center z-[10000] pointer-events-none">
      <div className="pointer-events-auto w-[780px] h-[424px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
        
        {/* Хедер модалки с крестиком */}
        <div className="flex justify-end h-5"> 
          <button onClick={onClose} className="text-text-secondary hover:opacity-70 transition-opacity">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Основной контентный блок */}
        <div className="grid grid-cols-[1fr_1.2fr] gap-[32px] flex-1 mt-4">
          
          {/* Левая колонна */}
          <div className="flex flex-col">
            <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[20px] text-text-primary mb-[24px]">
              Create a new project
            </h1>
            <p className="text-body-reg text-text-secondary">
              Organize your work by title. A project folder stores your videos and subtitles.
            </p>
          </div>

          {/* Правая колонна*/}
          <div className="flex flex-col justify-between h-full">
            
            <div className="flex flex-col gap-[24px]">
              <div className="flex flex-col gap-[8px]">
                <label className="text-caption text-text-secondary">Project name</label>
                <input 
                  type="text" 
									value={name}
  								onChange={(e) => setName(e.target.value)}
                  placeholder="My Awesome Series/Film"
                  className="w-full px-[12px] py-[10px] bg-secondary-main border border-border-default rounded-[8px] text-body-reg text-text-primary focus:outline-none focus:border-primary-main transition-colors"
                />
              </div>

              <div className="flex flex-col gap-[8px]">
                <label className="text-caption text-text-secondary">Project location</label>
                <div className="relative cursor-pointer" onClick={handleSelectFolder}>
                  <input 
                    type="text" 
                    readOnly
                    value={location || "Click to select folder..."}
                    className="w-full px-[12px] py-[10px] pr-[40px] bg-secondary-main border border-border-default rounded-[8px] text-body-reg text-text-secondary cursor-pointer"
                  />
                  <div className="absolute right-[12px] top-1/2 -translate-y-1/2 text-text-primary">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z"/>
                    </svg>
                  </div>
                </div>
                {previewPath && (
                  <p className="text-caption text-text-secondary leading-tight break-all">
                    Will be created at: <span className="text-text-primary">{previewPath}</span>
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-[8px]">
                <label className="text-caption text-text-secondary">Target language</label>
                <select
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  className="w-full px-[12px] py-[10px] bg-secondary-main border border-border-default rounded-[8px] text-body-reg text-text-primary focus:outline-none focus:border-primary-main transition-colors"
                >
                  {languageOptions.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Кнопка Create*/}
            <div className="flex justify-end">
              <button 
							onClick={handleCreate}
  						disabled={isCreating}
							className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors shadow-sm">
                {isCreating ? 'Creating...' : 'Create'}
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};