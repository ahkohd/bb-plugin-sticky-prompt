#!/usr/bin/env bash
# Fill the QA BB with conversations that exercise Sticky Prompt.
set -euo pipefail
Q=/home/box/qa/bbq
P=${1:?project id}
D=/home/box/qa/fixtures
mkdir -p "$D"

python3 - "$D" <<'PY'
import struct, sys, zlib
out = sys.argv[1]
def png(path, w, h, rgb):
    raw = b"".join(b"\x00" + b"".join(bytes(rgb(x, y)) for x in range(w)) for y in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
png(f"{out}/sunset.png", 320, 200, lambda x, y: (255, 120 + y // 3, 60 + x // 4))
png(f"{out}/sea.png", 320, 200, lambda x, y: (20 + x // 8, 90 + y // 4, 200))
png(f"{out}/forest.png", 200, 320, lambda x, y: (30, 110 + (x * y) % 90, 50))
png(f"{out}/grid.png", 240, 240, lambda x, y: (240, 240, 240) if (x // 30 + y // 30) % 2 else (40, 40, 40))
PY

cat > "$D/long.md" <<'EOF'
I need a careful plan for moving our **billing service** to the new queue, and I want you to read all of this before answering.

Context first. Today the service polls Postgres every five seconds with `SELECT ... FOR UPDATE SKIP LOCKED`, and under load the poller falls behind by several minutes. Customers see invoices late, and support has opened [three tickets](https://example.com/tickets) this week.

What I want:

1. Keep exactly-once delivery for invoice emails.
2. No downtime during the switch, even for a minute.
3. A rollback path that one person can run at 3 a.m. without reading code.

Constraints you should respect:

- We cannot add Redis.
- The team knows TypeScript well and Go a little.
- Anything new must have a dashboard before it ships.

> Note: the finance team freezes deploys on the last two days of each month.

Please answer with the steps, the risks of each step, and how we would know it worked. Be specific about the order of the migrations, and tell me which parts you are unsure about. This prompt is deliberately long so the pinned bar has to cut it after two lines and still read well.
EOF

cat > "$D/table.md" <<'EOF'
Compare these options and fill in anything I missed:

| Option | Cost | Ops work |
| --- | --- | --- |
| pg-boss | none | low |
| BullMQ | Redis | medium |

```ts
const queue = new PgBoss(process.env.DATABASE_URL);
await queue.start();
```

Which one should we pick?
EOF

cat > "$D/i18n.md" <<'EOF'
Can you check these strings render well? 🚀 café, naïve, 日本語のテキスト, 中文字符, and العربية من اليمين إلى اليسار. Also a very long word: supercalifragilisticexpialidocious_supercalifragilisticexpialidocious_supercalifragilisticexpialidocious
EOF

spawn() {
  "$Q" thread spawn --project "$P" --provider acp-qa --permission-mode full --title "$1" --prompt "$2" --json \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or d.get('thread',{}).get('id'))"
}
tell() { local t=$1; shift; "$Q" thread tell "$t" "$@" >/dev/null; "$Q" thread wait "$t" --timeout 120 >/dev/null; }

A=$(spawn "Billing queue plan" "short hello, can you help with a migration plan?")
"$Q" thread wait "$A" --timeout 120 >/dev/null
tell "$A" --message-file "$D/long.md"
tell "$A" --message-file "$D/table.md"
tell "$A" "Here is a screenshot of the dashboard, what stands out?" --image "$D/sunset.png"
tell "$A" "Four more screenshots from the incident, compare them" --image "$D/sea.png" --image "$D/forest.png" --image "$D/grid.png" --image "$D/sunset.png"
tell "$A" --message-file "$D/i18n.md"
tell "$A" "Walk through the code with tools please"
for i in 1 2 3 4; do tell "$A" "Follow-up question number $i about the rollout order"; done

B=$(spawn "Release notes" "short: draft the release notes heading")
"$Q" thread wait "$B" --timeout 120 >/dev/null
BB_THREAD_ID="$B" "$Q" thread tell "$A" "Message from the release notes thread: please confirm the queue cut-over date" >/dev/null
"$Q" thread wait "$A" --timeout 120 >/dev/null

C=$("$Q" thread spawn --project "$P" --provider acp-qa --permission-mode full --title "Child check" --parent-thread "$A" --prompt "short: check the cron job" --json \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or d.get('thread',{}).get('id'))")
"$Q" thread wait "$C" --timeout 120 >/dev/null
sleep 5
"$Q" thread wait "$A" --timeout 120 >/dev/null
tell "$A" "One last huge question to finish the thread"

echo "A=$A B=$B C=$C"
