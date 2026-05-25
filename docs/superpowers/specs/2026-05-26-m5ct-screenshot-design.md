# m5ct 主机触发截屏 — 设计文档

- 日期：2026-05-26
- 状态：已批准，待实现
- 分支建议：`feat/host-screenshot`
- 关联记忆：[[project-m5stack-coding-toys]]、[[m5stack-cores3-bring-up]]

## 1. 目标与动机

让用户在主机上敲一条命令，把 M5Stack 设备**屏幕上当前显示的那一帧**抓成 PNG，存到主机的 `~/.m5stack-coding-toys/` 目录下。主要用途：硬件验收取证、写文档配图、远程确认设备状态。

硬性约束（来自用户）：

1. **主机发起**：截屏由主机命令触发，不是设备端按键。
2. **存主机本地**：图片落到 `~/.m5stack-coding-toys/`，不是设备 SD 卡。
3. **daemon 不能断**：触发截屏绝不能重启 daemon 或抢占串口——必须复用正在运行的 daemon。
4. **入口形态**：`m5ct` CLI 子命令（已确认，非独立二进制）。

## 2. 关键架构事实（决定方案的前提）

调研既有代码得到的事实，是方案成立的基础：

- **CLI ↔ daemon 已有 IPC**：UNIX domain socket `~/.m5stack-coding-toys/daemon.sock`，单行 NDJSON。CLI 用 `callOnce(sock, {op})`（`packages/cli/src/control-client.ts`）发一行 JSON、读整段响应、关闭。daemon 在 `HookServer.dispatchOp`（`packages/daemon/src/hook-server.ts`）按 `op` 分发。→ 截屏只是**新增一个 op**，CLI 不 spawn 新进程、不碰串口，约束 3 天然满足。
- **daemon ↔ device 已有 RPC**：`DeviceSession.request({k,p}, timeoutMs)`（`packages/daemon/src/device-session.ts`）给帧附加自增 `id`、写串口、按 `id` 匹配设备回帧并 resolve；超时 reject（`code='ETIMEDOUT'`）。截屏请求/应答正好套这个 RPC。
- **Node 侧 NDJSON framer 无行长上限**：`NdjsonFramer.push`（`packages/protocol/src/framing-ndjson.ts`）只按 `\n` 切分，不限制行长。→ daemon 读取任意大小的 base64 PNG 行没有缓冲区天花板，**无需调任何 buffer**。
- **设备侧 framer 有 3072B 行上限**：`firmware/lib/m5proto/ndjson.h`。但这是**入站**（host→device）限制，截屏**请求**帧极小（< 64B），不受影响。截屏**应答**是设备→主机方向，设备只管 `transport->write` 原始字节，出站不过 framer，无上限。
- **设备已有离屏 sprite**：`CoreS3Canvas`（`firmware/boards/cores3_se/canvas_m5gfx.{h,cpp}`）把整屏画进 PSRAM 里的 `M5Canvas sprite_`（320×240 RGB565），`end()` 一次性 `pushSprite` 到 LCD。→ 截屏直接对 `sprite_` 调 M5GFX 的 `createPng()`，**不依赖面板回读**，抓到的就是屏上正显示的那帧。
- **设备帧分发**：`App::handleLine`（`firmware/lib/m5render/app.cpp`）按 `strcmp(env.kind, ...)` 分发，未知 kind 静默忽略。设备侧 `decode`（`firmware/lib/m5proto/codec.h`）对任意 kind 都能解析信封（不查 schema 表）。→ 加一个 `screenshot` 分支即可，无需改设备解码框架。
- **messages.h 是生成产物**：`firmware/lib/m5proto/messages.h` 由 `tools/gen-msgs`（`pnpm gen:msgs`）从 `HOST_KINDS`/`DEVICE_KINDS` 生成 kind 常量；CI 有 `gen:msgs:check`。→ 在 `kinds.ts` 加 kind 后必须重跑 `pnpm gen:msgs`。

## 3. 选定方案：A — RPC 单帧 base64 PNG

设备一次性把整张 PNG 编码成 base64，放在**一个** `screenshot.ack` 帧的 payload 里回给 daemon。

放弃分块（方案 B）的理由：截断 bug 的根因是**设备侧固定的 256B 入站 buffer**（host→device）；而截屏数据走**设备→主机**，由 Node 的无上限 framer 读取，没有硬件缓冲天花板。本项目又是纯色状态屏，PNG 必然很小（估算 1–4KB，base64 后 ~1.5–5.5KB）。按 YAGNI 不上分块状态机。若 bring-up 实测 PNG 异常大、或将来支持更复杂内容/新板子，可向后兼容地升级为分块（新增 `screenshot.begin/chunk/end` kind，旧的单帧 ack 保留）。

## 4. 数据流

```
m5ct screenshot [-o <path>]
  │  callOnce(daemon.sock, {op:"screenshot", out?:<abs path>})        ← 复用现有 control socket
  ▼
HookServer.dispatchOp("screenshot")
  └─ ControlHandler.screenshot(out?)
       └─ DeviceSession.request({k:"screenshot", p:{fmt:"png"}}, 5000) ← 复用现有 RPC（id 匹配）
            │  serial NDJSON （请求帧 < 64B）
            ▼
        App::handleLine → kind==screenshot
            ├─ canvas_.capturePng(bytes)          # sprite_.createPng
            ├─ b64 = base64Encode(bytes)
            ├─ line = encode_screenshot_ack(id, ok, w,h, b64)
            └─ send(line)                          # 设备→主机，回显同一 id
            │  serial NDJSON （应答帧，KB 级）
            ▼
       request() 按 id resolve → DecodedEnvelope(k=screenshot.ack)
  └─ ControlHandler.screenshot:
       p.ok==true → Buffer.from(p.png_b64,"base64") → 写文件到 path → {ok:true, path}
       p.ok==false / 无设备 / 超时 → {error: <reason>}
  ▼
CLI 打印 "Saved: <abs path>" 或错误，返回码 0/1
```

## 5. 各模块详细设计

### 5.1 协议（`packages/protocol`）

- `src/kinds.ts`：
  - `HOST_KINDS` 追加 `'screenshot'`。
  - `DEVICE_KINDS` 追加 `'screenshot.ack'`。
- `src/messages-host.ts`：
  ```ts
  export const screenshotPayload = z.object({
    fmt: z.literal('png').default('png'),
  })
  export type ScreenshotPayload = z.infer<typeof screenshotPayload>
  ```
  （`fmt` 字段为未来格式预留。）
- `src/messages-device.ts`：
  ```ts
  export const screenshotAckPayload = z.object({
    ok: z.boolean(),
    w: z.number().int().positive().optional(),
    h: z.number().int().positive().optional(),
    fmt: z.literal('png').optional(),
    png_b64: z.string().optional(),   // ok=true 时存在
    err: z.string().optional(),       // ok=false 时存在
  })
  export type ScreenshotAckPayload = z.infer<typeof screenshotAckPayload>
  ```
- `src/registry.ts`：`PAYLOAD_SCHEMAS` 加 `screenshot: screenshotPayload` 与 `'screenshot.ack': screenshotAckPayload`（满足 `Record<Kind, …>` 完整性）。
- 重跑 `pnpm gen:msgs` → `firmware/lib/m5proto/messages.h` 自动得到 `kind::screenshot` 与 `kind::screenshot_ack` 常量。

### 5.2 CLI（`packages/cli`）

- `src/main.ts`：`listCommands()` 加 `'screenshot'`；`switch` 加 `case 'screenshot': return runScreenshot(rest, io)`。
- 新文件 `src/cmd-screenshot.ts`：
  - 解析 `-o <path>`（也接受 `--out`）。给了就 `path.resolve(process.cwd(), arg)` 成绝对路径后塞进 `out`；没给则不带 `out`，让 daemon 用默认路径。
  - `callOnce<{ok?:boolean; path?:string; error?:string}>(socket, {op:'screenshot', ...(out?{out}: {})})`。
  - `ok && path` → `io.log('Saved: ' + path)`，返回 0；否则 `io.error('m5ct screenshot: ' + (error ?? 'unknown'))`，返回 1。
  - socket 不存在（daemon 未运行）→ `callOnce` 抛错 → catch 打印 `daemon not running`，返回 1。
- 测试 `src/cmd-screenshot.test.ts`：注入假的 `call`，断言发出的 op 与 `out`、断言成功/失败/无 daemon 三种打印与返回码。

### 5.3 daemon（`packages/daemon`）

- `src/state-dir.ts`：加 `export function screenshotsDir(home = homedir()) { return resolve(stateDir(home), 'screenshots') }`。
- `src/control-ops.ts`：
  - `ControlHandler` 接口加 `screenshot(out?: string): Promise<{ ok: true; path: string } | { error: string }>`。
  - `makeControlHandler` 实现：
    ```
    const sess = dm.currentSession()
    if (!sess) return { error: 'no_device' }
    let env
    try { env = await sess.request({ k: 'screenshot', p: { fmt: 'png' } }, 5000) }
    catch (e) { return { error: (e as Error).code === 'ETIMEDOUT' ? 'device_timeout' : (e as Error).message } }
    const p = env.p as ScreenshotAckPayload
    if (!p.ok || !p.png_b64) return { error: p.err ?? 'capture_failed' }
    const path = out ?? resolve(screenshotsDir(), tsFilename())   // tsFilename(): 2026-05-26T14-03-05.png
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.from(p.png_b64, 'base64'))
    return { ok: true, path }
    ```
  - `tsFilename()`：`new Date().toISOString()` → 取到秒、把 `:` 与 `.` 换成 `-`、加 `.png`（文件系统安全；如 `2026-05-26T14-03-05.png`）。
- `src/hook-server.ts`：`dispatchOp` 的 `switch` 加：
  ```
  case 'screenshot': {
    const out = typeof msg.out === 'string' ? msg.out : undefined
    const r = await this.control.screenshot(out)
    sock.end(`${JSON.stringify(r)}\n`)
    return
  }
  ```
- 测试 `src/control-ops.test.ts`（或新增）：用一个假的 `DeviceManager.currentSession()` 返回带 stub `request` 的对象，request 回 `{k:'screenshot.ack', p:{ok:true, png_b64:<已知>}}`；断言文件被写到临时目录、字节正确、返回 `{ok, path}`。再覆盖无设备、超时、ok:false 三条错误路径。

### 5.4 固件（`firmware`）

- `lib/m5render/canvas.h`：`Canvas` 加可选虚函数（默认不支持，便于 Cardputer/Mock 渐进实现）：
  ```cpp
  #include <cstdint>
  #include <vector>
  // ...
  // Capture the current frame as PNG bytes into `out`. Returns false if the
  // device/canvas can't produce a screenshot. Default: unsupported.
  virtual bool capturePng(std::vector<uint8_t>& out) { (void)out; return false; }
  ```
- `boards/cores3_se/canvas_m5gfx.{h,cpp}`：覆盖 `capturePng`：
  ```cpp
  bool CoreS3Canvas::capturePng(std::vector<uint8_t>& out) {
    if (!ready_) return false;
    std::size_t len = 0;
    void* png = sprite_.createPng(&len);   // M5GFX：对离屏 sprite 编码 PNG
    if (!png || len == 0) { if (png) free(png); return false; }
    const uint8_t* p = static_cast<const uint8_t*>(png);
    out.assign(p, p + len);
    free(png);                              // createPng 返回 malloc 的 buffer，调用方释放
    return true;
  }
  ```
- `lib/m5proto/`：新增 base64 与 ack 编码（纯 C++，可 native 测）：
  - `base64.h`：`std::string base64Encode(const uint8_t* data, std::size_t n)`（标准字母表 + `=` 填充）。
  - `encode_screenshot_ack`（放 `codec.h`，与其它 encoder 一致）：因 payload 可达 KB 级且 base64 字符集（`A-Za-z0-9+/=`）对 JSON 无需转义，**用字符串拼接**直接构造，避免 ArduinoJson 的多份拷贝。返回 `std::string`：
    ```cpp
    inline std::string encode_screenshot_ack(
        const char* id, uint64_t t, bool ok,
        int w, int h, const std::string& png_b64, const char* err) {
      std::string s = "{\"v\":1";
      if (id && id[0]) { s += ",\"id\":\""; s += id; s += "\""; }
      s += ",\"k\":\""; s += kind::screenshot_ack; s += "\",\"t\":";
      s += std::to_string(t); s += ",\"p\":{\"ok\":";
      s += ok ? "true" : "false";
      if (ok) {
        s += ",\"w\":"; s += std::to_string(w);
        s += ",\"h\":"; s += std::to_string(h);
        s += ",\"fmt\":\"png\",\"png_b64\":\""; s += png_b64; s += "\"";
      } else if (err && err[0]) {
        s += ",\"err\":\""; s += err; s += "\"";   // err 取受控常量字符串，无需转义
      }
      s += "}}";
      return s;
    }
    ```
- `lib/m5render/app.cpp`：`handleLine` 加分支（放在 ping/status 旁）：
  ```cpp
  if (std::strcmp(env.kind, m5proto::kind::screenshot) == 0) {
    std::vector<uint8_t> png;
    if (canvas_.capturePng(png) && !png.empty()) {
      std::string b64 = m5proto::base64Encode(png.data(), png.size());
      std::string line = m5proto::encode_screenshot_ack(
          env.id, 0, true, canvas_.width(), canvas_.height(), b64, nullptr);
      send(line.c_str(), line.size());
    } else {
      std::string line = m5proto::encode_screenshot_ack(
          env.id, 0, false, 0, 0, std::string(), "capture_unsupported");
      send(line.c_str(), line.size());
    }
    return;
  }
  ```
  - `send(const char*, len)` 已存在，写出后自动补 `\n`。出站大写入由 HWCDC 处理（见风险）。
- `lib/mock_hal/mock_canvas.h`：覆盖 `capturePng` 返回固定字节并记一笔调用，供 `test_app` 断言：
  ```cpp
  bool capturePng(std::vector<uint8_t>& out) override {
    calls.push_back("capturePng");
    out = {0x89, 'P', 'N', 'G'};   // 固定 4 字节，base64 = "iVBORw=="
    return true;
  }
  ```

### 5.5 模拟器（`tools/fake-firmware`）

`src/main.ts` 的 `handle` 加分支：收到 `screenshot` → 回一个固定 base64 的 `screenshot.ack`，供 daemon 集成测试用：
```ts
if (env.k === 'screenshot') {
  send(encode({
    k: 'screenshot.ack', ...(env.id ? { id: env.id } : {}),
    p: { ok: true, w: 320, h: 240, fmt: 'png', png_b64: 'iVBORw==' },
  }))
  return
}
```

## 6. 文件命名与位置

- 默认：`~/.m5stack-coding-toys/screenshots/<YYYY-MM-DDTHH-MM-SS>.png`（本地时间或 UTC 取 `toISOString` 的 UTC，实现取 UTC 即可，文档注明）。目录自动 `mkdir -p`。
- `-o <path>`：CLI 侧 resolve 成绝对路径；相对路径相对**用户当前 shell 的 cwd**（CLI 进程的 cwd），不是 daemon 的 cwd。daemon 直接用收到的绝对路径写盘。

## 7. 错误处理

| 情况 | 检测点 | CLI 表现 / 返回码 |
|------|--------|------------------|
| daemon 未运行 | socket 文件不存在，`callOnce` 抛错 | `m5ct screenshot: daemon socket not found …` / 1 |
| daemon 在跑但无设备 | `dm.currentSession()` 为 null | `m5ct screenshot: no_device` / 1 |
| 设备捕获失败（sprite 未就绪/不支持） | ack `ok:false, err` | `m5ct screenshot: <err>` / 1 |
| RPC 5s 超时 | `request` reject `ETIMEDOUT` | `m5ct screenshot: device_timeout` / 1 |
| 写文件失败（权限/路径） | `writeFile` 抛错 | `m5ct screenshot: <fs error>` / 1 |
| 成功 | ack `ok:true` + 写盘成功 | `Saved: <abs path>` / 0 |

## 8. 测试策略

- **protocol（vitest）**：`screenshot`/`screenshot.ack` 的 encode→decode round-trip；`registry` 完整性（类型层面已由 `satisfies Record<Kind,…>` 保证）。
- **m5proto native（Unity）**：`base64Encode` 对已知输入（含需要 1 个/2 个 `=` 填充的长度边界）输出正确；`encode_screenshot_ack` 对 ok/err 两种产出合法 JSON 且能被 `decode` 接受。
- **firmware test_app（Unity）**：注入 `screenshot` 帧 → 断言 `MockCanvas` 记录了 `capturePng`、且 `MockTransport.drain_tx()` 含 `"k":"screenshot.ack"`、含 mock 固定字节的 base64（`iVBORw==`）、回显同一 `id`。
- **daemon（vitest）**：`screenshot` 控制 op 四条路径（成功写文件 / 无设备 / 超时 / ok:false），用 stub session + 临时目录。
- **CLI（vitest）**：`cmd-screenshot` 注入假 `call`，断言 op/out、三种输出与返回码；`-o` 路径 resolve 行为。
- **daemon 集成（既有 fake-firmware 链路）**：跑通 `m5ct screenshot` → fake-firmware 回固定 PNG → 文件按预期落地、字节正确。
- **硬件验收**（走 [[m5stack-cores3-bring-up]]，需用户在场操作）：真机 flash 含本特性的固件 → 主机 `m5ct screenshot` → 打开生成的 PNG 肉眼比对屏幕；用例覆盖 Live 状态页与 Waiting 页各截一张。

## 9. 风险与缓解

- **大帧出站写**：KB 级 base64 一次性 `transport->write` 到 HWCDC。CoreS3 transport 假设全量写出；HWCDC 通常会阻塞直到 TX FIFO 排空，预期可行。bring-up 时确认无截断/丢字节；若有问题，降级为分块（方案 B）。
- **PNG 体积超预期**：实测若远大于估算（如 >32KB），评估是否升级分块。设备侧可加一个大小上限保护，超限回 `ok:false, err:"too_large"` 而非硬塞。
- **createPng 内存**：分配 PNG buffer + base64 串 + JSON 串，约 3× png 大小的瞬时 RAM。CoreS3 有 8MB PSRAM，余量充足。
- **Cardputer**：未实现 `capturePng`，默认返回 false → ack `ok:false`，CLI 报 `capture_unsupported`。本特性 V1 只保证 CoreS3 SE；Cardputer 后续补。

## 10. 验收标准（Definition of Done）

1. `pnpm gen:msgs:check`、Biome、全部 TS（vitest）与固件 native（Unity）测试绿。
2. `m5ct screenshot` 在无设备/超时/无 daemon 时给出明确错误与非零返回码。
3. fake-firmware 集成路径下，`m5ct screenshot` 把正确字节写到 `~/.m5stack-coding-toys/screenshots/<ts>.png`，`-o` 覆盖生效。
4. 触发截屏期间 daemon 不重启、串口会话不中断（复用 control socket + 现有 session 验证）。
5. （硬件，用户在场）真机截到的 PNG 与屏幕一致。
