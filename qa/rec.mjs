import { A, open, bar, scrollToRow } from "./lib.mjs";
const U = (n) => `${A}:user-seed:${n}`;
const scenes = {
  top: async (page) => { await open(page, A); await page.evaluate(async () => { const l = document.querySelector('[data-timeline-row-list="top-level"]'); let sc; for (let n = l.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if (o === "auto" || o === "scroll") { sc = n; break; } } for (let i = 0; i < 40 && sc.scrollTop > 0; i++) { sc.dispatchEvent(new WheelEvent("wheel", { deltaY: 0 })); sc.scrollTop = 0; await new Promise((r) => setTimeout(r, 120)); } }); },
  long: (page) => scrollToRow(page, U(22), 60),
  deep34: (page) => scrollToRow(page, U(34), -700),
  images: (page) => scrollToRow(page, U(46), 120),
  i18n: (page) => scrollToRow(page, U(70), 120),
  tools: (page) => scrollToRow(page, U(279), 420),
  agent: (page) => scrollToRow(page, U(209), 140),
  agentLong: (page) => scrollToRow(page, U(286), 120),
  imageOnly: (page) => scrollToRow(page, U(298), 120),
  state: async () => {},
};
export default async (page) => {
  const scene = process.env.SCENE ?? "state";
  await scenes[scene](page);
  await page.waitForTimeout(600);
  const b = await bar(page);
  const geo = await page.evaluate((id) => {
    const l = document.querySelector('[data-timeline-row-list="top-level"]'); let sc; for (let n = l.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if (o === "auto" || o === "scroll") { sc = n; break; } }
    const row = id ? document.querySelector(`[data-timeline-row-id="${CSS.escape(id)}"]`) : null;
    return { scrollTop: Math.round(sc.scrollTop), rowTop: row ? Math.round(row.getBoundingClientRect().top - sc.getBoundingClientRect().top) : null, mounted: !!row };
  }, process.env.ROW ? `${A}:user-seed:${process.env.ROW}` : null);
  return { scene, visible: b.visible, text: b.text?.slice(0, 80) ?? null, thumbs: b.thumbs, transform: b.transform, ...geo };
};
