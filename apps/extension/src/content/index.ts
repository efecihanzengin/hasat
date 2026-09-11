import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { initIsolatedBridge, requestYouTubeContext } from "./bridge.js";
import {
  initButtonInjection,
  injectTranscribeButton,
  cleanupTranscribeButton,
  isTargetPage,
  findTargetContainer,
} from "./button-injector.js";
import {
  ensureMountPoint,
  togglePanel,
  openPanel,
  closePanel,
  isPanelOpen,
  getShadowRoot,
  getMountPoint,
  onPanelToggle,
  _resetPanelStateForTesting,
} from "./shadow-shell.js";
import { App } from "./ui/App.js";

console.log("[Content Script] YouTube Bulk Transcript Extractor loaded");

let reactRootInstance: Root | null = null;

/**
 * Idempotently mounts the React UI into the Shadow DOM root element.
 */
export function mountPanelUi(
  doc: Document = typeof document !== "undefined" ? document : ({} as Document)
): Root | null {
  const mount = ensureMountPoint(doc);
  if (!mount.root) {
    return null;
  }

  if (!reactRootInstance) {
    try {
      reactRootInstance = createRoot(mount.root);
      reactRootInstance.render(React.createElement(App));
    } catch {
      reactRootInstance = {
        render: () => {},
        unmount: () => {},
      } as unknown as Root;
    }
  }

  return reactRootInstance;
}

if (typeof window !== "undefined") {
  // Initialize bridge listener to capture context updates from the main world
  initIsolatedBridge();

  // Initialize mount point, React UI, and SPA-safe button injection
  ensureMountPoint();
  mountPanelUi();
  initButtonInjection();
}

export {
  requestYouTubeContext,
  initButtonInjection,
  injectTranscribeButton,
  cleanupTranscribeButton,
  isTargetPage,
  findTargetContainer,
  ensureMountPoint,
  togglePanel,
  openPanel,
  closePanel,
  isPanelOpen,
  getShadowRoot,
  getMountPoint,
  onPanelToggle,
  _resetPanelStateForTesting,
};
