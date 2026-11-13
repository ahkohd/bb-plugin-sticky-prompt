// Who sent each user message.
//
// A message on screen tells us through the message metadata slot. For one BB
// has not rendered, page back through the thread's timeline summary. The
// walk is tolerant of the row shape: any object that looks like a user
// conversation row counts.

import type { Initiator } from "./registry";

const INITIATORS: ReadonlySet<string> = new Set(["agent", "system", "user"]);
const MAX_DEPTH = 8;

export function collectUserInitiators(
  value: unknown,
  out: Map<string, Initiator>,
  depth = 0,
): void {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectUserInitiators(item, out, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    record.kind === "conversation" &&
    record.role === "user" &&
    typeof record.id === "string" &&
    typeof record.initiator === "string" &&
    INITIATORS.has(record.initiator)
  ) {
    out.set(record.id, record.initiator as Initiator);
  }
  for (const key of Object.keys(record)) {
    const child = record[key];
    if (child !== null && typeof child === "object") {
      collectUserInitiators(child, out, depth + 1);
    }
  }
}

export interface TimelinePage {
  rows?: unknown;
  timelinePage?: {
    olderCursor?: { anchorId: string; anchorSeq: number } | null;
    olderRowUpdates?: unknown;
  };
}

export type FetchTimelinePage = (
  cursor: { anchorId: string; anchorSeq: number } | null,
) => Promise<TimelinePage>;

const MAX_PAGES = 40;

/**
 * Page back from the newest rows until `wantedId`'s sender is known or the
 * history ends. Returns every sender seen on the way.
 */
export async function findSenders(
  fetchPage: FetchTimelinePage,
  wantedId: string,
  signal: AbortSignal,
): Promise<Map<string, Initiator>> {
  const found = new Map<string, Initiator>();
  let cursor: { anchorId: string; anchorSeq: number } | null = null;
  for (let page = 0; page < MAX_PAGES && !signal.aborted; page++) {
    const result = await fetchPage(cursor);
    collectUserInitiators(result.rows, found);
    collectUserInitiators(result.timelinePage?.olderRowUpdates, found);
    if (found.has(wantedId)) break;
    cursor = result.timelinePage?.olderCursor ?? null;
    if (cursor === null) break;
  }
  return found;
}
