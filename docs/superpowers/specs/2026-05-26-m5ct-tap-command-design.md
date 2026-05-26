# m5ct 坐标点击命令 - 设计文档

- 日期: 2026-05-26
- 状态: 已批准，待实现
- 分支建议: `feat/m5ct-tap-command`
- 关联记忆: [[project-m5stack-coding-toys]]、[[m5stack-cores3-bring-up]]

## 1. 目标与动机

新增一个 `m5ct` CLI 子命令，让主机可以向已连接的 M5Stack 设备发送一次屏幕坐标点击，用于调试固件 UI、写自动化验收脚本，以及远程操作设备当前页面。

用户已确认的命令语义:

```text
m5ct tap <x> <y> [--duration <ms>]
```

第一版聚焦真实屏幕坐标点击:

1. `x`、`y` 是屏幕像素坐标，左上角为 `(0, 0)`。
2. `--duration` 表示按下时长，单位毫秒，默认 `50`。
3. CLI 必须复用正在运行的 daemon，不能直接抢串口。
4. 命令需要返回设备是否接受本次点击，而不是只做 fire-and-forget。

## 2. 关键架构事实

调研既有代码得到的事实:

- CLI 与 daemon 已有 UNIX socket 控制通道。`packages/cli/src/control-client.ts` 的 `callOnce()` 向 `~/.m5stack-coding-toys/daemon.sock` 发送单行 JSON；daemon 侧 `HookServer` 按 `op` 分发控制操作。`tap` 应作为一个新的 control op。
- daemon 与设备已有带 `id` 的 RPC。`DeviceSession.request()` 会发送 host kind、等待同 `id` 的 device kind 响应，并把超时标记为 `ETIMEDOUT`。`tap` 应复用该 RPC 模式，和当前 `screenshot` 一致。
- 协议 kind 列表集中在 `packages/protocol/src/kinds.ts`，payload schema 在 `messages-host.ts` / `messages-device.ts`。新增 kind 后需要更新 registry，并重跑 `pnpm gen:msgs` 生成 `firmware/lib/m5proto/messages.h`。
- CoreS3 SE 已声明 `touch` capability。物理触摸入口在 `firmware/boards/cores3_se/input_touch.cpp`，目前将触摸坐标压缩成 `TouchTap` 事件的区域 `code`。
- 固件 app 当前只消费 `TouchTap` 来翻页。`App::pollInput()` 在 Live 状态收到触摸点击后切到下一页。第一版模拟点击应走同一条 app 行为路径，而不是新增一套并行的页面控制逻辑。
- `m5hal::InputEvent` 目前没有 `x/y/duration` 字段，只有 `kind/code/t_ms`。为了保持变更小，第一版不把 HAL 输入事件模型扩成完整 press/release 坐标流。

## 3. 选定方案

采用协议级 RPC:

```text
m5ct tap 160 120 --duration 120
  -> daemon control op {op:"tap", x:160, y:120, duration_ms:120}
  -> device RPC {k:"tap", p:{x:160, y:120, duration_ms:120}}
  <- {k:"tap.ack", p:{ok:true}}
```

这个方案的优点:

- 和现有 `m5ct screenshot` 的 CLI -> daemon -> device 形态一致。
- CLI 能准确报告无设备、设备超时、不支持触摸、坐标越界等错误。
- 后续如果需要自动化多步 UI 操作，可以在相同控制通道上继续扩展。

放弃的方案:

- 只在 daemon 本地伪造输入事件: 不能真实点击设备屏幕，不满足目标。
- CLI 直接向串口发送调试命令: 会绕过 daemon/session 管理，和现有命令体系不一致，且容易和运行中的 daemon 抢串口。

## 4. 命令与用户体验

CLI 命令:

```text
m5ct tap <x> <y> [--duration <ms>]
```

解析规则:

- `x`、`y` 必须存在，且必须是非负整数。
- `--duration <ms>` 可选，默认 `50`。
- `duration_ms` 允许范围为 `1..5000`。范围足够覆盖短按和人工长按，同时避免误传超长等待。
- 第一版不支持 `--region`、多点触控、拖拽、滑动或独立 `down/up` 命令。

输出规则:

成功:

```text
Tapped: x=160 y=120 duration=120ms
```

失败:

```text
m5ct tap: no_device
m5ct tap: device_timeout
m5ct tap: touch_unsupported
m5ct tap: out_of_bounds
m5ct tap: <unexpected error>
```

退出码:

- `0`: 设备确认点击成功。
- `1`: daemon/device 层失败，或设备拒绝点击。
- `2`: CLI 参数错误，例如缺少坐标、坐标不是整数、`--duration` 缺值。

## 5. 数据流

```text
m5ct tap <x> <y> [--duration <ms>]
  |
  | callOnce(daemon.sock, {op:"tap", x, y, duration_ms})
  v
HookServer.dispatchOp("tap")
  |
  v
ControlHandler.tap(x, y, duration_ms)
  |
  | DeviceSession.request({k:"tap", p:{x, y, duration_ms}}, 3000)
  v
App::handleLine(kind=="tap")
  |
  | validate touch/display support and bounds
  | invoke app touch behavior for the supplied coordinate
  v
tap.ack {ok:true} or {ok:false, err}
  |
  v
daemon maps ack to {ok:true} or {error}
  |
  v
CLI prints result and exits
```

## 6. Module Design

### 6.1 Protocol

Files:

- `packages/protocol/src/kinds.ts`
- `packages/protocol/src/messages-host.ts`
- `packages/protocol/src/messages-device.ts`
- `packages/protocol/src/registry.ts`

Add host kind:

```ts
'tap'
```

Add device kind:

```ts
'tap.ack'
```

Host payload:

```ts
export const tapPayload = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    duration_ms: z.number().int().min(1).max(5000).default(50),
  })
  .strict()
```

Device payload:

```ts
export const tapAckPayload = z
  .object({
    ok: z.boolean(),
    err: z.string().optional(),
  })
  .strict()
```

`tap.ack` uses `ok:false, err:"..."` for expected device rejections. The protocol schema stays permissive about the exact error vocabulary; daemon and CLI simply surface it.

After changing protocol kinds, run:

```text
pnpm gen:msgs
```

### 6.2 CLI

Files:

- `packages/cli/src/main.ts`
- new `packages/cli/src/cmd-tap.ts`
- new `packages/cli/src/cmd-tap.test.ts`

`listCommands()` gains `tap`; the command dispatch calls `runTap(rest, io)`.

`runTap()` responsibilities:

- Parse exactly two positional arguments, `x` and `y`.
- Parse optional `--duration <ms>`.
- Reject unknown options and extra positional args.
- Validate integer/range constraints locally before calling daemon.
- Send `{op:"tap", x, y, duration_ms}` through `callOnce()`.
- Print success or error in the format defined above.

The implementation should mirror `cmd-screenshot.ts`: dependency-inject the call function in tests, use `defaultSocket()` by default, and avoid starting or stopping the daemon.

### 6.3 Daemon Control

Files:

- `packages/daemon/src/control-ops.ts`
- `packages/daemon/src/hook-server.ts`
- `packages/daemon/src/control-ops.test.ts`

Add to `ControlHandler`:

```ts
tap(x: number, y: number, durationMs: number):
  Promise<{ ok: true } | { error: string }>
```

`makeControlHandler().tap()`:

1. Get `dm.currentSession()`.
2. If no session, return `{error:"no_device"}`.
3. Send `sess.request({k:"tap", p:{x, y, duration_ms: durationMs}}, 3000)`.
4. Map `ETIMEDOUT` to `{error:"device_timeout"}`.
5. If ack payload has `ok:true`, return `{ok:true}`.
6. Otherwise return `{error: p.err ?? "tap_failed"}`.

`HookServer` dispatches `op:"tap"` by reading numeric `x`, `y`, and `duration_ms`. Invalid or missing fields return `{error:"bad_request"}` rather than throwing.

The daemon performs basic request-shape validation for socket callers, but screen bounds validation remains device-side because the connected board owns the display dimensions.

### 6.4 Firmware

Files:

- `firmware/lib/m5render/app.h`
- `firmware/lib/m5render/app.cpp`
- `firmware/lib/m5proto/codec.h`
- `firmware/lib/mock_hal/mock_canvas.h` or existing mock test helpers, as needed
- generated `firmware/lib/m5proto/messages.h`

Firmware receives `tap` in `App::handleLine`.

Validation:

- If no board, display, or touch-capable input exists, reply `touch_unsupported`.
- If `x < 0`, `y < 0`, `x >= display.width()`, or `y >= display.height()`, reply `out_of_bounds`.
- If payload fields are missing or not numeric, reply `bad_request`.

Behavior:

- Convert the coordinate into the same app-level touch behavior used by physical touch.
- Current app behavior is page advance while `link_ == Live`.
- To avoid duplicating behavior, extract the shared logic into a small method such as:

```cpp
void App::handleTouchTapAction(uint32_t t_ms);
```

`pollInput()` calls this method after physical touch polling. The `tap` RPC branch validates `x/y`, then calls the same method. If the app is not Live, the method leaves page state unchanged, matching physical touch behavior.

The first implementation does not need to store the RPC coordinate in `InputEvent`, because the current UI action does not depend on exact touch position. The coordinate is still validated against display bounds so future UI code can safely start using real positions without changing the CLI contract.

`duration_ms` is accepted and validated by the protocol, but first-version app behavior remains tap-based. The firmware does not delay for the full duration and does not synthesize separate down/up events. The field is reserved for future UI behavior that distinguishes long press from short press.

Ack encoding:

- Add an encoder for `tap.ack` consistent with existing firmware message helpers.
- Successful tap sends `{ok:true}` with the original RPC id.
- Expected failure sends `{ok:false,"err":"..."}` with the original RPC id.

### 6.5 Fake Firmware

File:

- `tools/fake-firmware/src/main.ts`

Add a `tap` handler that replies with `tap.ack`.

The fake should return `ok:true` for normal non-negative coordinates and `ok:false, err:"out_of_bounds"` for obviously invalid test cases if existing tests need that path. It does not need to simulate page state.

## 7. Error Handling

Canonical errors:

- `no_device`: daemon has no current device session.
- `device_timeout`: device did not answer the RPC in time.
- `bad_request`: caller sent malformed daemon op or malformed device payload.
- `touch_unsupported`: connected board cannot accept touch simulation.
- `out_of_bounds`: coordinate is outside the device display.
- `tap_failed`: fallback when the device rejects the tap without a specific reason.

CLI should display daemon/device error strings directly. This keeps troubleshooting transparent and matches the existing `screenshot` command style.

## 8. Testing

Protocol tests:

- `tapPayload` accepts valid `x/y/duration_ms`.
- `tapPayload` defaults `duration_ms` to `50` when omitted.
- `tapPayload` rejects negative coordinates, fractional coordinates, zero duration, and duration above `5000`.
- `tapAckPayload` accepts `ok:true` and `ok:false` with `err`.

CLI tests:

- `m5ct tap 160 120` sends `{op:"tap", x:160, y:120, duration_ms:50}`.
- `m5ct tap 160 120 --duration 120` sends duration `120`.
- Missing args, non-integer args, negative args, missing duration value, and unknown options return code `2`.
- Successful daemon result prints `Tapped: ...` and returns `0`.
- Daemon error prints `m5ct tap: <error>` and returns `1`.

Daemon tests:

- No current session returns `no_device`.
- Successful `tap.ack` returns `{ok:true}`.
- Timeout maps to `device_timeout`.
- `ok:false, err:"out_of_bounds"` is surfaced.
- HookServer `op:"tap"` dispatches with numeric fields and rejects malformed fields as `bad_request`.

Firmware native tests:

- `tap` request sends `tap.ack` with matching id.
- In Live state, valid tap advances the page exactly as physical touch does.
- In Linked/NoLink state, valid tap does not advance the page but still acknowledges success.
- Out-of-bounds coordinate returns `out_of_bounds`.
- Missing touch/display support returns `touch_unsupported`.

## 9. Non-Goals

- No swipe, drag, pinch, or multi-touch.
- No region aliases such as `top` or `bottom`.
- No separate `touchdown` / `touchup` commands.
- No direct serial-port mode from CLI.
- No daemon startup or daemon lifecycle management.
- No automatic screenshot comparison or UI assertion language.

## 10. Open Decisions Closed

- Coordinates are real screen pixels, not abstract regions.
- `--duration` is part of the CLI and protocol from the start.
- First implementation confirms accepted taps with `tap.ack`.
- First implementation does not block firmware execution for `duration_ms`; it preserves the value as a future-compatible semantic field.
