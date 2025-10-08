import { useSyncExternalStore } from "react";
import {
  getLayoutState,
  subscribeLayoutState,
  type LayoutState,
  type LayoutFrame,
  type LayoutPose,
} from "@/state/layoutFrameStore";

const getClientSnapshot = () => getLayoutState();
const getServerSnapshot = (() => {
  let snapshot: LayoutState | null = null;
  return () => {
    if (snapshot === null) {
      snapshot = getLayoutState();
    }
    return snapshot;
  };
})();

export function useLayoutFrameState(): LayoutState {
  return useSyncExternalStore(subscribeLayoutState, getClientSnapshot, getServerSnapshot);
}

export function useLayoutFrame(): LayoutFrame | null {
  return useLayoutFrameState().frame;
}

export function useLayoutCameraTarget(): [number, number, number] | null {
  return useLayoutFrameState().cameraTarget;
}

export function useLayoutDeskPose(): LayoutPose | null {
  return useLayoutFrameState().deskPose;
}
