import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { open, message } from '@tauri-apps/plugin-dialog';
import { useI18n } from '../../i18n';
import { projectService, type ProjectFile } from '../../services/projectService';
import { DraggableModalShell } from './DraggableModalShell';

const EXPORT_FORMATS = ['srt', 'ass', 'vtt', 'txt', 'pdf'] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

const FORMAT_LABEL_KEYS: Record<ExportFormat, 'export.formatSrt' | 'export.formatAss' | 'export.formatVtt' | 'export.formatTxt' | 'export.formatPdf'> = {
  srt: 'export.formatSrt',
  ass: 'export.formatAss',
  vtt: 'export.formatVtt',
  txt: 'export.formatTxt',
  pdf: 'export.formatPdf'
};

function joinExportPath(dir: string, fileName: string): string {
  const base = dir.replace(/[/\\]+$/, '');
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base}${sep}${fileName}`;
}

function outputFileName(sourceName: string, format: ExportFormat): string {
  const stem = sourceName.replace(/\.[^/.\\]+$/, '') || sourceName;
  return `${stem}.${format}`;
}

interface ExportModalProps {
  onClose: () => void;
  projectPath: string | null;
  subtitleFiles: ProjectFile[];
  onPrepareExport?: () => Promise<void>;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  onClose,
  projectPath,
  subtitleFiles,
  onPrepareExport
}) => {
  const { t } = useI18n();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [format, setFormat] = useState<ExportFormat>('srt');
  const [outputDir, setOutputDir] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<{ count: number; folder: string } | null>(null);

  const files = useMemo(
    () => subtitleFiles.filter((f) => f.path.replace(/\\/g, '/').startsWith('subtitles/')),
    [subtitleFiles]
  );

  useEffect(() => {
    setSelectedIds(new Set(files.map((f) => f.id)));
  }, [files]);

  useEffect(() => {
    if (projectPath && !outputDir) {
      setOutputDir(joinExportPath(projectPath, 'Exports'));
    }
  }, [projectPath, outputDir]);

  const allSelected = files.length > 0 && files.every((f) => selectedIds.has(f.id));
  const someSelected = files.some((f) => selectedIds.has(f.id));

  const toggleFile = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(files.map((f) => f.id)));
    }
  };

  const handleSelectFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('export.selectFolder'),
        defaultPath: outputDir || projectPath || undefined
      });
      if (selected && typeof selected === 'string') {
        setOutputDir(selected);
      }
    } catch (err) {
      console.error('export folder dialog', err);
    }
  }, [outputDir, projectPath, t]);

  const handleExport = async () => {
    if (!projectPath) {
      await message(t('export.openProjectFirst'), { kind: 'info', title: t('export.title') });
      return;
    }
    if (!outputDir.trim()) {
      await message(t('export.selectFolderFirst'), { kind: 'warning', title: t('export.title') });
      return;
    }
    const toExport = files.filter((f) => selectedIds.has(f.id));
    if (toExport.length === 0) {
      await message(t('export.noFilesSelected'), { kind: 'warning', title: t('export.title') });
      return;
    }

    setExporting(true);
    try {
      await onPrepareExport?.();
      for (const file of toExport) {
        const outPath = joinExportPath(outputDir, outputFileName(file.name, format));
        await projectService.exportSubtitles(projectPath, file.id, format, outPath);
      }
      setExportSuccess({ count: toExport.length, folder: outputDir });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      await message(t('export.exportFailed', { detail }), {
        kind: 'error',
        title: t('export.title')
      });
    } finally {
      setExporting(false);
    }
  };

  const selectChevron = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="pointer-events-none shrink-0"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );

  if (exportSuccess) {
    return (
      <DraggableModalShell
        width={480}
        className="bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none"
      >
          <div className="flex justify-end h-5 mb-2">
            <button type="button" onClick={onClose} className="text-text-secondary hover:opacity-70 transition-opacity">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex flex-col mb-8">
            <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[32px] text-text-primary mb-2">
              {t('export.successTitle')}
            </h1>
            <p className="text-body-reg text-text-secondary break-words whitespace-pre-line">
              {t('export.successDesc', { count: exportSuccess.count, folder: exportSuccess.folder })}
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="min-w-[112px] h-[26px] px-4 flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors shadow-sm"
            >
              {t('export.successOk')}
            </button>
          </div>
      </DraggableModalShell>
    );
  }

  return (
    <DraggableModalShell
      width={840}
      className="h-[560px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none"
    >
        {/* РЯД 1 Хедер с кнопкой закрытия */}
        <div className="flex justify-end h-5 mb-2"> 
          <button type="button" onClick={onClose} className="text-text-secondary hover:opacity-70 transition-opacity">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Заголовки окна */}
        <div className="flex flex-col mb-8">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[32px] text-text-primary mb-2">
            {t('export.title')}
          </h1>
          <p className="text-body-reg text-text-secondary">
            {t('export.desc')}
          </p>
        </div>

        {/* РЯД 2 Основной контент Таблица + Поля */}
        <div className="grid grid-cols-[1fr_1.1fr] gap-[32px] flex-1 min-h-0">
          
          {/* Левая часть: Список файлов */}
          <div className="flex flex-col min-h-0 border border-border-default rounded-[8px] bg-secondary-main overflow-hidden">
             <label className="h-[40px] border-b border-border-default flex items-center px-4 gap-3 bg-secondary-main sticky top-0 z-10 cursor-pointer">
                <input
                  type="checkbox"
                  className="export-modal-checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={toggleAll}
                />
                <span className="text-caption text-text-secondary">{t('export.selectAll')}</span>
             </label>
             
             {/* Тот самый скроллбар */}
             <div className="flex-1 overflow-y-auto subtitle-table-scroll">
                {files.length === 0 ? (
                  <div className="h-[40px] flex items-center px-4 text-body-reg text-text-secondary">
                    {t('export.noSubtitleFiles')}
                  </div>
                ) : (
                  files.map((file) => (
                    <label
                      key={file.id}
                      className="h-[40px] border-b border-border-default last:border-0 flex items-center px-4 gap-3 hover:bg-black/5 transition-colors cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="export-modal-checkbox"
                        checked={selectedIds.has(file.id)}
                        onChange={() => toggleFile(file.id)}
                      />
                      <span className="text-body-reg text-text-primary truncate">{file.name}</span>
                    </label>
                  ))
                )}
             </div>
          </div>

          {/* Правая часть Настройки */}
          <div className="flex flex-col gap-[24px]">
            <div className="flex flex-col gap-[8px]">
              <label className="text-caption text-text-secondary">{t('export.fileFormat')}</label>
              <div className="relative w-full">
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as ExportFormat)}
                  className="w-full appearance-none px-[12px] py-[10px] pr-10 bg-secondary-main border border-border-default rounded-[8px] text-body-reg text-text-primary cursor-pointer hover:border-primary-main transition-colors"
                >
                  {EXPORT_FORMATS.map((fmt) => (
                    <option key={fmt} value={fmt}>
                      {t(FORMAT_LABEL_KEYS[fmt])}
                    </option>
                  ))}
                </select>
                <div className="absolute right-[12px] top-1/2 -translate-y-1/2 text-text-primary">
                  {selectChevron}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-[8px]">
              <label className="text-caption text-text-secondary">{t('export.savingLocation')}</label>
              <div className="relative">
                <input 
                  type="text" 
                  readOnly
                  value={outputDir}
                  onClick={() => { void handleSelectFolder(); }}
                  placeholder={t('export.selectFolderPlaceholder')}
                  className="w-full px-[12px] py-[10px] pr-[40px] bg-secondary-main border border-border-default rounded-[8px] text-body-reg text-text-secondary overflow-hidden text-ellipsis cursor-pointer hover:border-primary-main transition-colors"
                />
                <button
                  type="button"
                  onClick={() => { void handleSelectFolder(); }}
                  className="absolute right-[12px] top-1/2 -translate-y-1/2 text-text-primary cursor-pointer hover:text-primary-main"
                  aria-label={t('export.selectFolder')}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* РЯД 3 Нижняя кнопка действия */}
        <div className="flex justify-end mt-8">
          <button
            type="button"
            disabled={exporting || !projectPath}
            onClick={() => { void handleExport(); }}
            className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-body-reg rounded-[5px] transition-colors shadow-sm"
          >
            {t('export.exportFiles')}
          </button>
        </div>

    </DraggableModalShell>
  );
};
