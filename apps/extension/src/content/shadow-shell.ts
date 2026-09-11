export const HOST_ID = "yt-bulk-transcript-host";
export const ROOT_ID = "yt-bulk-transcript-root";
export const TOGGLE_EVENT_NAME = "yt-bulk-transcript-toggle";

export type PanelToggleDetail = {
  open: boolean;
};

export type MountPoint = {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  root: HTMLElement;
};

let isPanelOpenState = false;
const toggleListeners = new Set<(open: boolean) => void>();

/**
 * Returns whether the transcript drawer panel is currently open.
 */
export function isPanelOpen(): boolean {
  return isPanelOpenState;
}

/**
 * Ensures the Shadow DOM host element and root container exist on document.body.
 * Returns the host, shadowRoot, and the inner container element.
 */
export function ensureMountPoint(doc: Document = document): MountPoint {
  let host = doc.getElementById(HOST_ID);

  if (host && host.shadowRoot) {
    const existingRoot = host.shadowRoot.getElementById(ROOT_ID);
    if (existingRoot) {
      return {
        host,
        shadowRoot: host.shadowRoot,
        root: existingRoot,
      };
    }
  }

  if (!host) {
    host = doc.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-open", "false");
    host.style.position = "fixed";
    host.style.top = "0";
    host.style.right = "0";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";

    const targetParent = doc.body ?? doc.documentElement;
    targetParent.appendChild(host);
  }

  const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });

  let style = shadowRoot.querySelector("style");
  if (!style) {
    style = doc.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        font-family: "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      }
      *, *::before, *::after {
        box-sizing: border-box;
      }
      .panel-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.6);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease;
      }
      .panel-backdrop.open {
        opacity: 1;
        pointer-events: auto;
      }
      .panel-container {
        position: fixed;
        top: 0;
        right: -450px;
        width: 420px;
        max-width: 95vw;
        height: 100vh;
        background-color: #0f0f0f;
        color: #f1f1f1;
        box-shadow: -6px 0 28px rgba(0, 0, 0, 0.65);
        transition: right 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        z-index: 10;
        box-sizing: border-box;
        overflow: hidden;
      }
      .panel-container.open {
        right: 0;
      }
      .panel-inner {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }
      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px;
        border-bottom: 1px solid #272727;
        background-color: #121212;
      }
      .panel-header-title {
        display: flex;
        align-items: center;
        gap: 10px;
        color: #f1f1f1;
        font-size: 15px;
        font-weight: 600;
      }
      .panel-icon {
        color: #ff0000;
        flex-shrink: 0;
      }
      .panel-close-btn {
        background: transparent;
        border: none;
        color: #aaaaaa;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        transition: background 0.15s, color 0.15s;
      }
      .panel-close-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
      }
      .source-card {
        padding: 14px 18px;
        background: #181818;
        border-bottom: 1px solid #272727;
      }
      .source-card-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      .source-badge {
        background: #272727;
        color: #3ea6ff;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        letter-spacing: 0.5px;
      }
      .source-count-badge {
        background: #222222;
        color: #aaaaaa;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .source-title {
        font-size: 15px;
        font-weight: 600;
        color: #ffffff;
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .source-handle {
        font-size: 12px;
        color: #888888;
        margin: 2px 0 0 0;
      }
      .error-banner {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 10px 14px;
        background: rgba(239, 68, 68, 0.15);
        border-left: 3px solid #ef4444;
        color: #fca5a5;
        font-size: 12px;
        line-height: 1.4;
      }
      .error-banner-icon {
        font-size: 14px;
        flex-shrink: 0;
      }
      .panel-body {
        flex: 1;
        overflow-y: auto;
        padding: 18px;
        scrollbar-width: thin;
        scrollbar-color: #333333 #121212;
      }
      .panel-body::-webkit-scrollbar {
        width: 6px;
      }
      .panel-body::-webkit-scrollbar-thumb {
        background: #333333;
        border-radius: 3px;
      }
      .form-section {
        margin-bottom: 20px;
      }
      .section-label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: #e5e5e5;
        margin-bottom: 4px;
      }
      .section-hint {
        font-size: 11px;
        color: #888888;
        margin: 0 0 10px 0;
      }
      .required-star {
        color: #ff4e45;
      }
      .formats-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .format-checkbox-label {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: #181818;
        border: 1px solid #2a2a2a;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        color: #cccccc;
        transition: border-color 0.15s, background 0.15s;
        user-select: none;
      }
      .format-checkbox-label:hover {
        background: #202020;
        border-color: #383838;
      }
      .format-checkbox-label.checked {
        border-color: #3ea6ff;
        background: rgba(62, 166, 255, 0.08);
        color: #ffffff;
      }
      .format-checkbox {
        accent-color: #3ea6ff;
        cursor: pointer;
      }
      .toggle-label {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px;
        background: #181818;
        border: 1px solid #2a2a2a;
        border-radius: 6px;
        cursor: pointer;
        user-select: none;
      }
      .toggle-checkbox {
        margin-top: 3px;
        accent-color: #3ea6ff;
        cursor: pointer;
      }
      .toggle-text {
        font-size: 12px;
        font-weight: 500;
        color: #dddddd;
      }
      .toggle-subtext {
        display: block;
        font-size: 11px;
        color: #888888;
        margin-top: 2px;
      }
      .toggle-subtext code {
        background: #222222;
        padding: 1px 4px;
        border-radius: 3px;
        color: #3ea6ff;
      }
      .language-select {
        width: 100%;
        padding: 8px 12px;
        background: #181818;
        color: #ffffff;
        border: 1px solid #2a2a2a;
        border-radius: 6px;
        font-size: 13px;
        outline: none;
        cursor: pointer;
        transition: border-color 0.15s;
      }
      .language-select:focus {
        border-color: #3ea6ff;
      }
      .language-select option {
        background: #181818;
        color: #ffffff;
      }
      .enumerating-view {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 36px 12px;
        text-align: center;
      }
      .spinner {
        width: 32px;
        height: 32px;
        border: 3px solid rgba(255, 255, 255, 0.15);
        border-top-color: #3ea6ff;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-bottom: 16px;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .enumerating-title {
        font-size: 15px;
        font-weight: 600;
        margin: 0 0 6px 0;
        color: #ffffff;
      }
      .enumerating-counter {
        font-size: 13px;
        font-weight: 500;
        color: #3ea6ff;
        margin: 0 0 6px 0;
      }
      .enumerating-subtext {
        font-size: 11px;
        color: #888888;
        max-width: 260px;
        margin: 0;
      }
      .progress-section {
        background: #181818;
        padding: 14px 16px;
        border-radius: 8px;
        margin-bottom: 16px;
        border: 1px solid #272727;
      }
      .progress-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 8px;
      }
      .progress-counter {
        font-size: 14px;
        font-weight: 600;
        color: #ffffff;
      }
      .progress-percent {
        font-size: 12px;
        font-weight: 600;
        color: #3ea6ff;
      }
      .progress-track {
        width: 100%;
        height: 8px;
        background: #272727;
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 10px;
      }
      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #3ea6ff, #2ba640);
        border-radius: 4px;
        transition: width 0.25s ease;
      }
      .progress-stats {
        display: flex;
        gap: 12px;
        font-size: 11px;
        font-weight: 500;
      }
      .stat-done { color: #2ba640; }
      .stat-skipped { color: #f59e0b; }
      .stat-failed { color: #ef4444; }
      .items-list-container {
        margin-top: 8px;
      }
      .items-list-title {
        font-size: 12px;
        font-weight: 600;
        color: #aaaaaa;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 0 0 8px 0;
      }
      .items-scroll-list {
        max-height: 280px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-right: 4px;
        scrollbar-width: thin;
        scrollbar-color: #333333 #121212;
      }
      .items-scroll-list::-webkit-scrollbar {
        width: 5px;
      }
      .items-scroll-list::-webkit-scrollbar-thumb {
        background: #333333;
        border-radius: 3px;
      }
      .video-item-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        background: #141414;
        border-radius: 6px;
        font-size: 12px;
        border: 1px solid #202020;
      }
      .video-index {
        color: #666666;
        font-size: 11px;
        width: 26px;
        flex-shrink: 0;
      }
      .video-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .video-title {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #dddddd;
      }
      .video-error-msg {
        font-size: 10px;
        color: #f87171;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .badge {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 10px;
        flex-shrink: 0;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      .badge-pending {
        background: #252525;
        color: #888888;
      }
      .badge-fetching {
        background: rgba(62, 166, 255, 0.2);
        color: #3ea6ff;
        animation: pulse 1.2s infinite ease-in-out;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      .badge-done {
        background: rgba(43, 166, 64, 0.2);
        color: #4ade80;
      }
      .badge-skipped {
        background: rgba(245, 158, 11, 0.2);
        color: #fbbf24;
      }
      .badge-failed {
        background: rgba(239, 68, 68, 0.2);
        color: #f87171;
      }
      .summary-banner {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 16px;
        border-radius: 8px;
        margin-bottom: 16px;
      }
      .banner-completed {
        background: rgba(43, 166, 64, 0.15);
        border: 1px solid rgba(43, 166, 64, 0.35);
        color: #4ade80;
      }
      .banner-cancelled {
        background: rgba(245, 158, 11, 0.15);
        border: 1px solid rgba(245, 158, 11, 0.35);
        color: #fbbf24;
      }
      .banner-failed {
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid rgba(239, 68, 68, 0.35);
        color: #f87171;
      }
      .summary-banner-icon {
        font-size: 20px;
        line-height: 1;
      }
      .summary-banner-content {
        flex: 1;
      }
      .summary-banner-title {
        font-size: 14px;
        font-weight: 600;
        margin: 0 0 2px 0;
        color: inherit;
      }
      .summary-banner-text {
        font-size: 12px;
        margin: 0;
        color: #cccccc;
      }
      .panel-footer {
        padding: 14px 18px;
        border-top: 1px solid #272727;
        background-color: #121212;
      }
      .footer-actions-group {
        display: flex;
        gap: 10px;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 16px;
        border-radius: 20px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: background-color 0.15s, opacity 0.15s;
        text-align: center;
        width: 100%;
        box-sizing: border-box;
      }
      .btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .btn-primary {
        background: #f1f1f1;
        color: #0f0f0f;
      }
      .btn-primary:hover:not(:disabled) {
        background: #ffffff;
      }
      .btn-secondary {
        background: #272727;
        color: #f1f1f1;
        border: 1px solid #3a3a3a;
      }
      .btn-secondary:hover:not(:disabled) {
        background: #333333;
      }
      .btn-danger {
        background: rgba(239, 68, 68, 0.15);
        color: #f87171;
        border: 1px solid rgba(239, 68, 68, 0.3);
      }
      .btn-danger:hover:not(:disabled) {
        background: rgba(239, 68, 68, 0.25);
      }
    `;
    shadowRoot.appendChild(style);
  }

  let backdrop = shadowRoot.querySelector(
    ".panel-backdrop"
  ) as HTMLElement | null;
  if (!backdrop) {
    backdrop = doc.createElement("div");
    backdrop.className = "panel-backdrop";
    backdrop.addEventListener("click", () => {
      closePanel(doc);
    });
    shadowRoot.appendChild(backdrop);
  }

  let root = shadowRoot.getElementById(ROOT_ID);
  if (!root) {
    root = doc.createElement("div");
    root.id = ROOT_ID;
    root.className = "panel-container";
    root.setAttribute("data-state", "closed");
    shadowRoot.appendChild(root);
  }

  return {
    host,
    shadowRoot,
    root,
  };
}

/**
 * Retrieves the active ShadowRoot if mounted, or null.
 */
export function getShadowRoot(doc: Document = document): ShadowRoot | null {
  const host = doc.getElementById(HOST_ID);
  return host?.shadowRoot ?? null;
}

/**
 * Retrieves the inner root container where React UI mounts.
 */
export function getMountPoint(doc: Document = document): HTMLElement | null {
  const sr = getShadowRoot(doc);
  return sr?.getElementById(ROOT_ID) ?? null;
}

/**
 * Toggles the In-Page Panel open or closed.
 * Updates DOM attributes, classes, dispatches custom event, and calls registered listeners.
 */
export function togglePanel(
  forceState?: boolean,
  doc: Document = document
): boolean {
  const mount = ensureMountPoint(doc);
  const nextState = forceState !== undefined ? forceState : !isPanelOpenState;
  isPanelOpenState = nextState;

  mount.host.setAttribute("data-open", String(nextState));
  mount.host.style.pointerEvents = nextState ? "auto" : "none";

  const backdrop = mount.shadowRoot.querySelector(
    ".panel-backdrop"
  ) as HTMLElement | null;
  if (backdrop) {
    backdrop.classList.toggle("open", nextState);
  }

  mount.root.classList.toggle("open", nextState);
  mount.root.setAttribute("data-state", nextState ? "open" : "closed");

  const eventInit: CustomEventInit<PanelToggleDetail> = {
    bubbles: true,
    composed: true,
    detail: { open: nextState },
  };

  const customEvent = new CustomEvent(TOGGLE_EVENT_NAME, eventInit);
  mount.host.dispatchEvent(customEvent);

  const win = doc.defaultView ?? (typeof window !== "undefined" ? window : null);
  if (win) {
    win.dispatchEvent(new CustomEvent(TOGGLE_EVENT_NAME, eventInit));
  }

  for (const listener of toggleListeners) {
    listener(nextState);
  }

  return nextState;
}

/**
 * Opens the transcript drawer panel.
 */
export function openPanel(doc: Document = document): void {
  togglePanel(true, doc);
}

/**
 * Closes the transcript drawer panel.
 */
export function closePanel(doc: Document = document): void {
  togglePanel(false, doc);
}

/**
 * Registers a callback for panel toggle state changes.
 * Returns an unsubscribe function.
 */
export function onPanelToggle(listener: (open: boolean) => void): () => void {
  toggleListeners.add(listener);
  return () => {
    toggleListeners.delete(listener);
  };
}

/**
 * Internal state reset helper for testing.
 */
export function _resetPanelStateForTesting(): void {
  isPanelOpenState = false;
  toggleListeners.clear();
}
