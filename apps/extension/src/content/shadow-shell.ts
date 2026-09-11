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
      .panel-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
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
        max-width: 90vw;
        height: 100vh;
        background-color: #0f0f0f;
        color: #f1f1f1;
        box-shadow: -4px 0 24px rgba(0, 0, 0, 0.5);
        transition: right 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        z-index: 10;
        box-sizing: border-box;
      }
      .panel-container.open {
        right: 0;
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
