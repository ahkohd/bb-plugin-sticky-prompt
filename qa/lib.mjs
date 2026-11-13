export const BASE = process.env.QA_BB_URL ?? "http://127.0.0.1:48886";
export const A = process.env.QA_THREAD ?? "thr_w3q5j4ac75";
const PROJECT = process.env.QA_PROJECT ?? "proj_uqmgqxvk48";
export async function open(page, thread) {
  await page.goto(`${BASE}/projects/${PROJECT}/threads/${thread}`);
  await page.waitForSelector('[data-timeline-row-list="top-level"]', { timeout: 20000 });
  await page.waitForTimeout(1500);
}
export const inPage = {
  scroller() {
    const list = document.querySelector('[data-timeline-row-list="top-level"]');
    for (let n = list.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowY;
      if (o === "auto" || o === "scroll") return n;
    }
    return null;
  },
};
export async function bar(page) {
  return page.evaluate(() => {
    const host = document.querySelector("[data-sticky-prompt]");
    if (!host) return { host: false };
    const visible = host.style.visibility === "visible";
    const text = host.querySelector("[data-sticky-prompt-text]")?.textContent?.trim().slice(0, 120) ?? null;
    const thumbs = host.querySelectorAll("img").length;
    const strip = host.firstElementChild;
    return { visible, text, thumbs, transform: strip?.style.transform ?? null, rect: host.getBoundingClientRect().toJSON?.() };
  });
}
export async function scrollToRow(page, id, offset) {
  return page.evaluate(async ([id, offset]) => {
    const list = document.querySelector('[data-timeline-row-list="top-level"]');
    let sc = null;
    for (let n = list.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if (o === "auto" || o === "scroll") { sc = n; break; } }
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    if (!document.querySelector(`[data-timeline-row-id="${CSS.escape(id)}"]`)) {
      for (let k = 0; k < 6; k++) { sc.dispatchEvent(new WheelEvent("wheel", { deltaY: 0 })); sc.scrollTop = sc.scrollHeight; await frame(); await frame(); }
    }
    for (let i = 0; i < 200; i++) {
      const row = document.querySelector(`[data-timeline-row-id="${CSS.escape(id)}"]`);
      if (row) {
        for (let k = 0; k < 10; k++) { const d = row.getBoundingClientRect().top - sc.getBoundingClientRect().top - offset; if (Math.abs(d) < 1) break; sc.dispatchEvent(new WheelEvent("wheel", { deltaY: 0 })); sc.scrollTop += d; await frame(); }
        return true;
      }
      sc.dispatchEvent(new WheelEvent("wheel", { deltaY: 0 })); sc.scrollTop = Math.max(0, sc.scrollTop - sc.clientHeight * 0.7); await frame(); await frame();
    }
    return false;
  }, [id, offset]);
}
export async function scrollBy(page, dy) {
  await page.evaluate(async (dy) => {
    const list = document.querySelector('[data-timeline-row-list="top-level"]');
    let sc = null;
    for (let n = list.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if (o === "auto" || o === "scroll") { sc = n; break; } }
    sc.dispatchEvent(new WheelEvent("wheel", { deltaY: 0 })); sc.scrollTop += dy;
    await new Promise((r) => setTimeout(r, 250));
  }, dy);
}
