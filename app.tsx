// Sticky Prompt: keep the message you are reading a reply to pinned at the
// top of the chat, the way Cursor does.
//
// Two contributions:
// - a message metadata anchor that renders nothing but reports each rendered
//   message (its thread, row, and sender) to src/registry.ts;
// - an app overlay that draws one bar per chat it heard about, portaled into
//   the chat's scroll container parent.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  useSdk,
  useSettings,
  type ExperimentalMessageMetadataProps,
} from "@get-bb/plugin-sdk/app";
import {
  getAreas,
  getInitiator,
  noteMessage,
  prune,
  rowSelector,
  setInitiator,
  subscribeAreas,
  subscribeInitiators,
  topLevelListOf,
  type Area,
} from "./src/registry";
import { pick, type Entry } from "./src/pick";
import { findSenders, type TimelinePage } from "./src/senders";

interface OutlineItem {
  id: string;
  preview: string;
  attachmentSummary: { fileCount: number; imageCount: number } | null;
}

const LIST_SELECTOR = '[data-timeline-row-list="top-level"]';
const OUTLINE_REFRESH_MS = 1500;

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
      if (tries < 20) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [id, threadId, initiator]);
  return null;
}

function labelFor(item: OutlineItem): string {
  const text = item.preview.replace(/\s+/g, " ").trim();
  if (text !== "") return text;
  const attachments = item.attachmentSummary;
  if (attachments !== null) {
    if (attachments.imageCount === 1 && attachments.fileCount === 0) return "Image attachment";
    const total = attachments.imageCount + attachments.fileCount;
    if (total > 0) return `${total} attachments`;
  }
  return "Your message";
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function findRowIn(list: Element, id: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>(rowSelector(id))) {
    if (topLevelListOf(row) === list) return row;
  }
  return null;
}

/** Scroll the chat until the message is mounted, then bring it to the top. */
async function jumpTo(scrollEl: HTMLElement, id: string): Promise<void> {
  for (let step = 0; step < 80; step++) {
    const list = scrollEl.querySelector(LIST_SELECTOR);
    if (list === null) return;
    const row = findRowIn(list, id);
    if (row !== null) {
      const offset =
        row.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top - 12;
      scrollEl.scrollBy({ top: offset, behavior: "smooth" });
      return;
    }
    if (scrollEl.scrollTop <= 0) return;
    scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop - scrollEl.clientHeight * 0.8);
    await nextFrame();
    await nextFrame();
  }
}

function StickyBar({ area, includeOthers }: { area: Area; includeOthers: boolean }) {
  const sdk = useSdk();
  const { scrollEl, threadId } = area;
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [shown, setShown] = useState<{ id: string; label: string } | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const outlineRef = useRef<OutlineItem[]>([]);
  const ownersRef = useRef(new Map<string, number>());
  const unresolvedRef = useRef(new Set<string>());
  const includeRef = useRef(includeOthers);
  includeRef.current = includeOthers;
  const scheduleRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const parent = scrollEl.parentElement;
    if (parent === null) return;
    const el = document.createElement("div");
    el.setAttribute("data-sticky-prompt", "");
    Object.assign(el.style, {
      position: "absolute",
      top: "0px",
      left: "0px",
      width: "0px",
      zIndex: "20",
      overflow: "hidden",
      pointerEvents: "none",
      display: "none",
    });
    let restorePosition: string | null = null;
    if (getComputedStyle(parent).position === "static") {
      restorePosition = parent.style.position;
      parent.style.position = "relative";
    }
    parent.appendChild(el);
    setHost(el);
    return () => {
      el.remove();
      if (restorePosition !== null) parent.style.position = restorePosition;
      setHost(null);
    };
  }, [scrollEl]);

  useEffect(() => {
    if (host === null) return;
    const hostEl: HTMLDivElement = host;
    const controller = new AbortController();
    const { signal } = controller;
    let frame = 0;
    let lastOutlineFetch = 0;
    let outlineInFlight = false;
    let lookupInFlight = false;

    const schedule = () => {
      if (frame === 0 && !signal.aborted) frame = requestAnimationFrame(run);
    };
    scheduleRef.current = schedule;

    const hide = () => {
      hostEl.style.display = "none";
    };

    const fetchOutline = async () => {
      if (outlineInFlight) return;
      outlineInFlight = true;
      lastOutlineFetch = Date.now();
      try {
        const result = await sdk.threads.conversationOutline({ threadId, role: "user", signal });
        outlineRef.current = result.items.filter((item) => item.role === "user");
        ownersRef.current.clear();
      } catch (error) {
        if (!signal.aborted) console.warn("[sticky-prompt] could not read the outline", error);
      } finally {
        outlineInFlight = false;
        schedule();
      }
    };

    const lookupSender = async (id: string) => {
      if (lookupInFlight) return;
      lookupInFlight = true;
      try {
        const found = await findSenders(
          (cursor) =>
            sdk.threads.timeline({
              threadId,
              summaryOnly: "true",
              deferContent: "true",
              ...(cursor === null
                ? {}
                : { beforeAnchorId: cursor.anchorId, beforeAnchorSeq: String(cursor.anchorSeq) }),
              signal,
            }) as Promise<TimelinePage>,
          id,
          signal,
        );
        for (const [messageId, who] of found) setInitiator(threadId, messageId, who, false);
        if (!found.has(id)) unresolvedRef.current.add(id);
      } catch (error) {
        if (signal.aborted) return;
        unresolvedRef.current.add(id);
        console.warn("[sticky-prompt] could not read message senders", error);
      } finally {
        lookupInFlight = false;
        schedule();
      }
    };

    function run() {
      frame = 0;
      if (!scrollEl.isConnected) return hide();
      const list = scrollEl.querySelector<HTMLElement>(LIST_SELECTOR);
      const outline = outlineRef.current;
      if (list === null) return hide();

      const outlineIds = outline.map((item) => item.id);
      const known = new Set(outlineIds);
      const entries: Entry[] = [];
      let stale = false;
      for (const node of list.querySelectorAll<HTMLElement>(
        "[data-timeline-row-id], [data-timeline-window-spacer]",
      )) {
        if (node.closest("[data-timeline-row-list]") !== list) continue;
        if (node.hasAttribute("data-timeline-window-spacer")) {
          entries.push({ kind: "spacer" });
          continue;
        }
        const id = node.getAttribute("data-timeline-row-id") ?? "";
        if (!known.has(id) && getInitiator(threadId, id) !== undefined) stale = true;
        const rect = node.getBoundingClientRect();
        entries.push({ kind: "row", id, top: rect.top, bottom: rect.bottom });
      }
      if (stale && Date.now() - lastOutlineFetch > OUTLINE_REFRESH_MS) void fetchOutline();
      if (outline.length === 0) return hide();

      const areaRect = scrollEl.getBoundingClientRect();
      const result = pick({
        entries,
        outlineIds,
        areaTop: areaRect.top,
        barHeight: stripRef.current?.offsetHeight || 56,
        areaHeight: scrollEl.clientHeight,
        owners: ownersRef.current,
        eligible: (index) => {
          if (includeRef.current) return true;
          const id = outlineIds[index];
          if (id === undefined) return false;
          const who = getInitiator(threadId, id);
          if (who !== undefined) return who === "user";
          return unresolvedRef.current.has(id) ? true : "unknown";
        },
      });
      if (result.kind === "unknown") {
        const id = outlineIds[result.index];
        if (id !== undefined) void lookupSender(id);
        return hide();
      }
      if (result.kind === "none") return hide();
      const item = outline[result.index];
      if (item === undefined) return hide();

      const parent = hostEl.parentElement;
      if (parent === null) return hide();
      const parentRect = parent.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      hostEl.style.top = `${areaRect.top - parentRect.top}px`;
      hostEl.style.left = `${listRect.left - parentRect.left}px`;
      hostEl.style.width = `${listRect.width}px`;
      hostEl.style.display = "block";
      if (stripRef.current !== null) {
        stripRef.current.style.transform = `translateY(${-result.push}px)`;
      }
      setShown((previous) =>
        previous?.id === item.id ? previous : { id: item.id, label: labelFor(item) },
      );
    }

    scrollEl.addEventListener("scroll", schedule, { passive: true });
    const resizes = new ResizeObserver(schedule);
    resizes.observe(scrollEl);
    const mutations = new MutationObserver(schedule);
    mutations.observe(scrollEl, { childList: true, subtree: true });
    const unsubscribe = subscribeInitiators((changed) => {
      if (changed === threadId) schedule();
    });
    void fetchOutline();

    return () => {
      controller.abort();
      cancelAnimationFrame(frame);
      scrollEl.removeEventListener("scroll", schedule);
      resizes.disconnect();
      mutations.disconnect();
      unsubscribe();
      scheduleRef.current = () => {};
    };
  }, [host, scrollEl, sdk, threadId]);

  useEffect(() => {
    scheduleRef.current();
  }, [includeOthers, shown]);

  if (host === null || shown === null) return null;
  return createPortal(
    <div
      ref={stripRef}
      style={{
        display: "flex",
        padding: "8px 0 16px",
        background:
          "linear-gradient(to bottom, var(--background) 0, var(--background) calc(100% - 16px), transparent 100%)",
      }}
    >
      <button
        type="button"
        title={shown.label}
        aria-label={`Scroll to your message: ${shown.label}`}
        onClick={() => void jumpTo(scrollEl, shown.id)}
        style={{
          pointerEvents: "auto",
          width: "100%",
          textAlign: "left",
          // The same surface as BB's own user message bubble:
          // rounded-xl border border-border-seam bg-surface-recessed px-4 py-2.5
          // text-sm leading-relaxed. The strip behind it is opaque, so the
          // translucent recessed surface reads exactly as it does in the chat.
          borderRadius: "0.75rem",
          border: "1px solid var(--border-seam)",
          background: "var(--surface-recessed)",
          color: "var(--foreground)",
          padding: "0.625rem 1rem",
          fontSize: "0.875rem",
          lineHeight: 1.625,
          fontFamily: "inherit",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            overflowWrap: "anywhere",
          }}
        >
          {shown.label}
        </span>
      </button>
    </div>,
    host,
  );
}

function Overlay() {
  const areas = useSyncExternalStore(subscribeAreas, getAreas, getAreas);
  const { values } = useSettings();
  const enabled = values?.enabled !== false;
  const includeOthers = values?.includeOtherSenders === true;
  useEffect(() => {
    const timer = window.setInterval(prune, 2000);
    return () => window.clearInterval(timer);
  }, []);
  if (!enabled) return null;
  return (
    <>
      {areas.map((area) => (
        <StickyBar key={`${area.key}:${area.threadId}`} area={area} includeOthers={includeOthers} />
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
