import { useCallback, useEffect, useMemo, useState, useRef } from 'react';

import { setGenericPropUniformScale, type Vec3 } from '@/state/genericPropsStore';
import { useSelection } from '@/canvas/hooks/useSelection';
import { useGenericProp } from '@/canvas/hooks/useGenericProps';
import { useUndoHistoryStore } from '@/state/undoHistoryStore';

const MIN_SCALE = 0.6;
const MAX_SCALE = 1.6;
const STEP = 0.01;

type PropScaleControlsProps = {
  className?: string;
};

type GenericTarget = {
  type: 'generic';
  id: string;
  label: string;
  description: string;
  scale: number;
  status: 'editing' | 'dragging' | 'placed';
};

export default function PropScaleControls({ className = '' }: PropScaleControlsProps = {}) {
  const selection = useSelection();
  const selectedGenericId = selection && selection.kind === 'generic' ? selection.id : null;
  const selectedGeneric = useGenericProp(selectedGenericId);
  const pushAction = useUndoHistoryStore((s) => s.push);

  const target = useMemo<GenericTarget | null>(() => {
    if (!selectedGeneric) return null;
    return {
      type: 'generic',
      id: selectedGeneric.id,
      label: selectedGeneric.label ?? 'Prop',
      description: selectedGeneric.label ? `${selectedGeneric.label} (Generic)` : 'Generic prop',
      scale: selectedGeneric.scale[0],
      status: selectedGeneric.status,
    };
  }, [selectedGeneric]);
  const [pendingValue, setPendingValue] = useState(target?.scale ?? 1);
  const scaleBeforeRef = useRef<Vec3 | null>(null);

  const targetKey = target ? `${target.type}:${target.id}` : null;

  useEffect(() => {
    if (target) {
      setPendingValue(target.scale);
    }
  }, [target?.scale, targetKey]);

  const handleScaleChange = useCallback(
    (next: number) => {
      if (!target) return;
      setPendingValue(next);
      const normalized = Number(next.toFixed(3));
      setGenericPropUniformScale(target.id, normalized);
    },
    [target],
  );

  const handleReset = useCallback(() => {
    if (!target || !selectedGeneric) return;
    const before = selectedGeneric.scale;
    const after: Vec3 = [1, 1, 1];
    setGenericPropUniformScale(target.id, 1);
    pushAction({
      type: 'scale',
      propId: target.id,
      before,
      after,
    });
  }, [target, selectedGeneric, pushAction]);

  const handlePointerDown = useCallback(() => {
    if (!selectedGeneric) return;
    scaleBeforeRef.current = selectedGeneric.scale;
  }, [selectedGeneric]);

  const handlePointerUp = useCallback(() => {
    if (!target || !selectedGeneric || !scaleBeforeRef.current) return;
    const before = scaleBeforeRef.current;
    const after = selectedGeneric.scale;

    // Only push if scale actually changed
    if (before[0] !== after[0]) {
      pushAction({
        type: 'scale',
        propId: target.id,
        before,
        after,
      });
    }
    scaleBeforeRef.current = null;
  }, [target, selectedGeneric, pushAction]);

  const containerClass = ['pointer-events-none flex flex-col items-end gap-2', className]
    .filter(Boolean)
    .join(' ');

  if (!target) return null;

  const isDocked = target.status === 'editing' ? false : selectedGeneric?.docked ?? false;
  const sliderClass = isDocked ? "mt-2 w-full opacity-40 cursor-not-allowed" : "mt-2 w-full";
  const resetButtonClass = isDocked
    ? "rounded border border-white/30 px-2 py-1 text-[10px] uppercase tracking-wide opacity-40 cursor-not-allowed"
    : "rounded border border-white/30 px-2 py-1 text-[10px] uppercase tracking-wide hover:bg-white/10";

  return (
    <div className={containerClass}>
      <div className="pointer-events-auto w-60 rounded-md bg-black/70 p-3 text-sm text-white shadow-lg">
        <div className="text-xs uppercase tracking-wide text-white/70">Adjusting</div>
        <div className="mt-1 font-semibold">{target.label}</div>
        <div className="text-xs text-white/60">{target.description}</div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-white/70">
            <span>Scale</span>
            <span>{pendingValue.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={STEP}
            value={pendingValue}
            onChange={(event) => !isDocked && handleScaleChange(Number(event.target.value))}
            onPointerDown={!isDocked ? handlePointerDown : undefined}
            onPointerUp={!isDocked ? handlePointerUp : undefined}
            disabled={isDocked}
            className={sliderClass}
          />
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/60">
            <span>{MIN_SCALE.toFixed(1)}x</span>
            <button
              type="button"
              className={resetButtonClass}
              onClick={isDocked ? undefined : handleReset}
              disabled={isDocked}
            >
              Reset
            </button>
            <span>{MAX_SCALE.toFixed(1)}x</span>
          </div>
        </div>
      </div>
    </div>
  );
}


