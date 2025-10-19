import { useCallback, useState, useMemo } from 'react';

import { PROP_CATALOG, CATEGORY_DEFINITIONS, SURFACE_TYPE_ICONS, type PropCategory } from '@/data/propCatalog';
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
  const [enabledCategories, setEnabledCategories] = useState<Set<PropCategory>>(new Set());
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

  // Toggle category filter
  const toggleCategory = useCallback((category: PropCategory) => {
    setEnabledCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  // Get sorted categories by order
  const sortedCategories = useMemo(() => {
    return Object.values(CATEGORY_DEFINITIONS).sort((a, b) => a.order - b.order);
  }, []);

  // Filtered and grouped catalog
  const groupedCatalog = useMemo(() => {
    let filtered = PROP_CATALOG;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(entry =>
        entry.label.toLowerCase().includes(query) ||
        entry.id.toLowerCase().includes(query)
      );
    }

    // Apply category filter
    if (enabledCategories.size > 0) {
      if (enabledCategories.size === 1) {
        // Single filter: show props that have this category (primary OR secondary)
        filtered = filtered.filter(entry =>
          entry.categories.some(cat => enabledCategories.has(cat))
        );
      } else {
        // Multiple filters (AND logic): show ONLY props that have ALL selected categories
        filtered = filtered.filter(entry => {
          const enabledArray = Array.from(enabledCategories);
          return enabledArray.every(cat => entry.categories.includes(cat));
        });
      }
    }

    // Group by primary category
    const grouped = new Map<PropCategory, typeof PROP_CATALOG>();
    for (const entry of filtered) {
      if (!grouped.has(entry.primaryCategory)) {
        grouped.set(entry.primaryCategory, []);
      }
      grouped.get(entry.primaryCategory)!.push(entry);
    }

    // Sort each category's props:
    // 1. Primary category matches first (when filtering is active)
    // 2. Then alphabetically within each priority group
    for (const [category, props] of grouped) {
      props.sort((a, b) => {
        // If category filtering is active, prioritize primary category matches
        if (enabledCategories.size > 0) {
          const aIsPrimary = enabledCategories.has(a.primaryCategory);
          const bIsPrimary = enabledCategories.has(b.primaryCategory);

          if (aIsPrimary && !bIsPrimary) return -1;
          if (!aIsPrimary && bIsPrimary) return 1;
        }

        // Then sort alphabetically
        return a.label.localeCompare(b.label);
      });
    }

    // Build groups array and sort
    let groups = sortedCategories
      .map(catDef => ({ category: catDef, props: grouped.get(catDef.id) || [] }))
      .filter(group => group.props.length > 0);

    // When filtering is active, reorder groups to show filtered category groups first
    if (enabledCategories.size > 0) {
      groups.sort((a, b) => {
        const aIsFiltered = enabledCategories.has(a.category.id);
        const bIsFiltered = enabledCategories.has(b.category.id);

        if (aIsFiltered && !bIsFiltered) return -1;
        if (!aIsFiltered && bIsFiltered) return 1;

        // Maintain category order for groups of same priority
        return a.category.order - b.category.order;
      });
    }

    return groups;
  }, [searchQuery, enabledCategories, sortedCategories]);

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
        <div className="pointer-events-auto w-72 rounded-lg bg-black/70 text-sm text-white shadow-lg flex flex-col" style={{ maxHeight: '80vh' }}>
          {/* Sticky Header */}
          <div className="px-4 py-3 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wide text-white/70">Prop Catalog</div>
              <div className="text-[10px] text-white/50">
                {groupedCatalog.reduce((sum, group) => sum + group.props.length, 0)} props
              </div>
            </div>

            <input
              type="text"
              placeholder="Search props..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-white/30 bg-black/50 px-3 py-1.5 text-sm text-white placeholder:text-white/40 focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all mb-3"
            />

            {/* Category Filters */}
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-white/50 mb-1.5">Filter by Category</div>
              <div className="grid grid-cols-2 gap-1.5">
                {sortedCategories.map((catDef) => (
                  <label
                    key={catDef.id}
                    className="flex items-center gap-1.5 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={enabledCategories.has(catDef.id)}
                      onChange={() => toggleCategory(catDef.id)}
                      className="w-3 h-3 rounded border-white/30 bg-black/50 text-white/80 focus:ring-2 focus:ring-white/20 cursor-pointer flex-shrink-0"
                    />
                    <span
                      className="text-[11px] py-0.5 rounded border group-hover:opacity-90 transition-opacity flex-1 relative"
                      style={{
                        borderColor: catDef.borderColor,
                        color: 'rgba(255, 255, 255, 0.85)',
                        paddingLeft: catDef.id === 'surface' ? '2.25rem' : '1.75rem',
                        paddingRight: '0.5rem',
                        textAlign: 'center'
                      }}
                    >
                      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                        {catDef.id === 'surface' ? (
                          // Special case for Surfaces: show both monitor and board icons
                          <>
                            <span className="text-xs">{SURFACE_TYPE_ICONS.monitor}</span>
                            <img
                              src={SURFACE_TYPE_ICONS.board}
                              alt="board"
                              className="w-3 h-3 inline-block"
                            />
                          </>
                        ) : catDef.iconPath ? (
                          <img
                            src={catDef.iconPath}
                            alt={catDef.label}
                            className="w-4 h-4 inline-block"
                          />
                        ) : (
                          catDef.icon
                        )}
                      </span>
                      {catDef.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Scrollable Content - Custom Scrollbar */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 custom-scrollbar">
            {groupedCatalog.length === 0 ? (
              <div className="text-center text-white/40 py-6 text-xs">
                No props found
              </div>
            ) : (
              groupedCatalog.map(({ category, props }) => (
                <div
                  key={category.id}
                  className="rounded-lg border-2 p-2 space-y-2"
                  style={{ borderColor: category.borderColor }}
                >
                  {/* Category Props */}
                  {props.map((entry) => {
                    const alreadySpawned = isAlreadySpawned(entry.id);
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        disabled={alreadySpawned}
                        className={`group w-full rounded-lg px-4 text-left text-xs flex items-center justify-between transition-all h-12
                          ${alreadySpawned
                            ? 'cursor-not-allowed'
                            : 'hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-white/40'
                          }`}
                        style={{
                          backgroundColor: category.bgColor
                        }}
                        onClick={() => !alreadySpawned && handleSpawn(entry.id)}
                      >
                        <span className={`tracking-wide ${alreadySpawned ? 'text-black/50' : 'text-black/90'}`}>
                          {entry.label}
                        </span>
                        <div className="flex items-center gap-2">
                          {alreadySpawned && (
                            <span className="inline-flex items-center rounded-full bg-green-500/30 px-2.5 py-1 text-[10px] font-medium text-green-200 uppercase tracking-wider">
                              In Scene
                            </span>
                          )}
                          {/* Category badges (max 3) - wrapped in dark chip */}
                          {!alreadySpawned && entry.categories.length > 0 && (
                            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/15">
                              {entry.categories.slice(0, 3).map((cat) => {
                                const catMeta = CATEGORY_DEFINITIONS[cat];

                                // Special case: for surface category, show specific surfaceType icon instead
                                if (cat === 'surface' && entry.surfaceType) {
                                  const surfaceIcon = SURFACE_TYPE_ICONS[entry.surfaceType];
                                  const isImagePath = surfaceIcon.startsWith('/');
                                  return (
                                    <span key={cat} className="text-xs" title={entry.surfaceType}>
                                      {isImagePath ? (
                                        <img
                                          src={surfaceIcon}
                                          alt={entry.surfaceType}
                                          className="w-3 h-3 inline-block"
                                        />
                                      ) : (
                                        surfaceIcon
                                      )}
                                    </span>
                                  );
                                }

                                return (
                                  <span key={cat} className="text-xs" title={catMeta.label}>
                                    {catMeta.iconPath ? (
                                      <img
                                        src={catMeta.iconPath}
                                        alt={catMeta.label}
                                        className="w-3 h-3 inline-block"
                                      />
                                    ) : (
                                      catMeta.icon
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
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
