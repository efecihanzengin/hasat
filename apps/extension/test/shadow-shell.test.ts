import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockDocument, MockWindow } from "./mock-dom.js";
import {
  HOST_ID,
  ROOT_ID,
  TOGGLE_EVENT_NAME,
  ensureMountPoint,
  togglePanel,
  openPanel,
  closePanel,
  isPanelOpen,
  getShadowRoot,
  getMountPoint,
  onPanelToggle,
  _resetPanelStateForTesting,
} from "../src/content/shadow-shell.js";

describe("Shadow DOM Shell (In-Page Panel Drawer)", () => {
  let mockWin: MockWindow;
  let mockDoc: MockDocument;

  beforeEach(() => {
    _resetPanelStateForTesting();
    mockWin = new MockWindow("https://www.youtube.com/@veritasium");
    mockDoc = mockWin.document;
  });

  afterEach(() => {
    _resetPanelStateForTesting();
    vi.restoreAllMocks();
  });

  it("creates an isolated Shadow DOM container mounted to document.body", () => {
    const mount = ensureMountPoint(mockDoc as unknown as Document);

    expect(mount.host).toBeDefined();
    expect(mount.host.id).toBe(HOST_ID);
    expect(mount.host.parentNode).toBe(mockDoc.body);
    expect(mount.host.getAttribute("data-open")).toBe("false");
    expect(mount.host.style.pointerEvents).toBe("none");

    expect(mount.shadowRoot).toBeDefined();
    expect(mount.shadowRoot.mode).toBe("open");

    expect(mount.root).toBeDefined();
    expect(mount.root.id).toBe(ROOT_ID);
    expect(mount.root.getAttribute("data-state")).toBe("closed");
  });

  it("is idempotent on repeated calls to ensureMountPoint", () => {
    const first = ensureMountPoint(mockDoc as unknown as Document);
    const second = ensureMountPoint(mockDoc as unknown as Document);

    expect(first.host).toBe(second.host);
    expect(first.shadowRoot).toBe(second.shadowRoot);
    expect(first.root).toBe(second.root);

    // Only one host in document.body
    const hosts = mockDoc.querySelectorAll(`#${HOST_ID}`);
    expect(hosts.length).toBe(1);
  });

  it("provides accessors getShadowRoot and getMountPoint", () => {
    expect(getShadowRoot(mockDoc as unknown as Document)).toBeNull();
    expect(getMountPoint(mockDoc as unknown as Document)).toBeNull();

    const mount = ensureMountPoint(mockDoc as unknown as Document);

    expect(getShadowRoot(mockDoc as unknown as Document)).toBe(
      mount.shadowRoot
    );
    expect(getMountPoint(mockDoc as unknown as Document)).toBe(mount.root);
  });

  it("manages open/close state and dispatches toggle events", () => {
    const listenerSpy = vi.fn();
    const unsubscribe = onPanelToggle(listenerSpy);

    const windowListenerSpy = vi.fn();
    mockWin.addEventListener(
      TOGGLE_EVENT_NAME,
      windowListenerSpy as EventListener
    );

    expect(isPanelOpen()).toBe(false);

    // 1. Open panel
    openPanel(mockDoc as unknown as Document);

    expect(isPanelOpen()).toBe(true);
    expect(listenerSpy).toHaveBeenCalledWith(true);
    expect(windowListenerSpy).toHaveBeenCalledTimes(1);

    const mount = ensureMountPoint(mockDoc as unknown as Document);
    expect(mount.host.getAttribute("data-open")).toBe("true");
    expect(mount.host.style.pointerEvents).toBe("auto");
    expect(mount.root.getAttribute("data-state")).toBe("open");
    expect(mount.root.classList.contains("open")).toBe(true);

    // 2. Close panel
    closePanel(mockDoc as unknown as Document);

    expect(isPanelOpen()).toBe(false);
    expect(listenerSpy).toHaveBeenCalledWith(false);
    expect(windowListenerSpy).toHaveBeenCalledTimes(2);

    expect(mount.host.getAttribute("data-open")).toBe("false");
    expect(mount.host.style.pointerEvents).toBe("none");
    expect(mount.root.getAttribute("data-state")).toBe("closed");
    expect(mount.root.classList.contains("open")).toBe(false);

    // 3. Unsubscribe stops receiving events
    unsubscribe();
    togglePanel(undefined, mockDoc as unknown as Document);
    expect(listenerSpy).toHaveBeenCalledTimes(2); // no extra call after unsubscribe
  });

  it("closes the panel when clicking on the backdrop", () => {
    openPanel(mockDoc as unknown as Document);
    expect(isPanelOpen()).toBe(true);

    const mount = ensureMountPoint(mockDoc as unknown as Document);
    const backdrop = mount.shadowRoot.querySelector(".panel-backdrop");
    expect(backdrop).toBeDefined();

    backdrop?.dispatchEvent(new Event("click"));
    expect(isPanelOpen()).toBe(false);
  });
});
