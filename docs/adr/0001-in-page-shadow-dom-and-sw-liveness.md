# 0001: In-Page Shadow DOM Drawer and Service Worker Liveness Port

## Context
In Chrome MV3, web page DOM buttons cannot reliably open the toolbar extension popup (`chrome.action.openPopup`). Additionally, background Service Workers are terminated by the browser after 30 seconds of perceived inactivity, which breaks 5-10 minute bulk extraction jobs across hundreds of videos.

## Decision
We render the UI as an In-Page Panel (slide-out drawer) injected into YouTube's DOM wrapped in a Shadow DOM to isolate styles. During an active extraction job, the Content Script maintains an open `chrome.runtime.Port` with the Service Worker to guarantee worker liveness until the job completes or is cancelled.
