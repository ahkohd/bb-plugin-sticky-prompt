import { A, open, bar, scrollToRow } from "../lib.mjs";
const newest = (page) => page.evaluate(() => { const ids = [...document.querySelectorAll('[data-timeline-row-id*=":user-seed:"]')].map((n) => n.getAttribute("data-timeline-row-id")); return ids[ids.length - 1]; });
const geo = (page, id) => page.evaluate((id) => {
  const list = document.querySelector('[data-timeline-row-list="top-level"]');
  let sc = null; for (let n = list.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if (o === "auto" || o === "scroll") { sc = n; break; } }
  const row = document.querySelector(`[data-timeline-row-id="${CSS.escape(id)}"]`);
  return { rowTop: row ? Math.round(row.getBoundingClientRect().top - sc.getBoundingClientRect().top) : null };
}, id);
export default async (page) => {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
  await open(page, A); await page.waitForTimeout(1500);
  const panes = await page.evaluate(() => document.querySelectorAll('[data-timeline-row-list="top-level"]').length);
  const id = await newest(page);
  let b = await bar(page);
  check("S1 newest message pinned at the bottom", panes === 1 && b.visible && b.text?.startsWith("slow: summarise the rollout risks"), { panes, id, text: b.text });
  const c = await page.evaluate(() => { const r = document.querySelector("[data-sticky-prompt-bar]").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(c.x, c.y); await page.waitForTimeout(1500);
  const g1 = await geo(page, id); await page.waitForTimeout(1000); const g2 = await geo(page, id);
  check("S12 click from the bottom brings the message to the top and it stays", g1.rowTop !== null && Math.abs(g1.rowTop - 12) <= 6 && Math.abs(g2.rowTop - 12) <= 6, { g1, g2 });
  await page.click("text=Release notes"); await page.waitForTimeout(2000);
  const onB = await page.evaluate(() => ({ url: location.pathname, panes: document.querySelectorAll('[data-timeline-row-list="top-level"]').length, bars: [...document.querySelectorAll("[data-sticky-prompt]")].filter((h) => h.style.visibility === "visible").length }));
  await page.click("text=Billing queue plan"); await page.waitForTimeout(2500);
  b = await bar(page);
  check("S15 switching threads never shows the other thread's message", onB.panes === 1 && onB.bars === 0 && b.visible, { onB, back: b.text });
  return results;
};
