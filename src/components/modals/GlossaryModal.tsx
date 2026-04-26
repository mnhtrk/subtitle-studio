import React, { useCallback, useEffect, useState } from 'react';
import { GlossaryEntry, projectService } from '../../services/projectService';

interface GlossaryRow {
  entryId?: string;
  original: string;
  translated: string;
  context: string;
}

interface GlossaryModalProps {
  onClose: () => void;
  projectPath: string | null;
  onSaved?: (glossary: GlossaryEntry[]) => void;
}

const emptyRows = (n: number): GlossaryRow[] =>
  Array(n)
    .fill(null)
    .map(() => ({ original: '', translated: '', context: '' }));

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
  return mapped;
}

export const GlossaryModal: React.FC<GlossaryModalProps> = ({
  onClose,
  projectPath,
  onSaved
}) => {
  const [rows, setRows] = useState<GlossaryRow[]>(() => emptyRows(8));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!projectPath) {
      setRows(emptyRows(8));
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const entries = await projectService.getGlossary(projectPath);
      setRows(entriesToRows(entries));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      setRows(emptyRows(8));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpdate = (index: number, field: keyof GlossaryRow, value: string) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };

    if (index === newRows.length - 1 && value !== '') {
      newRows.push({ original: '', translated: '', context: '' });
    }

    setRows(newRows);
  };

  const handleSave = async () => {
    if (!projectPath) return;
    setSaving(true);
    setSaveError(null);
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
      await projectService.updateGlossary(projectPath, entries);
      onSaved?.(entries);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  const canSave = Boolean(projectPath) && !loading && !saving;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[10000] pointer-events-none">
      <div className="pointer-events-auto w-[840px] h-[560px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
        <div className="flex justify-end h-5 mb-2">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-text-secondary hover:opacity-70 transition-opacity"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex flex-col mb-8">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[32px] text-text-primary mb-2">
            Glossary
          </h1>
          <p className="text-body-reg text-text-secondary">
            Define how the AI agent should translate specific names or terms.
          </p>
          {(loadError || saveError || !projectPath) && (
            <p className="text-caption text-amber-600/90 mt-2">
              {!projectPath && 'Open a project to edit the glossary.'}
              {loadError && ` ${loadError}`}
              {saveError && ` ${saveError}`}
            </p>
          )}
        </div>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden border border-border-default rounded-[8px] bg-secondary-main">
          <div className="flex-1 overflow-y-auto subtitle-table-scroll no-scrollbar">
            <table className="w-full border-collapse table-fixed">
              <thead className="sticky top-0 bg-secondary-main z-20">
                <tr className="h-[40px] border-b border-border-default">
                  <th className="px-4 text-left text-[14px] font-bold leading-[18px] text-text-primary border-r border-border-default w-[30%]">
                    Original
                  </th>
                  <th className="px-4 text-left text-[14px] font-bold leading-[18px] text-text-primary border-r border-border-default w-[30%]">
                    Translated
                  </th>
                  <th className="px-4 text-left text-[14px] font-bold leading-[18px] text-text-primary">
                    Meaning / Context
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
                        placeholder="Type term..."
                        disabled={loading}
                      />
                    </td>
                    <td className="p-0 border-r border-border-default">
                      <input
                        type="text"
                        value={row.translated}
                        onChange={(e) => handleUpdate(i, 'translated', e.target.value)}
                        className="w-full h-full px-4 bg-transparent outline-none text-body-reg text-text-primary placeholder:text-text-secondary/60"
                        placeholder="Translation..."
                        disabled={loading}
                      />
                    </td>
                    <td className="p-0">
                      <input
                        type="text"
                        value={row.context}
                        onChange={(e) => handleUpdate(i, 'context', e.target.value)}
                        className="w-full h-full px-4 bg-transparent outline-none text-body-reg text-text-secondary placeholder:text-text-secondary/60"
                        placeholder="Optional context..."
                        disabled={loading}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end mt-8">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover disabled:opacity-40 disabled:pointer-events-none text-white text-body-reg rounded-[5px] transition-colors shadow-sm"
          >
            {saving ? '…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
};
