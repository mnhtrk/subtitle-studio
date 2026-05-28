import React, { useEffect, useState } from 'react';
import { projectService, RecentProject } from '../../services/projectService';
import { useI18n } from '../../i18n';
import iconNewProject from '../../assets/icons/new-project.svg';
import iconOpenProject from '../../assets/icons/open-project.svg';
import { DraggableModalShell } from './DraggableModalShell';

function welcomeIconMaskStyle(src: string): React.CSSProperties {
	return {
		maskImage: `url(${src})`,
		WebkitMaskImage: `url(${src})`,
		maskSize: 'contain',
		maskRepeat: 'no-repeat',
		maskPosition: 'center'
	};
}

interface WelcomeModalProps {
  onClose: () => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onSelectProject: (path: string) => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ onClose, onNewProject, onOpenProject, onSelectProject }) => {
  const { t } = useI18n();
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    projectService.getRecent()
      .then((data) => {
        setRecentProjects(data.slice(0, 3));
        setLoading(false);
      })
      .catch(err => {
        console.error("Ошибка загрузки проектов:", err);
        setLoading(false);
      });
  }, []);

	return (
    <DraggableModalShell
      width={780}
      className="h-[424px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none"
    >
      <div className="flex flex-col gap-[24px] flex-1 min-h-0 h-full w-full">
        {(loading || recentProjects.length > 0) && (
          <div className="flex justify-end gap-[16px] shrink-0">
            <button onClick={onClose} className="text-text-secondary hover:opacity-70 transition-opacity">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-[32px] flex-1 min-h-0">
          <div className="flex flex-col">
            <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[20px] text-text-primary mb-[24px]">{t('welcome.title')}</h1>

            {(loading || recentProjects.length > 0) && (
              <div className="flex flex-col">
                <h3 className="text-body-reg text-text-secondary mb-[8px]">{t('welcome.recentProjects')}</h3>

                <div className="flex flex-col gap-[4px]">
                  {loading ? (
                    <div className="text-body-reg text-text-secondary/50 px-[8px]">{t('welcome.loading')}</div>
                  ) : (
                    recentProjects.map((project) => (
                      <button
                        key={project.path}
                        onClick={() => onSelectProject(project.path)}
                        className="w-full text-left px-[8px] py-[4px] rounded-[5px] bg-secondary-main hover:bg-secondary-hover transition-colors flex flex-col gap-[4px]"
                      >
                        <div className="text-body-reg text-text-primary leading-[18px]">
                          {project.name}
                        </div>
                        <div className="text-caption text-text-secondary leading-[14px]">
                          {project.last_opened}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-[4px]">
            <button
							onClick={onNewProject}
							className="flex items-center justify-between px-[32px] py-[12px] rounded-[10px] bg-secondary-main hover:bg-secondary-hover transition-all flex-1 group"
						>
							<span className="text-h1-heading font-semibold tracking-[-0.01em] text-text-primary">{t('welcome.newProject')}</span>
							<span
								className="inline-block h-7 w-7 shrink-0 bg-text-primary"
								style={welcomeIconMaskStyle(iconNewProject)}
								aria-hidden
							/>
						</button>
            <button
              onClick={onOpenProject}
              className="flex items-center justify-between px-[32px] py-[12px] rounded-[10px] bg-secondary-main hover:bg-secondary-hover transition-all flex-1 group"
            >
							<span className="text-h1-heading font-semibold tracking-[-0.01em] text-text-primary">{t('welcome.openProject')}</span>
							<span
								className="inline-block h-7 w-7 shrink-0 bg-text-primary"
								style={welcomeIconMaskStyle(iconOpenProject)}
								aria-hidden
							/>
						</button>
          </div>
        </div>
      </div>
    </DraggableModalShell>
  );
};
