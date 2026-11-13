import { describe, expect, it } from "vitest";
import { pick, type Entry, type Eligibility } from "../src/pick";
import { collectUserInitiators, findSender, senderFromPreview } from "../src/senders";
import type { Initiator } from "../src/registry";
import { imageSourcesOf } from "../src/thumbs";
import { barMarkdown, textOf } from "../src/message";

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
  return pick({ entries, outlineIds, areaTop: 0, barHeight: 50, areaHeight: 300, eligible, owners });
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
  it("collects user rows anywhere in a payload", () => {
    const out = new Map<string, Initiator>();
    collectUserInitiators(
      [
        { kind: "conversation", role: "user", id: "m1", initiator: "user" },
        { message: { kind: "conversation", role: "user", id: "m2", initiator: "agent" } },
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

  it("reads BB's prefixes", () => {
    expect(senderFromPreview("[bb system] @thread:thr_a completed")).toBe("system");
    expect(senderFromPreview("[bb message from thread:thr_a] hi")).toBe("agent");
    expect(senderFromPreview("> quoting [bb system]")).toBeUndefined();
  });

  it("looks a message up by the sequence in its id", async () => {
    const seqs: number[] = [];
    const who = await findSender(async (seq) => {
      seqs.push(seq);
      return {
        message: { kind: "conversation", role: "user", id: "thr_a:user-seed:42", initiator: "system" },
        before: [],
        after: [],
      };
    }, "thr_a:user-seed:42");
    expect(who).toBe("system");
    expect(seqs).toEqual([42]);
    expect(await findSender(async () => ({}), "no-seq")).toBeUndefined();
  });
});

describe("thumbnails", () => {
  it("lists web images, then project attachments, from a message answer", () => {
    expect(
      imageSourcesOf({
        message: {
          attachments: {
            imageUrls: ["https://example.com/a.png", "javascript:alert(1)", ""],
            localImagePaths: ["image-1.png"],
          },
        },
        before: [],
        after: [],
      }),
    ).toEqual([
      { kind: "web", url: "https://example.com/a.png" },
      { kind: "local", path: "image-1.png" },
    ]);
  });

  it("copes with rows that have no attachments", () => {
    expect(imageSourcesOf({ message: { attachments: null } })).toEqual([]);
    expect(imageSourcesOf(null)).toEqual([]);
  });
});

describe("bar markdown", () => {
  it("reads the text of a message answer", () => {
    expect(textOf({ message: { text: "Run `bb`" }, before: [], after: [] })).toBe("Run `bb`");
    expect(textOf({ message: { text: 3 } })).toBeNull();
    expect(textOf(null)).toBeNull();
  });

  it("keeps short text as it is", () => {
    expect(barMarkdown("  Run `mean inspect` and read it  ")).toBe("Run `mean inspect` and read it");
  });

  it("cuts long text at a line break and closes a fence the cut left open", () => {
    const text = "Intro\n```ts\nconst a = 1;\n" + "x".repeat(50) + "\nmore";
    const out = barMarkdown(text, 40);
    expect(out).toBe("Intro\n```ts\nconst a = 1;\n```");
  });

  it("leaves balanced fences alone", () => {
    expect(barMarkdown("a\n~~~\ncode\n~~~\nb")).toBe("a\n~~~\ncode\n~~~\nb");
  });
});
