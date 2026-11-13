import { A, open, bar, scrollToRow } from "../lib.mjs";
const U = (n) => `${A}:user-seed:${n}`;
const settle = (page, ms = 500) => page.waitForTimeout(ms);
export default async (page) => {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
  await open(page, A);
  await settle(page, 1200);
  let b = await bar(page);
  check("S1 newest message pinned at the bottom", b.visible && b.text?.startsWith("Thanks, so what changes"), b.text);

  await scrollToRow(page, U(22), -1); await settle(page);
  b = await bar(page);
  const md = await page.evaluate(() => { const t = document.querySelector("[data-sticky-prompt-text]"); return { strong: t?.querySelector("strong")?.textContent, code: t?.querySelector("code")?.textContent, inert: t?.hasAttribute("inert") }; });
  check("S2 pins as its top reaches the top, with BB Markdown", b.visible && b.text?.startsWith("I need a careful plan") && md.strong === "billing service" && !!md.code && md.inert, { text: b.text, md });

  await scrollToRow(page, U(22), 40); await settle(page);
  b = await bar(page);
  check("S3 short first turn is not pinned", !b.visible, b);

  await scrollToRow(page, U(34), 30); await settle(page);
  b = await bar(page);
  check("S4 next message pushes the bar up", b.visible && b.text?.startsWith("I need a careful plan") && /translateY\(-\d/.test(b.transform ?? ""), b.transform);

  await scrollToRow(page, U(34), -300); await settle(page, 800);
  b = await bar(page);
  const flat = await page.evaluate(() => { const t = document.querySelector("[data-sticky-prompt-text]"); const tbl = t?.querySelector("table"); return { table: tbl ? getComputedStyle(tbl).display : "absent", code: t?.querySelector("code")?.textContent ?? null }; });
  check("S7 table hidden, code block inline", b.visible && b.text?.startsWith("Compare these options") && flat.table !== "table", { text: b.text, flat });

  await scrollToRow(page, U(46), -300); await settle(page, 1200);
  b = await bar(page);
  check("S6 one image shows one thumbnail", b.visible && b.thumbs === 1 && b.text?.startsWith("Here is a screenshot"), b);

  await scrollToRow(page, U(58), -300); await settle(page, 1200);
  b = await bar(page);
  const more = await page.evaluate(() => document.querySelector("[data-sticky-prompt]")?.textContent?.includes("+1"));
  check("S5 four images show three thumbnails and +1", b.visible && b.thumbs === 3 && more, b);

  await scrollToRow(page, U(70), -300); await settle(page, 800);
  b = await bar(page);
  check("S8 emoji, CJK and RTL text render", b.visible && b.text?.includes("日本語") && b.text?.includes("العربية"), b.text);

  await scrollToRow(page, U(209), -250); await settle(page, 1500);
  b = await bar(page);
  check("S9 agent message skipped by default", b.visible && b.text?.startsWith("One last huge question"), b.text);

  await scrollToRow(page, U(181), -200); await settle(page, 1500);
  b = await bar(page);
  check("S10 BB system notice skipped", b.visible && !b.text?.startsWith("[bb system]"), b.text);
  await page.screenshot({ path: "/home/box/qa/shots/m1-last.png" });
  return results;
};
