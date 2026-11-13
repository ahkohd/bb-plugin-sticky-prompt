import { execFileSync } from "node:child_process";
import { A, open, bar, scrollToRow } from "../lib.mjs";
const U = (n) => `${A}:user-seed:${n}`;
const bbq = (...args) => execFileSync(process.env.BBQ ?? "/home/box/qa/bbq", args, { encoding: "utf8" });
export default async (page) => {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
  await open(page, A); await page.waitForTimeout(1200);
  await scrollToRow(page, U(286), -400); await page.waitForTimeout(1500);
  let b = await bar(page);
  const off = b;
  bbq("plugin", "config", "sticky-prompt", "set", "includeOtherSenders", "true");
  await page.waitForTimeout(2500);
  b = await bar(page);
  bbq("plugin", "config", "sticky-prompt", "set", "includeOtherSenders", "false");
  check("S17 agent message with a long reply: skipped by default, pinned with the setting on", off.visible && !off.text?.startsWith("[bb message") && b.visible && b.text?.startsWith("[bb message from thread:"), { off: off.text, on: b.text });
  await page.waitForTimeout(1500);

  return results;
};
