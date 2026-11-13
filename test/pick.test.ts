import { describe, expect, it } from "vitest";
import { makeOutline, pick, type Entry, type Eligibility } from "../src/pick";

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
  owners = new Map<string, string | null>(),
) {
  const outline = makeOutline(outlineIds);
  return pick({ entries, outline, areaTop: 0, barHeight: 50, areaHeight: 300, eligible, owners });
}

describe("pick", () => {
  it("shows nothing while the first message is still on screen", () => {
    expect(run([row("u0", 10), row("a0", 110)], ["u0"])).toEqual({ kind: "none" });
  });

  it("pins a message as soon as its top reaches the top", () => {
    expect(run([row("u0", 0), row("a0", 100, 400)], ["u0"])).toEqual({
      kind: "show",
      index: 0,
      push: 0,
    });
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
    // u1 just below the bar: u0 is almost pushed away.
    expect(run([row("u0", -300), row("a0", -200, 205), row("u1", 5)], outline)).toEqual({
      kind: "show",
      index: 0,
      push: 45,
    });
    // u1's top has reached the top: it sticks at once.
    expect(
      run([row("u0", -300), row("a0", -200, 150), row("u1", -50), row("a1", 50, 400)], outline),
    ).toEqual({
      kind: "show",
      index: 1,
      push: 0,
    });
    expect(run([row("u1", -150), row("a1", -50, 400)], outline)).toEqual({
      kind: "show",
      index: 1,
      push: 0,
    });
  });

  it("does not pin a turn that fits on screen", () => {
    const outline = ["u0", "u1"];
    // u0 and the start of u1 are 240px apart in a 300px view.
    expect(
      run([row("u0", -40), row("a0", 60, 140), row("u1", 200, 60), row("a1", 260, 400)], outline),
    ).toEqual({ kind: "none" });
    // The last turn ends at the newest row.
    expect(run([row("u1", -40), row("a1", 60, 200)], outline)).toEqual({ kind: "none" });
    // A reply that runs past the view is pinned.
    expect(run([row("u1", -40), row("a1", 60, 400)], outline)).toEqual({
      kind: "show",
      index: 1,
      push: 0,
    });
  });

  it("uses what it learned before BB unmounted the message", () => {
    const owners = new Map<string, string | null>();
    const outline = ["u0", "u1"];
    run([row("u1", 0), row("a1", 100), row("t1", 200)], outline, all, owners);
    expect(owners.get("t1")).toBe("u1");
    // Later, u1 is windowed out: a spacer stands where it was.
    expect(run([spacer, row("t1", -20, 300), spacer, row("last", 900)], outline, all, owners)).toEqual({
      kind: "show",
      index: 1,
      push: 0,
    });
  });

  it("keeps what it learned when a new message is added to the outline", () => {
    const owners = new Map<string, string | null>();
    run([row("u1", 0), row("a1", 100), row("t1", 200)], ["u0", "u1"], all, owners);
    expect(
      run([spacer, row("t1", -20, 300), spacer, row("u2", 900)], ["u0", "u1", "u2"], all, owners),
    ).toEqual({ kind: "show", index: 1, push: 0 });
  });

  it("does not guess across a spacer it knows nothing about", () => {
    expect(run([spacer, row("x", -20, 300), spacer, row("last", 900)], ["u0", "u1"])).toEqual({
      kind: "none",
    });
  });

  it("falls back to the newest message inside the last turn, and says so", () => {
    expect(run([spacer, row("x", -20, 300), row("last", 280)], ["u0", "u1"])).toEqual({
      kind: "show",
      index: 1,
      push: 0,
      fallback: true,
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
