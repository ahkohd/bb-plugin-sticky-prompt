// Who sent each user message.
//
// A message on screen tells us through the message metadata slot. BB marks
// notices and messages from other threads in their text, which settles most
// of the rest. For anything else, the outline id ends in the message's event
// sequence (`<thread>:user-seed:<seq>`), and `threads.message` returns that
// one row with its initiator.

import { userRowOf } from "./message";
import type { Initiator } from "./registry";

/** The sender BB's own prefix names, if the preview has one. */
export function senderFromPreview(preview: string): Initiator | undefined {
  const text = preview.trimStart();
  if (text.startsWith("[bb system]")) return "system";
  if (text.startsWith("[bb message from thread:")) return "agent";
  return undefined;
}

export function seqFromId(id: string): number | undefined {
  const match = /:user-seed:(\d+)$/.exec(id);
  if (match === null) return undefined;
  const seq = Number(match[1]);
  return Number.isSafeInteger(seq) ? seq : undefined;
}

export type FetchMessage = (seq: number) => Promise<unknown>;

/** Look one message up by its event sequence. Undefined when BB cannot say. */
export async function findSender(
  fetchMessage: FetchMessage,
  id: string,
): Promise<Initiator | undefined> {
  const seq = seqFromId(id);
  if (seq === undefined) return undefined;
  return userRowOf(await fetchMessage(seq), id)?.initiator;
}
