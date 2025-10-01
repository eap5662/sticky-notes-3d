import { useSyncExternalStore } from "react";

import {
  getLayoutOverrides,
  subscribeLayoutOverrides,
  type LayoutOverridesState,
} from "@/state/layoutOverridesStore";

const getClientSnapshot = () => getLayoutOverrides();
const getServerSnapshot = (() => {
  let snapshot: LayoutOverridesState | null = null;
  return () => {
    if (snapshot === null) {
      snapshot = getLayoutOverrides();
    }
    return snapshot;
  };
})();

export function useLayoutOverridesState(): LayoutOverridesState {
  return useSyncExternalStore(
    subscribeLayoutOverrides,
    getClientSnapshot,
    getServerSnapshot,
  );
}

