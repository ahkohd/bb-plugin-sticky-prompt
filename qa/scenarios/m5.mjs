import { execFileSync } from "node:child_process";
import { A, open, bar, scrollToRow } from "../lib.mjs";
const U = (n) => `${A}:user-seed:${n}`;
const bbq = (...args) => execFileSync(process.env.BBQ ?? "/home/box/qa/bbq", args, { encoding: "utf8" });
const hosts = (page) => page.evaluate(() => document.querySelectorAll("[data-sticky-prompt]").length);
export default async (page) => {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
  await open(page, A); await page.waitForTimeout(1200);
  await scrollToRow(page, U(209), -10); await page.waitForTimeout(1200);

  bbq("plugin", "config", "sticky-prompt", "set", "includeOtherSenders", "true");
  await page.waitForTimeout(2500);
  let b = await bar(page);
  check("S17 with the setting on, the agent message is pinned", b.visible && b.text?.startsWith("[bb message from thread:"), b.text);
  bbq("plugin", "config", "sticky-prompt", "set", "includeOtherSenders", "false");
  await page.waitForTimeout(2500);
  b = await bar(page);
  check("S17b setting off again skips it", b.visible && b.text?.startsWith("One last huge question"), b.text);

  bbq("plugin", "config", "sticky-prompt", "set", "enabled", "false");
  await page.waitForTimeout(2500);
  const off = await hosts(page);
  bbq("plugin", "config", "sticky-prompt", "set", "enabled", "true");
  await page.waitForTimeout(3000);
  b = await bar(page);
  check("S16 turning the bar off removes it, on brings it back", off === 0 && b.visible, { off, b: b.text });

  const parentBefore = await page.evaluate(() => document.querySelector("[data-sticky-prompt]")?.parentElement?.style.position ?? null);
  bbq("plugin", "disable", "sticky-prompt");
  await page.waitForTimeout(3000);
  const afterDisable = await page.evaluate(() => ({ hosts: document.querySelectorAll("[data-sticky-prompt]").length, styles: [...document.querySelectorAll("style")].filter((s) => s.textContent.includes("data-sticky-prompt")).length }));
  bbq("plugin", "enable", "sticky-prompt");
  await page.waitForTimeout(4000);
  await scrollToRow(page, U(209), -10); await page.waitForTimeout(1500);
  b = await bar(page);
  check("S18 disabling the plugin removes every trace; enabling restores it", afterDisable.hosts === 0 && afterDisable.styles === 0 && b.visible, { parentBefore, afterDisable, b: b.text });

  const B = "thr_bkadmvcu6m";
  await page.click(`text=Release notes`); await page.waitForTimeout(2000);
  const onB = await page.evaluate(() => ({ url: location.pathname, bars: [...document.querySelectorAll("[data-sticky-prompt]")].filter((h) => h.style.visibility === "visible").length }));
  await page.click(`text=Billing queue plan`); await page.waitForTimeout(2500);
  b = await bar(page);
  check("S15 switching threads never shows the other thread's message", onB.url.includes(B) && onB.bars === 0 && b.visible, { onB, back: b.text });
  return results;
};
