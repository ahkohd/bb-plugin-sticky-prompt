// Reading one `threads.message` answer, and preparing its text for the bar.

/** The row of a `threads.message` answer, or the value itself if it is a row. */
export function rowOf(response: unknown): Record<string, unknown> | null {
  if (response === null || typeof response !== "object") return null;
  const record = response as Record<string, unknown>;
  if (record.message !== null && typeof record.message === "object") {
    return record.message as Record<string, unknown>;
  }
  return record;
}

export function textOf(response: unknown): string | null {
  const text = rowOf(response)?.text;
  return typeof text === "string" ? text : null;
}

const MAX_SOURCE = 2000;

/**
 * The start of a message as Markdown source for the two-line bar. Long text
 * is cut, at a line break where one is near, and a code fence left open by
 * the cut is closed so the rest does not turn into code.
 */
export function barMarkdown(text: string, max = MAX_SOURCE): string {
  let source = text.trim();
  if (source.length > max) {
    const cut = source.lastIndexOf("\n", max);
    source = source.slice(0, cut > max / 2 ? cut : max).trimEnd();
  }
  for (const fence of ["```", "~~~"]) {
    const opened = source.split("\n").filter((line) => line.trimStart().startsWith(fence)).length;
    if (opened % 2 === 1) source += `\n${fence}`;
  }
  return source;
}
