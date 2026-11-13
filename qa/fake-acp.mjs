#!/usr/bin/env node
// A scripted ACP agent for Sticky Prompt QA. It answers every prompt with a
// fixed reply chosen by keywords in the prompt, so QA runs are repeatable.
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cancelled = new Set();
let nextTool = 1;

const paragraph = (n) =>
  `Paragraph ${n} of the reply. The pinned message should stay at the top of the chat while this text scrolls under it. ` +
  `It names what the agent is answering, so a reader halfway down a long answer still knows the question. ` +
  `This sentence is here to make the paragraph wrap across several lines at the usual chat width.`;

function longReply(topic, sections) {
  const parts = [`Here is a long answer about **${topic}**.`];
  for (let s = 1; s <= sections; s++) {
    parts.push(`## Part ${s}`);
    parts.push(paragraph(s * 3 - 2), paragraph(s * 3 - 1));
    if (s === 2) {
      parts.push(
        "| Case | Expected | Notes |\n| --- | --- | --- |\n| Short turn | Not pinned | Fits on screen |\n| Long turn | Pinned | Pushed by the next message |\n| Agent message | Skipped | Unless the setting is on |",
      );
    }
    if (s === 3) parts.push("```ts\nexport function pick(input: PickInput): PickResult {\n  return { kind: \"none\" };\n}\n```");
    parts.push(paragraph(s * 3));
  }
  parts.push("That is the end of the answer.");
  return parts.join("\n\n");
}

function textOf(prompt) {
  return (prompt ?? []).filter((block) => block?.type === "text").map((block) => block.text).join("\n");
}

async function streamText(sessionId, text) {
  const chunks = text.match(/[\s\S]{1,400}/g) ?? [];
  for (const chunk of chunks) {
    if (cancelled.has(sessionId)) return;
    send({
      method: "session/update",
      params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } } },
    });
    await sleep(Number(process.env.QA_CHUNK_DELAY_MS ?? 40));
  }
}

async function toolCall(sessionId, title) {
  const toolCallId = `qa-tool-${nextTool++}`;
  send({
    method: "session/update",
    params: { sessionId, update: { sessionUpdate: "tool_call", toolCallId, title, kind: "read", status: "in_progress" } },
  });
  await sleep(60);
  send({
    method: "session/update",
    params: { sessionId, update: { sessionUpdate: "tool_call_update", toolCallId, status: "completed" } },
  });
}

async function answer(sessionId, prompt) {
  const text = textOf(prompt);
  const lower = text.toLowerCase();
  if (lower.includes("short")) {
    await streamText(sessionId, "Short answer: yes. This reply fits on one screen with its question.");
    return;
  }
  if (lower.includes("tools")) {
    for (let i = 1; i <= 6; i++) {
      await streamText(sessionId, `Step ${i}: reading part of the code.\n\n${paragraph(i)}`);
      await toolCall(sessionId, `Read src/file-${i}.ts`);
    }
    await streamText(sessionId, longReply("the tool run", 2));
    return;
  }
  const sections = lower.includes("huge") ? 12 : lower.includes("slow") ? 6 : 4;
  await streamText(sessionId, longReply(lower.includes("image") ? "the images" : "your question", sections));
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (id === undefined) {
    if (method === "session/cancel") cancelled.add(params?.sessionId);
    return;
  }
  switch (method) {
    case "initialize":
      send({
        id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: false, promptCapabilities: { image: true, audio: false, embeddedContext: true } },
          authMethods: [],
          agentInfo: { name: "sticky-prompt-qa", version: "1.0.0" },
        },
      });
      return;
    case "session/new":
      send({ id, result: { sessionId: `qa-${randomUUID()}` } });
      return;
    case "session/prompt": {
      const sessionId = params?.sessionId;
      cancelled.delete(sessionId);
      if (String(textOf(params?.prompt)).toLowerCase().includes("slow")) process.env.QA_CHUNK_DELAY_MS = "250";
      await answer(sessionId, params?.prompt);
      process.env.QA_CHUNK_DELAY_MS = "40";
      send({ id, result: { stopReason: cancelled.has(sessionId) ? "cancelled" : "end_turn" } });
      return;
    }
    default:
      send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
