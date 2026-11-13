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
export const TOP_LEVEL_LIST = `[${LIST_ATTR}="${TOP_LEVEL}"]`;

const areas = new Map<HTMLElement, Area>();
const areaKeys = new WeakMap<HTMLElement, number>();
const scrollContainers = new WeakMap<Element, HTMLElement | null>();
let nextKey = 1;
let snapshot: readonly Area[] = [];
const areaListeners = new Set<() => void>();

// Senders seen, most recently used thread last. Bounded: a long session
// visits many threads, and each entry is only a hint the API can answer.
const MAX_THREADS = 30;
const MAX_PER_THREAD = 2000;
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

export function subscribeInitiators(listener: (threadId: string) => void): () => void {
  initiatorListeners.add(listener);
  return () => {
    initiatorListeners.delete(listener);
  };
}

export function getInitiator(threadId: string, messageId: string): Initiator | undefined {
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
  } else {
    initiators.delete(threadId);
  }
  initiators.set(threadId, byId);
  while (initiators.size > MAX_THREADS) {
    const oldest = initiators.keys().next().value;
    if (oldest === undefined) break;
    initiators.delete(oldest);
  }
  if (byId.get(messageId) === initiator) return;
  byId.set(messageId, initiator);
  while (byId.size > MAX_PER_THREAD) {
    const oldest = byId.keys().next().value;
    if (oldest === undefined) break;
    byId.delete(oldest);
  }
  if (notify) for (const listener of initiatorListeners) listener(threadId);
}

/**
 * The top-level timeline row list a row belongs to, or null. A chat embedded
 * inside another chat's rows is left to the outer bar.
 */
export function topLevelListOf(row: Element): HTMLElement | null {
  const list = row.closest<HTMLElement>(`[${LIST_ATTR}]`);
  if (list === null || list.getAttribute(LIST_ATTR) !== TOP_LEVEL) return null;
  if (list.parentElement?.closest(TOP_LEVEL_LIST) != null) return null;
  return list;
}

function scrollContainerOf(list: Element): HTMLElement | null {
  const cached = scrollContainers.get(list);
  if (cached !== undefined && (cached === null || cached.isConnected)) return cached;
  let found: HTMLElement | null = null;
  for (let node = list.parentElement; node !== null && node !== document.body; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      found = node;
      break;
    }
  }
  scrollContainers.set(list, found);
  return found;
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
    if (areas.get(scrollEl)?.threadId === threadId) continue;
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
