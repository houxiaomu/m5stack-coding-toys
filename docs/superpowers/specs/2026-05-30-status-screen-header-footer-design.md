# Status Screen Header/Footer Redesign

Date: 2026-05-30

## 背景

当前 CoreS3 状态屏的数据页 header 左侧显示 Claude model，例如 `Opus 4.8`。
这在多终端场景下不合理：用户首先需要知道自己正在看哪个 terminal/session，
model 只是该 session 的属性，不应该占据全局标题位置。

同时，底部目前只显示居中的 page dots；设备已有 RTC 日期和时间，但 Live
数据页没有长期展示。用户希望 footer 长期显示日期、分页和时间：

```text
2026-05-30        ● ○ ○ ○        18:14
```

本次调整只改变固件 UI 内容组织，不改变 host→device 协议。

## 目标

- 数据页 header 左侧显示当前 terminal/session name，而不是 model。
- Sessions picker 页的 header 标题显示 `TERMINALS`。
- Overview 第一页仍然显示 model，但放入内容区域。
- Live 数据页底部长期显示左日期、中 page indicator、右时间。
- 保持 activity badge、focus label、现有 4 个 overview metric tiles 的信息密度。

## 非目标

- 不采集真实终端窗口标题或 tab title。
- 不新增协议字段。
- 不改变 multi-session focus 协议。
- 不重做整体视觉风格、颜色系统或页面数量。
- 不要求 Cardputer ADV 硬件验证。

## Header 设计

数据页包括 Overview、Cost、Limits、Workspace。它们共享 header：

- 左侧状态 dot 保持不变。
- 主标题显示当前 terminal/session name。
- 中间 multi-session focus label 保持不变，例如 `AUTO 2/4` 或 `PINNED 1/3`。
- 右侧 activity badge 保持不变，例如 `WORKING`、`YOUR TURN`、`NEEDS YOU`。

标题来源使用固件本地可推导信息，优先级如下：

1. 如果 `sessions[]` 中存在当前 selected/pinned session，使用它的 `name`。
2. 否则使用 `wsWorktree`。
3. 否则使用 workspace path 的 basename。
4. 否则 fallback 到 `Claude`。

这样单 session 和 multi-session 都能工作，并且不需要 host 新增字段。

## Sessions Picker 设计

Sessions picker 页不再把当前 model 或当前 session name 放在 header 左侧。
它的 header 主标题固定为：

```text
TERMINALS
```

页面列表行继续显示各 terminal/session 的 name 与 activity。当前已有的
`TERMINALS` 小标题可以移除或降级，避免同一屏重复出现两个 `TERMINALS`。

## Overview Model 设计

model 从 header 移到 Overview 的 Context tile label，采用用户选择的方案 C。
固件字符串使用 ASCII 分隔符，避免嵌入式字体/编码兼容问题：

```text
CONTEXT / Opus 4.8
```

如果 model 缺失，则 label 保持：

```text
CONTEXT
```

Overview 仍保留当前四个 tile：

- `CONTEXT / <model>`
- `5H BLOCK`
- `SESSION`
- `DIFF`

不新增 model tile，不挤掉现有 metric，也不在 workspace strip 额外放 chip。

## Footer 设计

Live 数据页底部使用统一 footer：

- 左侧：设备 RTC 日期，格式沿用当前 `DeviceInfo.date` 的 `YYYY-MM-DD`。
- 中间：page indicator dots。
- 右侧：设备 RTC 时间，格式沿用当前 `DeviceInfo.clock` 的 `HH:MM`。

footer 替代当前单独的 `renderPageDots()` 底部占位。各页面内容需要预留底部
safe area，避免 rows 或 tiles 与 footer 重叠。

Waiting / NoLink 屏保持当前设备状态语义：它已有底部日期和电量，且没有
data-page pagination。后续如需统一 waiting footer 可单独设计。

## 渲染架构

当前 `renderPage(PageId, StatusModel, Canvas)` 无法拿到 RTC 日期和时间；
这些数据在 `DeviceInfo` 中，只在 Waiting/NoLink 渲染前刷新。

本次需要让 Live 页面也拿到 `DeviceInfo`：

- `App::render()` 在 Live 状态渲染前调用 `refreshDeviceInfo()`。
- `renderPage` 接收 `DeviceInfo`，或内部页面渲染函数通过统一入口拿到它。
- 新增 shared footer helper，例如 `renderFooter(active, pageCount, DeviceInfo, Canvas)`。
- page dots 的总数应使用 `pageCountFor(m)`，当 sessions picker 可用时显示 5 页，
  否则显示 4 页。

## 测试策略

Firmware native tests：

- header 在普通数据页显示 terminal/session name，不显示 model。
- header 在 Sessions picker 页显示 `TERMINALS`。
- Overview 的 Context label 在有 model 时显示 `CONTEXT / <model>`。
- Overview 的 Context label 在无 model 时显示 `CONTEXT`。
- Live footer 渲染日期、时间和 page dots。
- footer dots 数量按 `pageCountFor(m)` 变化。

Host/TypeScript tests 不需要新增，因为协议和 daemon aggregation 不变。

## 验收标准

- 截图中 header 不再出现 `Opus 4.8` 作为主标题。
- 在 session picker 页面，header 显示 `TERMINALS`。
- 在普通 session 数据页，header 显示当前 terminal/session name。
- Overview 第一页仍能看到 model，位置为 Context tile label。
- Live 页面底部始终显示日期、page indicator 和时间。
- `pnpm test`、相关 firmware native tests、Biome 检查通过。
