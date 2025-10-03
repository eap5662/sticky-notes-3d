import { useCallback, useState } from 'react';

import { PROP_CATALOG } from '@/data/propCatalog';
import { spawnGenericProp } from '@/state/genericPropsStore';
import { setSelection } from '@/state/selectionStore';

const PANEL_CLASS = 'pointer-events-auto w-56 rounded-md bg-black/70 p-3 text-sm text-white shadow-lg';
const BUTTON_CLASS = 'pointer-events-auto rounded-full bg-black/70 px-3 py-1 text-xs uppercase tracking-wide text-white shadow hover:bg-black/80';

export default function GenericPropControls({ className = '' }: { className?: string } = {}) {
  const [isOpen, setIsOpen] = useState(false);

  const handleSpawn = useCallback((catalogId: string) => {
    const entry = PROP_CATALOG.find((item) => item.id === catalogId);
    if (!entry) return;

    const prop = spawnGenericProp({
      catalogId: entry.id,
      label: entry.label,
      url: entry.url,
      anchor: entry.anchor,
    });

    setSelection({ kind: 'generic', id: prop.id });
    setIsOpen(false);
  }, []);

  const containerClass = ['pointer-events-none flex flex-col items-end gap-2', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClass}>
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {isOpen ? 'Close Props' : 'Add Prop'}
      </button>

      {isOpen && (
        <div className={PANEL_CLASS}>
          <div className="text-xs uppercase tracking-wide text-white/70">Prop Catalog</div>
          <div className="mt-2 flex flex-col gap-2">
            {PROP_CATALOG.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="w-full rounded border border-white/30 px-2 py-1 text-left text-xs uppercase tracking-wide hover:bg-white/10"
                onClick={() => handleSpawn(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
