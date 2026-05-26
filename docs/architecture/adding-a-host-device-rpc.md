# Adding a host→device RPC / m5ct command

Adding a new host→device RPC (e.g. a new `m5ct <cmd>`) touches 7 layers. **Fastest path: copy the newest existing RPC command verbatim** — `tap` and `screenshot` are complete, working templates; clone whichever is closest and rename. Don't reinvent the flow.

The 7 layers (a host→device request + a `*.ack` reply, both carrying a matching `id`):

1. **`packages/protocol/src/kinds.ts`** — add the kind to `HOST_KINDS` and `<kind>.ack` to `DEVICE_KINDS`.
2. **`packages/protocol/src/messages-host.ts` + `messages-device.ts`** — zod `<kind>Payload` (`.strict()`) and `<kind>AckPayload` (`{ ok, err? }`).
3. **`packages/protocol/src/registry.ts`** — add both to `PAYLOAD_SCHEMAS`. The `satisfies Record<Kind, ...>` forces you to add both or typecheck fails (good guardrail).
4. **`pnpm gen:msgs`** — regenerates `firmware/lib/m5proto/messages.h`. **EASY TO MISS**; CI's `pnpm gen:msgs:check` blocks if you skip it. Build protocol first (`pnpm --filter @m5stack-coding-toys/protocol build`).
5. **daemon** — `control-ops.ts`: add the op to `ControlHandler`, implement via `sess.request({k,p}, timeoutMs)` (catch `ETIMEDOUT` → `device_timeout`), copy the `tap` impl. `hook-server.ts`: add a `case` in the `dispatchOp` switch + arg validation (`finiteNumber`).
6. **cli** — new `cmd-<x>.ts` (copy `cmd-tap.ts`, post `{op, ...}` via `callOnce` / `defaultSocket`); wire into `main.ts` (`listCommands()` array + `switch` case). `main.test.ts` asserts the exact command list — update it.
7. **firmware + fake-firmware** — `tools/fake-firmware/src/main.ts`: add `if (env.k === '<kind>') send <kind>.ack` so daemon/e2e tests work without hardware. `firmware/lib/m5render/app.cpp`: handle the kind, reply via `encode_<kind>_ack` (add it to `firmware/lib/m5proto/codec.h`, copy `encode_tap_ack`). Add `firmware/test/test_app` native cases.

## Verify

```
pnpm gen:msgs:check && pnpm typecheck && pnpm test && pnpm lint
```

(The project uses biome — a `style: format` commit usually follows.) Then `pio test -e native` for firmware. E2e through fake-firmware needs no real device; the real-device check uses the flashing rules in the `m5stack-cores3-bring-up` skill.

## Caveat: capability ≠ hardware

Surfaced while planning a hypothetical `buzz`: declaring a cap (e.g. `haptic`) doesn't mean the hardware has it — `Power::vibrate()` is an empty default and CoreS3 SE has no motor. If an ack means "did it physically happen", gate on a real capability check, don't just return `ok`.
