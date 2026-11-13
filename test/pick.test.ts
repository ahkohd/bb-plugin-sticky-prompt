import { describe, expect, it } from "vitest";
import { pick, type Entry, type Eligibility } from "../src/pick";
import { collectUserInitiators, findSenders } from "../src/senders";
import type { Initiator } from "../src/registry";

const row = (id: string, top: number, height = 100): Entry => ({
  kind: "row",
  id,
  top,
  bottom: top + height,
});
const spacer: Entry = { kind: "spacer" };
const all = (): Eligibility => true;

function run(
  entries: Entry[],
  outlineIds: string[],
  eligible: (index: number) => Eligibility = all,
  owners = new Map<string, number>(),
) {
  return pick({ entries, outlineIds, areaTop: 0, barHeight: 50, eligible, owners });
}

describe("pick", () => {
  it("shows nothing while the first message is still on screen", () => {
    expect(run([row("u0", 10), row("a0", 110)], ["u0"])).toEqual({ kind: "none" });
  });

  it("pins a message once it has scrolled past the top", () => {
    expect(run([row("u0", -200), row("a0", -100, 400)], ["u0"])).toEqual({
      kind: "show",
      index: 0,
      push: 0,
    });
  });

  it("is pushed up by the next message and switches once that one leaves", () => {
    const outline = ["u0", "u1"];
    expect(run([row("u0", -300), row("a0", -200, 220), row("u1", 20)], outline)).toEqual({
      kind: "show",
      index: 0,
      push: 30,
    });
    // u1 partly visible: the bar shows u0, fully pushed away.
    expect(run([row("u0", -300), row("a0", -200, 150), row("u1", -50)], outline)).toEqual({
      kind: "show",
      index: 0,
      push: 50,
    });
    expect(run([row("u1", -150), row("a1", -50, 400)], outline)).toEqual({
      kind: "show",
      index: 1,
      push: 0,
    });
  });

  it("uses what it learned before BB unmounted the message", () => {
    const owners = new Map<string, number>();
    const outline = ["u0", "u1"];
    run([row("u1", 0), row("a1", 100), row("t1", 200)], outline, all, owners);
    expect(owners.get("t1")).toBe(1);
    // Later, u1 is windowed out: a spacer stands where it was.
    expect(run([spacer, row("t1", -20, 300), spacer, row("last", 900)], outline, all, owners)).toEqual({
      kind: "show",
      index: 1,
      push: 0,
    });
  });

  it("does not guess across a spacer it knows nothing about", () => {
    expect(run([spacer, row("x", -20, 300), spacer, row("last", 900)], ["u0", "u1"])).toEqual({
      kind: "none",
    });
  });

  it("falls back to the newest message inside the last turn", () => {
    expect(run([spacer, row("x", -20, 300), row("last", 280)], ["u0", "u1"])).toEqual({
      kind: "show",
      index: 1,
      push: 0,
    });
  });

  it("rows before the first mounted message belong to the one before it", () => {
    expect(run([spacer, row("a0", -50, 200), row("u1", 150)], ["u0", "u1"])).toEqual({
      kind: "show",
      index: 0,
      push: 0,
    });
  });

  it("skips messages you did not send", () => {
    const senders: Eligibility[] = [true, false];
    const eligible = (i: number) => senders[i] ?? false;
    // u1 is from an agent; the reply below it keeps u0 pinned.
    expect(run([row("u1", -200), row("a1", -100, 400)], ["u0", "u1"], eligible)).toEqual({
      kind: "show",
      index: 0,
      push: 0,
    });
    // An agent message arriving does not push your pinned message away.
    expect(run([row("a0", -100, 120), row("u1", 20)], ["u0", "u1"], eligible)).toEqual({
      kind: "show",
      index: 0,
      push: 0,
    });
  });

  it("asks for the sender when it is not known", () => {
    expect(
      run([row("u1", -200), row("a1", -100, 400)], ["u0", "u1"], (i) => (i === 1 ? "unknown" : true)),
    ).toEqual({ kind: "unknown", index: 1 });
  });
});

describe("senders", () => {
  it("collects user rows anywhere in a timeline payload", () => {
    const out = new Map<string, Initiator>();
    collectUserInitiators(
      [
        { kind: "conversation", role: "user", id: "m1", initiator: "user" },
        { kind: "turn", rows: [{ kind: "conversation", role: "user", id: "m2", initiator: "agent" }] },
        { kind: "conversation", role: "assistant", id: "m3", initiator: "user" },
        { kind: "conversation", role: "user", id: "m4", initiator: "robot" },
      ],
      out,
    );
    expect([...out]).toEqual([
      ["m1", "user"],
      ["m2", "agent"],
    ]);
  });

  it("pages back until the wanted message is found", async () => {
    const pages = [
      { rows: [{ kind: "conversation", role: "user", id: "new", initiator: "user" }], timelinePage: { olderCursor: { anchorId: "a", anchorSeq: 5 } } },
      { rows: [{ kind: "conversation", role: "user", id: "old", initiator: "system" }], timelinePage: { olderCursor: { anchorId: "b", anchorSeq: 1 } } },
    ];
    const cursors: unknown[] = [];
    const found = await findSenders(
      async (cursor) => {
        cursors.push(cursor);
        return pages[cursors.length - 1] ?? {};
      },
      "old",
      new AbortController().signal,
    );
    expect(found.get("old")).toBe("system");
    expect(cursors).toEqual([null, { anchorId: "a", anchorSeq: 5 }]);
  });
});
