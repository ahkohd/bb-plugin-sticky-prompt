import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0];
const page = context.pages().find((p) => p.url().includes("48886")) ?? context.pages()[0];
const mod = await import(process.argv[2]);
try { const out = await mod.default(page, context); if (out !== undefined) console.log(typeof out === "string" ? out : JSON.stringify(out, null, 1)); }
finally { await browser.close().catch(() => {}); }
