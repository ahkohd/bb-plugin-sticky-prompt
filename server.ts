// Sticky Prompt backend: the settings, and a diagnostic command. The bar
// itself lives in app.tsx and reads threads through the frontend SDK with
// the user's own session.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { userRowOf } from "./src/message";
import { findSender, senderFromPreview, seqFromId } from "./src/senders";
import { imageSourcesOf } from "./src/thumbs";

const USAGE = [
  "Usage:",
  "  bb sticky-prompt senders <thread-id> [--last <n>]",
  "  bb sticky-prompt images <thread-id> [--last <n>]",
].join("\n");
const MAX_LAST = 30;
const MAX_IMAGE_LINES = 40;

function oneLine(text: string, max: number): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function reason(error: unknown): string {
  return oneLine(error instanceof Error ? error.message : String(error), 120);
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
        "Messages from other threads, agents and BB system notices are pinned as well as yours.",
      default: false,
    },
    motion: {
      type: "select",
      label: "Motion (experimental)",
      description:
        "Follow: the bar fades with your scroll. Fade: short timed fades. Off: it switches at once.",
      options: ["follow", "fade", "off"],
      default: "follow",
    },
  });

  async function senders(threadId: string, last: number): Promise<string[]> {
    const outline = await bb.sdk.threads.conversationOutline({ threadId, role: "user" });
    const lines = [`thread ${threadId}: ${outline.items.length} user messages`];
    lines.push("sender  how      pinned  id  preview");
    for (const item of outline.items.slice(-last)) {
      let who = senderFromPreview(item.preview);
      let how = "prefix";
      if (who === undefined) {
        how = "lookup";
        try {
          who = await findSender(
            (seq) => bb.sdk.threads.message({ threadId, seq, before: 0, after: 0 }),
            item.id,
          );
        } catch (error) {
          how = `error: ${reason(error).slice(0, 40)}`;
        }
      }
      const pinned = who === undefined || who === "user" ? "yes" : "no";
      lines.push(
        `${(who ?? "?").padEnd(7)} ${how.padEnd(8)} ${pinned.padEnd(7)} ${item.id}  ${oneLine(item.preview, 50)}`,
      );
    }
    return lines;
  }

  async function images(threadId: string, last: number): Promise<string[]> {
    const outline = await bb.sdk.threads.conversationOutline({ threadId, role: "user" });
    const withImages = outline.items.filter((item) => (item.attachmentSummary?.imageCount ?? 0) > 0);
    const lines = [
      `thread ${threadId}: ${outline.items.length} user messages, ${withImages.length} with images`,
    ];
    const thread = await bb.sdk.threads.get({ threadId });
    let omitted = 0;
    for (const item of withImages.slice(-last)) {
      const seq = seqFromId(item.id);
      const row =
        seq === undefined
          ? null
          : userRowOf(await bb.sdk.threads.message({ threadId, seq, before: 0, after: 0 }), item.id);
      if (row === null) {
        lines.push(`  ${item.id}: BB did not return this message`);
        continue;
      }
      const sources = imageSourcesOf(row.attachments);
      if (sources.length === 0) lines.push(`  ${item.id}: the message lists no images`);
      for (const source of sources) {
        if (lines.length > MAX_IMAGE_LINES) {
          omitted += 1;
          continue;
        }
        if (source.kind === "web") {
          lines.push(`  ${item.id}: web image ${oneLine(source.url, 60)}`);
          continue;
        }
        try {
          const file = await bb.sdk.projects.attachments.read({
            projectId: thread.projectId,
            path: source.path,
          });
          lines.push(`  ${item.id}: ${oneLine(source.path, 60)} ${file.mimeType} ${file.sizeBytes} bytes`);
        } catch (error) {
          lines.push(`  ${item.id}: ${oneLine(source.path, 60)} could not be read: ${reason(error)}`);
        }
      }
    }
    if (omitted > 0) lines.push(`  ${omitted} more images not checked`);
    return lines;
  }

  bb.cli.register({
    name: "sticky-prompt",
    summary: "Diagnose the Sticky Prompt plugin",
    commands: [
      {
        name: "senders",
        summary: "Show who sent a thread's newest user messages, and whether the bar would pin them",
        usage: "bb sticky-prompt senders <thread-id> [--last <n>]",
      },
      {
        name: "images",
        summary: "Read the images of a thread's newest user messages the way the bar loads its thumbnails",
        usage: "bb sticky-prompt images <thread-id> [--last <n>]",
      },
    ],
    async run(argv) {
      const [command, threadId, ...rest] = argv;
      if (command === undefined || command === "help" || command === "--help") {
        return { exitCode: 0, stdout: USAGE };
      }
      const known = command === "senders" || command === "images";
      if (!known || threadId === undefined || !/^thr_\w+$/.test(threadId)) {
        return { exitCode: 1, stderr: USAGE };
      }
      const lastFlag = rest.indexOf("--last");
      const last = Math.min(MAX_LAST, Math.max(1, Number(rest[lastFlag + 1] ?? 10) || 10));
      try {
        const lines =
          command === "senders" ? await senders(threadId, last) : await images(threadId, last);
        return { exitCode: 0, stdout: lines.join("\n") };
      } catch (error) {
        return { exitCode: 1, stderr: `Could not read thread ${threadId}: ${reason(error)}` };
      }
    },
  });
}
