import { useCallback, useEffect, useMemo, useState, useRef } from 'react';

import { setGenericPropUniformScale, type Vec3 } from '@/state/genericPropsStore';
import { useSelection } from '@/canvas/hooks/useSelection';
import { useGenericProp } from '@/canvas/hooks/useGenericProps';
import { useUndoHistoryStore } from '@/state/undoHistoryStore';
import { PROP_CATALOG } from '@/data/propCatalog';

const MIN_USER_SCALE = 0.01; // Minimum user-visible scale (0.01x)
const MAX_USER_SCALE = 10; // Maximum user-visible scale (10x)
const STEP = 0.01;

type PropScaleControlsProps = {
  className?: string;
};

type GenericTarget = {
  type: 'generic';
  id: string;
  catalogId?: string;
  label: string;
  description: string;
  scale: number;
  defaultScale: number;
  status: 'editing' | 'dragging' | 'placed';
};

export default function PropScaleControls({ className = '' }: PropScaleControlsProps = {}) {
  const selection = useSelection();
  const selectedGenericId = selection && selection.kind === 'generic' ? selection.id : null;
  const selectedGeneric = useGenericProp(selectedGenericId);
  const pushAction = useUndoHistoryStore((s) => s.push);

  const target = useMemo<GenericTarget | null>(() => {
    if (!selectedGeneric) return null;

    // Get defaultScale from catalog
    const catalogEntry = selectedGeneric.catalogId
      ? PROP_CATALOG.find(entry => entry.id === selectedGeneric.catalogId)
      : null;
    const defaultScale = catalogEntry?.defaultScale ?? 1;

    return {
      type: 'generic',
      id: selectedGeneric.id,
      catalogId: selectedGeneric.catalogId,
      label: selectedGeneric.label ?? 'Prop',
      description: selectedGeneric.label ? `${selectedGeneric.label} (Generic)` : 'Generic prop',
      scale: selectedGeneric.scale[0],
      defaultScale,
      status: selectedGeneric.status,
    };
  }, [selectedGeneric]);
  // Store the user-visible normalized scale (relative to defaultScale)
  const [pendingValue, setPendingValue] = useState(1);
  // Store raw input string to allow typing "0.", "0.0", etc.
  const [inputValue, setInputValue] = useState('1');
  const [isFocused, setIsFocused] = useState(false);
  const scaleBeforeRef = useRef<Vec3 | null>(null);

  const targetKey = target ? `${target.type}:${target.id}` : null;

  // Helper to format display value (clean, no trailing zeros)
  const formatDisplayValue = useCallback((value: number): string => {
    // Round to 3 decimals, then convert to string and remove trailing zeros
    const rounded = Number(value.toFixed(3));
    return rounded.toString(); // Auto removes trailing zeros
  }, []);

  useEffect(() => {
    if (target && !isFocused) {
      // Only update display when not focused (don't interfere with typing)
      // Convert absolute scale to normalized (user-visible) scale
      const normalizedScale = target.scale / target.defaultScale;
      const rounded = Number(normalizedScale.toFixed(3));
      setPendingValue(rounded);
      setInputValue(formatDisplayValue(rounded));
    }
  }, [target?.scale, target?.defaultScale, targetKey, isFocused, formatDisplayValue]);

  const handleScaleChange = useCallback(
    (userScale: number) => {
      if (!target) return;
      // Clamp user input between MIN_USER_SCALE and MAX_USER_SCALE
      const clampedUser = Math.max(MIN_USER_SCALE, Math.min(MAX_USER_SCALE, userScale));
      setPendingValue(clampedUser);

      // Convert user scale to absolute scale by multiplying with defaultScale
      const absoluteScale = clampedUser * target.defaultScale;
      const normalized = Number(absoluteScale.toFixed(4));

      setGenericPropUniformScale(target.id, normalized);
    },
    [target],
  );

  const handlePointerDown = useCallback(() => {
    if (!selectedGeneric) return;
    scaleBeforeRef.current = selectedGeneric.scale;
  }, [selectedGeneric]);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!target) return;
      const value = event.target.value;

      // Always update the raw input value to allow typing
      setInputValue(value);

      // Allow empty input during typing
      if (value === '') {
        setPendingValue(0);
        return;
      }

      // Parse the value - if valid, update pending scale
      const parsed = parseFloat(value);
      if (!isNaN(parsed) && parsed >= 0) {
        setPendingValue(parsed);
      }
    },
    [target],
  );

  const handleInputFocus = useCallback((event: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    handlePointerDown();
    // Select all text so user can replace with one keystroke
    event.target.select();
  }, [handlePointerDown]);

  const handleInputBlur = useCallback(() => {
    setIsFocused(false);
    if (!target) return;
    // On blur, apply the scale and ensure we have a valid value
    let finalValue = pendingValue;
    if (finalValue < MIN_USER_SCALE || isNaN(finalValue)) {
      finalValue = 1; // Reset to normalized 1x (which is the defaultScale)
    }
    handleScaleChange(finalValue);
    // Update input to show clean formatted value (no trailing zeros)
    setInputValue(formatDisplayValue(finalValue));
  }, [target, pendingValue, handleScaleChange, formatDisplayValue]);

  const handleReset = useCallback(() => {
    if (!target || !selectedGeneric) return;
    const before = selectedGeneric.scale;
    // Reset to defaultScale (which appears as 1x to user)
    const after: Vec3 = [target.defaultScale, target.defaultScale, target.defaultScale];
    setGenericPropUniformScale(target.id, target.defaultScale);
    pushAction({
      type: 'scale',
      propId: target.id,
      before,
      after,
    });
  }, [target, selectedGeneric, pushAction]);

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
  const inputClass = isDocked
    ? "mt-2 w-full rounded border border-white/30 bg-black/50 px-3 py-2 text-sm text-white opacity-40 cursor-not-allowed"
    : "mt-2 w-full rounded border border-white/30 bg-black/50 px-3 py-2 text-sm text-white focus:border-white/50 focus:outline-none";
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
            <span>Scale Multiplier</span>
          </div>
          <input
            type="number"
            min={MIN_USER_SCALE}
            max={MAX_USER_SCALE}
            step={STEP}
            value={inputValue}
            onChange={!isDocked ? handleInputChange : undefined}
            onBlur={!isDocked ? handleInputBlur : undefined}
            onFocus={!isDocked ? handleInputFocus : undefined}
            onKeyDown={(e) => {
              // Allow Enter to apply immediately
              if (e.key === 'Enter' && !isDocked) {
                handleInputBlur();
                e.currentTarget.blur();
              }
            }}
            disabled={isDocked}
            className={inputClass}
            placeholder="1"
          />
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/60">
            <span className="text-white/40">Range: {MIN_USER_SCALE}x – {MAX_USER_SCALE}x</span>
            <button
              type="button"
              className={resetButtonClass}
              onClick={isDocked ? undefined : handleReset}
              disabled={isDocked}
            >
              Reset to 1x
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


