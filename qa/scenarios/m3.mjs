import { A, open, bar, scrollToRow } from "../lib.mjs";
const U = (n) => `${A}:user-seed:${n}`;
const geo = (page, id) => page.evaluate((id) => {
  const list = document.querySelector('[data-timeline-row-list="top-level"]');
  let sc = null; for (let n = list.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if (o === "auto" || o === "scroll") { sc = n; break; } }
  const row = id ? document.querySelector(`[data-timeline-row-id="${CSS.escape(id)}"]`) : null;
  return { st: Math.round(sc.scrollTop), rowTop: row ? Math.round(row.getBoundingClientRect().top - sc.getBoundingClientRect().top) : null };
}, id);
async function barCenter(page) {
  const r = await page.evaluate(() => { const el = document.querySelector("[data-sticky-prompt-bar]"); const b = el?.getBoundingClientRect(); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; });
  return r;
}
export default async (page) => {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
  await open(page, A); await page.waitForTimeout(1500);

  // S12: click from the bottom, where BB is attached to the end
  let c = await barCenter(page);
  await page.mouse.click(c.x, c.y); await page.waitForTimeout(1500);
  let g1 = await geo(page, U(219)); await page.waitForTimeout(1000); let g2 = await geo(page, U(219));
  check("S12 click from the bottom brings the message to the top and it stays", g1.rowTop !== null && Math.abs(g1.rowTop - 12) <= 2 && Math.abs(g2.rowTop - 12) <= 2, { g1, g2 });

  // S11: wheel over the bar scrolls the chat
  await scrollToRow(page, U(219), -900); await page.waitForTimeout(500);
  c = await barCenter(page);
  const before = await geo(page);
  await page.mouse.move(c.x, c.y); await page.mouse.wheel(0, 400); await page.waitForTimeout(700);
  const after = await geo(page);
  check("S11 wheel over the bar scrolls the chat", after.st - before.st >= 300, { before: before.st, after: after.st });

  // S13: jump across the long tool turn
  await scrollToRow(page, U(121), 600); await page.waitForTimeout(800);
  let b = await bar(page);
  const pinned82 = b.visible && b.text?.startsWith("Walk through the code");
  const mounted82 = (await geo(page, U(82))).rowTop !== null;
  c = await barCenter(page);
  await page.mouse.click(c.x, c.y); await page.waitForTimeout(2500);
  g1 = await geo(page, U(82));
  check("S13 jump to the tool turn's message", pinned82 && g1.rowTop !== null && Math.abs(g1.rowTop - 12) <= 2, { pinned: b.text, mountedBefore: mounted82, g1 });

  // S14: keyboard
  await scrollToRow(page, U(34), -500); await page.waitForTimeout(600);
  await page.focus("[data-sticky-prompt-bar]");
  const ring = await page.evaluate(() => { const el = document.querySelector("[data-sticky-prompt-bar]"); const s = getComputedStyle(el); return { focused: document.activeElement === el, outline: s.outlineStyle, offset: s.outlineOffset }; });
  await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
  g1 = await geo(page, U(34));
  const tabbable = await page.evaluate(() => [...document.querySelectorAll("[data-sticky-prompt-text] a")].every((a) => a.closest("[inert]")));
  check("S14 Enter on the focused bar jumps; links are not focusable", ring.focused && g1.rowTop !== null && Math.abs(g1.rowTop - 12) <= 2 && tabbable, { ring, g1 });
  await page.screenshot({ path: "/home/box/qa/shots/m3-focus.png" });

  // S23: a real wheel cancels a long jump
  await open(page, A); await page.waitForTimeout(1000);
  await scrollToRow(page, U(121), 600); await page.waitForTimeout(600);
  c = await barCenter(page);
  const startSt = (await geo(page)).st;
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(16);
  await page.mouse.move(c.x, c.y + 300);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(1200);
  const endSt = (await geo(page)).st; const at82 = (await geo(page, U(82))).rowTop;
  check("S23 wheel during a jump stops it", !(at82 !== null && Math.abs(at82 - 12) <= 2) || Math.abs(endSt - startSt) < 2000, { startSt, endSt, at82 });
  return results;
};
