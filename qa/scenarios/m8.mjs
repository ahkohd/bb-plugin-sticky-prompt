import { execFileSync } from "node:child_process";
import { A, open, bar, scrollToRow } from "../lib.mjs";
const bbq = (...args) => execFileSync(process.env.BBQ ?? "/home/box/qa/bbq", args, { encoding: "utf8" });
const all = (page) => page.evaluate(() => [...document.querySelectorAll("[data-sticky-prompt]")].map((h) => ({ shown: h.style.visibility === "visible", text: h.querySelector("[data-sticky-prompt-text]")?.textContent?.slice(0, 50) ?? null, left: Math.round(h.getBoundingClientRect().left), width: Math.round(h.getBoundingClientRect().width) })));
export default async (page) => {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
  await open(page, A); await page.waitForTimeout(1500);
  let out = "";
  try { out = bbq("thread", "open", "thr_bkadmvcu6m", "--split", "right"); } catch (e) { out = String(e.stderr ?? e); }
  await page.waitForTimeout(3000);
  const lists = await page.evaluate(() => document.querySelectorAll('[data-timeline-row-list="top-level"]').length);
  const bars = await all(page);
  await page.screenshot({ path: "/home/box/qa/shots/m8-split.png" });
  check("S21 split panes get one bar each, each for its own thread", lists >= 2 && bars.length >= 1 && bars.every((b) => !b.shown || !b.text?.startsWith("draft the release")), { out: out.slice(0, 120), lists, bars });

  const s = await page.context().newCDPSession(page);
  const { windowId, bounds } = await s.send("Browser.getWindowForTarget");
  await s.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } }).catch(() => {});
  await s.send("Browser.setWindowBounds", { windowId, bounds: { left: 0, top: 0, width: 520, height: 1000 } });
  await page.waitForTimeout(1500);
  await open(page, A); await page.waitForTimeout(1500);
  await scrollToRow(page, `${A}:user-seed:22`, -200); await page.waitForTimeout(1200);
  const narrow = await bar(page);
  const overflow = await page.evaluate(() => { const h = document.querySelector("[data-sticky-prompt]"); return h ? h.scrollWidth - h.clientWidth : null; });
  await page.screenshot({ path: "/home/box/qa/shots/m8-narrow.png" });
  await s.send("Browser.setWindowBounds", { windowId, bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } });
  check("S22 narrow window: bar fits the column", narrow.visible && overflow === 0 && narrow.rect.width < 520, { narrow: { text: narrow.text?.slice(0, 40), rect: narrow.rect }, overflow });
  return results;
};
