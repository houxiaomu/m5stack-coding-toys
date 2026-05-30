# Status display architecture

m5ct is a **pure Claude Code status display** (the earlier approve/deny + Cardputer keyboard-prompt scope was dropped — "info too scattered").

Data enters via Claude Code's **`statusLine`** (not hooks): the `m5ct-statusline` shim (`packages/statusline-shim`) forwards CC's JSON → daemon `SessionAggregator` (maps native CC fields + git enrichment + in-memory burnHistory/today) → daemon pushes ONE consolidated `status` frame to the device. When multiple sessions are live, the device owns selection through a Sessions picker; hook activity for other sessions updates the picker rows without interrupting the current detail view. Protocol kinds are minimal: `hello`/`status`/`notify`/`ping` plus the RPC pairs (`screenshot`, `tap`) — see [adding-a-host-device-rpc.md](adding-a-host-device-rpc.md).

Firmware is device-agnostic in 3 layers: a `StatusModel` + `Canvas` interface + pages (Overview/Cost/Limits/Workspace/Sessions/Waiting), with a per-device `CoreS3Canvas` (M5GFX off-screen sprite double-buffer) and an `App` loop (touch paging). In multi-session mode, the detail pages cycle back to Sessions after Workspace, and tapping a detail-page header returns to Sessions immediately.

## Liveness: three decoupled concerns

This fixed the "device flaps back to Waiting while a session is idle-but-alive" bug — the old design wrongly used a 10s status-frame silence as a proxy for "session ended".

1. **Link liveness** — ANY decoded frame (incl. the 5s `ping`) refreshes `lastRxMs_`; >15s silence → device shows NoLink.
2. **Session liveness** — daemon resolves the Claude Code PID (statusline-shim `ccpid.ts` walks the process tree `node→sh→claude`, nearest `claude` ancestor) and probes `kill(pid,0)` every 5s via `SessionAggregator.checkLiveness()`; on PID death sends ONE `state:'idle'` frame; 10-min TTL fallback when no PID.
3. **Content** — statusLine ticks just update the display.

Device `App` is a 3-state machine **NoLink / Linked / Live**. Protocol `STATES = ['active','idle']`. The activity badge (working / awaiting_input / needs_attention) is orthogonal, driven by CC hook events.

See also: [firmware-hardware-gotchas.md](firmware-hardware-gotchas.md) for the frame-size / serial caveats.
