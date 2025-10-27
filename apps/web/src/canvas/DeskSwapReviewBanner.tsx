import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  cancelDeskSwap,
  clearDeskSwapReview,
  forceCompleteDeskSwap,
  useDeskSwapStore,
} from '@/state/deskSwapStore';

function usePortalTarget() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.body);
  }, []);

  return target;
}

export default function DeskSwapReviewBanner() {
  const pendingReview = useDeskSwapStore((s) => s.pendingReview);
  const target = usePortalTarget();

  const issues = useMemo(() => {
    if (!pendingReview) return [];
    return pendingReview.attachments.filter((attachment) => attachment.status !== 'ok');
  }, [pendingReview]);

  if (!pendingReview || !target) {
    return null;
  }

  const hasForceablePlans = issues.some((issue) => issue.plan);

  return createPortal(
    <div className="fixed top-4 right-4 z-[1100] w-80 rounded-lg border border-red-400/60 bg-slate-950/95 p-4 text-sm text-white shadow-xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-red-300">Desk Swap Review Needed</div>
          <p className="mt-1 text-xs text-red-100">
            Move highlighted props fully onto the replacement desk surface, then retry the swap. You can also force the swap to clamp these items automatically.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss review banner"
          className="ml-auto text-red-200/70 transition hover:text-red-100"
          onClick={clearDeskSwapReview}
        >
          ×
        </button>
      </div>

      <ul className="mt-3 space-y-1 text-xs">
        {issues.map((issue) => (
          <li key={issue.propId} className="rounded bg-red-500/10 px-2 py-1 text-red-100">
            <div className="font-medium">{issue.label}</div>
            <div className="text-[11px] text-red-200/80">
              {issue.reason ?? (issue.status === 'failed' ? 'Cannot map to new desk surface' : 'Would clamp to desk bounds')}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          className="rounded border border-red-400/70 bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-100 transition hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!hasForceablePlans}
          onClick={() => {
            forceCompleteDeskSwap(pendingReview.entry);
          }}
        >
          Force Swap With Clamps
        </button>
        <button
          type="button"
          className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/10"
          onClick={cancelDeskSwap}
        >
          Cancel Swap
        </button>
      </div>
    </div>,
    target,
  );
}
