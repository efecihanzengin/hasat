import { createJobItem } from "@youtube-transcript/core";

chrome.runtime.onInstalled.addListener(() => {
  const initialJob = createJobItem("init", "YouTube Bulk Transcript Extractor");
  console.log("[Background] Service worker initialized", initialJob);
});
