import { initIsolatedBridge, requestYouTubeContext } from "./bridge.js";

console.log("[Content Script] YouTube Bulk Transcript Extractor loaded");

// Initialize bridge listener to capture context updates from the main world
initIsolatedBridge();

export { requestYouTubeContext };
