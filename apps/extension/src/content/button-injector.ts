import { ensureMountPoint, togglePanel } from "./shadow-shell.js";

export const BUTTON_ID = "yt-bulk-transcript-btn";

export const CHANNEL_HEADER_SELECTORS = [
  "ytd-browse:not([hidden]) yt-page-header-renderer .ytFlexibleActionsViewModelActionRow",
  "ytd-browse:not([hidden]) yt-page-header-renderer yt-flexible-actions-view-model",
  "ytd-browse:not([hidden]) yt-page-header-renderer #page-header-action-buttons",
  "ytd-browse:not([hidden]) yt-page-header-renderer .page-header-view-model-wiz__page-header-actions",
  "ytd-browse:not([hidden]) ytd-channel-header-renderer #buttons",
  "ytd-browse:not([hidden]) ytd-c4-tabbed-header-renderer #buttons",
  "ytd-browse:not([hidden]) #channel-header #buttons",
  "ytd-browse:not([hidden]) #inner-header-container #buttons",
  "yt-page-header-renderer .ytFlexibleActionsViewModelActionRow",
  "yt-page-header-renderer yt-flexible-actions-view-model",
  "yt-page-header-renderer #page-header-action-buttons",
  "yt-page-header-renderer .page-header-view-model-wiz__page-header-actions",
  "ytd-channel-header-renderer #buttons",
  "ytd-c4-tabbed-header-renderer #buttons",
  "#channel-header #buttons",
  "#inner-header-container #buttons",
];

export const PLAYLIST_HEADER_SELECTORS = [
  "ytd-watch-flexy:not([hidden]) ytd-playlist-panel-renderer #header-contents",
  "ytd-watch-flexy:not([hidden]) ytd-playlist-panel-renderer #header",
  "ytd-watch-flexy:not([hidden]) ytd-playlist-panel-renderer .header",
  "ytd-watch-flexy:not([hidden]) ytd-playlist-panel-renderer #header-top-row",
  "ytd-watch-flexy:not([hidden]) ytd-playlist-panel-renderer .playlist-buttons",
  "ytd-playlist-panel-renderer #header-contents",
  "ytd-playlist-panel-renderer #header",
  "ytd-playlist-panel-renderer .header",
  "ytd-playlist-panel-renderer #header-top-row",
  "ytd-playlist-panel-renderer .playlist-buttons",
  "ytd-playlist-panel-renderer #top-level-buttons",
  "ytd-playlist-panel-renderer #top-level-buttons-computed",
  "ytd-playlist-panel-renderer ytd-menu-renderer",
  "ytd-playlist-panel-renderer",
  "ytd-browse:not([hidden]) yt-page-header-renderer .ytFlexibleActionsViewModelActionRow",
  "ytd-browse:not([hidden]) yt-page-header-renderer yt-flexible-actions-view-model",
  "ytd-browse:not([hidden]) yt-page-header-renderer #page-header-action-buttons",
  "ytd-browse:not([hidden]) yt-page-header-renderer .page-header-view-model-wiz__page-header-actions",
  "ytd-browse:not([hidden]) ytd-playlist-sidebar-renderer #actions",
  "ytd-browse:not([hidden]) ytd-playlist-sidebar-renderer .metadata-action-bar",
  "ytd-browse:not([hidden]) ytd-playlist-sidebar-renderer #buttons",
  "ytd-browse:not([hidden]) ytd-playlist-sidebar-renderer yt-flexible-actions-view-model",
  "ytd-browse:not([hidden]) ytd-playlist-header-renderer .metadata-action-bar",
  "ytd-browse:not([hidden]) ytd-playlist-header-renderer #actions",
  "ytd-browse:not([hidden]) ytd-playlist-header-renderer #buttons",
  "yt-page-header-renderer .ytFlexibleActionsViewModelActionRow",
  "yt-page-header-renderer yt-flexible-actions-view-model",
  "yt-page-header-renderer #page-header-action-buttons",
  "yt-page-header-renderer .page-header-view-model-wiz__page-header-actions",
  "ytd-playlist-sidebar-renderer #actions",
  "ytd-playlist-sidebar-renderer .metadata-action-bar",
  "ytd-playlist-sidebar-renderer #buttons",
  "ytd-playlist-sidebar-renderer yt-flexible-actions-view-model",
  "ytd-playlist-sidebar-renderer .ytFlexibleActionsViewModelActionRow",
  "ytd-playlist-header-renderer .metadata-action-bar",
  "ytd-playlist-header-renderer #actions",
  "ytd-playlist-header-renderer #buttons",
  "ytd-playlist-header-renderer #top-level-buttons-computed",
  "ytd-playlist-header-renderer ytd-menu-renderer",
  "ytd-playlist-header-renderer .action-bar-view-model",
  "ytd-playlist-header-renderer yt-flexible-actions-view-model",
  "ytd-playlist-header-renderer .ytFlexibleActionsViewModelActionRow",
  "ytd-playlist-header-renderer .metadata-action-bar-buttons",
  ".metadata-action-bar",
];

export type TargetPageType = "channel" | "playlist";

export type TargetPageResult = {
  isMatch: boolean;
  type: TargetPageType | null;
};

/**
 * Checks whether a pathname corresponds to a YouTube channel.
 */
export function isChannelUrl(pathname: string): boolean {
  return (
    pathname.startsWith("/@") ||
    pathname.startsWith("/channel/") ||
    pathname.startsWith("/c/") ||
    pathname.startsWith("/user/")
  );
}

/**
 * Checks whether a pathname and query correspond to a YouTube playlist.
 * Matches both standard playlist URLs (/playlist?list=...) and watch pages with a playlist (/watch?v=...&list=...).
 */
export function isPlaylistUrl(pathname: string, search: string): boolean {
  if (pathname.startsWith("/playlist") || pathname.startsWith("/watch")) {
    try {
      const params = new URLSearchParams(search);
      return params.has("list");
    } catch {
      return search.includes("list=");
    }
  }
  return false;
}

/**
 * Evaluates whether a given URL (or current location) is an injection target.
 */
export function isTargetPage(urlInput?: string | URL): TargetPageResult {
  try {
    let url: URL;
    if (typeof urlInput === "string") {
      url = new URL(urlInput, "https://www.youtube.com");
    } else if (urlInput instanceof URL) {
      url = urlInput;
    } else if (typeof window !== "undefined" && window.location) {
      url = new URL(window.location.href);
    } else {
      return { isMatch: false, type: null };
    }

    if (isPlaylistUrl(url.pathname, url.search)) {
      return { isMatch: true, type: "playlist" };
    }

    if (isChannelUrl(url.pathname)) {
      return { isMatch: true, type: "channel" };
    }

    return { isMatch: false, type: null };
  } catch {
    return { isMatch: false, type: null };
  }
}

/**
 * Locates the suitable action header element for channel or playlist pages.
 * Strictly avoids top masthead controls.
 */
const isHtmlElement = (el: unknown): el is HTMLElement => {
  return (
    el !== null &&
    typeof el === "object" &&
    (typeof HTMLElement !== "undefined"
      ? el instanceof HTMLElement
      : typeof (el as Record<string, unknown>).closest === "function")
  );
};

export function findTargetContainer(
  doc: Document = document,
  type?: TargetPageType | null
): HTMLElement | null {
  const selectors =
    type === "channel"
      ? CHANNEL_HEADER_SELECTORS
      : type === "playlist"
        ? PLAYLIST_HEADER_SELECTORS
        : [...CHANNEL_HEADER_SELECTORS, ...PLAYLIST_HEADER_SELECTORS];

  for (const selector of selectors) {
    const elements = doc.querySelectorAll(selector);
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (isHtmlElement(el)) {
        if (el.closest("#masthead") || el.closest("ytd-masthead")) {
          continue;
        }
        if (
          el.closest("[hidden]") ||
          el.closest("ytd-page-manager > [hidden]")
        ) {
          continue;
        }
        if (
          type === "channel" &&
          (el.closest("ytd-watch-flexy") ||
            el.closest("ytd-playlist-panel-renderer"))
        ) {
          continue;
        }
        return el;
      }
    }
  }

  return null;
}

/**
 * Constructs the styled Transcribe button element.
 */
export function createTranscribeButton(
  onClick: () => void,
  doc: Document = document
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.className = "yt-bulk-transcript-btn";
  button.setAttribute("aria-label", "Transcribe");
  button.setAttribute("data-testid", BUTTON_ID);

  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.justifyContent = "center";
  button.style.gap = "6px";
  button.style.height = "36px";
  button.style.padding = "0 16px";
  button.style.border = "none";
  button.style.borderRadius = "18px";
  button.style.cursor = "pointer";
  button.style.fontFamily = "Roboto, Arial, sans-serif";
  button.style.fontSize = "14px";
  button.style.fontWeight = "500";
  button.style.lineHeight = "36px";
  button.style.backgroundColor = "#cc0000";
  button.style.color = "#ffffff";
  button.style.verticalAlign = "middle";
  button.style.margin = "6px 8px";
  button.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.2)";
  button.style.zIndex = "999";
  button.style.position = "relative";
  button.style.transition = "background-color 0.15s ease, transform 0.1s ease";
  button.style.flexShrink = "0";

  button.addEventListener("mouseenter", () => {
    button.style.backgroundColor = "#b30000";
  });
  button.addEventListener("mouseleave", () => {
    button.style.backgroundColor = "#cc0000";
  });
  button.addEventListener("mousedown", () => {
    button.style.transform = "scale(0.96)";
  });
  button.addEventListener("mouseup", () => {
    button.style.transform = "scale(1)";
  });

  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");

  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H6v-2h5v2zm7 4H6v-2h12v2zm0-4h-5V9h5v2z"
  );
  svg.appendChild(path);

  const label = doc.createElement("span");
  label.textContent = "Transcribe";

  button.appendChild(svg);
  button.appendChild(label);

  button.addEventListener("click", (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });

  return button;
}

/**
 * Removes all injected buttons from the document.
 */
export function cleanupTranscribeButton(doc: Document = document): void {
  const existingButtons = doc.querySelectorAll(`#${BUTTON_ID}`);
  for (let i = 0; i < existingButtons.length; i++) {
    const btn = existingButtons[i];
    if (btn) {
      btn.remove();
    }
  }
}

let isInjecting = false;

/**
 * Idempotently injects the Transcribe button into the header toolbar.
 */
export function injectTranscribeButton(
  doc: Document = document,
  targetType?: TargetPageType | null
): HTMLButtonElement | null {
  if (isInjecting) {
    return null;
  }

  const targetContainer = findTargetContainer(doc, targetType);
  if (!targetContainer) {
    return null;
  }

  // Idempotency: Return existing button if already in this container
  const existingInContainer = targetContainer.querySelector(
    `#${BUTTON_ID}`
  ) as HTMLButtonElement | null;
  if (existingInContainer) {
    return existingInContainer;
  }

  isInjecting = true;
  try {
    // If a button exists elsewhere in document (stale SPA header), clean it up
    cleanupTranscribeButton(doc);

    // Ensure Shadow DOM mount point is ready
    ensureMountPoint(doc);

    const button = createTranscribeButton(() => {
      togglePanel(undefined, doc);
    }, doc);

    targetContainer.appendChild(button);
    console.log(
      "[YT Bulk Transcripts] Injected Transcribe button into:",
      targetContainer.tagName,
      targetContainer.id ? `#${targetContainer.id}` : targetContainer.className
    );
    return button;
  } finally {
    isInjecting = false;
  }
}

/**
 * Initializes SPA navigation monitoring and button injection.
 * Listens to yt-navigate-finish, uses MutationObserver fallback for async DOM rendering,
 * and cleans up when navigating away from target pages.
 */
export function initButtonInjection(
  win: Window = typeof window !== "undefined" ? window : ({} as Window)
): () => void {
  const doc = win.document;
  if (!doc) {
    return () => {};
  }

  let observer: MutationObserver | null = null;
  let observerTimeout: ReturnType<typeof setTimeout> | null = null;

  const stopObserver = (): void => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (observerTimeout !== null) {
      clearTimeout(observerTimeout);
      observerTimeout = null;
    }
  };

  const startObserver = (): void => {
    if (observer) {
      return;
    }

    const winWithObserver = win as unknown as {
      MutationObserver?: typeof MutationObserver;
    };
    const MutationObserverCtor =
      winWithObserver.MutationObserver ??
      (typeof MutationObserver !== "undefined" ? MutationObserver : null);
    if (!MutationObserverCtor) {
      return;
    }

    const obsInstance = new MutationObserverCtor(() => {
      const currentUrl = win.location?.href ?? "";
      const currentCheck = isTargetPage(currentUrl);

      if (!currentCheck.isMatch) {
        cleanupTranscribeButton(doc);
        stopObserver();
        return;
      }

      const container = findTargetContainer(doc, currentCheck.type);
      if (container) {
        injectTranscribeButton(doc, currentCheck.type);
        stopObserver();
      }
    });

    observer = obsInstance;

    const targetNode = doc.body ?? doc.documentElement;
    if (targetNode) {
      obsInstance.observe(targetNode, {
        childList: true,
        subtree: true,
      });
    }

    if (observerTimeout !== null) {
      clearTimeout(observerTimeout);
    }
    observerTimeout = setTimeout(() => {
      stopObserver();
    }, 20000);
  };

  const attemptInjection = (): void => {
    const currentUrl = win.location?.href ?? "";
    const urlCheck = isTargetPage(currentUrl);

    console.log("[YT Bulk Transcripts] URL check:", currentUrl, urlCheck);

    if (!urlCheck.isMatch) {
      cleanupTranscribeButton(doc);
      stopObserver();
      return;
    }

    const container = findTargetContainer(doc, urlCheck.type);
    if (container) {
      injectTranscribeButton(doc, urlCheck.type);
      stopObserver();
    } else {
      console.log(
        "[YT Bulk Transcripts] Container not ready yet, starting observer..."
      );
      startObserver();
    }
  };

  const onNavigateFinish = (): void => {
    attemptInjection();
  };

  win.addEventListener?.("yt-navigate-finish", onNavigateFinish);
  win.addEventListener?.("popstate", onNavigateFinish);

  // Initial attempt
  attemptInjection();

  return () => {
    stopObserver();
    win.removeEventListener?.("yt-navigate-finish", onNavigateFinish);
    win.removeEventListener?.("popstate", onNavigateFinish);
    cleanupTranscribeButton(doc);
  };
}
