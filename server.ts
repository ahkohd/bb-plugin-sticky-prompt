// Sticky Prompt backend: the settings, and a diagnostic command. The bar
// itself lives in app.tsx and reads threads through the frontend SDK with
// the user's own session.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { findSender, senderFromPreview, seqFromId } from "./src/senders";
import { imageSourcesOf } from "./src/thumbs";

const USAGE = [
  "Usage:",
  "  bb sticky-prompt senders <thread-id> [--last <n>]",
  "  bb sticky-prompt images <thread-id> [--last <n>]",
].join("\n");

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
      const known = command === "senders" || command === "images";
      if (!known || threadId === undefined || !/^thr_[a-z0-9]+$/.test(threadId)) {
        const help = command === undefined || command === "help" || command === "--help";
        return help ? { exitCode: 0, stdout: USAGE } : { exitCode: 1, stderr: USAGE };
      }
      const lastFlag = rest.indexOf("--last");
      const last = Math.min(30, Math.max(1, Number(rest[lastFlag + 1] ?? 10) || 10));
      const outline = await bb.sdk.threads.conversationOutline({ threadId, role: "user" });
      const lines = [`thread ${threadId}: ${outline.items.length} user messages`];
      if (command === "images") {
        const withImages = outline.items.filter((item) => (item.attachmentSummary?.imageCount ?? 0) > 0);
        lines.push(`${withImages.length} of them have images`);
        const thread = await bb.sdk.threads.get({ threadId });
        for (const item of withImages.slice(-last)) {
          const seq = seqFromId(item.id);
          if (seq === undefined) {
            lines.push(`  ${item.id}: no sequence in the id`);
            continue;
          }
          const sources = imageSourcesOf(await bb.sdk.threads.message({ threadId, seq, before: 0, after: 0 }));
          for (const source of sources) {
            if (source.kind === "web") {
              lines.push(`  ${item.id}: web image ${source.url.slice(0, 60)}`);
              continue;
            }
            try {
              const file = await bb.sdk.projects.attachments.read({ projectId: thread.projectId, path: source.path });
              lines.push(`  ${item.id}: ${source.path} ${file.mimeType} ${file.sizeBytes} bytes`);
            } catch (error) {
              const reason = error instanceof Error ? error.message.slice(0, 60) : "unknown";
              lines.push(`  ${item.id}: ${source.path} could not be read: ${reason}`);
            }
          }
          if (sources.length === 0) lines.push(`  ${item.id}: the message lists no images`);
        }
        return { exitCode: 0, stdout: lines.join("\n") };
      }
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
            how = `error: ${error instanceof Error ? error.message.slice(0, 40) : "unknown"}`;
          }
        }
        const pinned = who === undefined || who === "user" ? "yes" : "no";
        const preview = item.preview.replace(/\s+/g, " ").slice(0, 50);
        lines.push(`${(who ?? "?").padEnd(7)} ${how.padEnd(8)} ${pinned.padEnd(7)} ${item.id}  ${preview}`);
      }
      return { exitCode: 0, stdout: lines.join("\n") };
    },
  });
}
