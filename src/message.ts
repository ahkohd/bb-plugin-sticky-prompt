// One `threads.message` answer, and the Markdown source the bar renders.

import type { Initiator } from "./registry";

export interface UserRow {
  id: string;
  text: string;
  initiator: Initiator | undefined;
  attachments: unknown;
}

const INITIATORS: ReadonlySet<string> = new Set(["agent", "system", "user"]);

/**
 * The user row of a `threads.message` answer, or null unless it is exactly
 * the message asked for: a seq that lands on another row must not change
 * what the bar shows.
 */
export function userRowOf(response: unknown, id: string): UserRow | null {
  if (response === null || typeof response !== "object") return null;
  const message = (response as { message?: unknown }).message;
  if (message === null || typeof message !== "object") return null;
  const row = message as Record<string, unknown>;
  if (row.role !== "user" || row.id !== id) return null;
  return {
    id,
    text: typeof row.text === "string" ? row.text : "",
    initiator:
      typeof row.initiator === "string" && INITIATORS.has(row.initiator)
        ? (row.initiator as Initiator)
        : undefined,
    attachments: row.attachments,
  };
}

const MAX_SOURCE = 2000;
const MAX_INLINE_CODE = 160;
const FENCE = /^\s*(`{3,}|~{3,})/;

/** A fenced block becomes one inline code span, so no code renderer runs. */
function inlineFences(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const open = FENCE.exec(line);
    if (open === null) {
      out.push(line);
      continue;
    }
    const fence = open[1] ?? "```";
    const body: string[] = [];
    for (i++; i < lines.length && !(lines[i] ?? "").trimStart().startsWith(fence); i++) {
      body.push(lines[i] ?? "");
    }
    const code = body.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_INLINE_CODE);
    if (code !== "") out.push(code.includes("`") ? `\`\` ${code} \`\`` : `\`${code}\``);
  }
  return out.join("\n");
}

/**
 * BB's own bubbles replace the sender prefix with a sender line. The bar has
 * no room for one: a thread mention stands in for the sending thread, and
 * BB's system prefix is dropped.
 */
export function withoutSenderPrefix(text: string): string {
  return text
    .replace(/^\s*\[bb message from thread:(thr_\w+)\]\s*/, "@thread:$1 ")
    .replace(/^\s*\[bb system\]\s*/, "");
}

/**
 * The start of a message as Markdown for the two-line bar: cut long text at a
 * line break, turn code blocks into inline code, show every image (inline,
 * reference or shortcut) as its alt text, and escape directive lines so
 * nothing embeds or loads from the bar.
 */
export function barMarkdown(text: string, max = MAX_SOURCE): string {
  let source = withoutSenderPrefix(text).trim();
  if (source.length > max) {
    const cut = source.lastIndexOf("\n", max);
    source = source.slice(0, cut > max / 2 ? cut : max).trimEnd();
  }
  // Repeat until nothing changes: an image in another image's alt text
  // leaves an image behind. Each pass shortens the text, so this ends.
  let out = inlineFences(source);
  for (;;) {
    const next = out.replace(/!\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])?/g, "$1");
    if (next === out) break;
    out = next;
  }
  return out.replace(/^(\s*):/gm, "$1\\:");
}
