// Decide which of your messages the sticky bar shows.
//
// Pure so it can be tested without a DOM. The caller reads the top-level
// timeline in DOM order: mounted rows with their on-screen box, the spacers
// BB puts where it has unmounted rows (it windows long threads), and breaks:
// user messages on screen that the outline does not list yet.

export type Entry =
  | { kind: "row"; id: string; top: number; bottom: number }
  | { kind: "spacer" }
  | { kind: "break"; id: string; top: number; bottom: number };

/** true: pin it; false: skip it; "unknown": its sender is not known yet. */
export type Eligibility = boolean | "unknown";

/** The thread's user messages, oldest first, with each id's position. */
export interface Outline {
  ids: readonly string[];
  indexById: ReadonlyMap<string, number>;
}

export function makeOutline(ids: readonly string[]): Outline {
  return { ids, indexById: new Map(ids.map((id, index) => [id, index])) };
}

export interface PickInput {
  entries: readonly Entry[];
  outline: Outline;
  /** Top edge of the scroll container, in the same coordinates as rows. */
  areaTop: number;
  /** Height of the bar, for the push-out effect. */
  barHeight: number;
  /** Visible height of the scroll container. */
  areaHeight: number;
  eligible: (index: number) => Eligibility;
  /**
   * Row id to the id of the user message it falls under, or null for rows
   * before the first one. Filled while rows are mounted together with their
   * message, read once BB unmounts that message. Keyed by id, not position,
   * so it survives outline refreshes; an id the outline does not list marks
   * the row as under an unlisted message. Mutated.
   */
  owners: Map<string, string | null>;
}

export type PickResult =
  | { kind: "none" }
  | { kind: "unknown"; index: number }
  | {
      kind: "show";
      index: number;
      push: number;
      /** Chosen by the last-turn guess rather than by a row on screen. */
      fallback?: true;
    };

const NONE: PickResult = { kind: "none" };

export function pick(input: PickInput): PickResult {
  const { entries, outline, areaTop, barHeight, areaHeight, eligible, owners } = input;
  const { ids: outlineIds, indexById } = outline;
  if (outlineIds.length === 0) return NONE;

  // Which user message each mounted row falls under. A spacer may hide user
  // messages, so knowledge never crosses one. Rows after a break belong to a
  // message the outline does not have: they are owned by no one known.
  const owner: (number | undefined)[] = new Array(entries.length);
  const orphan: boolean[] = new Array(entries.length).fill(false);
  let running: number | undefined;
  let pending: number[] = [];
  let unlisted: string | undefined;
  entries.forEach((entry, i) => {
    if (entry.kind !== "row") {
      running = undefined;
      pending = [];
      unlisted = entry.kind === "break" ? entry.id : undefined;
      return;
    }
    const userIndex = indexById.get(entry.id);
    if (userIndex !== undefined) {
      for (const p of pending) owner[p] = userIndex - 1;
      pending = [];
      unlisted = undefined;
      running = userIndex;
      owner[i] = userIndex;
    } else if (unlisted !== undefined) {
      orphan[i] = true;
      owners.set(entry.id, unlisted);
    } else if (running !== undefined) {
      owner[i] = running;
    } else {
      pending.push(i);
    }
  });
  entries.forEach((entry, i) => {
    if (entry.kind !== "row" || orphan[i]) return;
    const known = owner[i];
    if (known !== undefined) {
      owners.set(entry.id, known < 0 ? null : (outlineIds[known] ?? null));
      return;
    }
    const remembered = owners.get(entry.id);
    if (remembered === null) owner[i] = -1;
    else if (remembered !== undefined) {
      owner[i] = indexById.get(remembered);
      if (owner[i] === undefined) orphan[i] = true;
    }
  });

  // The first row still on screen. Under a message the outline lacks, show
  // nothing rather than an older message.
  let topIndex = -1;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry !== undefined && entry.kind !== "spacer" && entry.bottom > areaTop + 1) {
      topIndex = i;
      break;
    }
  }
  if (topIndex < 0) return NONE;
  const topEntry = entries[topIndex];
  if (topEntry === undefined || topEntry.kind === "spacer" || orphan[topIndex]) return NONE;

  let candidate: number | undefined;
  if (topEntry.kind === "break") {
    // An unlisted message coming up keeps the one before it pinned, pushed
    // away like for any message; once it reaches the top there is nothing to
    // show.
    if (topEntry.top <= areaTop + 1) return NONE;
    for (let j = topIndex - 1; j >= 0; j--) {
      const before = entries[j];
      if (before?.kind !== "row" || orphan[j]) break;
      if (owner[j] !== undefined) {
        candidate = owner[j];
        break;
      }
    }
    if (candidate === undefined) return NONE;
  } else {
    const topUser = indexById.get(topEntry.id);
    // A message sticks as soon as its top reaches the top of the chat, like
    // a sticky header. Until then the one before it stays pinned.
    if (topUser !== undefined) candidate = topEntry.top <= areaTop + 1 ? topUser : topUser - 1;
    else candidate = owner[topIndex];
  }
  let fallback = false;
  if (candidate === undefined) {
    // Nothing known about this row. If no spacer and no user message follows
    // it, it is in the last turn: BB always keeps the newest row mounted.
    const rest = entries.slice(topIndex + 1);
    const contiguousToEnd = rest.every(
      (entry) => entry.kind === "row" && !indexById.has(entry.id),
    );
    if (!contiguousToEnd) return NONE;
    candidate = outlineIds.length - 1;
    fallback = true;
  }

  let chosen = candidate;
  for (; chosen >= 0; chosen--) {
    const verdict = eligible(chosen);
    if (verdict === "unknown") return { kind: "unknown", index: chosen };
    if (verdict) break;
  }
  if (chosen < 0) return NONE;

  // The next pinned message ends this turn and pushes the bar up as it
  // reaches the top. A message the outline lacks counts as one.
  let next: { top: number } | undefined;
  for (let i = topIndex; i < entries.length; i++) {
    const entry = entries[i];
    if (entry?.kind === "break") {
      next = entry;
      break;
    }
    if (entry?.kind !== "row") continue;
    const userIndex = indexById.get(entry.id);
    if (userIndex === undefined || userIndex <= chosen) continue;
    if (eligible(userIndex) === false) continue;
    next = entry;
    break;
  }

  // A turn that fits on screen needs no pin: its message and the end of its
  // reply can be seen together. A message or an end BB has unmounted is far
  // away, so the turn is long.
  const chosenId = outlineIds[chosen];
  const start = entries.findIndex((entry) => entry.kind === "row" && entry.id === chosenId);
  const startRow = entries[start];
  if (startRow?.kind === "row") {
    let end: number | undefined = next?.top;
    if (end === undefined) {
      const after = entries.slice(start + 1);
      const last = entries[entries.length - 1];
      if (after.every((entry) => entry.kind === "row") && last?.kind === "row") {
        end = last.bottom;
      }
    }
    if (end !== undefined && end - startRow.top <= areaHeight) return NONE;
  }

  const push =
    next === undefined ? 0 : Math.min(barHeight, Math.max(0, areaTop + barHeight - next.top));
  return fallback ? { kind: "show", index: chosen, push, fallback } : { kind: "show", index: chosen, push };
}
