import React, { useState } from 'react';

interface GlossaryRow {
  original: string;
  translated: string;
  context: string;
}

interface GlossaryModalProps {
  onClose: () => void;
}

export const GlossaryModal: React.FC<GlossaryModalProps> = ({ onClose }) => {
  // Инициализируем 8 пустых строк для заполнения
  const [rows, setRows] = useState<GlossaryRow[]>(
    Array(8).fill(null).map(() => ({ original: '', translated: '', context: '' }))
  );

  // Функция обновления конкретной ячейки
  const handleUpdate = (index: number, field: keyof GlossaryRow, value: string) => {
    const newRows = [...rows];
    newRows[index][field] = value;

    // Если пользователь начал писать в самой последней строке, автоматически добавляем еще одну пустую
    if (index === rows.length - 1 && value !== '') {
      newRows.push({ original: '', translated: '', context: '' });
    }
    
    setRows(newRows);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[10000] pointer-events-none">
      <div className="pointer-events-auto w-[840px] h-[560px] bg-surface-secondary border border-border-default rounded-[20px] shadow-2xl p-8 flex flex-col select-none">
        
        {/* Хедер модалки */}
        <div className="flex justify-end h-5 mb-2"> 
          <div className="flex items-center gap-2">
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-secondary cursor-pointer hover:opacity-70 transition-opacity"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
             <button onClick={onClose} className="text-text-secondary hover:opacity-70 transition-opacity">
               <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
             </button>
          </div>
        </div>

        {/* Заголовки */}
        <div className="flex flex-col mb-8">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] leading-[32px] text-text-primary mb-2">
            Glossary
          </h1>
          <p className="text-body-reg text-text-secondary">
            Define how the AI agent should translate specific names or terms.
          </p>
        </div>

        {/* Таблица */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden border border-border-default rounded-[8px] bg-secondary-main">
          <div className="flex-1 overflow-y-auto subtitle-table-scroll no-scrollbar">
            <table className="w-full border-collapse table-fixed">
              <thead className="sticky top-0 bg-secondary-main z-20">
                <tr className="h-[40px] border-b border-border-default">
                  <th className="px-4 text-left text-[14px] font-bold leading-[18px] text-text-primary border-r border-border-default w-[30%]">Original</th>
                  <th className="px-4 text-left text-[14px] font-bold leading-[18px] text-text-primary border-r border-border-default w-[30%]">Translated</th>
                  <th className="px-4 text-left text-[14px] font-bold leading-[18px] text-text-primary">Meaning / Context</th>
                </tr>
              </thead>
              <tbody className="bg-secondary-main">
                {rows.map((row, i) => (
                  <tr key={i} className="h-[40px] border-b border-border-default hover:bg-black/5 transition-colors group">
                    <td className="p-0 border-r border-border-default">
                      <input 
                        type="text"
                        value={row.original}
                        onChange={(e) => handleUpdate(i, 'original', e.target.value)}
                        className="w-full h-full px-4 bg-transparent outline-none text-body-reg text-text-primary placeholder:opacity-30"
                        placeholder="Type term..."
                      />
                    </td>
                    <td className="p-0 border-r border-border-default">
                      <input 
                        type="text"
                        value={row.translated}
                        onChange={(e) => handleUpdate(i, 'translated', e.target.value)}
                        className="w-full h-full px-4 bg-transparent outline-none text-body-reg text-text-primary placeholder:opacity-30"
                        placeholder="Translation..."
                      />
                    </td>
                    <td className="p-0">
                      <input 
                        type="text"
                        value={row.context}
                        onChange={(e) => handleUpdate(i, 'context', e.target.value)}
                        className="w-full h-full px-4 bg-transparent outline-none text-body-reg text-text-secondary placeholder:opacity-30"
                        placeholder="Optional context..."
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Футер */}
        <div className="flex justify-end mt-8">
          <button className="w-[112px] h-[26px] flex items-center justify-center bg-primary-main hover:bg-primary-hover text-white text-body-reg rounded-[5px] transition-colors shadow-sm">
            Save changes
          </button>
        </div>

      </div>
    </div>
  );
};