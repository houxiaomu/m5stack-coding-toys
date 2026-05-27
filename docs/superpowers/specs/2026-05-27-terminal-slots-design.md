# Terminal Slots Identity Design

Date: 2026-05-27

## 背景

当前 multi-session 实现把屏幕上的一行视为 Claude 的 `session_id`。
这会导致一个实际用户可见的 bug：同一个 Claude Code 进程如果换了新的
`session_id`，旧记录仍然绑定着同一个 live PID，因此 liveness 认为它还活着，
设备 picker 上会出现重复的 workspace 行。

产品上，设备要显示的不是 Claude conversation 历史，而是用户当前打开的
Claude Code 终端实例。用户验证时也会自然比较“本机有几个 claude 进程”和
“设备显示几个终端”是否一致。

## 目标

把 host 端 identity 模型从 `session_id` 改为 **terminal slot**：

- 一个 terminal slot 表示一个 live Claude Code 进程。
- 设备 picker 标题使用 `TERMINALS`。
- 屏幕上的 live row 数量应与本机 live Claude Code CLI 进程数量一致。
- Claude `session_id` 只作为当前 conversation alias，用于 hook routing，
  不再作为 UI entity 的主身份。

## 非目标

- 不支持 Claude macOS app 进程。
- 不做历史 conversation 浏览器。
- 不改变设备 focus 协议的外形；`sessions[].id` 仍然是字符串。
- 不新增 CLI session 管理命令。

## Identity 规则

host 聚合器维护 `TerminalSlot`，主键为 `slotId`：

1. 如果 statusLine 能解析出 `ccPid`，`slotId = "pid:<ccPid>"`。
2. 如果没有 `ccPid` 但有 `session_id`，`slotId = "sid:<session_id>"`。
3. 如果两者都没有，`slotId = "anonymous"`。

`pid:` slot 是正常路径。`sid:` 和 `anonymous` 是兜底路径，继续使用 30 秒
无 PID TTL。只要该兜底 slot 持续收到 statusLine tick，`lastActivityMs` 会刷新，
不会在活跃时被误清。

当同一个 `ccPid` 收到新的 `session_id`：

- 不创建新 UI row。
- 更新该 `TerminalSlot` 的 `currentSessionId`。
- 维护 `sessionId -> slotId` alias 映射，使后续 hook 能路由到这个 slot。
- 旧 `session_id` alias 可以保留到该 slot 消失，避免迟到 hook 丢失。

## Host 数据模型

`TrackedSession` 重命名为 `TerminalSlot`。建议字段：

- `id`: slot id，例如 `pid:83876`
- `pid?: number`
- `currentSessionId?: string`
- `knownSessionIds: Set<string>`
- `firstSeenMs`
- `lastActivityMs`
- `activity`
- `lastFrame`
- `lastSample`
- `burnHistory`
- `latestCostUsd?`

聚合器新增 alias index：

- `sessionAliases: Map<string, string>`，从 Claude `session_id` 找到 `slotId`

聚合器的 `slots`、`order`、`foregroundSlotId`、`pinnedSlotId` 都使用 slot id。

## Hook 路由

hook event 仍然只携带 Claude `session_id`。daemon 处理方式：

1. 如果 event 带 `sessionId`，先查 `sessionAliases`。
2. 找到 slot 后更新该 slot 的 activity，并重推当前 foreground frame。
3. 找不到时忽略，不创建 phantom slot。
4. 不带 `sessionId` 的 hook 只允许命中 `anonymous` slot。

这样 conversation alias 只影响事件归属，不影响 picker 行数。

## Focus 语义

设备发回的 focus event 仍然使用：

```json
{ "kind": "focus", "target": "session", "sessionId": "pid:83876" }
```

这里字段名保留为 `sessionId` 是为了协议兼容；语义上它已经是 host 端发给设备的
row id，也就是 slot id。

host 收到 focus event 后：

- `target: "auto"` 切回 auto。
- `target: "session"` 只接受已存在的 slot id。
- pinned 的是 terminal slot，不是 Claude conversation。

## UI 命名

设备 picker 标题改为：

```text
TERMINALS
```

行名仍然优先使用用户能识别的工作上下文：

1. `workspace.worktree`
2. workspace/current dir basename
3. slot id short form

如果多个 slot 计算出同一个展示名，追加序号避免歧义：

```text
pm
pm #2
```

header 计数保持不变：

```text
AUTO 1/2
PINNED 2/2
```

## 成本与 today 语义

`today.sessions` 当前含义是当天见过的 Claude conversation 数。改成 terminal slot
后需要避免继续叫 session 造成歧义。

本次 identity 修正先保持 wire 字段不变以减少协议改动，但 host 端统计应按 slot
去重，代表今天活跃过的 terminal 数。后续如果要更精确，可以新增
`today.terminals`，再逐步弃用 `today.sessions`。

## 退出与清理

`checkLiveness()` 按 slot 清理：

- `pid:` slot：PID 不存在时删除。
- `sid:` / `anonymous` slot：超过 30 秒未收到 tick 时删除。

删除 slot 时需要同步清理：

- `slots`
- `order`
- `todaySessionCosts`
- `sessionAliases` 中指向该 slot 的所有 alias
- `pinnedSlotId`
- `foregroundSlotId`

如果删除的是 pinned slot 且仍有其他 slot，切回 auto 并重推 selected frame。
如果没有 slot，发送 idle frame。

## 测试策略

Host 单元测试：

- 同一个 `ccPid`、不同 `session_id` 只生成一个 terminal row。
- 新 `session_id` 更新 `currentSessionId` 和 alias，不新增 row。
- 不同 `ccPid` 即使 workspace 名相同也生成两个 rows，并显示 `name` / `name #2`。
- hook 通过旧 alias 和新 alias 都能命中同一个 slot。
- focus pin 使用 slot id。
- `pid:` slot 在 PID 死亡后清理，并清理 aliases。
- 无 PID slot 继续按 30 秒 TTL 过期。

E2E 测试：

- 模拟同一 `ccPid` 连续发送 `s1`、`s2`，fake firmware 最终只收到一个 live row。
- 模拟两个不同 `ccPid` 的 `pm` workspace，fake firmware 收到两个 row，名称去重。

Firmware/native 测试：

- picker 标题从 `SESSIONS` 改为 `TERMINALS`。
- row id 仍按 host 下发字符串处理，不假设其是 Claude `session_id`。

## 迁移影响

这是 feature branch 内部迁移，不需要兼容已发布 daemon 状态。持久化文件里只有
today/burn history，不保存 live session registry，因此 daemon 重启后会自然使用
新模型。

协议字段名暂不重命名，避免扩大 firmware 与 host 的同步改动。代码内部命名需要
主动改为 slot/terminal slot，避免继续引入 session identity 混淆。
