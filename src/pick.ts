// Decide which of your messages the sticky bar shows.
//
// Pure so it can be tested without a DOM. The caller reads the top-level
// timeline in DOM order: mounted rows with their on-screen box, and the
// spacers BB puts where it has unmounted rows (it windows long threads).

export type Entry =
  | { kind: "row"; id: string; top: number; bottom: number }
  | { kind: "spacer" };

/** true: pin it; false: skip it; "unknown": its sender is not known yet. */
export type Eligibility = boolean | "unknown";

export interface PickInput {
  entries: readonly Entry[];
  /** Ids of the thread's user messages, oldest first. */
  outlineIds: readonly string[];
  /** Top edge of the scroll container, in the same coordinates as rows. */
  areaTop: number;
  /** Height of the bar, for the push-out effect. */
  barHeight: number;
  eligible: (index: number) => Eligibility;
  /**
   * Row id to the index of the user message it falls under. Filled while
   * rows are mounted together with their message, read once BB unmounts
   * that message. Mutated.
   */
  owners: Map<string, number>;
}

export type PickResult =
  | { kind: "none" }
  | { kind: "unknown"; index: number }
  | { kind: "show"; index: number; push: number };

const NONE: PickResult = { kind: "none" };

export function pick(input: PickInput): PickResult {
  const { entries, outlineIds, areaTop, barHeight, eligible, owners } = input;
  if (outlineIds.length === 0) return NONE;
  const indexById = new Map<string, number>();
  outlineIds.forEach((id, index) => indexById.set(id, index));

  // Which user message each mounted row falls under. A spacer may hide user
  // messages, so knowledge never crosses one.
  const owner: (number | undefined)[] = new Array(entries.length);
  let running: number | undefined;
  let pending: number[] = [];
  entries.forEach((entry, i) => {
    if (entry.kind === "spacer") {
      running = undefined;
      pending = [];
      return;
    }
    const userIndex = indexById.get(entry.id);
    if (userIndex !== undefined) {
      for (const p of pending) owner[p] = userIndex - 1;
      pending = [];
      running = userIndex;
      owner[i] = userIndex;
    } else if (running !== undefined) {
      owner[i] = running;
    } else {
      pending.push(i);
    }
  });
  entries.forEach((entry, i) => {
    if (entry.kind !== "row") return;
    const known = owner[i];
    if (known !== undefined) owners.set(entry.id, known);
    else owner[i] = owners.get(entry.id);
  });

  // The first row still on screen.
  let topIndex = -1;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry?.kind === "row" && entry.bottom > areaTop + 1) {
      topIndex = i;
      break;
    }
  }
  if (topIndex < 0) return NONE;
  const topEntry = entries[topIndex] as Extract<Entry, { kind: "row" }>;

  let candidate: number | undefined;
  const topUser = indexById.get(topEntry.id);
  if (topUser !== undefined) {
    // A message sticks as soon as its top reaches the top of the chat, like
    // a sticky header. Until then the one before it stays pinned.
    candidate = topEntry.top <= areaTop + 1 ? topUser : topUser - 1;
  } else {
    candidate = owner[topIndex];
  }
  if (candidate === undefined) {
    // Nothing known about this row. If no spacer and no user message follows
    // it, it is in the last turn: BB always keeps the newest row mounted.
    const rest = entries.slice(topIndex + 1);
    const contiguousToEnd = rest.every(
      (entry) => entry.kind === "row" && !indexById.has(entry.id),
    );
    if (!contiguousToEnd) return NONE;
    candidate = outlineIds.length - 1;
  }

  let chosen = candidate;
  for (; chosen >= 0; chosen--) {
    const verdict = eligible(chosen);
    if (verdict === "unknown") return { kind: "unknown", index: chosen };
    if (verdict) break;
  }
  if (chosen < 0) return NONE;

  // The next pinned message pushes the bar up as it reaches the top.
  let push = 0;
  for (let i = topIndex; i < entries.length; i++) {
    const entry = entries[i];
    if (entry?.kind !== "row") continue;
    const userIndex = indexById.get(entry.id);
    if (userIndex === undefined || userIndex <= chosen) continue;
    if (eligible(userIndex) === false) continue;
    push = Math.min(barHeight, Math.max(0, areaTop + barHeight - entry.top));
    break;
  }
  return { kind: "show", index: chosen, push };
}
