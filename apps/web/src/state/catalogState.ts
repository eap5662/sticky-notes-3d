/**
 * Simple catalog state management for external control
 * Allows SceneRoot to close the catalog on background clicks
 */

let closeHandler: (() => void) | null = null;

export function registerCatalogCloseHandler(handler: () => void) {
  closeHandler = handler;
  return () => {
    closeHandler = null;
  };
}

export function closeCatalog() {
  closeHandler?.();
}
