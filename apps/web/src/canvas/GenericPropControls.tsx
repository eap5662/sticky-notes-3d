import { useCallback, useState, useMemo } from 'react';

import { PROP_CATALOG } from '@/data/propCatalog';
import { spawnGenericProp } from '@/state/genericPropsStore';
import { setSelection } from '@/state/selectionStore';
import { useSurface, useSurfacesByKind } from './hooks/useSurfaces';

const PANEL_CLASS = 'pointer-events-auto w-56 rounded-md bg-black/70 p-3 text-sm text-white shadow-lg';
const BUTTON_CLASS = 'pointer-events-auto rounded-full bg-black/70 px-3 py-1 text-xs uppercase tracking-wide text-white shadow hover:bg-black/80';
const DESK_CLEARANCE = 0.015; // Same as GenericProp.tsx

export default function GenericPropControls({ className = '' }: { className?: string } = {}) {
  const [isOpen, setIsOpen] = useState(false);

  // Get desk surface for spawn height calculation
  const deskSurfaces = useSurfacesByKind('desk');
  const deskSurfaceId = deskSurfaces[0]?.id;
  const deskSurface = useSurface(deskSurfaceId ?? '');

  const deskHeight = useMemo(() => {
    if (!deskSurface) return null;
    return deskSurface.origin[1];
  }, [deskSurface]);

  const handleSpawn = useCallback((catalogId: string) => {
    const entry = PROP_CATALOG.find((item) => item.id === catalogId);
    if (!entry) return;

    // Calculate spawn position - if desk exists, spawn at desk height + clearance
    // Otherwise use default staging position
    let position: [number, number, number] | undefined;
    if (deskHeight !== null) {
      // Spawn props at desk surface + small clearance
      // Use same x/z as staging position but adjust y to desk height
      position = [0.6, deskHeight + DESK_CLEARANCE, -0.2];
    }

    const prop = spawnGenericProp({
      catalogId: entry.id,
      label: entry.label,
      url: entry.url,
      anchor: entry.anchor,
      position,
    });

    setSelection({ kind: 'generic', id: prop.id });
    setIsOpen(false);
  }, [deskHeight]);

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
