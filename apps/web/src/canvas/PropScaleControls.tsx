import { useCallback, useEffect, useMemo, useState } from 'react';

import { useCamera } from '@/state/cameraSlice';
import { setUniformPropScale } from '@/state/propScaleStore';
import { setGenericPropUniformScale } from '@/state/genericPropsStore';
import { usePropScale } from '@/canvas/hooks/usePropScale';
import { useSelection } from '@/canvas/hooks/useSelection';
import { useGenericProp } from '@/canvas/hooks/useGenericProps';
import type { PropId } from '@/state/propBoundsStore';

const MIN_SCALE = 0.6;
const MAX_SCALE = 1.6;
const STEP = 0.01;

type PropScaleControlsProps = {
  className?: string;
};

function describeProp(id: PropId) {
  if (id === 'monitor1') {
    return { label: 'Monitor', description: 'Primary display' };
  }
  return { label: 'Desk', description: 'Workspace surface' };
}

type FixedTarget = {
  type: 'fixed';
  id: PropId;
  label: string;
  description: string;
  scale: number;
};

type GenericTarget = {
  type: 'generic';
  id: string;
  label: string;
  description: string;
  scale: number;
};

type ScaleTarget = FixedTarget | GenericTarget;

export default function PropScaleControls({ className = '' }: PropScaleControlsProps = {}) {
  const mode = useCamera((s) => s.mode);
  const selection = useSelection();
  const selectedGenericId = selection && selection.kind === 'generic' ? selection.id : null;
  const selectedGeneric = useGenericProp(selectedGenericId);

  const fallbackId: PropId = mode.kind === 'screen' ? 'monitor1' : 'desk';
  const fallbackInfo = useMemo(() => describeProp(fallbackId), [fallbackId]);
  const fallbackScaleVec = usePropScale(fallbackId);
  const fallbackTarget = useMemo<FixedTarget>(
    () => ({
      type: 'fixed',
      id: fallbackId,
      label: fallbackInfo.label,
      description: fallbackInfo.description,
      scale: fallbackScaleVec[0],
    }),
    [fallbackId, fallbackInfo, fallbackScaleVec],
  );

  const genericTarget = useMemo<GenericTarget | null>(() => {
    if (!selectedGeneric) return null;
    return {
      type: 'generic',
      id: selectedGeneric.id,
      label: selectedGeneric.label ?? 'Prop',
      description: selectedGeneric.label ? `${selectedGeneric.label} (Generic)` : 'Generic prop',
      scale: selectedGeneric.scale[0],
    };
  }, [selectedGeneric]);

  const target: ScaleTarget = genericTarget ?? fallbackTarget;
  const [isOpen, setIsOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState(target.scale);

  const targetKey = `${target.type}:${target.id}`;

  useEffect(() => {
    setPendingValue(target.scale);
  }, [target.scale, targetKey]);

  const handleScaleChange = useCallback(
    (next: number) => {
      setPendingValue(next);
      const normalized = Number(next.toFixed(3));
      if (genericTarget) {
        setGenericPropUniformScale(genericTarget.id, normalized);
      } else {
        setUniformPropScale(fallbackId, normalized);
      }
    },
    [genericTarget, fallbackId],
  );

  const handleReset = useCallback(() => {
    if (genericTarget) {
      setGenericPropUniformScale(genericTarget.id, 1);
    } else {
      setUniformPropScale(fallbackId, 1);
    }
  }, [genericTarget, fallbackId]);

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const containerClass = ['pointer-events-none flex flex-col items-end gap-2', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClass}>
      <button
        type="button"
        className="pointer-events-auto rounded-full bg-black/70 px-3 py-1 text-xs uppercase tracking-wide text-white shadow hover:bg-black/80"
        onClick={toggleOpen}
      >
        {isOpen ? 'Hide Scale' : `Scale: ${target.label}`}
      </button>

      {isOpen && (
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
              onChange={(event) => handleScaleChange(Number(event.target.value))}
              className="mt-2 w-full"
            />
            <div className="mt-2 flex items-center justify-between text-[11px] text-white/60">
              <span>{MIN_SCALE.toFixed(1)}x</span>
              <button
                type="button"
                className="rounded border border-white/30 px-2 py-1 text-[10px] uppercase tracking-wide hover:bg-white/10"
                onClick={handleReset}
              >
                Reset
              </button>
              <span>{MAX_SCALE.toFixed(1)}x</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
