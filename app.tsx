// Sticky Prompt: keep the message you are reading a reply to pinned at the
// top of the chat, the way Cursor does.
//
// Two contributions:
// - a message metadata anchor that renders nothing but reports each rendered
//   message (its thread, row, and sender) to src/registry.ts;
// - an app overlay that draws one bar per chat it heard about (src/bar.tsx).
import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import {
  definePluginApp,
  useSettings,
  type ExperimentalMessageMetadataProps,
} from "@get-bb/plugin-sdk/app";
import { getAreas, noteMessage, prune, setInitiator, subscribeAreas } from "./src/registry";
import { clearBlobUrls } from "./src/thumbs";
import { StickyBar, type Motion } from "./src/bar";

const ANCHOR_RETRY_FRAMES = 20;
const PRUNE_MS = 2000;

function Anchor({ message }: ExperimentalMessageMetadataProps) {
  const { id, threadId } = message;
  const initiator = message.role === "user" ? message.initiator : null;
  useLayoutEffect(() => {
    if (initiator !== null) setInitiator(threadId, id, initiator);
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      frame = 0;
      if (noteMessage(threadId, id)) return;
      tries += 1;
      if (tries < ANCHOR_RETRY_FRAMES) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [id, threadId, initiator]);
  return null;
}

function Overlay() {
  const areas = useSyncExternalStore(subscribeAreas, getAreas, getAreas);
  const { values, isLoading } = useSettings();
  useEffect(() => {
    const timer = window.setInterval(prune, PRUNE_MS);
    return () => {
      window.clearInterval(timer);
      clearBlobUrls();
    };
  }, []);
  // Until settings load, a user who turned the bar off must not see it flash.
  if (isLoading && values === undefined) return null;
  if (values?.enabled === false) return null;
  const includeOthers = values?.includeOtherSenders === true;
  const motion: Motion =
    values?.motion === "fade" || values?.motion === "off" ? values.motion : "follow";
  return (
    <>
      {areas.map((area) => (
        <StickyBar
          key={`${area.key}:${area.threadId}`}
          area={area}
          includeOthers={includeOthers}
          motion={motion}
        />
      ))}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_messageMetadata({
    id: "sticky-prompt-anchor",
    placement: "above",
    component: Anchor,
  });
  app.slots.experimental_appOverlay({
    id: "sticky-prompt",
    component: Overlay,
  });
});
