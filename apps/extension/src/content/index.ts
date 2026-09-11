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
} from "./shadow-shell.js";

console.log("[Content Script] YouTube Bulk Transcript Extractor loaded");

// Initialize bridge listener to capture context updates from the main world
initIsolatedBridge();

// Initialize mount point and SPA-safe button injection
ensureMountPoint();
initButtonInjection();

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
};

