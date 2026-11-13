// Sticky Prompt backend: the settings, and a diagnostic command. The bar
// itself lives in app.tsx and reads threads through the frontend SDK with
// the user's own session.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { collectUserInitiators, type TimelinePage } from "./src/senders";
import type { Initiator } from "./src/registry";

const USAGE = "Usage: bb sticky-prompt senders <thread-id> [--pages <n>]";

function kindsOf(value: unknown, out: Map<string, number>, depth = 0): void {
  if (depth > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) kindsOf(item, out, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.kind === "string") {
    const role = typeof record.role === "string" ? `/${record.role}` : "";
    const key = `${record.kind}${role}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  for (const child of Object.values(record)) kindsOf(child, out, depth + 1);
}

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Pin your message to the top of the chat",
      description:
        "While you scroll through a reply, the message it answers stays at the top. Click it to jump back.",
      default: true,
    },
    includeOtherSenders: {
      type: "boolean",
      label: "Also pin messages from agents and BB",
      description:
        "Off: only messages you typed are pinned. On: messages from other threads, agents and BB system notices are pinned too.",
      default: false,
    },
  });

  bb.cli.register({
    name: "sticky-prompt",
    summary: "Diagnose the Sticky Prompt plugin",
    commands: [
      {
        name: "senders",
        summary: "Show which user messages in a thread the bar would pin, and how their senders were found",
        usage: "bb sticky-prompt senders <thread-id> [--pages <n>]",
      },
    ],
    async run(argv) {
      const [command, threadId, ...rest] = argv;
      if (command !== "senders" || threadId === undefined || !/^thr_[a-z0-9]+$/.test(threadId)) {
        return { exitCode: command === undefined || command === "help" ? 0 : 1, stdout: USAGE };
      }
      const pagesFlag = rest.indexOf("--pages");
      const maxPages = Math.min(40, Math.max(1, Number(rest[pagesFlag + 1] ?? 3) || 3));

      const outline = await bb.sdk.threads.conversationOutline({ threadId, role: "user" });
      const senders = new Map<string, Initiator>();
      const kinds = new Map<string, number>();
      let cursor: { anchorId: string; anchorSeq: number } | null = null;
      let pages = 0;
      let sampleUserRow: string | null = null;
      for (; pages < maxPages; pages++) {
        const before: { anchorId: string; anchorSeq: number } | null = cursor;
        const page: TimelinePage = await bb.sdk.threads.timeline({
          threadId,
          summaryOnly: "true",
          deferContent: "true",
          ...(before === null
            ? {}
            : { beforeAnchorId: before.anchorId, beforeAnchorSeq: String(before.anchorSeq) }),
        });
        collectUserInitiators(page.rows, senders);
        collectUserInitiators(page.timelinePage?.olderRowUpdates, senders);
        kindsOf(page.rows, kinds);
        if (sampleUserRow === null) {
          const found: unknown[] = [];
          const walk = (value: unknown, depth = 0): void => {
            if (found.length > 0 || depth > 8 || value === null || typeof value !== "object") return;
            if (Array.isArray(value)) return value.forEach((item) => walk(item, depth + 1));
            const record = value as Record<string, unknown>;
            if (record.kind === "conversation" && record.role === "user") found.push(record);
            for (const child of Object.values(record)) walk(child, depth + 1);
          };
          walk(page.rows);
          if (found[0] !== undefined) {
            const record = found[0] as Record<string, unknown>;
            sampleUserRow = Object.keys(record)
              .sort()
              .map((key) => {
                const value = record[key];
                const shown =
                  typeof value === "string" ? JSON.stringify(value.slice(0, 40)) : JSON.stringify(value)?.slice(0, 60);
                return `  ${key}: ${shown}`;
              })
              .join("\n");
          }
        }
        cursor = page.timelinePage?.olderCursor ?? null;
        if (cursor === null) {
          pages += 1;
          break;
        }
      }

      const lines: string[] = [];
      lines.push(`thread ${threadId}: ${outline.items.length} user messages in the outline`);
      lines.push(`timeline pages read: ${pages}${cursor === null ? " (reached the start)" : " (more remain)"}`);
      lines.push(`row kinds seen: ${[...kinds].map(([k, n]) => `${k}=${n}`).join(", ") || "none"}`);
      lines.push(`user rows with a sender: ${senders.size}`);
      lines.push(sampleUserRow === null ? "no user row found in the first page" : `first user row fields:\n${sampleUserRow}`);
      lines.push("newest outline items (sender, id, preview):");
      for (const item of outline.items.slice(-8)) {
        const who = senders.get(item.id) ?? "?";
        lines.push(`  ${who.padEnd(6)} ${item.id}  ${item.preview.replace(/\s+/g, " ").slice(0, 60)}`);
      }
      return { exitCode: 0, stdout: lines.join("\n") };
    },
  });
}
