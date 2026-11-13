// Sticky Prompt: keep the message you are reading a reply to pinned at the
// top of the chat, the way Cursor does.
//
// Two contributions:
// - a message metadata anchor that renders nothing but reports each rendered
//   message (its thread, row, and sender) to src/registry.ts;
// - an app overlay that draws one bar per chat it heard about, portaled into
//   the chat's scroll container parent.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { findSender, senderFromPreview, seqFromId } from "./src/senders";
import { cachedBlobUrl, imageSourcesOf } from "./src/thumbs";

interface OutlineItem {
  id: string;
  preview: string;
  attachmentSummary: { fileCount: number; imageCount: number } | null;
}

const LIST_SELECTOR = '[data-timeline-row-list="top-level"]';
const OUTLINE_REFRESH_MS = 1500;
const MAX_THUMBS = 3;
const THUMB_SIZE = 32;

interface Shown {
  id: string;
  label: string;
  imageCount: number;
  hasText: boolean;
}

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

/** BB cuts outline previews at this many characters, without an ellipsis. */
const PREVIEW_MAX_LENGTH = 200;

function labelFor(item: OutlineItem): string {
  const text = item.preview.replace(/\s+/g, " ").trim();
  if (text !== "") return item.preview.length >= PREVIEW_MAX_LENGTH ? `${text}…` : text;
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

function StickyBar({
  area,
  includeOthers,
  fadeEdge,
}: {
  area: Area;
  includeOthers: boolean;
  fadeEdge: boolean;
}) {
  const sdk = useSdk();
  const { scrollEl, threadId } = area;
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [thumbs, setThumbs] = useState<{ id: string; srcs: string[]; more: number } | null>(null);
  const messagesRef = useRef(new Map<number, Promise<unknown>>());
  const projectRef = useRef<Promise<string | null> | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const outlineRef = useRef<OutlineItem[]>([]);
  const ownersRef = useRef(new Map<string, number>());
  const unresolvedRef = useRef(new Set<string>());
  const includeRef = useRef(includeOthers);
  includeRef.current = includeOthers;
  const scheduleRef = useRef<() => void>(() => {});

  // One `threads.message` answer per message, shared by the sender check
  // and the thumbnails.
  const fetchMessage = useCallback(
    (seq: number): Promise<unknown> => {
      let pending = messagesRef.current.get(seq);
      if (pending === undefined) {
        pending = sdk.threads.message({ threadId, seq, before: 0, after: 0 });
        pending.catch(() => messagesRef.current.delete(seq));
        messagesRef.current.set(seq, pending);
      }
      return pending;
    },
    [sdk, threadId],
  );

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
        const who = await findSender(fetchMessage, id);
        if (who === undefined) unresolvedRef.current.add(id);
        else setInitiator(threadId, id, who, false);
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
          const item = outline[index];
          if (id === undefined || item === undefined) return false;
          const who = getInitiator(threadId, id) ?? senderFromPreview(item.preview);
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
        previous?.id === item.id
          ? previous
          : {
              id: item.id,
              label: labelFor(item),
              imageCount: item.attachmentSummary?.imageCount ?? 0,
              hasText: item.preview.trim() !== "",
            },
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
  }, [host, scrollEl, sdk, threadId, fetchMessage]);

  const shownId = shown?.id;
  const imageCount = shown?.imageCount ?? 0;
  useEffect(() => {
    if (shownId === undefined || imageCount === 0) return;
    const seq = seqFromId(shownId);
    if (seq === undefined) return;
    let cancelled = false;
    const load = async () => {
      const sources = imageSourcesOf(await fetchMessage(seq));
      const first = sources.slice(0, MAX_THUMBS);
      let projectId: string | null = null;
      if (first.some((source) => source.kind === "local")) {
        projectRef.current ??= sdk.threads.get({ threadId }).then(
          (thread) => thread.projectId ?? null,
          () => null,
        );
        projectId = await projectRef.current;
      }
      const srcs = await Promise.all(
        first.map((source) => {
          if (source.kind === "web") return Promise.resolve<string | null>(source.url);
          if (projectId === null) return Promise.resolve(null);
          const project = projectId;
          return cachedBlobUrl(`${project}\n${source.path}`, () =>
            sdk.projects.attachments.read({ projectId: project, path: source.path }),
          );
        }),
      );
      if (cancelled) return;
      setThumbs({
        id: shownId,
        srcs: srcs.filter((src): src is string => src !== null),
        more: Math.max(0, sources.length - first.length),
      });
    };
    load().catch((error) => {
      if (!cancelled) console.warn("[sticky-prompt] could not load images", error);
    });
    return () => {
      cancelled = true;
    };
  }, [shownId, imageCount, fetchMessage, sdk, threadId]);

  useEffect(() => {
    scheduleRef.current();
  }, [includeOthers, fadeEdge, shown, thumbs]);

  if (host === null || shown === null) return null;
  const shownThumbs = thumbs?.id === shown.id ? thumbs : null;
  const showLabel = shown.hasText || shownThumbs === null || shownThumbs.srcs.length === 0;
  return createPortal(
    <div
      ref={stripRef}
      style={{
        display: "flex",
        // Flat like the rest of BB: a hard edge unless the fade is turned on.
        padding: fadeEdge ? "8px 0 16px" : "8px 0",
        background: fadeEdge
          ? "linear-gradient(to bottom, var(--background) 0, var(--background) calc(100% - 16px), transparent 100%)"
          : "var(--background)",
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
          // rounded-xl border border-border-seam bg-surface-recessed px-4 py-2.5.
          // The strip behind it is opaque, so the
          // translucent recessed surface reads exactly as it does in the chat.
          borderRadius: "calc(var(--radius) + 4px)",
          border: "1px solid var(--border-seam)",
          background: "var(--surface-recessed)",
          color: "var(--foreground)",
          padding: "0.625rem 1rem",
          // The prompt box's size: BB sets --text-sm per theme.
          fontSize: "var(--text-sm)",
          lineHeight: "var(--text-sm--line-height)",
          fontFamily: "inherit",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
        }}
      >
        {shownThumbs !== null && shownThumbs.srcs.length > 0 ? (
          <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            {shownThumbs.srcs.map((src) => (
              <img
                key={src}
                src={src}
                alt=""
                draggable={false}
                style={{
                  display: "block",
                  width: THUMB_SIZE,
                  height: THUMB_SIZE,
                  objectFit: "cover",
                  borderRadius: "calc(var(--radius) - 2px)",
                  border: "1px solid var(--border-seam)",
                }}
              />
            ))}
            {shownThumbs.more > 0 ? (
              <span
                style={{
                  color: "var(--muted-foreground)",
                  fontSize: "var(--text-xs)",
                  lineHeight: "var(--text-xs--line-height)",
                  paddingLeft: 2,
                }}
              >
                +{shownThumbs.more}
              </span>
            ) : null}
          </span>
        ) : null}
        {showLabel ? (
          <span
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              overflowWrap: "anywhere",
            }}
          >
            {shown.label}
          </span>
        ) : null}
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
  const fadeEdge = values?.fadeEdge === true;
  useEffect(() => {
    const timer = window.setInterval(prune, 2000);
    return () => window.clearInterval(timer);
  }, []);
  if (!enabled) return null;
  return (
    <>
      {areas.map((area) => (
        <StickyBar
          key={`${area.key}:${area.threadId}`}
          area={area}
          includeOthers={includeOthers}
          fadeEdge={fadeEdge}
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
