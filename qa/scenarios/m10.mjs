import { A, open, bar, scrollToRow } from "../lib.mjs";
const U = (n) => `${A}:user-seed:${n}`;
export default async (page) => {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
  await open(page, A); await page.waitForTimeout(1200);
  await scrollToRow(page, U(34), -700); await page.waitForTimeout(800);
  const c = await page.evaluate(() => { const r = document.querySelector("[data-sticky-prompt-bar]").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(c.x, c.y); await page.waitForTimeout(1500);
  const st = await page.evaluate((id) => {
    const host = document.querySelector("[data-sticky-prompt]"); const strip = host.firstElementChild;
    const row = document.querySelector(`[data-timeline-row-id="${CSS.escape(id)}"]`);
    const hostTop = host.getBoundingClientRect().top;
    return { visibility: host.style.visibility, stripBottom: Math.round(strip.getBoundingClientRect().bottom - hostTop), rowTop: Math.round(row.getBoundingClientRect().top - hostTop), title: document.querySelector("[data-sticky-prompt-bar]")?.getAttribute("title") ?? null };
  }, U(34));
  check("S12b after a jump the previous bar no longer covers the message", st.visibility !== "visible" || st.stripBottom <= st.rowTop + 1, st);
  check("S25 no raw Markdown tooltip", st.title === null, st.title);
  return results;
};
