import { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { PROP_CATALOG, CATEGORY_DEFINITIONS, SURFACE_TYPE_ICONS, type PropCategory, type PropCatalogEntry } from '@/data/propCatalog';
import { spawnGenericProp } from '@/state/genericPropsStore';
import { setSelection, clearSelection, getSelection, subscribeSelection } from '@/state/selectionStore';
import { useSurface, useSurfaceMeta, useSurfacesByKind } from './hooks/useSurfaces';
import { useGenericProps } from './hooks/useGenericProps';
import { useUndoHistoryStore } from '@/state/undoHistoryStore';
import { createSnapshotFromProp } from '@/state/genericPropsStore';
import { registerCatalogCloseHandler } from '@/state/catalogState';
import { useDelayedVisibility } from './hooks/useDelayedVisibility';
import PropPreviewOverlay from '@/canvas/PropPreviewOverlay';
import { useGLTF } from '@react-three/drei';
import { useDeskSwapStore, completeDeskSwap, cancelDeskSwap, setDeskSwapPreviewEntry } from '@/state/deskSwapStore';
import { getSurfaceSpawnPoint } from '@/canvas/math/surfaceFrame';

function lightenHex(base: string, amount = 0.2): string {
  const hex = base.startsWith('#') ? base.slice(1) : base;
  if (hex.length !== 6) return base;
  const num = parseInt(hex, 16);
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  const apply = (channel: number) => clamp(channel + (255 - channel) * amount);
  const r = apply((num >> 16) & 0xff);
  const g = apply((num >> 8) & 0xff);
  const b = apply(num & 0xff);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

const PANEL_CLASS = 'pointer-events-auto w-56 rounded-md bg-black/70 p-3 text-sm text-white shadow-lg';
const BUTTON_CLASS =
  'pointer-events-auto rounded-full border border-white/25 bg-black/70 px-3 py-1 text-xs uppercase tracking-wide text-white shadow transition-colors duration-150 hover:border-green-400 hover:bg-green-500 hover:text-black focus:outline-none focus:ring-2 focus:ring-green-400/60';
const DESK_CLEARANCE = 0.015; // Same as GenericProp.tsx

export default function GenericPropControls({ className = '' }: { className?: string } = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [enabledCategories, setEnabledCategories] = useState<Set<PropCategory>>(new Set());
  const pushAction = useUndoHistoryStore((s) => s.push);
  const [hoveredItem, setHoveredItem] = useState<{ entry: PropCatalogEntry; element: HTMLElement } | null>(null);
  const [hoverRect, setHoverRect] = useState<DOMRectReadOnly | null>(null);
  const hoverIntentRef = useRef<number | null>(null);
  const prevCategoriesRef = useRef<Set<PropCategory> | null>(null);
  const prevSearchRef = useRef<string>('');

  const swapStoreState = useDeskSwapStore((s) => s);
  const isSwapActive = swapStoreState.active;
  const pendingReviewEntryId = swapStoreState.pendingReview?.entry.id ?? null;
  const hasPreviewState = Boolean(swapStoreState.previewEntry || swapStoreState.previewAnalysis);

  // Coordinate catalog visibility with prop selection panel animations
  // Always delay entrance to be safe (prop panels might be closing)
  const shouldShow = useDelayedVisibility(isOpen, {
    enterDelay: 300, // Coordinate with prop panel close
    exitDelay: 250   // Match exit animation duration
  });

  const [isCatalogRendering, setIsCatalogRendering] = useState(false);

  useEffect(() => {
    if (shouldShow) {
      setIsCatalogRendering(true);
    }
  }, [shouldShow]);

  useEffect(() => {
    const element = hoveredItem?.element;
    if (!element) {
      setHoverRect(null);
      return undefined;
    }

    let frame = 0;

    const updateRect = () => {
      setHoverRect(element.getBoundingClientRect());
    };

    const scheduleUpdate = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateRect();
      });
    };

    updateRect();

    window.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', scheduleUpdate);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => scheduleUpdate());
      observer.observe(element);
    }

    return () => {
      window.removeEventListener('scroll', scheduleUpdate, true);
      window.removeEventListener('resize', scheduleUpdate);
      if (observer) observer.disconnect();
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [hoveredItem]);

  useEffect(() => {
    if (!isOpen) {
      setHoveredItem(null);
      setHoverRect(null);
    }
  }, [isOpen]);

  // Mutual exclusivity logic: Only one UI can be active at a time
  // (1) When user selects a prop from scene → close catalog
  useEffect(() => {
    const unsubscribe = subscribeSelection(() => {
      const selection = getSelection();
      // Only close if a prop was selected (ignore clearSelection calls)
      if (selection !== null) {
        setIsOpen(false);
      }
    });
    return unsubscribe;
  }, []);

  // (2) When user opens catalog → deselect any selected prop
  useEffect(() => {
    if (isOpen) {
      const currentSelection = getSelection();
      // Only clear if something is actually selected (avoid unnecessary calls)
      if (currentSelection !== null) {
        clearSelection();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (isSwapActive) {
      prevCategoriesRef.current = new Set(enabledCategories);
      prevSearchRef.current = searchQuery;
      setEnabledCategories(new Set(['desk']));
      setSearchQuery('');
      setIsOpen(true);
    } else if (prevCategoriesRef.current) {
      setEnabledCategories(prevCategoriesRef.current);
      setSearchQuery(prevSearchRef.current);
      prevCategoriesRef.current = null;
    }
  }, [isSwapActive]);

const prevIsOpenRef = useRef(isOpen);
useEffect(() => {
  const prevIsOpen = prevIsOpenRef.current;
  prevIsOpenRef.current = isOpen;
  if (prevIsOpen && !isOpen && isSwapActive) {
    cancelDeskSwap();
  }
}, [isOpen, isSwapActive]);

  // (2b) Register catalog close handler for external control (scene clicks)
  useEffect(() => {
    const unregister = registerCatalogCloseHandler(() => setIsOpen(false));
    return unregister;
  }, []);

  // Get all spawned props to check for duplicates
  const genericProps = useGenericProps();

  // Get desk surface for spawn height calculation
  const deskSurfaces = useSurfacesByKind('desk');
  const deskSurfaceId = deskSurfaces[0]?.id;
  const deskSurface = useSurface(deskSurfaceId ?? '');
  const deskSurfaceMeta = useSurfaceMeta(deskSurfaceId ?? '');

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
    if (isSwapActive) {
      return;
    }
    setEnabledCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, [isSwapActive]);

  // Get sorted categories by order
  const sortedCategories = useMemo(() => {
    return Object.values(CATEGORY_DEFINITIONS).sort((a, b) => a.order - b.order);
  }, []);

  const swapTargetDeskId = swapStoreState.active ? swapStoreState.targetDeskId : null;
  const swapTargetCatalogId = useMemo(() => {
    if (!swapTargetDeskId) return null;
    const targetDesk = genericProps.find((prop) => prop.id === swapTargetDeskId);
    return targetDesk?.catalogId ?? null;
  }, [genericProps, swapTargetDeskId]);

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
    const groups = sortedCategories
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

    if (isSwapActive) {
      const success = completeDeskSwap(entry);
      if (success) {
        setIsOpen(false);
        setDeskSwapPreviewEntry(null);
      }
      return;
    }

    // Calculate spawn position - if desk exists, spawn at desk height + clearance
    // Otherwise use default staging position
    let position: [number, number, number] | undefined;
    if (deskSurfaceMeta) {
      const spawn = getSurfaceSpawnPoint(deskSurfaceMeta, DESK_CLEARANCE);
      if (spawn) {
        position = spawn.position;
      }
    } else if (deskHeight !== null) {
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
    const snapshot = createSnapshotFromProp(prop);

    pushAction({
      type: 'spawn',
      propId: prop.id,
      snapshot,
    });

    // Select the newly spawned prop (catalog will auto-close via selection subscription)
    setSelection({ kind: 'generic', id: prop.id });
  }, [deskHeight, deskSurfaceMeta, pushAction, isSwapActive, setIsOpen, completeDeskSwap]);

  const containerClass = ['pointer-events-none flex items-start justify-end gap-2', className]
    .filter(Boolean)
    .join(' ');

  const handleToggleCatalog = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleEntryHoverStart = useCallback((entry: PropCatalogEntry, element: HTMLElement) => {
    useGLTF.preload(entry.url);
    if (hoverIntentRef.current !== null) {
      window.clearTimeout(hoverIntentRef.current);
    }
    hoverIntentRef.current = window.setTimeout(() => {
      setHoveredItem({ entry, element });
      if (isSwapActive) {
        setDeskSwapPreviewEntry(entry);
      }
    }, 180);
  }, [isSwapActive]);

  const handleEntryHoverEnd = useCallback(() => {
    if (hoverIntentRef.current !== null) {
      window.clearTimeout(hoverIntentRef.current);
      hoverIntentRef.current = null;
    }
    setHoveredItem(null);
    if (isSwapActive && !pendingReviewEntryId && hasPreviewState) {
      setDeskSwapPreviewEntry(null);
    }
  }, [isSwapActive, pendingReviewEntryId, hasPreviewState]);

  useEffect(() => {
    return () => {
      if (hoverIntentRef.current !== null) {
        window.clearTimeout(hoverIntentRef.current);
        hoverIntentRef.current = null;
      }
    };
  }, []);

  const totalProps = groupedCatalog.reduce((sum, group) => sum + group.props.length, 0);

  useEffect(() => {
    if (!isCatalogRendering) {
      setHoveredItem(null);
      setHoverRect(null);
    }
  }, [isCatalogRendering]);

  const showAddButton = !isOpen && !isCatalogRendering && !isSwapActive;

  return (
    <div className={containerClass} style={{ marginTop: '0.35rem' }}>
      <AnimatePresence>
        {showAddButton && (
          <motion.button
            key="add-prop-button"
            type="button"
            className={BUTTON_CLASS}
            onClick={handleToggleCatalog}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            style={{ marginTop: '0.6rem' }}
          >
            Add Prop
          </motion.button>
        )}
      </AnimatePresence>

      <PropPreviewOverlay
        entry={shouldShow ? hoveredItem?.entry ?? null : null}
        rect={hoverRect}
      />

      <AnimatePresence
        onExitComplete={() => {
          setIsCatalogRendering(false);
        }}
      >
        {shouldShow && (
          <motion.div
            layout
            initial={{ opacity: 0, x: 20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="pointer-events-auto w-72 rounded-lg bg-black/70 text-sm text-white shadow-lg flex flex-col"
            style={{ maxHeight: '80vh' }}
          >
          {/* Sticky Header */}
          <div className="px-4 py-3 border-b border-white/10 flex-shrink-0">
            <div className="mb-1.5 flex items-center gap-2">
              <div className="text-xs uppercase tracking-wide text-white/90 font-semibold">Prop Catalog</div>
              <div className="flex-1 text-center text-xs text-white/60">
                <span className="font-bold text-white/80">{totalProps}</span>
                <span className="font-normal text-white/50"> props</span>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close prop catalog"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-white/30 text-lg text-white/80 transition-colors hover:bg-red-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-400/60 focus:bg-red-500"
              >
                ×
              </button>
            </div>

            <input
              type="text"
              placeholder="Search props..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-white/30 bg-black/50 px-3 py-1 text-sm text-white placeholder:text-white/40 focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all mb-2"
              disabled={isSwapActive}
            />

            {/* Category Filters */}
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-white/50 mb-1">Filter by Category</div>
              <div className="grid grid-cols-2 gap-2">
                {sortedCategories.map((catDef) => {
                  const isActive = enabledCategories.has(catDef.id);
                  return (
                    <button
                      key={catDef.id}
                      type="button"
                      onClick={() => toggleCategory(catDef.id)}
                      disabled={isSwapActive}
                      className={`category-filter-btn text-[11px] py-1.5 rounded border transition-all relative cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white/30 ${
                        isActive
                          ? 'bg-white/10 shadow-lg'
                          : 'bg-transparent'
                      }`}
                      style={{
                        borderColor: isActive ? catDef.borderColor : `${catDef.borderColor}99`,
                        borderWidth: isActive ? '2px' : '1px',
                        color: isActive ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.7)',
                        paddingLeft: catDef.id === 'note-surface' ? '2.5rem' : '1.75rem',
                        paddingRight: '0.5rem',
                        textAlign: 'center',
                        boxShadow: isActive ? `0 0 8px ${catDef.borderColor}40` : 'none',
                        '--glow-color': `${catDef.borderColor}`,
                      } as React.CSSProperties & { '--glow-color': string }}
                    >
                      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                        {catDef.id === 'note-surface' ? (
                          // Special case for Note Surfaces: show both monitor and board icons
                          <>
                            <span className="text-xs">{SURFACE_TYPE_ICONS.monitor}</span>
                            <img
                              src={SURFACE_TYPE_ICONS.board}
                              alt="board"
                              className="w-3.5 h-3.5 inline-block"
                            />
                          </>
                        ) : catDef.iconPath ? (
                          <img
                            src={catDef.iconPath}
                            alt={catDef.label}
                            className="w-[18px] h-[18px] inline-block"
                          />
                        ) : (
                          catDef.icon
                        )}
                      </span>
                      {catDef.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {isSwapActive && (
              <div className="mt-3 rounded-md border border-teal-400/40 bg-teal-500/10 px-3 py-2 text-[11px] text-teal-200">
                Swap mode active — choose a desk to replace the current one or close the catalog to cancel.
              </div>
            )}
          </div>

          {/* Scrollable Content - Custom Scrollbar */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 custom-scrollbar">
            {groupedCatalog.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center text-white/40 py-6 text-xs"
              >
                No props found
              </motion.div>
            ) : (
              <AnimatePresence mode="sync">
                {groupedCatalog.map(({ category, props }) => (
                  <motion.div
                    key={category.id}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="rounded-lg border-2 p-2 space-y-2"
                    style={{ borderColor: category.borderColor }}
                  >
                    {/* Category Props */}
                    <AnimatePresence mode="sync">
                      {props.map((entry, index) => {
                        const alreadySpawned = isSwapActive ? false : isAlreadySpawned(entry.id);
                        const isCurrentDesk = isSwapActive && swapTargetCatalogId === entry.id;
                        const isDisabled = isCurrentDesk || alreadySpawned;
                        const isHovered = hoveredItem?.entry.id === entry.id;
                        return (
                          <motion.button
                            layout
                            key={entry.id}
                            initial={{ opacity: 0, y: 12, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -8, scale: 0.96 }}
                            transition={{
                              layout: { type: 'spring', bounce: 0.15, duration: 0.4 },
                              opacity: { duration: 0.2 },
                              y: { duration: 0.2, ease: 'easeOut' },
                              scale: { duration: 0.2, ease: 'easeOut' },
                              delay: index * 0.025
                            }}
                            type="button"
                            disabled={isDisabled}
                            className={`group relative w-full rounded-lg px-4 text-left text-xs flex items-center justify-between transition-all duration-150 h-12 border backdrop-blur-sm
                              ${isDisabled
                                ? 'cursor-not-allowed border-transparent opacity-60'
                                : 'focus:outline-none focus:ring-2 focus:ring-white/50 hover:ring-1 hover:ring-white/40'
                              }
                              ${isHovered && !isDisabled ? 'ring-2 ring-white/70 shadow-lg scale-[1.02]' : ''}
                            `}
                            style={{
                              backgroundColor: isDisabled
                                ? category.bgColor
                                : isHovered
                                  ? lightenHex(category.bgColor, 0.22)
                                  : category.bgColor,
                              opacity: isDisabled ? 0.6 : 0.95
                            }}
                            onClick={() => !isDisabled && handleSpawn(entry.id)}
                            onMouseEnter={(event) => handleEntryHoverStart(entry, event.currentTarget)}
                            onMouseLeave={handleEntryHoverEnd}
                            onFocus={(event) => handleEntryHoverStart(entry, event.currentTarget)}
                            onBlur={handleEntryHoverEnd}
                          >
                        <span className={`tracking-wide ${isDisabled ? 'text-black/50' : 'text-black/90'}`}>
                          {entry.label}
                        </span>
                        <div className="flex items-center gap-2">
                          {alreadySpawned && !isSwapActive && (
                            <span className="inline-flex items-center rounded-full bg-green-500/30 px-2.5 py-1 text-[10px] font-medium text-green-200 uppercase tracking-wider">
                              In Scene
                            </span>
                          )}
                          {isCurrentDesk && (
                            <span className="inline-flex items-center rounded-full bg-blue-500/20 px-2.5 py-1 text-[10px] font-medium text-blue-100 uppercase tracking-wider">
                              Active Desk
                            </span>
                          )}
                          {/* Category badges (max 3) - wrapped in dark chip */}
                          {entry.categories.length > 0 && (
                            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/15">
                              {entry.categories.slice(0, 3).map((cat) => {
                                const catMeta = CATEGORY_DEFINITIONS[cat];

                                // Special case: for note-surface category, show specific surfaceType icon instead
                                if (cat === 'note-surface' && entry.surfaceType) {
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
                      </motion.button>
                        );
                      })}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>

          {/* Custom Scrollbar Styles + Pulsing Ring Animation */}
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

            /* Ensure consistent height for all filter buttons */
            .category-filter-btn {
              box-sizing: border-box;
              border-width: 2px !important;
            }

            /* Simple hover glow enhancement */
            .category-filter-btn:not(:disabled):hover {
              box-shadow:
                0 0 16px color-mix(in srgb, var(--glow-color) 50%, transparent),
                0 0 32px color-mix(in srgb, var(--glow-color) 25%, transparent),
                inset 0 0 0 1px color-mix(in srgb, var(--glow-color) 90%, transparent) !important;
              border-color: var(--glow-color) !important;
            }
          `}</style>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
