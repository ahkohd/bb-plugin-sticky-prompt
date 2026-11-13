import { A, open, bar, scrollToRow } from "../lib.mjs";
const U = (n) => `${A}:user-seed:${n}`;
const geo = (page, id) => page.evaluate((id) => {
  const list = document.querySelector('[data-timeline-row-list="top-level"]');
  let sc = null; for (let n = list.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if (o === "auto" || o === "scroll") { sc = n; break; } }
  const row = id ? document.querySelector(`[data-timeline-row-id="${CSS.escape(id)}"]`) : null;
  return { st: Math.round(sc.scrollTop), rowTop: row ? Math.round(row.getBoundingClientRect().top - sc.getBoundingClientRect().top) : null };
}, id);
const center = (page) => page.evaluate(() => { const b = document.querySelector("[data-sticky-prompt-bar]")?.getBoundingClientRect(); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; });
export default async (page) => {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
  await open(page, A); await page.waitForTimeout(1200);
  await scrollToRow(page, U(279), 300); await page.waitForTimeout(800);
  let b = await bar(page);
  const unmounted = (await geo(page, U(240))).rowTop === null;
  const c = await center(page);
  await page.mouse.click(c.x, c.y); await page.waitForTimeout(2500);
  let g = await geo(page, U(240)); await page.waitForTimeout(800); const g2 = await geo(page, U(240));
  check("S13 jump to a message BB had unloaded", unmounted && b.text?.startsWith("Walk through the tools again") && g.rowTop !== null && Math.abs(g.rowTop - 12) <= 2 && Math.abs(g2.rowTop - 12) <= 2, { unmounted, text: b.text, g, g2 });

  await scrollToRow(page, U(209), -10); await page.waitForTimeout(1500);
  b = await bar(page);
  check("S9 agent message skipped by default", b.visible && b.text?.startsWith("One last huge question"), b.text);
  await scrollToRow(page, U(181), -10); await page.waitForTimeout(1500);
  b = await bar(page);
  check("S10 BB system notice skipped", b.visible && b.text?.startsWith("Message from the release notes"), b.text);
  return results;
};
