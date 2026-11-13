# Sticky Prompt

A BB plugin that keeps the message you are reading a reply to pinned at the
top of the chat, as Cursor does. Click the pinned message to scroll back to it.

## Behaviour

- Once your message scrolls past the top of the chat, a full-width copy of it,
  cut to two lines, stays pinned there.
- When your next message reaches the top, it pushes the pinned one away and
  takes its place.
- By default only messages you typed are pinned. Messages from other
  threads, agents and BB system notices are skipped.

## Settings

Open Settings, then Installed plugins, then Sticky Prompt, or use
`bb plugin config sticky-prompt`.

| Setting | Default | Effect |
| --- | --- | --- |
| `enabled` | on | Show the pinned message. |
| `includeOtherSenders` | off | Also pin messages from agents, other threads and BB. |

## How it works

- A message metadata slot that renders nothing records each message BB shows:
  its thread, its row in the timeline and who sent it.
- An app overlay draws one bar per chat. It reads the thread's list of user
  messages with `sdk.threads.conversationOutline`, so it can still name a
  message that BB has unmounted from a long thread.
- For a message whose sender it has not seen, it pages back through
  `sdk.threads.timeline` in summary mode.

The bar finds rows through BB's timeline markup (`data-timeline-row-id`,
`data-timeline-row-list`, `data-timeline-window-spacer`). That markup is not
a public API. If a BB update changes it, the bar stops showing and the chat
keeps working.

## Development

```sh
npm install
npm test
npm run typecheck
bb plugin build
```
