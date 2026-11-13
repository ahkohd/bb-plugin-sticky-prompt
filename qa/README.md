# QA harness

End-to-end checks for Sticky Prompt in a real BB, used for the 0.2.0 release.
Run them on a throwaway machine with a desktop, never against your own BB.

## What is here

- `fake-acp.mjs` is a scripted ACP agent. It answers every prompt with a fixed
  reply chosen by keywords: `short` gives one line, `tools` gives a run of tool
  calls, `huge` a very long reply, `slow` streams slowly, anything else a long
  reply with headings, a table and code.
- `populate.sh <project-id>` fills a BB with the conversations the scenarios
  expect: long prompts, a table and code block, one and four images, emoji,
  CJK and right-to-left text, a tool run, an agent message and a system notice.
- `cdp.mjs` runs a scenario module against Chrome on `127.0.0.1:9222`.
  `lib.mjs` has the helpers. `scenarios/*.mjs` hold the checks; each prints
  PASS or FAIL per check with what it saw.
- `last-run.txt` is the output of the final run for 0.2.0.

## Setup

Install the driver once in this folder: `npm install playwright-core`.

1. Install `bb-app` 0.49 into its own folder and start it with its own data
   directory and ports, for example `--data-dir ~/qa/data --server-port 48886
   --host-daemon-port 48888`.
2. Register the agent: `bb plugin config provider-acp set customAgents
   '[{"id":"qa","displayName":"QA script","command":"node","args":["<path>/fake-acp.mjs"]}]'`.
3. Create a project, run `populate.sh` and install the plugin from its folder.
4. Start Chrome with `--remote-debugging-port=9222`, dark mode if wanted
   (`--force-dark-mode --blink-settings=preferredColorScheme=0`), and open BB.
5. Set `QA_THREAD`, `QA_PROJECT` and `QA_BB_URL`, then run
   `node cdp.mjs ./scenarios/m1.mjs` and the others.

The scenarios name messages by their outline ids (`<thread>:user-seed:<seq>`)
from the 0.2.0 run. A fresh `populate.sh` run gives the same order of
messages, but check the sequence numbers with
`bb sticky-prompt senders <thread> --last 30` and adjust the scenarios if they
differ.

BB keeps the chat where it is unless a scroll follows user input on the chat,
so the helpers send an empty `wheel` event before each scroll, as the plugin
does.
