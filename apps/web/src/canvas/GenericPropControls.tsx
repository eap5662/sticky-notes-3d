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
  const [searchQuery, setSearchQuery] = useState('');
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

  // Filtered and sorted catalog
  const filteredCatalog = useMemo(() => {
    let filtered = PROP_CATALOG;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(entry =>
        entry.label.toLowerCase().includes(query) ||
        entry.id.toLowerCase().includes(query)
      );
    }

    // Sort alphabetically by label
    return filtered.slice().sort((a, b) => a.label.localeCompare(b.label));
  }, [searchQuery]);

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
      scale: entry.defaultScale ? [entry.defaultScale, entry.defaultScale, entry.defaultScale] : [1, 1, 1],
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
        <div className="pointer-events-auto w-72 rounded-lg bg-black/70 text-sm text-white shadow-lg flex flex-col" style={{ maxHeight: '60vh' }}>
          {/* Sticky Header */}
          <div className="px-4 py-3 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wide text-white/70">Prop Catalog</div>
              <div className="text-[10px] text-white/50">{filteredCatalog.length} props</div>
            </div>
            <input
              type="text"
              placeholder="Search props..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-white/30 bg-black/50 px-3 py-1.5 text-sm text-white placeholder:text-white/40 focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
            />
          </div>

          {/* Scrollable Content - Custom Scrollbar */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 custom-scrollbar">
            {filteredCatalog.length === 0 ? (
              <div className="text-center text-white/40 py-6 text-xs">
                No props found
              </div>
            ) : (
              filteredCatalog.map((entry) => {
                const alreadySpawned = isAlreadySpawned(entry.id);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={alreadySpawned}
                    className={`group w-full rounded-lg border px-4 text-left text-xs flex items-center justify-between transition-all
                      ${alreadySpawned
                        ? 'h-12 cursor-not-allowed border-green-500/30 bg-green-500/5'
                        : 'h-12 border-white/30 bg-black/20 hover:bg-white/10 hover:border-white/50 focus:outline-none focus:ring-2 focus:ring-white/40'
                      }`}
                    onClick={() => !alreadySpawned && handleSpawn(entry.id)}
                  >
                    <span className={`uppercase tracking-wide ${alreadySpawned ? 'text-white/60' : 'text-white'}`}>
                      {entry.label}
                    </span>
                    {alreadySpawned && (
                      <span className="inline-flex items-center rounded-full bg-green-500/30 px-2.5 py-1 text-[10px] font-medium text-green-200 uppercase tracking-wider">
                        In Scene
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Custom Scrollbar Styles */}
          <style jsx>{`
            .custom-scrollbar::-webkit-scrollbar {
              width: 6px;
            }
            .custom-scrollbar::-webkit-scrollbar-track {
              background: transparent;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb {
              background: rgba(255, 255, 255, 0.15);
              border-radius: 3px;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
              background: rgba(255, 255, 255, 0.25);
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
