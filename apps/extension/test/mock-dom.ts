/**
 * Lightweight mock DOM environment for unit testing extension content scripts in Node.
 */

export class MockDOMTokenList {
  private tokens = new Set<string>();

  constructor(initial = "") {
    if (initial) {
      for (const t of initial.split(/\s+/)) {
        if (t) {
          this.tokens.add(t);
        }
      }
    }
  }

  add(...tokens: string[]): void {
    for (const t of tokens) {
      if (t) {
        this.tokens.add(t);
      }
    }
  }

  remove(...tokens: string[]): void {
    for (const t of tokens) {
      this.tokens.delete(t);
    }
  }

  toggle(token: string, force?: boolean): boolean {
    if (force !== undefined) {
      if (force) {
        this.tokens.add(token);
      } else {
        this.tokens.delete(token);
      }
      return force;
    }
    if (this.tokens.has(token)) {
      this.tokens.delete(token);
      return false;
    } else {
      this.tokens.add(token);
      return true;
    }
  }

  contains(token: string): boolean {
    return this.tokens.has(token);
  }

  toString(): string {
    return Array.from(this.tokens).join(" ");
  }
}

export class MockEventTarget {
  private listeners: Map<string, Set<EventListener>> = new Map();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    const fn = typeof listener === "function" ? listener : listener.handleEvent;
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)?.add(fn);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    const fn = typeof listener === "function" ? listener : listener.handleEvent;
    this.listeners.get(type)?.delete(fn);
  }

  dispatchEvent(event: Event): boolean {
    const set = this.listeners.get(event.type);
    if (set) {
      for (const fn of set) {
        fn.call(this, event);
      }
    }
    return true;
  }
}

export class MockNode extends MockEventTarget {
  parentNode: MockNode | null = null;
  childNodes: MockNode[] = [];

  appendChild<T extends MockNode>(child: T): T {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.childNodes.push(child);
    MockMutationObserver.notify(this);
    return child;
  }

  removeChild<T extends MockNode>(child: T): T {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
      MockMutationObserver.notify(this);
    }
    return child;
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }
}

export class MockElement extends MockNode {
  tagName: string;
  id: string = "";
  classList: MockDOMTokenList = new MockDOMTokenList();
  style: Record<string, string> = {};
  attributes: Map<string, string> = new Map();
  shadowRoot: MockShadowRoot | null = null;
  private _textContent: string = "";

  constructor(tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
  }

  get textContent(): string {
    if (this.childNodes.length === 0) {
      return this._textContent;
    }
    let text = this._textContent;
    for (const child of this.childNodes) {
      if (child instanceof MockElement) {
        text += child.textContent;
      }
    }
    return text;
  }

  set textContent(val: string) {
    this._textContent = val;
    this.childNodes = [];
  }


  get className(): string {
    return this.classList.toString();
  }

  set className(val: string) {
    this.classList = new MockDOMTokenList(val);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "id") {
      this.id = value;
    }
    if (name === "class") {
      this.className = value;
    }
  }

  getAttribute(name: string): string | null {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  attachShadow(options: { mode: "open" | "closed" }): MockShadowRoot {
    const sr = new MockShadowRoot(this, options.mode);
    this.shadowRoot = sr;
    return sr;
  }

  closest(selector: string): MockElement | null {
    if (matchesSimple(this, selector)) {
      return this;
    }
    let curr = this.parentNode;
    while (curr) {
      if (curr instanceof MockElement && matchesSimple(curr, selector)) {
        return curr;
      }
      curr = curr.parentNode;
    }
    return null;
  }

  querySelector(selector: string): MockElement | null {
    return querySelectorInternal(this, selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    return querySelectorAllInternal(this, selector);
  }

  click(): void {
    const event =
      typeof Event !== "undefined" ? new Event("click") : ({ type: "click" } as Event);
    this.dispatchEvent(event);
  }
}

export class MockShadowRoot extends MockNode {
  host: MockElement;
  mode: "open" | "closed";

  constructor(host: MockElement, mode: "open" | "closed") {
    super();
    this.host = host;
    this.mode = mode;
  }

  getElementById(id: string): MockElement | null {
    return findByIdInternal(this, id);
  }

  querySelector(selector: string): MockElement | null {
    return querySelectorInternal(this, selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    return querySelectorAllInternal(this, selector);
  }
}

export class MockDocument extends MockNode {
  body: MockElement;
  documentElement: MockElement;
  defaultView: MockWindow | null = null;
  title: string = "";

  constructor() {
    super();
    this.documentElement = new MockElement("HTML");
    this.body = new MockElement("BODY");
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tagName: string): MockElement {
    return new MockElement(tagName);
  }

  createElementNS(_ns: string, tagName: string): MockElement {
    return new MockElement(tagName);
  }

  getElementById(id: string): MockElement | null {
    return findByIdInternal(this, id);
  }

  querySelector(selector: string): MockElement | null {
    return querySelectorInternal(this, selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    return querySelectorAllInternal(this, selector);
  }
}

export class MockMutationObserver {
  private static activeObservers: MockMutationObserver[] = [];
  callback: (mutations: unknown[]) => void;
  target: MockNode | null = null;

  constructor(callback: (mutations: unknown[]) => void) {
    this.callback = callback;
    MockMutationObserver.activeObservers.push(this);
  }

  observe(target: MockNode): void {
    this.target = target;
  }


  disconnect(): void {
    this.target = null;
    const idx = MockMutationObserver.activeObservers.indexOf(this);
    if (idx !== -1) {
      MockMutationObserver.activeObservers.splice(idx, 1);
    }
  }

  private static isNotifying = false;

  static notify(mutatedNode: MockNode): void {
    if (this.isNotifying) return;
    this.isNotifying = true;
    try {
      for (const obs of [...this.activeObservers]) {
        if (obs.target) {
          let curr: MockNode | null = mutatedNode;
          while (curr) {
            if (curr === obs.target) {
              obs.callback([]);
              break;
            }
            curr = curr.parentNode;
          }
        }
      }
    } finally {
      this.isNotifying = false;
    }
  }

  static reset(): void {
    this.activeObservers = [];
    this.isNotifying = false;
  }

}

export class MockWindow extends MockEventTarget {
  document: MockDocument;
  location: { href: string; pathname: string; search: string };
  MutationObserver: typeof MockMutationObserver = MockMutationObserver;

  constructor(initialUrl = "https://www.youtube.com") {
    super();
    this.document = new MockDocument();
    this.document.defaultView = this;
    const parsed = new URL(initialUrl);
    this.location = {
      href: parsed.href,
      pathname: parsed.pathname,
      search: parsed.search,
    };
  }

  setUrl(url: string): void {
    const parsed = new URL(url, "https://www.youtube.com");
    this.location.href = parsed.href;
    this.location.pathname = parsed.pathname;
    this.location.search = parsed.search;
  }

  navigate(url: string): void {
    this.setUrl(url);
    this.dispatchEvent(new Event("yt-navigate-finish"));
  }
}

// Selector matching helpers
function matchesSimple(el: MockElement, selector: string): boolean {
  const trimmed = selector.trim();
  if (trimmed.startsWith("#")) {
    return el.id === trimmed.slice(1);
  }
  if (trimmed.startsWith(".")) {
    return el.classList.contains(trimmed.slice(1));
  }
  const attrMatch = trimmed.match(
    /^([a-zA-Z0-9_-]*)\[([a-zA-Z0-9_-]+)([*^$]?=)"?([^"\]]*)"?\]$/
  );
  if (attrMatch) {
    const tag = attrMatch[1];
    const attrName = attrMatch[2];
    const op = attrMatch[3];
    const expectedVal = attrMatch[4];
    if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) {
      return false;
    }
    if (!attrName) return false;
    const actualVal = el.getAttribute(attrName);
    if (actualVal === null || actualVal === undefined) return false;
    if (op === "=") return actualVal === expectedVal;
    if (op === "*=") return actualVal.includes(expectedVal ?? "");
    if (op === "^=") return actualVal.startsWith(expectedVal ?? "");
    if (op === "$=") return actualVal.endsWith(expectedVal ?? "");
    return true;
  }
  return el.tagName.toLowerCase() === trimmed.toLowerCase();
}

function matchesSelector(el: MockElement, selector: string): boolean {
  const parts = selector.trim().split(/\s+/);
  if (parts.length === 1) {
    const part = parts[0];
    if (!part) return false;
    return matchesSimple(el, part);
  }

  // Handle two-part descendant selectors like "ytd-channel-header-renderer #buttons"
  const lastPart = parts[parts.length - 1];
  if (!lastPart || !matchesSimple(el, lastPart)) {
    return false;
  }

  const prevPart = parts[parts.length - 2];
  if (!prevPart) return false;

  let ancestor: MockNode | null = el.parentNode;
  while (ancestor) {
    if (ancestor instanceof MockElement && matchesSimple(ancestor, prevPart)) {
      return true;
    }
    ancestor = ancestor.parentNode;
  }
  return false;
}

function findByIdInternal(root: MockNode, id: string): MockElement | null {
  for (const child of root.childNodes) {
    if (child instanceof MockElement) {
      if (child.id === id) return child;
      const found = findByIdInternal(child, id);
      if (found) return found;
    }
  }
  return null;
}

function querySelectorInternal(root: MockNode, selector: string): MockElement | null {
  for (const child of root.childNodes) {
    if (child instanceof MockElement) {
      if (matchesSelector(child, selector)) return child;
      const found = querySelectorInternal(child, selector);
      if (found) return found;
    }
  }
  return null;
}

function querySelectorAllInternal(root: MockNode, selector: string): MockElement[] {
  const results: MockElement[] = [];
  function walk(node: MockNode): void {
    for (const child of node.childNodes) {
      if (child instanceof MockElement) {
        if (matchesSelector(child, selector)) {
          results.push(child);
        }
        walk(child);
      }
    }
  }
  walk(root);
  return results;
}
