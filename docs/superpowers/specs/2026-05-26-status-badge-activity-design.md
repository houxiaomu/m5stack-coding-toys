# Status Badge Activity Redesign

Date: 2026-05-26

## Goal

Replace the firmware top-right status badge — which today is a pseudo-status that
reads `WORKING` almost permanently — with a badge that reflects **what Claude is
doing right now**, so a glance at the desk device answers: "should I go back to the
screen?"

The badge changes only in the corner (color + animation tempo); it does not take
over the screen and does not interrupt the data pages.

## Current Behavior (and why it is wrong)

`renderHeader()` in `firmware/lib/m5render/pages.cpp` hardcodes exactly two badge
values:

- `WORKING` (default)
- `CTX HIGH` when `hasContext && (exceeds200k || ctxUsedPct >= 80)`

The badge only renders while the device is `Live` (an active session showing data
pages). The host (`SessionAggregator`) sends `state:'active'` on every Claude Code
statusLine tick and a single `state:'idle'` when the CC process exits. Result:

- The badge is `WORKING` whenever a session is live and context is under 80%.
- It is a **context-pressure indicator wearing an activity label**. It cannot tell
  whether Claude is generating, waiting for the user, or blocked on a permission
  prompt — all three render identically as `WORKING`.

The only signal the daemon receives today is the statusLine command (one NDJSON
frame over a UNIX socket per CC status-line render). That signal has no
prompt/tool lifecycle granularity, so real activity state is impossible to derive
from it.

## Product Direction

### Activity state model

Three states, driven by Claude Code **hook events** (a new ingestion channel):

| activity           | CC hook trigger     | color (palette)   | animation        | meaning                         |
|--------------------|---------------------|-------------------|------------------|---------------------------------|
| `working`          | `UserPromptSubmit`  | `color::good` (green)  | slow breathe ~2s | busy, do not disturb            |
| `awaiting_input`   | `Stop`              | `color::accent` (orange) | gentle pulse ~1s | finished its turn, your move    |
| `needs_attention`  | `Notification`      | `color::warn` (red)    | fast blink ~0.4s | blocked (permission), come back |

Visual grammar: **green and moving = relax; color shifts and slows/​quickens =
look; red fast-blink = go now.** Animation tempo encodes urgency. All three colors
already exist in the palette (`firmware/lib/m5render/canvas.h`) — no new colors.

`awaiting_input` is distinct from `needs_attention` because the urgency differs:
`Stop` means Claude voluntarily ended its turn (work is not stalled), while
`Notification` (permission request) means Claude is blocked and burning wall-clock
until the user acts. The latter deserves the loudest treatment.

Default activity for a session before any hook arrives is `working`.

### CTX HIGH relocation

The badge no longer shows `CTX HIGH`. Context-pressure warning is orthogonal to
activity, so it moves to the existing context display on the data pages: when
`ctxUsedPct >= 80 || exceeds200k`, the context percentage/micro-bar renders in
`color::warn`. The two dimensions then never mask each other.

### Out of scope (YAGNI)

- Buzzer / vibration alerts (HAL has only a no-op `vibrate()`, hardware support is
  unconfirmed).
- Tool-level granularity (which tool is running). Three states only.
- Full-screen takeover for alerts. Corner badge only.
- Distinguishing `Notification` sub-reasons (permission vs idle). Both → `needs_attention`.

## Architecture (Approach A: new hooks channel)

Five small changes across the stack. The numeric/string data the badge needs is
NOT sent by the host as a word; the host sends a structured `activity` enum and the
firmware owns the visual mapping.

### 1. Protocol (`packages/protocol`)

Add an optional `activity` field to the status payload:

```
activity?: 'working' | 'awaiting_input' | 'needs_attention'
```

It is orthogonal to the existing `state: 'active' | 'idle'` (session liveness).
Additive only; no existing field changes. Add to `messages-host.ts` schema and the
generated message types; cover with a schema test. Run `gen:msgs` if the generated
sources require regeneration.

### 2. statusline-shim (`packages/statusline-shim`)

Add an `--event <Name>` mode. When invoked as
`m5ct-statusline --event UserPromptSubmit|Stop|Notification`:

- Read the hook JSON from stdin (CC passes the hook payload on stdin).
- Send one NDJSON line to the daemon socket: `{ event: '<Name>', sessionId? }`.
- Do NOT print a status-line string (hooks have no stdout contract for the badge).
- Keep the same fire-and-forget connect + short timeout + `ensureDaemon()` behavior
  the statusLine path already uses.

### 3. Daemon (`packages/daemon`)

- `hook-server.ts`: add an `{ event }` branch in `process()` alongside the existing
  `{ statusLine }` and `{ op }` branches, dispatching to a new activity handler.
- `main.ts`: register the activity handler, wiring it to the aggregator.
- `session-aggregator.ts`: hold `currentActivity` state.
  - `UserPromptSubmit` → `working`; `Stop` → `awaiting_input`;
    `Notification` → `needs_attention`.
  - On a hook event, **immediately push a status frame** (do not wait for the next
    statusLine tick) so the badge updates promptly.
  - Every outgoing status frame — whether triggered by a statusLine tick or a hook
    — is stamped with `currentActivity`.
  - **Re-send the last known full status frame** on a hook push (reuse cached
    payload, change only `activity`). This preserves the firmware's "missing group
    = clear" parse semantics so a hook-triggered frame never blanks the data tiles
    to `—`.
  - Default `currentActivity = 'working'` at session start; reset on `idle`.

### 4. install / uninstall (`packages/cli`)

- `install.ts`: in addition to the `statusLine` patch, write three CC hooks into
  `~/.claude/settings.json` `hooks`: `UserPromptSubmit`, `Stop`, `Notification`,
  each running `m5ct-statusline --event <Name>`. Back up and chain/preserve any
  user-existing hooks (mirror the existing statusLine backup + chain logic, adapted
  to the `hooks` object-of-arrays shape).
- `uninstall.ts`: symmetrically remove only the hooks this tool added, restoring
  prior entries.

### 5. Firmware (`firmware/lib/m5render`)

- `status_model.h` / `status_model.cpp`: add an `Activity` enum and
  `activity` field to `StatusModel`; parse the `activity` string in
  `parseStatusFrame` (default `working` when absent).
- `pages.cpp` `renderHeader()`: choose badge color + animation phase from
  `m.activity`. Remove the `WORKING` / `CTX HIGH` literals and the `ctxWarn`
  badge logic. The badge label text and color derive from `activity`.
- Context warning relocates to wherever the context metric is drawn on the data
  pages (warn color when `ctxUsedPct >= 80 || exceeds200k`).
- Animation loop: `app.cpp` `tick()` already runs each loop iteration and renders
  only when `dirty_`. Add an animation timer: while `Live` and the current activity
  animates, set `dirty_` on the animation cadence and advance a phase counter;
  `renderHeader` uses the phase to compute badge brightness/visibility. To bound
  cost, prefer redrawing only the header region (add a Canvas partial-flush path if
  needed); breathing runs at a modest frame rate (~8–12 fps), the blink is a cheap
  ~2 Hz on/off toggle. If partial flush proves infeasible, fall back to low-fps
  full redraw.

## Data Flow

```
CC hook fires (UserPromptSubmit/Stop/Notification)
  → m5ct-statusline --event <Name>  (reads hook JSON on stdin)
  → UNIX socket: { event: '<Name>' }
  → daemon HookServer.process → activity handler
  → SessionAggregator.currentActivity updated
  → push full cached status frame stamped with new activity
  → device: status frame parsed → StatusModel.activity
  → renderHeader picks color + animation → badge
```

Normal statusLine ticks continue unchanged, each stamped with the current
activity.

## Testing Strategy (TDD)

- **protocol**: schema test accepts the three `activity` values and rejects junk;
  `state` and `activity` coexist.
- **statusline-shim**: `--event` mode emits `{ event }` to the socket and prints no
  status string; statusLine mode unchanged.
- **daemon**: each hook event sets the expected activity and triggers an immediate
  push; hook-triggered frames carry the full last-known payload (tiles not blanked);
  statusLine frames are stamped with current activity; `idle` resets to `working`.
- **cli install/uninstall**: install adds the three hooks and chains existing ones;
  uninstall removes only what it added.
- **firmware (Unity native)**: `parseStatusFrame` maps each `activity` string (and
  default); `renderHeader` selects the correct color per activity and no longer
  emits `WORKING`/`CTX HIGH`; context warning renders warn color on the data page
  when over threshold.

## Open Questions

None. All product decisions are settled (3 states, two urgency tiers via animation
tempo, corner-only, CTX HIGH relocated, no physical alerts).
