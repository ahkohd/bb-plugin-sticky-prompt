// One `threads.message` answer, and the Markdown source the bar renders.

import type { Initiator } from "./registry";

/** A mention in a message: its range in the text and what it points at. */
export interface MessageMention {
  start: number;
  end: number;
  resource: Record<string, unknown>;
}

export interface UserRow {
  id: string;
  text: string;
  initiator: Initiator | undefined;
  attachments: unknown;
  mentions: MessageMention[];
}

function mentionsOf(value: unknown): MessageMention[] {
  if (!Array.isArray(value)) return [];
  const out: MessageMention[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const { start, end, resource } = item as Record<string, unknown>;
    if (typeof start !== "number" || typeof end !== "number" || end <= start) continue;
    if (resource === null || typeof resource !== "object") continue;
    out.push({ start, end, resource: resource as Record<string, unknown> });
  }
  return out.sort((a, b) => a.start - b.start);
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
    mentions: mentionsOf(row.mentions),
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

const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * Tables are left out of the bar: rendered and hidden inside its one line,
 * BB's scrolling table wrapper lays the lines on top of each other.
 */
function withoutTables(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    if (line.includes("|") && next.includes("-") && TABLE_DELIMITER.test(next)) {
      i += 1;
      while (i + 1 < lines.length && (lines[i + 1] ?? "").includes("|")) i += 1;
      continue;
    }
    out.push(line);
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
 * Markdown made safe for the two-line bar: code blocks become inline code,
 * tables go, every image (inline, reference or shortcut) becomes its alt
 * text, and directive lines are escaped, so nothing embeds or loads.
 */
function cleanMarkdown(source: string): string {
  // Repeat until nothing changes: an image in another image's alt text
  // leaves an image behind. Each pass shortens the text, so this ends.
  let out = withoutTables(inlineFences(source));
  for (;;) {
    const next = out.replace(/!\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])?/g, "$1");
    if (next === out) break;
    out = next;
  }
  return out.replace(/^(\s*):/gm, "$1\\:");
}

function capped(source: string, max: number): string {
  if (source.length <= max) return source;
  const cut = source.lastIndexOf("\n", max);
  return source.slice(0, cut > max / 2 ? cut : max).trimEnd();
}

/** The start of a message as Markdown for the two-line bar. */
export function barMarkdown(text: string, max = MAX_SOURCE): string {
  return cleanMarkdown(capped(withoutSenderPrefix(text).trim(), max));
}

/** One piece of the bar: Markdown text, or a mention BB draws as a chip. */
export type BarPart =
  | { kind: "text"; markdown: string }
  | { kind: "mention"; label: string; resource: Record<string, unknown> };

/**
 * A message split at its mentions, so each one can be drawn as BB draws it in
 * the bubble. Mention ranges index the stored text, so the sender prefix is
 * only removed when no mention comes before it.
 */
export function barParts(text: string, mentions: readonly MessageMention[], max = MAX_SOURCE): BarPart[] {
  const parts: BarPart[] = [];
  let at = 0;
  let budget = max;
  const pushText = (raw: string) => {
    if (budget <= 0 || raw === "") return;
    const piece = capped(raw, budget);
    budget -= piece.length;
    const markdown = cleanMarkdown(piece);
    if (markdown.trim() !== "") parts.push({ kind: "text", markdown });
  };
  for (const mention of mentions) {
    if (mention.start < at || mention.end > text.length) continue;
    pushText(parts.length === 0 ? withoutSenderPrefix(text.slice(at, mention.start)).trimStart() : text.slice(at, mention.start));
    if (budget <= 0) break;
    const label = mention.resource.label;
    parts.push({
      kind: "mention",
      label: typeof label === "string" && label !== "" ? label : text.slice(mention.start, mention.end).replace(/^@/, ""),
      resource: mention.resource,
    });
    at = mention.end;
  }
  const rest = text.slice(at);
  pushText(parts.length === 0 ? withoutSenderPrefix(rest).trim() : rest.trimEnd());
  return parts;
}

/**
 * What BB's mention helpers expect for a stored mention. Stored plugin
 * mentions name their item `itemId`; the composer's shape names it `id`.
 */
export function mentionTarget(part: Extract<BarPart, { kind: "mention" }>): Record<string, unknown> {
  const resource = part.resource;
  if (resource.kind === "plugin") {
    return {
      kind: "plugin",
      pluginId: resource.pluginId,
      provider: typeof resource.provider === "string" ? resource.provider : "",
      id: typeof resource.itemId === "string" ? resource.itemId : resource.id,
      label: part.label,
      icon: resource.icon ?? null,
    };
  }
  return { ...resource, label: part.label };
}
