import React, { useEffect, useState } from 'react';
import type { GlossaryEntry } from '../../services/projectService';
import { useI18n } from '../../i18n';

interface GlossaryRow {
  entryId?: string;
  original: string;
  translated: string;
  context: string;
}

interface GlossaryModalProps {
  onClose: () => void;
  projectPath: string | null;
  initialEntries: GlossaryEntry[];
  onSaved?: (glossary: GlossaryEntry[], changes: GlossaryReplacementChange[]) => void;
}

export interface GlossaryReplacementChange {
  id: string;
  oldSource: string;
  newSource: string;
  oldTarget: string;
  newTarget: string;
  oldContext: string;
  newContext: string;
}

function entriesToRows(entries: GlossaryEntry[]): GlossaryRow[] {
  const mapped: GlossaryRow[] = entries.map((e) => ({
    entryId: e.id,
    original: e.source,
    translated: e.target,
    context: (e.context ?? e.description ?? '').trim()
  }));
  while (mapped.length < 8) {
    mapped.push({ original: '', translated: '', context: '' });
  }
  const last = mapped[mapped.length - 1];
  if (
    last.original.trim() !== '' ||
    last.translated.trim() !== '' ||
    last.context.trim() !== ''
  ) {
    mapped.push({ original: '', translated: '', context: '' });
  }
  return mapped;
}

function collectReplacementChanges(
  previous: GlossaryEntry[],
  next: GlossaryEntry[]
): GlossaryReplacementChange[] {
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));
  return next
    .map((entry) => {
      const prev = previousById.get(entry.id);
      if (!prev) return null;

      const oldSource = prev.source.trim();
      const newSource = entry.source.trim();
      const oldTarget = prev.target.trim();
      const newTarget = entry.target.trim();
      const oldContext = (prev.context ?? prev.description ?? '').trim();
      const newContext = (entry.context ?? entry.description ?? '').trim();

      if (oldSource === newSource && oldTarget === newTarget) {
        return null;
      }

      return {
        id: entry.id,
        oldSource,
        newSource,
        oldTarget,
        newTarget,
        oldContext,
        newContext
      };
    })
    .filter((change): change is GlossaryReplacementChange => Boolean(change));
}

export const GlossaryModal: React.FC<GlossaryModalProps> = ({
  onClose,
  projectPath,
  initialEntries,
  onSaved
}) => {
  const { t } = useI18n();
  const [rows, setRows] = useState<GlossaryRow[]>(() => entriesToRows(initialEntries));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadedEntries, setLoadedEntries] = useState<GlossaryEntry[]>(initialEntries);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRows(entriesToRows(initialEntries));
    setLoadedEntries(initialEntries);
    setSaveError(null);
  }, [initialEntries]);

  const handleUpdate = (index: number, field: keyof GlossaryRow, value: string) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };

    if (index === newRows.length - 1 && value !== '') {
      newRows.push({ original: '', translated: '', context: '' });
    }

    setRows(newRows);
  };

  const handleSave = async () => {
    if (!projectPath || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      const entries: GlossaryEntry[] = rows
        .filter((r) => r.original.trim().length > 0)
        .map((r) => ({
          id: r.entryId ?? crypto.randomUUID(),
          source: r.original.trim(),
          target: r.translated.trim(),
          description: null,
          context: r.context.trim() || null
        }));
      const changes = collectReplacementChanges(loadedEntries, entries);
      // Только в память проекта; на диск — при «Сохранить проект»
      onSaved?.(entries, changes);
      setLoadedEntries(entries);
      setRows(entriesToRows(entries));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  const canSave = Boolean(projectPath) && !saving;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto w-[840px] h-[560px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col overflow-hidden select-none">
        <div className="shrink-0 flex justify-end h-5 mb-2">
            <button
              type="button"
              onClick={onClose}
              className="text-text-secondary hover:opacity-70 transition-opacity"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
        </div>

        <div className="shrink-0 flex flex-col mb-4">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[32px] text-text-primary mb-2">
            {t('glossary.title')}
          </h1>
          <p className="text-body-reg text-text-secondary">
            {t('glossary.desc')}
          </p>
          {(saveError || !projectPath) && (
            <p className="text-caption text-amber-600/90 mt-2">
              {!projectPath && t('glossary.openProjectFirst')}
              {saveError && ` ${saveError}`}
            </p>
          )}
        </div>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden border border-border-default rounded-[8px] bg-secondary-main">
          <div className="flex-1 overflow-y-auto subtitle-table-scroll no-scrollbar">
            <table className="w-full border-collapse table-fixed">
              <thead className="sticky top-0 bg-secondary-main z-10">
                <tr className="h-[40px] border-b border-border-default">
                  <th className="px-4 text-left text-[14px] font-bold leading-[18px] text-text-primary border-r border-border-default w-[30%]">
                    {t('glossary.original')}
                  </th>
                  <th className="px-4 text-left text-[14px] font-bold leading-[18px] text-text-primary border-r border-border-default w-[30%]">
                    {t('glossary.translated')}
                  </th>
                  <th className="px-4 text-left text-[14px] font-bold leading-[18px] text-text-primary">
                    {t('glossary.context')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-secondary-main">
                {rows.map((row, i) => (
                  <tr
                    key={row.entryId ?? `row-${i}`}
                    className="h-[40px] border-b border-border-default hover:bg-black/5 transition-colors group"
                  >
                    <td className="p-0 border-r border-border-default">
                      <input
                        type="text"
                        value={row.original}
                        onChange={(e) => handleUpdate(i, 'original', e.target.value)}
                        className="w-full h-full px-4 bg-transparent outline-none text-body-reg text-text-primary placeholder:text-text-secondary/60"
                        placeholder={t('glossary.termPlaceholder')}
                      />
                    </td>
                    <td className="p-0 border-r border-border-default">
                      <input
                        type="text"
                        value={row.translated}
                        onChange={(e) => handleUpdate(i, 'translated', e.target.value)}
                        className="w-full h-full px-4 bg-transparent outline-none text-body-reg text-text-primary placeholder:text-text-secondary/60"
                        placeholder={t('glossary.translationPlaceholder')}
                      />
                    </td>
                    <td className="p-0">
                      <input
                        type="text"
                        value={row.context}
                        onChange={(e) => handleUpdate(i, 'context', e.target.value)}
                        className="w-full h-full px-4 bg-transparent outline-none text-body-reg text-text-secondary placeholder:text-text-secondary/60"
                        placeholder={t('glossary.contextPlaceholder')}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="shrink-0 flex justify-end pt-6">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover disabled:opacity-40 disabled:pointer-events-none text-white text-body-reg rounded-[5px] transition-colors shadow-sm"
          >
            {t('glossary.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  );
};
