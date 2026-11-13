import { describe, expect, it } from "vitest";
import { barMarkdown, barParts, mentionTarget, userRowOf, withoutSenderPrefix } from "../src/message";
import { findSender, senderFromPreview, seqFromId } from "../src/senders";
import { imageSourcesOf } from "../src/thumbs";

const answer = (message: Record<string, unknown>) => ({ message, before: [], after: [] });

describe("message rows", () => {
  it("reads the user row BB returned for the id asked for", () => {
    const row = userRowOf(
      answer({ role: "user", id: "t:user-seed:4", text: "Run `bb`", initiator: "agent", attachments: null }),
      "t:user-seed:4",
    );
    expect(row).toEqual({ id: "t:user-seed:4", text: "Run `bb`", initiator: "agent", attachments: null, mentions: [] });
  });

  it("ignores a row that is not the message asked for", () => {
    expect(userRowOf(answer({ role: "user", id: "t:user-seed:5", text: "x" }), "t:user-seed:4")).toBeNull();
    expect(userRowOf(answer({ role: "assistant", id: "t:user-seed:4", text: "x" }), "t:user-seed:4")).toBeNull();
    expect(userRowOf(null, "t:user-seed:4")).toBeNull();
  });
});

describe("senders", () => {
  it("reads BB's prefixes", () => {
    expect(senderFromPreview("[bb system] @thread:thr_a completed")).toBe("system");
    expect(senderFromPreview("[bb message from thread:thr_a] hi")).toBe("agent");
    expect(senderFromPreview("> quoting [bb system]")).toBeUndefined();
  });

  it("parses the sequence from an outline id", () => {
    expect(seqFromId("thr_a:user-seed:42")).toBe(42);
    expect(seqFromId("thr_a:assistant:x")).toBeUndefined();
  });

  it("looks a message up by the sequence in its id", async () => {
    const seqs: number[] = [];
    const who = await findSender(async (seq) => {
      seqs.push(seq);
      return answer({ role: "user", id: "thr_a:user-seed:42", text: "", initiator: "system" });
    }, "thr_a:user-seed:42");
    expect(who).toBe("system");
    expect(seqs).toEqual([42]);
  });

  it("does not take the sender of another row", async () => {
    const who = await findSender(
      async () => answer({ role: "user", id: "thr_a:user-seed:43", initiator: "user" }),
      "thr_a:user-seed:42",
    );
    expect(who).toBeUndefined();
  });
});

describe("thumbnails", () => {
  it("lists safe web images, then project attachments", () => {
    expect(
      imageSourcesOf({
        imageUrls: ["https://example.com/a.png", "javascript:alert(1)", ""],
        localImagePaths: ["image-1.png"],
      }),
    ).toEqual([
      { kind: "web", url: "https://example.com/a.png" },
      { kind: "local", path: "image-1.png" },
    ]);
  });

  it("copes with rows that have no attachments", () => {
    expect(imageSourcesOf(null)).toEqual([]);
    expect(imageSourcesOf({ imageUrls: "nope" })).toEqual([]);
  });
});

describe("bar markdown", () => {
  it("keeps short text as it is", () => {
    expect(barMarkdown("  Run `mean inspect` and read it  ")).toBe("Run `mean inspect` and read it");
  });

  it("turns a code block into inline code, even one the cut left open", () => {
    expect(barMarkdown("Intro\n```ts\nconst a = 1;\nconst b = 2;\n```\nAfter")).toBe(
      "Intro\n`const a = 1; const b = 2;`\nAfter",
    );
    const text = "Intro\n```ts\nconst a = 1;\n" + "x".repeat(50) + "\nmore";
    expect(barMarkdown(text, 40)).toBe("Intro\n`const a = 1;`");
  });

  it("leaves tables out", () => {
    expect(barMarkdown("Compare:\n\n| a | b |\n| --- | :-: |\n| 1 | 2 |\n\nWhich one?")).toBe(
      "Compare:\n\n\nWhich one?",
    );
    expect(barMarkdown("Pipes | in prose stay")).toBe("Pipes | in prose stay");
  });

  it("uses double backticks for code that contains one", () => {
    expect(barMarkdown("~~~\nlet s = `x`;\n~~~")).toBe("`` let s = `x`; ``");
  });

  it("shows images as their alt text and escapes directive lines", () => {
    expect(barMarkdown("See ![the chart](https://example.com/c.png) here")).toBe("See the chart here");
    expect(barMarkdown("![chart][plot] and ![logo][] and ![icon]\n\n[plot]: https://example.com/p.png")).toBe(
      "chart and logo and icon\n\n[plot]: https://example.com/p.png",
    );
    expect(barMarkdown("::inline-vis{file=\"a.html\"}\ntext")).toBe("\\::inline-vis{file=\"a.html\"}\ntext");
    expect(barMarkdown("![![chart](https://example.com/in.png)](https://example.com/out.png)")).toBe("chart");
  });
});

describe("sender prefixes", () => {
  it("shows the sending thread as a mention and drops BB's system prefix", () => {
    expect(withoutSenderPrefix("[bb message from thread:thr_ab12] please check")).toBe("@thread:thr_ab12 please check");
    expect(withoutSenderPrefix("[bb system] @thread:thr_x completed")).toBe("@thread:thr_x completed");
    expect(withoutSenderPrefix("I wrote [bb system] myself")).toBe("I wrote [bb system] myself");
  });
});

describe("mentions", () => {
  const comment = {
    kind: "plugin",
    pluginId: "inline-comments",
    icon: null,
    itemId: "comment:1",
    label: "Option B, ask macOS to leave it ou\u2026",
  };

  it("reads a message's mentions, sorted, and drops malformed ones", () => {
    const row = userRowOf(
      {
        message: {
          role: "user",
          id: "t:user-seed:9",
          text: "x",
          mentions: [
            { start: 5, end: 9, resource: { kind: "thread", threadId: "thr_b", label: "B" } },
            { start: 0, end: 4, resource: comment },
            { start: 3, end: 3, resource: comment },
            { start: 1, end: 2 },
          ],
        },
      },
      "t:user-seed:9",
    );
    expect(row?.mentions.map((m) => m.start)).toEqual([0, 5]);
  });

  it("splits the text at mentions and keeps the text around them", () => {
    const text = "@Option B, ask macOS to leave it ou\u2026 and check **this**";
    const end = text.indexOf(" and");
    expect(barParts(text, [{ start: 0, end, resource: comment }])).toEqual([
      { kind: "mention", label: comment.label, resource: comment },
      { kind: "text", markdown: " and check **this**" },
    ]);
  });

  it("is a single text part without mentions", () => {
    expect(barParts("  Run `bb`  ", [])).toEqual([{ kind: "text", markdown: "Run `bb`" }]);
  });

  it("maps a stored plugin mention to the composer's shape", () => {
    expect(mentionTarget({ kind: "mention", label: "L", resource: comment })).toEqual({
      kind: "plugin",
      pluginId: "inline-comments",
      provider: "",
      id: "comment:1",
      label: "L",
      icon: null,
    });
    expect(
      mentionTarget({ kind: "mention", label: "B", resource: { kind: "thread", threadId: "thr_b" } }),
    ).toEqual({ kind: "thread", threadId: "thr_b", label: "B" });
  });
});
