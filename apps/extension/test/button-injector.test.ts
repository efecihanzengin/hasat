import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MockDocument,
  MockElement,
  MockMutationObserver,
  MockWindow,
} from "./mock-dom.js";
import {
  BUTTON_ID,
  isTargetPage,
  isChannelUrl,
  isPlaylistUrl,
  findTargetContainer,
  createTranscribeButton,
  injectTranscribeButton,
  cleanupTranscribeButton,
  initButtonInjection,
} from "../src/content/button-injector.js";
import {
  isPanelOpen,
  _resetPanelStateForTesting,
} from "../src/content/shadow-shell.js";

describe("Button Injector & SPA Lifecycle", () => {
  let mockWin: MockWindow;
  let mockDoc: MockDocument;

  beforeEach(() => {
    _resetPanelStateForTesting();
    MockMutationObserver.reset();
    mockWin = new MockWindow("https://www.youtube.com/@veritasium");
    mockDoc = mockWin.document;
  });

  afterEach(() => {
    _resetPanelStateForTesting();
    MockMutationObserver.reset();
    vi.restoreAllMocks();
  });

  describe("URL Target Detection", () => {
    it("identifies channel URLs accurately", () => {
      expect(isChannelUrl("/@veritasium")).toBe(true);
      expect(isChannelUrl("/@veritasium/videos")).toBe(true);
      expect(isChannelUrl("/@3blue1brown/featured")).toBe(true);
      expect(isChannelUrl("/channel/UCHnyfMqiRRG1u-2MsSQLbXA")).toBe(true);
      expect(isChannelUrl("/c/TED")).toBe(true);
      expect(isChannelUrl("/user/crashcourse")).toBe(true);

      expect(isChannelUrl("/watch")).toBe(false);
      expect(isChannelUrl("/playlist")).toBe(false);
      expect(isChannelUrl("/")).toBe(false);
      expect(isChannelUrl("/feed/subscriptions")).toBe(false);
    });

    it("identifies playlist URLs accurately", () => {
      expect(
        isPlaylistUrl("/playlist", "?list=PLrAXtmErZgOdP_8GztsuKi9nvOGQofMR4")
      ).toBe(true);
      expect(
        isPlaylistUrl("/playlist", "list=PLrAXtmErZgOdP_8GztsuKi9nvOGQofMR4")
      ).toBe(true);
      expect(isPlaylistUrl("/playlist", "")).toBe(false);
      expect(isPlaylistUrl("/watch", "?v=123&list=PL123")).toBe(true);
      expect(isPlaylistUrl("/watch", "?v=123")).toBe(false);
    });

    it("detects target pages with isTargetPage", () => {
      expect(isTargetPage("https://www.youtube.com/@hubermanlab")).toEqual({
        isMatch: true,
        type: "channel",
      });
      expect(
        isTargetPage("https://www.youtube.com/playlist?list=PL12345")
      ).toEqual({
        isMatch: true,
        type: "playlist",
      });
      expect(
        isTargetPage(
          "https://www.youtube.com/watch?v=tmw7oYG3vMU&list=PL_JVnPgp2IRdpXdNpsZOqi0xk9k1aXQ93"
        )
      ).toEqual({
        isMatch: true,
        type: "playlist",
      });
      expect(
        isTargetPage("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
      ).toEqual({
        isMatch: false,
        type: null,
      });
      expect(isTargetPage("https://www.youtube.com/")).toEqual({
        isMatch: false,
        type: null,
      });
      expect(
        isTargetPage("https://www.youtube.com/results?search_query=podcast")
      ).toEqual({
        isMatch: false,
        type: null,
      });
    });
  });

  describe("Target Container Detection", () => {
    it("detects channel action buttons container", () => {
      const channelHeader = new MockElement("ytd-channel-header-renderer");
      const buttonsContainer = new MockElement("div");
      buttonsContainer.id = "buttons";
      channelHeader.appendChild(buttonsContainer);
      mockDoc.body.appendChild(channelHeader);

      const target = findTargetContainer(
        mockDoc as unknown as Document,
        "channel"
      );
      expect(target).toBe(buttonsContainer);
    });

    it("detects modern page header action buttons container", () => {
      const pageHeader = new MockElement("yt-page-header-renderer");
      const actionButtons = new MockElement("div");
      actionButtons.id = "page-header-action-buttons";
      pageHeader.appendChild(actionButtons);
      mockDoc.body.appendChild(pageHeader);

      const target = findTargetContainer(
        mockDoc as unknown as Document,
        "channel"
      );
      expect(target).toBe(actionButtons);
    });

    it("detects playlist action bar container", () => {
      const playlistHeader = new MockElement("ytd-playlist-header-renderer");
      const actionBar = new MockElement("div");
      actionBar.className = "metadata-action-bar";
      playlistHeader.appendChild(actionBar);
      mockDoc.body.appendChild(playlistHeader);

      const target = findTargetContainer(
        mockDoc as unknown as Document,
        "playlist"
      );
      expect(target).toBe(actionBar);
    });

    it("detects watch page playlist panel action container", () => {
      const panel = new MockElement("ytd-playlist-panel-renderer");
      const panelButtons = new MockElement("div");
      panelButtons.id = "top-level-buttons-computed";
      panel.appendChild(panelButtons);
      mockDoc.body.appendChild(panel);

      const target = findTargetContainer(
        mockDoc as unknown as Document,
        "playlist"
      );
      expect(target).toBe(panelButtons);
    });

    it("strictly excludes masthead buttons from matching", () => {
      const masthead = new MockElement("ytd-masthead");
      masthead.id = "masthead";
      const mastheadButtons = new MockElement("div");
      mastheadButtons.id = "buttons";
      masthead.appendChild(mastheadButtons);
      mockDoc.body.appendChild(masthead);

      // Without channel header, masthead #buttons must be ignored
      const target = findTargetContainer(mockDoc as unknown as Document);
      expect(target).toBeNull();
    });
  });

  describe("Button Creation and Click Behavior", () => {
    it("creates an accessible Transcribe button with label and SVG icon", () => {
      const clickSpy = vi.fn();
      const button = createTranscribeButton(
        clickSpy,
        mockDoc as unknown as Document
      );

      expect(button.id).toBe(BUTTON_ID);
      expect(button.getAttribute("aria-label")).toBe("Transcribe");
      expect(button.textContent).toContain("Transcribe");

      const svg = button.querySelector("svg");
      expect(svg).toBeDefined();

      button.dispatchEvent(new Event("click"));
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Idempotency and Cleanup", () => {
    it("injects button into container and does not duplicate on repeat calls", () => {
      const header = new MockElement("ytd-channel-header-renderer");
      const buttons = new MockElement("div");
      buttons.id = "buttons";
      header.appendChild(buttons);
      mockDoc.body.appendChild(header);

      const btn1 = injectTranscribeButton(
        mockDoc as unknown as Document,
        "channel"
      );
      expect(btn1).toBeDefined();
      expect(buttons.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);

      // Second injection attempt should return the existing button
      const btn2 = injectTranscribeButton(
        mockDoc as unknown as Document,
        "channel"
      );
      expect(btn2).toBe(btn1);
      expect(buttons.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);
    });

    it("cleans up stale buttons in disconnected headers before injecting into active header", () => {
      // First header (e.g. from an earlier channel page)
      const oldHeader = new MockElement("ytd-channel-header-renderer");
      const oldButtons = new MockElement("div");
      oldButtons.id = "buttons";
      oldHeader.appendChild(oldButtons);
      mockDoc.body.appendChild(oldHeader);

      injectTranscribeButton(mockDoc as unknown as Document, "channel");
      expect(oldButtons.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);

      // Simulate YouTube swapping in a new channel header
      oldHeader.remove();
      const newHeader = new MockElement("ytd-channel-header-renderer");
      const newButtons = new MockElement("div");
      newButtons.id = "buttons";
      newHeader.appendChild(newButtons);
      mockDoc.body.appendChild(newHeader);

      const newBtn = injectTranscribeButton(
        mockDoc as unknown as Document,
        "channel"
      );
      expect(newBtn).toBeDefined();
      expect(newButtons.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);
      expect(mockDoc.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);
    });

    it("removes button cleanly with cleanupTranscribeButton", () => {
      const header = new MockElement("ytd-channel-header-renderer");
      const buttons = new MockElement("div");
      buttons.id = "buttons";
      header.appendChild(buttons);
      mockDoc.body.appendChild(header);

      injectTranscribeButton(mockDoc as unknown as Document, "channel");
      expect(mockDoc.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);

      cleanupTranscribeButton(mockDoc as unknown as Document);
      expect(mockDoc.querySelectorAll(`#${BUTTON_ID}`).length).toBe(0);
    });
  });

  describe("SPA Navigation Lifecycle & MutationObserver Fallback", () => {
    it("injects button when header already exists on load", () => {
      const header = new MockElement("ytd-channel-header-renderer");
      const buttons = new MockElement("div");
      buttons.id = "buttons";
      header.appendChild(buttons);
      mockDoc.body.appendChild(header);

      const cleanup = initButtonInjection(mockWin as unknown as Window);
      expect(mockDoc.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);

      cleanup();
    });

    it("uses MutationObserver fallback when header renders asynchronously", () => {
      // Start on channel page before header renders
      const cleanup = initButtonInjection(mockWin as unknown as Window);
      expect(mockDoc.querySelectorAll(`#${BUTTON_ID}`).length).toBe(0);

      // Simulate YouTube rendering header later
      const header = new MockElement("ytd-channel-header-renderer");
      const buttons = new MockElement("div");
      buttons.id = "buttons";
      header.appendChild(buttons);
      mockDoc.body.appendChild(header);

      expect(mockDoc.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);

      cleanup();
    });

    it("cleans up button when navigating to non-target page (e.g. watch page)", () => {
      const header = new MockElement("ytd-channel-header-renderer");
      const buttons = new MockElement("div");
      buttons.id = "buttons";
      header.appendChild(buttons);
      mockDoc.body.appendChild(header);

      const cleanup = initButtonInjection(mockWin as unknown as Window);
      expect(mockDoc.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);

      // Navigate to watch page
      mockWin.navigate("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

      expect(mockDoc.querySelectorAll(`#${BUTTON_ID}`).length).toBe(0);

      cleanup();
    });

    it("re-injects cleanly when navigating across channels", () => {
      const header = new MockElement("ytd-channel-header-renderer");
      const buttons = new MockElement("div");
      buttons.id = "buttons";
      header.appendChild(buttons);
      mockDoc.body.appendChild(header);

      const cleanup = initButtonInjection(mockWin as unknown as Window);
      expect(mockDoc.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);

      // Navigate to another channel
      mockWin.navigate("https://www.youtube.com/@3blue1brown");
      expect(mockDoc.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);

      // Navigate to playlist
      const playlistHeader = new MockElement("ytd-playlist-header-renderer");
      const actionBar = new MockElement("div");
      actionBar.className = "metadata-action-bar";
      playlistHeader.appendChild(actionBar);
      header.remove();
      mockDoc.body.appendChild(playlistHeader);

      mockWin.navigate("https://www.youtube.com/playlist?list=PL12345");
      expect(mockDoc.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);
      expect(actionBar.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);

      cleanup();
    });

    it("clicking the injected button toggles the Shadow DOM panel drawer", () => {
      const header = new MockElement("ytd-channel-header-renderer");
      const buttons = new MockElement("div");
      buttons.id = "buttons";
      header.appendChild(buttons);
      mockDoc.body.appendChild(header);

      const cleanup = initButtonInjection(mockWin as unknown as Window);
      const button = mockDoc.querySelector(`#${BUTTON_ID}`) as MockElement;
      expect(button).toBeDefined();

      expect(isPanelOpen()).toBe(false);

      // Click button -> opens panel
      button.dispatchEvent(new Event("click"));
      expect(isPanelOpen()).toBe(true);

      // Click button again -> closes panel
      button.dispatchEvent(new Event("click"));
      expect(isPanelOpen()).toBe(false);

      cleanup();
    });
  });
});
