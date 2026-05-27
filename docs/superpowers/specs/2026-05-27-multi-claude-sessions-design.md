# Multi Claude Sessions Design

Date: 2026-05-27

## Goal

Support multiple live Claude Code sessions on one M5 device without turning the
device into a full session-management app.

The product role becomes: **a Claude sessions attention router**. The device
normally shows the session that matters most, but the user can explicitly choose
and lock focus to another live session.

## Current Behavior

The current stack has a single foreground Claude session:

- `m5ct-statusline` receives one Claude Code `statusLine` JSON payload per render
  and forwards it to the daemon.
- The payload already includes `session_id`, workspace, worktree, model, context,
  cost, and rate-limit fields when Claude provides them.
- Hook events (`UserPromptSubmit`, `Stop`, `Notification`) can also carry
  `sessionId`.
- `HookServer` currently forwards statusLine metadata, but hook events are wired
  only as global activity events.
- `SessionAggregator` stores one `lastFrame`, one `currentActivity`, one `ccPid`,
  one cost/burn history baseline, and one foreground status payload.
- Firmware receives one `status` payload and renders one set of detail pages:
  Overview, Cost, Limits, and Workspace.

The data source is mostly sufficient for multi-session support. The current host
state model is not: it needs to become a registry of live sessions plus a
foreground-selection policy.

## Product Model

### Live sessions only

The device only tracks live Claude Code sessions. A session is live while its
Claude process is alive. When the process exits, the session disappears from the
picker immediately.

If no live sessions remain, the device returns to the existing linked waiting
screen: connected, waiting for Claude.

If the pinned session exits while other sessions remain, the device opens the
session picker so the user can choose `AUTO` or another live session.

### Focus modes

There are two foreground modes.

#### AUTO

`AUTO` is the default mode. It means "let m5ct pick the foreground session."

Auto is intentionally stable:

1. If any live session is `needs_attention`, foreground the earliest-created
   `needs_attention` session.
2. Otherwise, if the current foreground session is still live, keep showing it.
3. Otherwise, choose a live session by stable creation order.

`awaiting_input` is displayed as an activity label but does not steal foreground
from a still-live current foreground session. This avoids a screen that constantly
jumps among sessions.

#### PINNED

`PINNED` means the user explicitly selected a live session from the picker.

Pinned mode is a hard lock:

- The device does not automatically switch away from the pinned session.
- Other sessions entering `needs_attention` do not take over the detail pages.
- Those other attention states are visible in the picker list.
- The user exits pinned mode by selecting `AUTO` in the picker or by selecting a
  different session.

## Device Interaction

### When the picker exists

The session picker exists only when there are at least two live sessions.

With one live session, the device behaves like it does today: tap cycles the
existing detail pages, and no Auto/Pinned complexity is shown.

With two or more live sessions, the picker joins the page cycle:

```
Overview -> Cost -> Limits -> Workspace -> Sessions -> Overview
```

The device does not automatically jump to the picker when a second session
appears. The page is discoverable through the normal tap cycle.

### Picker contents

The picker list is stable and navigational, not a dashboard.

Rows:

1. `AUTO` is always the first row.
2. Live sessions follow in creation/discovery order.

Session naming:

- Primary name: `worktree.name` when present.
- Fallback: repository/workspace basename.
- Final fallback: short session id.

Each session row shows:

- primary name
- activity label: `WORKING`, `YOUR TURN`, or `NEEDS YOU`
- current foreground/pinned marker by highlight or compact symbol

The picker does not show cost. Cost belongs on the Cost detail page.

Selecting `AUTO` or a session immediately returns to Overview for the resulting
foreground session.

### Picker input

The current HAL exposes coarse input events, not full touch coordinates. On
CoreS3 today, touch is encoded as a top-half or bottom-half tap. The MVP picker
therefore uses a two-action model instead of arbitrary row tapping:

- top-half tap: move the highlighted picker row to the next row, wrapping at
  the end
- bottom-half tap: commit the highlighted row

Committing `AUTO` switches to Auto mode. Committing a session switches to Pinned
mode for that session. After commit, firmware returns to Overview.

This keeps normal detail-page tap behavior intact while avoiding a dependency on
precise touch coordinates.

### Header mode label

When there are two or more live sessions, detail-page headers show a compact
focus label:

- `AUTO · 2/4`
- `PINNED · 2/4`

The number is the foreground session's stable picker index among live sessions.
The label does not replace the activity badge. The activity badge remains
`WORKING`, `YOUR TURN`, or `NEEDS YOU`.

With one live session, this extra focus label is hidden to preserve today's
single-session experience.

## Data Semantics

Multi-session support must avoid mixing per-session and account-level numbers.

Per-session fields:

- model
- activity
- context usage
- session cost
- duration
- session line counts
- workspace/worktree
- git enrichment for that workspace
- process liveness
- burn history for that session

Account-level fields:

- 5-hour block usage
- weekly usage
- today total cost
- today total session count

Cost page labels should make the distinction explicit:

- `THIS SESSION`: foreground session cost, duration, and burn rate
- `TODAY TOTAL`: account/day total cost and today session count

Rate limits remain account-level because Claude reports them as account-level
limits, not per-session limits.

## Unknown or Ambiguous Events

Hook events without a recognized `sessionId` are ignored for session activity.

Wrongly assigning a hook event to the current foreground or most-recent session
would be worse than missing one activity update. A later statusLine tick from the
correct session can still refresh that session's data.

StatusLine frames without `session_id` are treated as an anonymous single live
session only if no better id exists for that process. The preferred identity is
always Claude's `session_id`.

## Host Architecture Direction

Replace the single `SessionAggregator` mental model with:

1. A session registry keyed by `session_id`.
2. Per-session state records:
   - latest mapped status payload
   - activity
   - Claude PID
   - firstSeen/lastSeen timestamps
   - last cost sample
   - burn history
   - workspace/git cache input
3. A foreground selector:
   - mode: `auto` or `pinned`
   - pinned session id
   - current foreground session id
   - stable creation-order list
4. A status payload builder that emits the selected session detail payload plus
   multi-session UI metadata.

The daemon still sends a single `status` frame to firmware. The selected
foreground session determines the detail fields in that frame.

## Protocol Direction

Extend the `status` payload additively. Existing firmware continues to degrade
gracefully if it ignores the new fields.

Add these optional fields:

```
focus?: {
  mode?: 'auto' | 'pinned'
  index?: number
  total?: number
}

sessions?: {
  index: number
  id: string
  name: string
  activity: 'working' | 'awaiting_input' | 'needs_attention'
  selected?: boolean
  pinned?: boolean
  auto?: boolean
}[]
```

The `sessions` list is only necessary when there are two or more live sessions.
`focus` is only displayed by firmware when `total >= 2`.

The existing top-level fields (`model`, `context`, `cost`, `workspace`, `git`,
etc.) continue to describe the foreground session.

Device-to-host focus changes use the existing `device.event` channel with an
additive event kind:

```
{ kind: 'focus', target: 'auto' }
{ kind: 'focus', target: 'session', sessionId: string }
```

The daemon handles these events by updating the foreground selector and pushing a
fresh status frame. Unknown or stale `sessionId` values are ignored.

## Firmware Direction

Firmware keeps the existing detail pages and adds one page:

- `Sessions`

`Sessions` is only included in the page cycle when the host sends a session list
with at least two live sessions. The page renders:

- first row: `AUTO`
- one row per live session
- stable row order
- activity label per row
- selected/pinned highlight
- local highlighted row for picker navigation

Tap behavior remains page-cycle oriented outside the Sessions page. On the
Sessions page, top-half tap moves the local highlight and bottom-half tap commits
the highlighted row by sending a `device.event` focus event, then returns to
Overview after the host acknowledges via the next status frame.

If the host sends a status frame indicating that the pinned session ended and a
session list still exists, firmware opens the Sessions page.

## CLI and Control Surface

Device control is enough for the first version. No CLI pin/auto command is
required.

`m5ct status --json` does not expose live session summaries in this version.

## Error Handling

- If the foreground session disappears in `AUTO`, choose the next live session by
  stable creation order; if no sessions remain, send idle/waiting.
- If the foreground session disappears in `PINNED`, clear the pin and surface the
  picker when other sessions remain.
- If no device is connected, registry updates continue in memory but no frames are
  sent.
- If git enrichment fails for one session, only that session's git group is
  omitted; other sessions are unaffected.
- If a hook event references a session that is not yet known, ignore it rather
  than creating a partial phantom session.

## Testing Strategy

Host tests:

- creates separate session records from distinct `session_id` statusLine frames
- keeps per-session activity, PID, burn history, and last frame separate
- Auto selects earliest `needs_attention`
- Auto keeps current foreground when no session needs attention
- Pinned mode ignores other sessions becoming `needs_attention`
- pinned session exit opens/requests picker when other sessions remain
- ended sessions disappear from the live list
- unknown-session hooks are ignored
- account-level today totals remain distinct from foreground session cost

Protocol tests:

- optional `focus` and `sessions` payloads validate
- `device.event` focus payloads validate
- old minimal `status` frames still validate
- invalid session activity/mode values reject

Firmware/native tests:

- parser accepts `focus` and `sessions`
- Sessions page is absent for zero/one live session
- Sessions page appears for two or more live sessions
- header shows `AUTO · i/n` or `PINNED · i/n` only when `n >= 2`
- top-half picker tap moves the highlighted row
- bottom-half picker tap sends a host focus event and returns to Overview after
  the next status frame

Integration tests:

- two simulated Claude sessions update independently and render the selected
  foreground session
- `Notification` for session B does not disturb pinned session A
- `AUTO` foregrounds earliest `needs_attention` session
- when all sessions exit, device returns to the linked waiting screen

## Out of Scope

- Historical session browser
- Per-session daily history after process exit
- Cost dashboard across live sessions
- CLI commands for pin/auto
- Workspace priority rules
- Automatic jump to picker when the second session appears
- Notification banners on detail pages while pinned
