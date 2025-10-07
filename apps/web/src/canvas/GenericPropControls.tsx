import { useCallback, useState, useMemo } from 'react';

import { PROP_CATALOG } from '@/data/propCatalog';
import { spawnGenericProp } from '@/state/genericPropsStore';
import { setSelection } from '@/state/selectionStore';
import { useSurface, useSurfacesByKind } from './hooks/useSurfaces';
import { useGenericProps } from './hooks/useGenericProps';
import { useUndoHistoryStore, type GenericPropSnapshot } from '@/state/undoHistoryStore';

const PANEL_CLASS = 'pointer-events-auto w-56 rounded-md bg-black/70 p-3 text-sm text-white shadow-lg';
const BUTTON_CLASS = 'pointer-events-auto rounded-full bg-black/70 px-3 py-1 text-xs uppercase tracking-wide text-white shadow hover:bg-black/80';
const DESK_CLEARANCE = 0.015; // Same as GenericProp.tsx

export default function GenericPropControls({ className = '' }: { className?: string } = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const pushAction = useUndoHistoryStore((s) => s.push);

  // Get all spawned props to check for duplicates
  const genericProps = useGenericProps();

  // Get desk surface for spawn height calculation
  const deskSurfaces = useSurfacesByKind('desk');
  const deskSurfaceId = deskSurfaces[0]?.id;
  const deskSurface = useSurface(deskSurfaceId ?? '');

  const deskHeight = useMemo(() => {
    if (!deskSurface) return null;
    return deskSurface.origin[1];
  }, [deskSurface]);

  // Check if a catalog item is already spawned
  const isAlreadySpawned = useCallback((catalogId: string) => {
    return genericProps.some(prop => prop.catalogId === catalogId);
  }, [genericProps]);

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
      rotation: entry.defaultRotation,
    });

    // Push spawn action to undo stack
    const snapshot: GenericPropSnapshot = {
      id: prop.id,
      catalogId: prop.catalogId ?? '',
      label: prop.label,
      url: prop.url,
      anchor: prop.anchor,
      position: prop.position,
      rotation: prop.rotation,
      scale: prop.scale,
      docked: prop.docked,
      dockOffset: prop.dockOffset,
    };

    pushAction({
      type: 'spawn',
      propId: prop.id,
      snapshot,
    });

    setSelection({ kind: 'generic', id: prop.id });
    setIsOpen(false);
  }, [deskHeight, pushAction]);

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
            {PROP_CATALOG.map((entry) => {
              const alreadySpawned = isAlreadySpawned(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  disabled={alreadySpawned}
                  className={`w-full rounded border px-2 py-1 text-left text-xs uppercase tracking-wide ${
                    alreadySpawned
                      ? 'cursor-not-allowed border-white/10 bg-white/5 text-white/30'
                      : 'border-white/30 hover:bg-white/10'
                  }`}
                  onClick={() => !alreadySpawned && handleSpawn(entry.id)}
                >
                  {entry.label} {alreadySpawned && '(In Scene)'}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
