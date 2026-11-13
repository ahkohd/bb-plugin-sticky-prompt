// The bar for one chat: which message to pin, where to draw it, and what
// clicking, scrolling and touching it do.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TouchEvent, WheelEvent } from "react";
import { createPortal } from "react-dom";
import { Markdown, useSdk } from "@get-bb/plugin-sdk/app";
import {
  getInitiator,
  rowSelector,
  setInitiator,
  subscribeInitiators,
  topLevelListOf,
  TOP_LEVEL_LIST,
  type Area,
} from "./registry";
import { makeOutline, pick, type Entry, type Outline } from "./pick";
import { findSender, senderFromPreview, seqFromId } from "./senders";
import { cachedBlobUrl, imageSourcesOf } from "./thumbs";
import { barMarkdown, userRowOf, withoutSenderPrefix } from "./message";

interface OutlineItem {
  id: string;
  preview: string;
  attachmentSummary: { fileCount: number; imageCount: number } | null;
}

interface Shown {
  id: string;
  label: string;
  imageCount: number;
  hasText: boolean;
}

const OUTLINE_REFRESH_MS = 1500;
/** A row the outline still lacks after this many fetches stops asking. */
const MAX_OUTLINE_MISSES = 3;
const MAX_CACHED_MESSAGES = 40;
const MAX_THUMBS = 3;
const THUMB_SIZE = 32;
/** BB cuts outline previews at this many characters, without an ellipsis. */
const PREVIEW_MAX_LENGTH = 200;
/** Frames a jump waits at the top for BB to load older rows. */
const JUMP_PATIENCE_FRAMES = 90;
/** Frames a jump spends correcting for rows BB measures as they mount. */
const SETTLE_FRAMES = 20;
const JUMP_MARGIN = 12;

// BB's Markdown renders blocks; the bar has two lines. Run every block into
// one line of text, keep inline styling (code, bold, links, mentions) as BB
// draws it, and drop what cannot sit in a line.
const T = "[data-sticky-prompt-text]";
const FLATTEN_CSS = `
${T} :is(p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, li, pre, div, section, figure) {
  display: inline; margin: 0; padding: 0; border: 0; background: none;
  font-size: inherit; line-height: inherit;
}
${T} :is(p, h1, h2, h3, h4, h5, h6, li, pre, blockquote)::after { content: " "; }
${T} li::before, ${T} li::marker { content: none; }
${T} pre, ${T} pre code { white-space: normal; }
${T} :is(button, img, video, iframe, table, hr, input) { display: none; }
[data-sticky-prompt-bar]:focus { outline: none; }
[data-sticky-prompt-bar]:focus-visible {
  outline: 2px solid var(--ring, currentColor); outline-offset: -3px;
}
`;

function labelFor(item: OutlineItem): string {
  const text = withoutSenderPrefix(item.preview).replace(/\s+/g, " ").trim();
  if (text !== "") return item.preview.length >= PREVIEW_MAX_LENGTH ? `${text}…` : text;
  const attachments = item.attachmentSummary;
  if (attachments !== null) {
    if (attachments.imageCount === 1 && attachments.fileCount === 0) return "Image attachment";
    const total = attachments.imageCount + attachments.fileCount;
    if (total > 0) return `${total} attachments`;
  }
  return "Message";
}

/**
 * BB keeps the chat where it was unless a scroll follows the user's own input
 * on the chat (a wheel, touch, pointer or key), and puts back any other. The
 * bar's scrolls start outside the chat, so each announces itself with an
 * empty wheel event first; listeners that must react only to real wheels
 * check `isTrusted`.
 */
function scrollChat(scrollEl: HTMLElement, top: number): void {
  scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: 0 }));
  scrollEl.scrollTop = top;
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

/**
 * Put the row at the top and hold it there while BB measures the rows that
 * mount around it. Instant steps: a smooth scroll fights BB's own scroll
 * corrections and jerks.
 */
async function settle(scrollEl: HTMLElement, list: Element, id: string, signal: AbortSignal) {
  let steady = 0;
  for (let i = 0; i < SETTLE_FRAMES && !signal.aborted && steady < 3; i++) {
    const row = findRowIn(list, id);
    if (row === null) return;
    const offset =
      row.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top - JUMP_MARGIN;
    if (Math.abs(offset) < 1) {
      steady += 1;
    } else {
      steady = 0;
      scrollChat(scrollEl, scrollEl.scrollTop + offset);
    }
    await nextFrame();
  }
}

/**
 * Scroll up until BB mounts the message, then bring it to the top. Keeps
 * going while BB loads older rows at the top; stops when nothing moves.
 */
async function jumpTo(scrollEl: HTMLElement, id: string, signal: AbortSignal): Promise<void> {
  let idle = 0;
  while (!signal.aborted && scrollEl.isConnected) {
    const list = scrollEl.querySelector(TOP_LEVEL_LIST);
    if (list === null) return;
    if (findRowIn(list, id) !== null) {
      await settle(scrollEl, list, id, signal);
      return;
    }
    const { scrollTop, scrollHeight } = scrollEl;
    scrollChat(scrollEl, Math.max(0, scrollTop - scrollEl.clientHeight * 0.8));
    await nextFrame();
    await nextFrame();
    const moved = scrollEl.scrollTop < scrollTop || scrollEl.scrollHeight !== scrollHeight;
    idle = moved ? 0 : idle + 1;
    if (idle > JUMP_PATIENCE_FRAMES) return;
  }
}

/** Wheel deltas in pixels, whatever unit the device reported. */
function wheelPixels(event: WheelEvent, scrollEl: HTMLElement): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * scrollEl.clientHeight;
  return event.deltaY;
}

// Several bars can share one parent; the first one in makes it a positioning
// context and the last one out restores it.
const positioned = new WeakMap<HTMLElement, { count: number; restore: string | null }>();

function holdPosition(parent: HTMLElement): () => void {
  const held = positioned.get(parent);
  if (held !== undefined) {
    held.count += 1;
  } else {
    const isStatic = getComputedStyle(parent).position === "static";
    positioned.set(parent, { count: 1, restore: isStatic ? parent.style.position : null });
    if (isStatic) parent.style.position = "relative";
  }
  return () => {
    const entry = positioned.get(parent);
    if (entry === undefined) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    if (entry.restore !== null) parent.style.position = entry.restore;
    positioned.delete(parent);
  };
}

export function StickyBar({ area, includeOthers }: { area: Area; includeOthers: boolean }) {
  const sdk = useSdk();
  const { scrollEl, threadId } = area;
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [thumbs, setThumbs] = useState<{ id: string; srcs: string[]; more: number } | null>(null);
  const [source, setSource] = useState<{ id: string; markdown: string } | null>(null);
  const shownRef = useRef<Shown | null>(null);
  shownRef.current = shown;
  const messagesRef = useRef(new Map<string, Promise<unknown>>());
  const projectRef = useRef<Promise<string | null> | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<OutlineItem[]>([]);
  const outlineRef = useRef<Outline>(makeOutline([]));
  const ownersRef = useRef(new Map<string, string | null>());
  const unresolvedRef = useRef(new Set<string>());
  const includeRef = useRef(includeOthers);
  includeRef.current = includeOthers;
  const scheduleRef = useRef<() => void>(() => {});
  const jumpRef = useRef<AbortController | null>(null);
  const touchRef = useRef<number | null>(null);

  // One `threads.message` answer per message and preview, shared by the
  // sender check, the text and the thumbnails. Bounded, most recent kept.
  const fetchMessage = useCallback(
    (seq: number, revision = ""): Promise<unknown> => {
      const cache = messagesRef.current;
      const key = `${seq}\n${revision}`;
      let pending = cache.get(key);
      if (pending !== undefined) {
        cache.delete(key);
      } else {
        pending = sdk.threads.message({ threadId, seq, before: 0, after: 0 });
        pending.catch(() => cache.delete(key));
      }
      cache.set(key, pending);
      while (cache.size > MAX_CACHED_MESSAGES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
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
    const release = holdPosition(parent);
    // Before the chat, so the bar comes before it in tab order.
    parent.insertBefore(el, scrollEl);
    setHost(el);
    return () => {
      jumpRef.current?.abort();
      el.remove();
      release();
      setHost(null);
    };
  }, [scrollEl]);

  useEffect(() => {
    if (host === null) return;
    const hostEl: HTMLDivElement = host;
    const controller = new AbortController();
    const { signal } = controller;
    const rowPrefix = `${threadId}:`;
    let frame = 0;
    let lastOutlineFetch = 0;
    let outlineInFlight = false;
    let outlineAgain = false;
    let outlineTimer = 0;
    const outlineAskedFor = new Set<string>();
    const outlineMisses = new Map<string, number>();
    let lookupInFlight = false;

    const schedule = () => {
      if (frame === 0 && !signal.aborted) frame = requestAnimationFrame(run);
    };
    scheduleRef.current = schedule;

    const hide = () => {
      hostEl.style.display = "none";
    };

    const fetchOutline = async () => {
      outlineInFlight = true;
      lastOutlineFetch = Date.now();
      const askedFor = [...outlineAskedFor];
      outlineAskedFor.clear();
      try {
        const result = await sdk.threads.conversationOutline({ threadId, role: "user", signal });
        const items = result.items.filter((item) => item.role === "user");
        itemsRef.current = items;
        outlineRef.current = makeOutline(items.map((item) => item.id));
        for (const id of askedFor) {
          if (!outlineRef.current.indexById.has(id)) {
            outlineMisses.set(id, (outlineMisses.get(id) ?? 0) + 1);
          }
        }
      } catch (error) {
        if (!signal.aborted) console.warn("[sticky-prompt] could not read the outline", error);
      } finally {
        outlineInFlight = false;
        if (outlineAgain) {
          outlineAgain = false;
          requestOutline();
        }
        schedule();
      }
    };

    // At most one fetch per interval, and always one more after a change
    // that arrived while waiting, so a new message is never left out.
    function requestOutline() {
      if (signal.aborted) return;
      if (outlineInFlight) {
        outlineAgain = true;
        return;
      }
      const wait = lastOutlineFetch + OUTLINE_REFRESH_MS - Date.now();
      if (wait > 0) {
        if (outlineTimer === 0) {
          outlineTimer = window.setTimeout(() => {
            outlineTimer = 0;
            requestOutline();
          }, wait);
        }
        return;
      }
      void fetchOutline();
    }

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
      const list = scrollEl.querySelector<HTMLElement>(TOP_LEVEL_LIST);
      if (list === null) return hide();
      const outline = outlineRef.current;
      const items = itemsRef.current;

      // Rows of another thread mean the pane has switched and this bar is
      // about to go; never pin across threads.
      const entries: Entry[] = [];
      let foreign = 0;
      for (const node of list.querySelectorAll<HTMLElement>(
        "[data-timeline-row-id], [data-timeline-window-spacer]",
      )) {
        if (node.closest("[data-timeline-row-list]") !== list) continue;
        if (node.hasAttribute("data-timeline-window-spacer")) {
          entries.push({ kind: "spacer" });
          continue;
        }
        const id = node.getAttribute("data-timeline-row-id") ?? "";
        if (!id.startsWith(rowPrefix)) {
          foreign += 1;
          continue;
        }
        if (
          !outline.indexById.has(id) &&
          getInitiator(threadId, id) !== undefined &&
          (outlineMisses.get(id) ?? 0) < MAX_OUTLINE_MISSES
        ) {
          outlineAskedFor.add(id);
        }
        const rect = node.getBoundingClientRect();
        entries.push({ kind: "row", id, top: rect.top, bottom: rect.bottom });
      }
      if (outlineAskedFor.size > 0) requestOutline();
      if (foreign > 0 || outline.ids.length === 0) return hide();

      const areaRect = scrollEl.getBoundingClientRect();
      const result = pick({
        entries,
        outline,
        areaTop: areaRect.top,
        barHeight: stripRef.current?.offsetHeight || 56,
        areaHeight: scrollEl.clientHeight,
        owners: ownersRef.current,
        eligible: (index) => {
          if (includeRef.current) return true;
          const item = items[index];
          if (item === undefined) return false;
          const who = getInitiator(threadId, item.id) ?? senderFromPreview(item.preview);
          if (who !== undefined) return who === "user";
          return unresolvedRef.current.has(item.id) ? true : "unknown";
        },
      });
      if (result.kind === "unknown") {
        const id = outline.ids[result.index];
        if (id !== undefined) void lookupSender(id);
        return hide();
      }
      if (result.kind === "none") return hide();
      const item = items[result.index];
      if (item === undefined) return hide();

      // Show only once React has drawn this message, never the previous one.
      const label = labelFor(item);
      const current = shownRef.current;
      if (current?.id !== item.id || current.label !== label) {
        hide();
        setShown({
          id: item.id,
          label,
          imageCount: item.attachmentSummary?.imageCount ?? 0,
          hasText: item.preview.trim() !== "",
        });
        return;
      }

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
    }

    // A user scrolling or typing takes over from a jump in progress.
    const stopJump = (event: Event) => {
      if (event.isTrusted) jumpRef.current?.abort();
    };
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    scrollEl.addEventListener("wheel", stopJump, { passive: true });
    scrollEl.addEventListener("touchstart", stopJump, { passive: true });
    scrollEl.addEventListener("keydown", stopJump);
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
      window.clearTimeout(outlineTimer);
      scrollEl.removeEventListener("scroll", schedule);
      scrollEl.removeEventListener("wheel", stopJump);
      scrollEl.removeEventListener("touchstart", stopJump);
      scrollEl.removeEventListener("keydown", stopJump);
      resizes.disconnect();
      mutations.disconnect();
      unsubscribe();
      scheduleRef.current = () => {};
    };
  }, [host, scrollEl, sdk, threadId, fetchMessage]);

  const shownId = shown?.id;
  const shownLabel = shown?.label ?? "";
  const imageCount = shown?.imageCount ?? 0;
  useEffect(() => {
    if (shownId === undefined) return;
    const seq = seqFromId(shownId);
    if (seq === undefined) return;
    let cancelled = false;
    const load = async () => {
      // The full text, rendered by BB's own Markdown component. Until it
      // arrives, or if BB answers with another row, the bar keeps the
      // outline's plain preview.
      const row = userRowOf(await fetchMessage(seq, shownLabel), shownId);
      if (cancelled || row === null) return;
      if (row.text.trim() !== "") setSource({ id: shownId, markdown: barMarkdown(row.text) });
      if (imageCount === 0) return;
      const sources = imageSourcesOf(row.attachments);
      const first = sources.slice(0, MAX_THUMBS);
      let projectId: string | null = null;
      if (first.some((image) => image.kind === "local")) {
        projectRef.current ??= sdk.threads.get({ threadId }).then(
          (thread) => thread.projectId ?? null,
          () => {
            projectRef.current = null;
            return null;
          },
        );
        projectId = await projectRef.current;
      }
      const srcs = await Promise.all(
        first.map((image) => {
          if (image.kind === "web") return Promise.resolve<string | null>(image.url);
          if (projectId === null) return Promise.resolve(null);
          const project = projectId;
          return cachedBlobUrl(`${project}\n${image.path}`, () =>
            sdk.projects.attachments.read({ projectId: project, path: image.path }),
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
      if (!cancelled) console.warn("[sticky-prompt] could not load the message", error);
    });
    return () => {
      cancelled = true;
    };
  }, [shownId, shownLabel, imageCount, fetchMessage, sdk, threadId]);

  useEffect(() => {
    scheduleRef.current();
  }, [includeOthers, shown, thumbs, source]);

  if (host === null || shown === null) return null;
  const shownThumbs = thumbs?.id === shown.id ? thumbs : null;
  const showLabel = shown.hasText || shownThumbs === null || shownThumbs.srcs.length === 0;
  const markdown = source?.id === shown.id ? source.markdown : null;

  const jump = () => {
    jumpRef.current?.abort();
    const controller = new AbortController();
    jumpRef.current = controller;
    void jumpTo(scrollEl, shown.id, controller.signal);
  };
  // The bar sits outside the chat's scroll container, so pass scrolling on.
  const onWheel = (event: WheelEvent) => {
    jumpRef.current?.abort();
    scrollChat(scrollEl, scrollEl.scrollTop + wheelPixels(event, scrollEl));
  };
  const onTouchStart = (event: TouchEvent) => {
    jumpRef.current?.abort();
    touchRef.current = event.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (y === undefined || touchRef.current === null) return;
    scrollChat(scrollEl, scrollEl.scrollTop + touchRef.current - y);
    touchRef.current = y;
  };

  return createPortal(
    <div
      ref={stripRef}
      style={{
        display: "flex",
        // The reply fades in under the bar rather than meeting a hard edge.
        padding: "8px 0 16px",
        background:
          "linear-gradient(to bottom, var(--background) 0, var(--background) calc(100% - 16px), transparent 100%)",
      }}
    >
      <style>{FLATTEN_CSS}</style>
      {/* A div, not a button: the Markdown inside may contain links. */}
      <div
        data-sticky-prompt-bar=""
        role="button"
        tabIndex={0}
        title={shown.label}
        aria-label={`Scroll to the pinned message: ${shown.label}`}
        onClick={(event) => {
          // A pointer click leaves no focus behind; keyboard focus stays.
          if (event.detail > 0) event.currentTarget.blur();
          jump();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          jump();
        }}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        style={{
          pointerEvents: "auto",
          touchAction: "none",
          width: "100%",
          textAlign: "left",
          // The same surface as BB's own user message bubble:
          // rounded-xl border border-border-seam bg-surface-recessed px-4 py-2.5.
          // The strip behind it is opaque, so the translucent recessed surface
          // reads exactly as it does in the chat.
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
                referrerPolicy="no-referrer"
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
          // inert: links in the Markdown must not take focus or clicks; the
          // whole bar is one control and its label carries the text.
          <div
            data-sticky-prompt-text=""
            inert
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
            {markdown === null ? shown.label : <Markdown content={markdown} />}
          </div>
        ) : null}
      </div>
    </div>,
    host,
  );
}
