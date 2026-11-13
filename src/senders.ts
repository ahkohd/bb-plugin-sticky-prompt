// Who sent each user message.
//
// A message on screen tells us through the message metadata slot. BB marks
// notices and messages from other threads in their text, which settles most
// of the rest. For anything else, the outline id ends in the message's event
// sequence (`<thread>:user-seed:<seq>`), and `threads.message` returns that
// one row with its initiator.

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

/** The sender BB's own prefix names, if the preview has one. */
export function senderFromPreview(preview: string): Initiator | undefined {
  const text = preview.trimStart();
  if (text.startsWith("[bb system]")) return "system";
  if (text.startsWith("[bb message from thread:")) return "agent";
  return undefined;
}

export function seqFromId(id: string): number | undefined {
  const match = /:user-seed:(\d+)$/.exec(id);
  if (match === null) return undefined;
  const seq = Number(match[1]);
  return Number.isSafeInteger(seq) ? seq : undefined;
}

export type FetchMessage = (seq: number) => Promise<unknown>;

/** Look one message up by its event sequence. Undefined when BB cannot say. */
export async function findSender(
  fetchMessage: FetchMessage,
  id: string,
): Promise<Initiator | undefined> {
  const seq = seqFromId(id);
  if (seq === undefined) return undefined;
  const found = new Map<string, Initiator>();
  collectUserInitiators(await fetchMessage(seq), found);
  const exact = found.get(id);
  if (exact !== undefined) return exact;
  // The row id may be spelled differently from the outline id; a single user
  // row in the answer is still this message.
  return found.size === 1 ? [...found.values()][0] : undefined;
}
