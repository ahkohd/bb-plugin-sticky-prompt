// Shared state between the per-message anchors and the overlay.
//
// BB gives a plugin no thread id in the timeline DOM, so every rendered
// message reports itself here through the experimental_messageMetadata slot.
// From its row we find the chat's scroll container, which becomes an "area"
// the overlay draws a sticky bar for. Anchors also record each user
// message's initiator, which the outline API does not carry.

export type Initiator = "agent" | "system" | "user";

export interface Area {
  /** Stable per scroll container, used as a React key. */
  key: number;
  scrollEl: HTMLElement;
  threadId: string;
}

const ROW_ATTR = "data-timeline-row-id";
const LIST_ATTR = "data-timeline-row-list";
const TOP_LEVEL = "top-level";

const areas = new Map<HTMLElement, Area>();
const areaKeys = new WeakMap<HTMLElement, number>();
let nextKey = 1;
let snapshot: readonly Area[] = [];
const areaListeners = new Set<() => void>();

const initiators = new Map<string, Map<string, Initiator>>();
const initiatorListeners = new Set<(threadId: string) => void>();

function emitAreas(): void {
  snapshot = [...areas.values()];
  for (const listener of areaListeners) listener();
}

export function subscribeAreas(listener: () => void): () => void {
  areaListeners.add(listener);
  return () => {
    areaListeners.delete(listener);
  };
}

export function getAreas(): readonly Area[] {
  return snapshot;
}

export function subscribeInitiators(
  listener: (threadId: string) => void,
): () => void {
  initiatorListeners.add(listener);
  return () => {
    initiatorListeners.delete(listener);
  };
}

export function getInitiator(
  threadId: string,
  messageId: string,
): Initiator | undefined {
  return initiators.get(threadId)?.get(messageId);
}

export function setInitiator(
  threadId: string,
  messageId: string,
  initiator: Initiator,
  notify = true,
): void {
  let byId = initiators.get(threadId);
  if (byId === undefined) {
    byId = new Map();
    initiators.set(threadId, byId);
  }
  if (byId.get(messageId) === initiator) return;
  byId.set(messageId, initiator);
  if (notify) for (const listener of initiatorListeners) listener(threadId);
}

export function notifyInitiators(threadId: string): void {
  for (const listener of initiatorListeners) listener(threadId);
}

/** The top-level timeline row list a row belongs to, or null. */
export function topLevelListOf(row: Element): HTMLElement | null {
  const list = row.closest<HTMLElement>(`[${LIST_ATTR}]`);
  if (list === null || list.getAttribute(LIST_ATTR) !== TOP_LEVEL) return null;
  return list;
}

export function scrollContainerOf(el: Element): HTMLElement | null {
  let node = el.parentElement;
  while (node !== null && node !== document.body) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

export function rowSelector(messageId: string): string {
  return `[${ROW_ATTR}="${CSS.escape(messageId)}"]`;
}

/**
 * Record a rendered message. Returns false when its row is not in the DOM
 * yet, so the caller can retry on the next frame.
 */
export function noteMessage(threadId: string, messageId: string): boolean {
  const rows = document.querySelectorAll(rowSelector(messageId));
  if (rows.length === 0) return false;
  let changed = false;
  for (const row of rows) {
    const list = topLevelListOf(row);
    if (list === null) continue;
    const scrollEl = scrollContainerOf(list);
    if (scrollEl === null) continue;
    const existing = areas.get(scrollEl);
    if (existing?.threadId === threadId) continue;
    let key = areaKeys.get(scrollEl);
    if (key === undefined) {
      key = nextKey++;
      areaKeys.set(scrollEl, key);
    }
    areas.set(scrollEl, { key, scrollEl, threadId });
    changed = true;
  }
  if (pruneDisconnected() || changed) emitAreas();
  return true;
}

function pruneDisconnected(): boolean {
  let changed = false;
  for (const scrollEl of areas.keys()) {
    if (!scrollEl.isConnected) {
      areas.delete(scrollEl);
      changed = true;
    }
  }
  return changed;
}

export function prune(): void {
  if (pruneDisconnected()) emitAreas();
}

export function resetForTests(): void {
  areas.clear();
  initiators.clear();
  snapshot = [];
}
