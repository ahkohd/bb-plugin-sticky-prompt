// Sticky Prompt backend: only the settings. The bar itself lives in app.tsx
// and reads threads through the frontend SDK with the user's own session.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

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
}
