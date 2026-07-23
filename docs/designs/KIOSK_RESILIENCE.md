# Kiosk resilience: offline scan queue + network health & auto-recovery

**Status: PROPOSAL (design review) — nothing here is built.** Companion to the
kiosk client in `client/` and the scan path in `checkin-app`. Written after a
verified recon of both repos (2026-07-22, origin/main); every claim about
current behavior below was checked against the tree — symbols are greppable,
no file:line links.

## 1. Why the kiosk "goes down", verified

The kiosk is a Python Ed25519-signing proxy (`client.py`, localhost-only) with
Chromium in `--kiosk` mode rendering a wrapper that iframes
`/attendance/current?mode=kiosk`; USB badge scans become signed
`POST /api/scan`. Today `post_scan` catches every exception, paints a red
"Scan failed" banner, and **drops the scan — no retry, no queue, no
persistence**. The verified outage shapes:

- **Scale-to-zero cold wake (the headline).** Prod tears down to
  `desiredCount=0` overnight (soft curfew) and wakes on intent. A scan `POST`
  IS the waking intent — but its own response is the waker's `503
  WARMING_HTML` page; `post_scan` calls `r.json()` on HTML, throws, and the
  scan is lost. **The first scan after any idle teardown is guaranteed lost
  today**, with a red banner that reads as "broken" instead of "warming".
- **Aurora auto-pause** (`min_capacity=0`, 5-min pause). Mostly absorbed
  server-side by `auroraResumeRetry` (45s connection-acquisition deadline);
  scans past the deadline drop.
- **Genuine network loss** (WiFi/DNS/upstream): every scan drops for the
  duration; the failure layer is invisible to staff.
- **Silent scanner death**: `usb_scanner_listener`'s `read_loop()` has no
  re-grab guard — an unplugged/renamed USB scanner kills the thread with zero
  surface.
- **Two dead self-heal paths on main**: the version poller fetches
  `origin/master` (doesn't exist) and polls `/api/kiosk/version` (404; the
  real route is `/api/system-status/kiosk-version`), so the auto-update
  restart and server-version reload never fire. `config.example.json`'s
  `kiosk_path` points at `/kioskdisplay` which 404s (real page:
  `/attendance/current?mode=kiosk`).
- **No heartbeat**: outages are discovered by walking up to the door.
  `DbWakeNotice` is session-gated and therefore inert on the signature-authed
  kiosk.

One server-side fact shapes the whole queue design: `/api/scan`'s dedup is a
**3-second time-debounce** against `RawBadgeLog` (which has **no unique
key**), and the check-in/out direction is a **live-state toggle** — so a
delayed re-delivery of a lost scan doesn't dedup, it **toggles the person
back out**. Retry without a real idempotency key is worse than the disease.

## 2. Offline scan queue

Design forces beyond §1, all verified: the client process restarts routinely
— self-update `os._exit(0)` (once §3.3 revives it) through the `kiosk.sh`
respawn loop, and these are Pis that lose power (in-memory
anything dies; storage must be crash-consistent); the toggle direction is
inferred from live state under a per-participant `pg_advisory_xact_lock` and
that inference is only valid at scan time; one facility shares one NAT IP
against the 300/min scan rate limit (counted before crypto in `withKiosk`);
and `findAssociatedEventAt` binds a visit to an Event **by time**, so replay
must carry the original scan time or the visit lands under the wrong Event.

### Decisions

**D1 — Queue storage: SQLite via stdlib `sqlite3`.** One file, one table, WAL +
`synchronous=FULL`. Stdlib (no new Pi dependency) and it provides what a
hand-rolled log would make us write: ACID durability across the respawn loop,
crash-consistency on power-cut (a torn write rolls back), DELETE-by-id on ack,
and a UNIQUE column for dedup. Corruption knob: on open, a `DatabaseError`
means rename the file aside (`outbox.corrupt.<ts>`) and start fresh —
**scanning must never block on a sick queue.** Volume is a handful of human
scans; favor durability over speed.

Outbox schema (client): `outbox(client_event_id TEXT PRIMARY KEY,
participant_id INT, scanned_at TEXT, attempts INT DEFAULT 0, last_status INT,
state TEXT DEFAULT 'pending', created_at TEXT)` — `state ∈ {pending, dead}`.

**D2 — Event identity: client UUID + scan-time timestamp; server dedups on a
nullable unique column.** The client generates `clientEventId` (UUID) and
captures `scannedAt` at the moment the badge is read, and reuses both across
every retry. Server-side dedup is `@unique` on `RawBadgeLog.clientEventId`,
**nullable** so legacy/web writers keep writing NULL (Postgres NULLs don't
collide) — un-upgraded kiosks and web check-ins are unaffected. New writers
get exactly-once semantics: a redelivered event hits the pre-read and no-ops.

**D3 — Stale-replay: record the touch always; toggle only within a freshness
window; park the rest for a human.** The honest finding: **no fully-automatic
scheme is safe** for a stale scan — a bare toggle cannot tell "badge to enter"
from "badge to leave"; it leans on live state, which is exactly what is stale.
Split by freshness:

- **Always** write the `RawBadgeLog` row with `clientEventId` and
  `timestamp = scannedAt` (the true event time). The touch is never lost and
  event-association stays correct even when we decline to project a Visit.
- **Within window W** (config, default ~10 min — comfortably exceeds the
  worst-case ~3–5 min cold wake): apply the normal toggle at delivery via the
  existing `processCheckin`/`processCheckout`, passing `scannedAt` as the
  visit time. One **out-of-order guard**: if the participant has any visit
  activity (arrival or departure) newer than `scannedAt`, park instead of
  toggling — state has moved past the event, and applying it could otherwise
  write a Visit with `departedAt < arrivedAt` or resurrect a closed visit.
  This covers the waker and Aurora outages — the events we most
  need not to lose — and reuses the advisory lock, the partial unique index
  (`Visit_one_open_per_participant`), and the facility-close path unchanged.
- **Beyond W**: do **not** touch `Visit`. Record the log row, set
  `reviewReason`, surface in the ops panel (D7) for a human. `200
  {type:"parked"}`.

Interplay with the 3s debounce: a replayed row's past `timestamp` never
suppresses later live scans, but the debounce read at *delivery* time
(`timestamp >= now-3000ms`, by person) can match a live scan that landed just
before the replay — the replay then returns `ignored_debounce`, which the
client acks (rare: the touch row is swallowed, but the live scan already set
the state; honest cost of keeping double-badge protection). `clientEventId`
is the real dedup, pre-read **inside** the advisory-lock transaction
(mirroring the debounce pre-read shape) so there is no TOCTOU against a
racing replay of the same event; the `@unique` constraint is the backstop —
any pre-read race that slips through (e.g. two kiosks replaying one event
across *different* advisory locks after a mid-replay merge changed the
survivor) surfaces as P2002, which the server maps to `200
duplicate_ignored`. One more `timestamp` consumer to note: the
last-keyholder force-close detector (top-2 `RawBadgeLog` rows within 12s)
compares scan times after replay — a queued warning+confirm pair keeps its
original spacing, so the confirm semantics survive delivery lag.
Parked events don't write Visit, so they can't violate the partial index.
Multi-kiosk, one person: the advisory lock serializes replay-vs-live and
kiosk-vs-kiosk, and the out-of-order guard makes the newest `scannedAt` win —
an older event arriving after it parks for review instead of overwriting
(sign-off: open question 4). Residual misorderings are rare and
self-correcting (staff see the roster; the person re-badges). We explicitly
do not build cross-kiosk ordering consensus for a makerspace door.

**D4 — Replay transport: single FIFO-by-time thread, re-sign per attempt,
waker-aligned backoff, one-at-a-time first.** One drain thread pulls
`state='pending'` in `scanned_at` order — global-time FIFO trivially preserves
per-person order. Re-signing every attempt is forced by the 60s signature
window and free (the key lives on the Pi). The client stops calling
`r.json()` blind and branches:

| Server says | Client does |
|---|---|
| `2xx` JSON `{type: checkin\|checkout\|duplicate_ignored\|ignored_debounce\|parked}` | **ack** — DELETE from outbox |
| `503` / non-JSON body / `Retry-After` present | **warming, not failure** — keep; sleep `max(Retry-After≈30s, backoff)`; §3.5's ~10-min cap reclassifies a stuck "warming" |
| `429` | backoff, respect `Retry-After` |
| `400` JSON `{type:"warning"}` | **ack** — the last-keyholder force-close caution; the touch row WAS recorded server-side, and the confirm badge is its own queued event |
| other `400` / `404` / `409` | **terminal** — `state='dead'`, escalate (D6/D7) |
| `401` | retry + escalate to the warning banner — clock skew (NTP) or key mismatch; **never** dead-letter, re-signing succeeds once the clock/key recovers |
| other `5xx` | retry with backoff — handler threw, transaction rolled back, idempotent |
| status 0 (network/timeout) | retry with backoff — safe, idempotent |

Backoff: start at the waker's `Retry-After: 30`, exponential to ~5 min cap,
jittered. **The drain sleeps through the closed window**: a queued `POST` is a
non-GET (it would wake the curfewed service) and steady retries defer the soft
curfew's 5-min quiet check — the §3.4 trap twice over. Events held overnight
land beyond W and park for morning review, which is the right outcome. On
startup (including after the nightly reboot — the WAL survives) the drain
begins by reading existing `pending` rows. **Try-first,
enqueue-on-non-confirmation** (not write-ahead):
generate `clientEventId` before the first attempt; persist to the outbox only
if the attempt isn't confirmed — **unless the outbox already holds a pending
event for the same participant, in which case enqueue behind it instead**: a
fresh scan must not jump its own predecessor, or the drain later applies the
older toggle on top of the newer one (order inversion; D3's server-side guard
is the backstop). The idempotency key makes at-least-once
delivery harmless, so the happy path skips an INSERT+DELETE per scan.
`ponytail:` the only gap is a crash in the milliseconds between a failed send
and the enqueue — closeable later with write-ahead at the cost of a DELETE per
scan.

**D5 — UX: a fourth banner state that reads as *safe*.** Green ok / red error /
amber warning exist today, and amber is already the keyholder force-close
caution. A queued scan must read as **done and safe to walk away from**: a
distinct **blue "Saved" banner** with a check-mark — `✓ Saved — will sync
(N waiting)`. The check-mark on green and blue is the "safe" signal; **red is
the only "not saved" state.** A live queued-count rides the SSE stream so
staff watch the backlog drain. Two honest caveats: a blue scan is not yet on
the live roster/count (the display catches up on sync), and permanent
failures can't re-alert a person who already left — those escalate to the ops
panel, not the banner.

**D6 — Failure budget: keep accepting, always.** Refusing a scan during an
outage turns people away at the door — the opposite of resilience. A queued
event is ~100 bytes; a full day offline is kilobytes on a Pi with gigabytes.
The outbox holds only un-acked events, so it is near-empty except mid-outage;
a large size cap (~50k rows) is a guard rail against a pathological stuck
state, and un-acked rows are **never** silently evicted. Events that can
never apply (unknown `participantId` after a merge → 404/409; malformed →
400) are dead-lettered: `state='dead'` stops them burning rate limit and
blocking FIFO; the badge needed reissuing anyway.

**D7 — Parked & dead events live on the existing `system-status` panel,
backed by two columns on `RawBadgeLog`.** No new table: a parked event IS a
badge-log row we chose not to project. `reviewReason` (set at park/dead time)
and `reviewedAt`/`reviewedBy` (set on resolution) hang on the row we're
already extending. A `system-status/unsynced-scans` sub-page — same
`withAuth({roles:['isSysadmin','isBoardMember']})` pattern as
`system-status/errors` — lists unresolved rows: "Person X, scanned 2:14pm,
40 min late — [Check in] [Dismiss]." A small "⚠ N need review" count on the
kiosk corner signals accumulation without a keyboard.

### Extended `/api/scan` contract (backward-compatible)

```
POST /api/scan                       Auth unchanged (withKiosk; re-sign every attempt)
Body (new fields optional):
  { participantId: number,
    clientEventId?: string,          // UUID, stable across retries of one scan
    scannedAt?:     string }         // ISO8601, instant the badge was read

Server:
  legacy body {participantId}        → exactly today's behavior (timestamp=now, no dedup key)
  clientEventId present → in the advisory-lock tx, pre-read RawBadgeLog by clientEventId:
    found  → 200 {type:"duplicate_ignored"}                    (idempotent replay, no toggle)
    absent → write RawBadgeLog{clientEventId, timestamp: scannedAt ?? now}:
      (now - scannedAt) <= W → normal toggle, event-assoc uses scannedAt
                               → 200 {type:"checkin"|"checkout"}
                               out-of-order guard (D3): participant has visit
                               activity newer than scannedAt → park instead
      else                   → set reviewReason, DO NOT toggle → 200 {type:"parked"}
  unique-violation on the insert (cross-lock race, e.g. mid-replay merge)
                                     → 200 {type:"duplicate_ignored"}
```

### Schema delta

```prisma
model RawBadgeLog {
  // …existing…
  clientEventId String?   @unique   // idempotency key; NULL for legacy/web writers
  reviewReason  String?             // set when a stale/dead replay is parked instead of toggled
  reviewedAt    DateTime?           // set when a human resolves it in system-status
  reviewedBy    Int?                // resolver personId
  // timestamp carries the ORIGINAL scannedAt for replayed events (previously always now())
}
```

Create the unique index `CONCURRENTLY` in a raw-SQL migration (can't run in a
transaction; would otherwise lock the table) — the hand-written-migration
precedent set by `Visit_one_open_per_participant`.

### Rejected alternatives (tombstones)

- **Append-only JSONL outbox** — hand-rolls compaction, dedup, read-cursor,
  torn-last-line handling, cross-thread locking; SQLite gives all of it from
  stdlib.
- **Redis / queue daemon on the Pi** — a whole service for a handful of rows.
- **Write-ahead every scan** — the idempotency key already makes at-least-once
  harmless; named as the upgrade path for the millisecond crash window.
- **Full event-sourcing (recompute Visits from RawBadgeLog)** — fights the
  imperative toggle, the partial unique index, the facility-close sweep, and
  notifications; and a bare toggle still can't resolve two same-direction
  scans. Not worth rebuilding the projection engine for a door.
- **Precondition replay on kiosk-observed state** — the kiosk doesn't reliably
  know the state; the confirming response is exactly the one that never
  arrived.
- **Dead-letter everything stale** — a 40-min-old scan is usually still
  correct; blanket dead-lettering discards real attendance.
- **A dedicated ParkedScan/SyncFollowUp table** — two nullable columns on the
  row we're already extending + the existing panel cover it.
- **Per-person parallel replay** — a Pi drains a trickle; single FIFO-by-time
  preserves order with one thread and one cursor.

## 3. Health checking, recovery, and heartbeat

### 3.1 Layered health state machine

A single background thread (`health_monitor`, sibling to the existing
`attendance_poller`/`version_poller`) owns new state fields (`scanner_ok`,
`last_browser_seen`, `last_attendance_ok`, `net_layer`, `warming`). Layers are
diagnosed by **one cookieless `GET /api/health`** plus two local observations
— the probe's *failure mode* is the layer discriminator, so there is no probe
per layer:

| Layer | Signal | Failure looks like | Recovery trigger |
|---|---|---|---|
| L0 process | client.py alive | crash/exit | `kiosk.sh` loop respawn (rung 2 path) |
| L1 scanner | `dev.grab()` held; `read_loop()` iterating | silent today: unplug kills the thread, zero surface | re-grab (rung 0.5) + heartbeat flag |
| L2 LAN/gateway | default gateway reachable | probe `ConnectionError` AND gateway unreachable | wifi bounce (rung 3, gated) |
| L3 DNS | resolve the backend host | `gaierror`; gateway fine | wifi/NM restart (rung 3) |
| L4 TLS/TCP to ALB | :443 handshake | `ConnectTimeout`/`SSLError`; gateway+DNS fine → upstream, **not locally recoverable** | report only — never thrash wifi |
| L5 app | `/api/health` → 200 | `503`+`Retry-After` = **warming, not down**; other 5xx = app fault | warming → §3.5 banner; other 5xx → report only (upstream — a Pi reboot can't fix the app) |
| L6 DB | scan outcomes (real writes) | scans fail while L5=200 | observe from scans; **never steady-poll** |

**One probe, failure-mode routed.** `/api/health` is public, DB-free, and a
cookieless GET **does not wake** the scaled-to-zero service (the waker wakes
only on any-cookie or non-GET/HEAD). Not-waking is only half the curfew trap,
though: the soft curfew tears down only when the trailing 5 minutes are
request-quiet (`shutdown_min_idle_minutes = 5`, ALB RequestCount across BOTH
target groups — cookieless GETs count; only the ALB's own TG health checks
don't), so a steady sub-5-min poll keeps prod up all night — the 2026-07-17
monitor-as-keep-alive incident shape. `health_monitor` polls freely during
open hours (idle teardown is off) and goes **silent through the closed
window** — and so must ALL steady kiosk traffic: the **existing**
`attendance_poller` (30s signed GET, currently unconditional) alone would
defer every curfew attempt the moment a 24/7-powered kiosk points at prod,
so the closed-window gate covers it too.

**L6 is observed, not probed.** `/api/health/db` is session-gated by design
(an anonymous `SELECT 1` would let crawlers resume and pin the auto-pausing
Aurora). A `withKiosk`-signed analog (`GET /api/system-status/db-ping`) is
defined **as an on-demand diagnostic only, never a timer** — even a signed
steady poll would pin Aurora. Scans already exercise the DB; their outcomes
are the DB signal.

**L1 is the highest-value new signal**: wrap `read_loop()` in try/except; on
device loss set `scanner_ok=false`, re-run `find_device` + `grab()` with
capped backoff, surface on the heartbeat and a persistent warning banner.

### 3.2 Recovery ladder

| Rung | Action | Gate |
|---|---|---|
| 0 | SSE `{reload:true}` → iframe re-src | auto, ungated (existing path) |
| 0.5 | scanner re-grab | auto, ungated, backoff |
| 1 | bounce Chromium alone | auto, cooldown (≤1 / 5 min) |
| 2 | full `kiosk.sh` cycle | auto, cooldown (existing `os._exit(0)` path) |
| 3 | NetworkManager/wifi bounce | auto, **only on L2 gateway-unreachable or L3 DNS failure**; never on L4 |
| 4 | reboot | nightly (closed hours) + escalation (rate-limited 1/hr) |

**Hung-Chromium detection via the proxy's on-path view (rung 1).** Today the
browser is bounced only when the Python process exits; a renderer hang leaves
a frozen screen forever. But the proxy sees every request the browser makes —
the wrapper's SSE and the iframe's 60s `usePolling` → `/api/attendance`.
**Caveat found in review:** the page's never-idle-stop branch keys on
sig/ts/nonce URL params (`isSignedKiosk`), which the proxied wrapper never
passes — on the Pi the poll idle-stops after 10 input-less minutes, and a
kiosk browser gets no user input. Prerequisite for this rung: exempt the
kiosk display from idle-stop (key on `mode=kiosk` or the `signedRequest`
response flag), or every quiet night reads as a wedged browser. With that
fixed: `last_browser_seen` = last local-browser request; silence > ~150s
(2.5× the poll) with Python healthy = wedged browser.

**Extend `kiosk.sh`, don't migrate to systemd now.** To bounce Chromium alone,
nest its launch in an inner loop guarded by a sentinel file that `client.py`
writes on wedge-detect; `os._exit(0)` still forces the full outer cycle.
systemd (with its watchdog) is *permitted* — the README's warning is about
XDG autostart — but the fleet is hand-provisioned and `kiosk.sh` ships to
every Pi for free via its own `git pull origin main`; units would mean
touching each Pi by hand. Right target once a provisioning image exists; the
migration doesn't pay for itself yet.

**Wifi bounce is gated to the local plane (L2/L3).** Bouncing on L4
(gateway+DNS fine, upstream down) is thrash that can lose association and
make it worse.

**Nightly reboot is curfew-safe and rolls updates.** The post-boot startup
calls (git pull hits GitHub; attendance/version checks are cookieless GETs)
cannot wake the service; schedule it in the closed window clear of
the 06:45 prewarm. The outbox rides through — SQLite WAL + `synchronous=FULL`
is reboot-safe, and the drain re-reads `pending` rows at startup (D4). Clears kernel/USB/wifi-firmware wedges nothing else fixes,
and pulls the latest client via `kiosk.sh`. Escalation reboot (ladder
exhausted, still red) is rate-limited to 1/hr against boot-loops.

### 3.3 Ship-first dead-path fixes (independent of everything else)

1. `version_poller`: `origin/master` → **`origin/main`** (self-update restart
   currently never fires).
2. `get_server_version`: `/api/kiosk/version` → **`/api/system-status/kiosk-version`**
   — the merged, public, DB-free route already consumed by `SystemHealthPanels`.
   (Rejected: resurrecting the unmerged `feature/kiosk-auto-reboot` duplicate.)
3. `config.example.json` + the `kiosk_path` default in `client.py`:
   `/kioskdisplay?mode=kiosk` → **`/attendance/current?mode=kiosk`** (the
   committed example 404s on a fresh Pi).

### 3.4 Heartbeat — designed around the curfew + auto-pause trap

**The trap:** a heartbeat that is non-GET or cookie-bearing wakes the curfewed
service all night; one that writes the DB every N seconds keeps Aurora from
ever pausing. Both are money leaks.

**Liveness is free — reuse traffic the kiosk already sends.** `withKiosk`
verifies a signature on every kiosk request (scans and the Python
`attendance_poller`'s 30s signed poll — the browser's 60s poll idle-stops,
§3.2). Stamp an **in-memory** `lastSeenByKiosk` on every verified request:
zero new requests (cannot wake), zero DB writes (cannot pin). A new admin
`GET /api/system-status/kiosk-heartbeat` reads it into a "Kiosk last seen Xm
ago" panel on `SystemHealthPanels`. Only a verified kiosk signature updates
it (no anonymous forgery); the per-IP rate limit already caps it. Overnight
the value dies with the scaled-to-zero task and the panel correctly reads
stale-during-curfew — expected, not an alert. Single-task assumption is the
same one the nonce Map already makes; `ponytail:` multi-task needs the DB.

**Richer self-diagnosis (optional, default off):** a slow-cadence signed
cookieless GET carrying `X-Kiosk-State` (which layer is red, last-scan age);
downshifts to silent when the probe sees warming-503 and resumes on 200 —
and stays silent through the closed window (any sub-5-min cadence defers the
soft curfew's quiet check; see §3.1).

**Persistence only on state transition, only if alerting is wanted:** on
online↔offline edges write one `SystemMetricLog` row (`metric="kiosk_online"`)
— O(transitions) writes, Aurora still pauses. Default: no DB writes; add
write-on-change as the gated upgrade that active alerting (email via the
existing `sendEmail` path from a cron) would require.

### 3.5 Waker-aware display

On `503` / non-JSON / `Retry-After` from the backend, the proxy and
`post_scan` treat the response as **warming**: push an SSE warning banner
("Server waking (~1 min)…", the existing `banner-warning` style) instead of
red failure, then probe cookieless `/api/health` every ~5s (the holding
page's own refresh cadence) until 200 — the scan's own POST already issued
the wake; the probe just notices recovery fast. On flip to 200: clear banner,
push `{reload:true}`. The queue (§2) owns re-sending the scan itself.
**Warming has a clock**: past ~10 min (double the worst-case cold wake) stop
calling it warming — flip to the red failure banner and flag the heartbeat.
Without the cap, a never-healthy task or crash-looping deploy (the ALB demotes
to the waker page, which looks exactly like warming) reads as "waking (~1
min)" forever.

### 3.6 Wedged-display detection

`last_attendance_ok` = timestamp of the last successfully proxied
`/api/attendance` 200 (requires the §3.2 idle-stop exemption first — without
it the poll legitimately stops after 10 quiet minutes). Stale > ~180s (3× the
poll) while L2–L5 are green =
the iframe is wedged (JS crash, dead EventSource, hung renderer) → rung 0
reload; still stale → rung 1 Chromium bounce. The proxy sees all traffic, so
this needs no cooperation from the page.

### Rejected alternatives (tombstones)

- **Dedicated POST heartbeat** — non-GET wakes the service; defeats the curfew
  all night.
- **Heartbeat writing the DB per beat** — pins Aurora; the 5-min pause never
  arrives.
- **Anonymous (or steady signed) DB probe** — the exact abuse the
  `/api/health/db` session gate exists to prevent; even signed, a steady poll
  pins. On-demand only.
- **systemd migration now** — allowed but doesn't pay for itself on a
  hand-provisioned fleet; deferred to a provisioning image.
- **Resurrecting `feature/kiosk-auto-reboot`'s endpoint** — duplicates the
  merged, panel-backed `/api/system-status/kiosk-version`.
- **Wifi bounce on any backend failure** — upstream faults would thrash the
  radio; gated to the local plane (L2 gateway-unreachable / L3 DNS).
- **CloudWatch custom heartbeat metric** — extra plumbing for what the
  in-memory stamp + panel already show during open hours; deferred to
  overnight-alerting, if ever wanted.

## 4. Phased delivery

- **Phase 0 — the three dead-path fixes (§3.3).** Lines of config/paths;
  resurrects self-update and version-reload. Ship first, alone.
- **Phase 1 — scan durability (kills the guaranteed-lost cold-wake scan).**
  Schema delta + extended `/api/scan` (§2 contract); client: `clientEventId` +
  `scannedAt`, status/content-type branching, SQLite outbox, single replay
  thread with waker-aligned backoff + dead-letter states (D6), blue "Saved"
  banner; waker-aware warming
  banner + fast recovery probe (§3.5).
- **Phase 2 — health + visibility.** `health_monitor` state machine, recovery
  ladder (Chromium bounce, gated wifi bounce, nightly + escalation reboot),
  its two prerequisites — the kiosk-display idle-stop exemption (§3.2) and
  the closed-window quieting of all steady kiosk traffic incl. the existing
  `attendance_poller` (§3.1) —
  scanner re-grab, in-memory heartbeat + system-status panel,
  `system-status/unsynced-scans` review page + the kiosk "⚠ N need review"
  corner count (D7).
- **Phase 3 — only if measured.** `POST /api/scan/batch` for hours-long
  backlogs vs the shared 300/min limit; write-on-change persistence + email
  alerting; systemd, when a provisioning image exists.

## 5. Open questions (for Jeff)

1. **Freshness window W** — default 10 min. Is a same-day late-landing
   check-in ever wanted past W, or is anything older always human review?
2. **Queued keyholder scan** — if a keyholder's opening scan is stuck in the
   outbox, the server thinks the facility is closed while it's physically
   open (non-keyholder live scans rejected). Accept, or add a kiosk-local
   "facility open" override during outages? (Policy call.)
3. **Parked-event resolution** — who resolves (sysadmin only, or any
   keyholder)? Does resolving write the Visit at `scannedAt` or at resolution
   time?
4. **Multi-kiosk within-window conflicts** — recommendation: newest
   `scannedAt` wins, older late arrivals park for review (the D3 out-of-order
   guard). Acceptable for keyholder/safety counts?
5. **Alerting** — passive panel only, or email someone when a kiosk goes
   offline during open hours (needs write-on-change persistence)? Proposed
   default: panel only.
6. **Open-hours source** — is there a canonical one, or hard-code the closed
   window (≈23:00–07:00 CT, mirroring the curfew) for reboot scheduling, the
   drain's overnight sleep, health-poll silence, and heartbeat downshift?
7. **Escalation reboot during open hours** — acceptable to auto-reboot a
   wedged kiosk mid-session (~2 min loss) once the ladder is exhausted?
8. **Fleet size** — multi-key `KIOSK_PUBLIC_KEY` today is rotation, not
   identity. If more than one kiosk exists (or will), the heartbeat needs a
   `kiosk_id` and last-seen moves to the DB. How many kiosks?
