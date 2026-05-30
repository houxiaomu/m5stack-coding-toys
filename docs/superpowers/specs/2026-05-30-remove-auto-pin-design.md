# 删除多 session auto/pin 设计

## 背景

当前多 session 机制把“自动聚焦”和“固定某个 session”混在一起：

- daemon 会在 `auto` 模式下自动切到最早 `needs_attention` 的 session。
- 固件 Sessions 页包含 `AUTO` 行，选中普通 session 后进入 `pinned` 模式。
- 协议状态里有 `focus.mode=auto|pinned`、session `pinned`、session `auto` 等字段。

这个模型会打断用户正在看的 session，也让 Sessions 页承担了“模式切换”而不是“选择 session”的职责。新设计删除 auto/pin 语义，把多 session 交互改为用户显式选择。

## 目标

1. 多 session 时不再有 `AUTO` 行，也不再有 `PINNED` 状态。
2. 其他 session 变成 `needs_attention` 时，只在 Sessions picker 中显示，不打断当前详情页。
3. 用户在 Sessions picker 中点击哪个 session，就进入哪个 session 的详情页。
4. 详情页只展示用户选中的 session；四个详情页结束后自动回 Sessions picker。
5. 详情页 header 区域可直接点击回 Sessions picker。
6. 小屏幕列表使用大触摸目标和简单分页，不做滚动条或拖动滚动。

## 非目标

- 不实现拖动滚动、惯性滚动或 scrollbar。
- 不为 Cardputer ADV 补齐键盘输入；本设计只保证状态模型后续可复用。
- 不新增持久化的默认 session 偏好。
- 不改变单 session 的四页信息布局。

## 产品行为

### 单 session

当 live session 少于 2 个时，设备保持现有四页循环：

`Overview -> Cost -> Limits -> Workspace -> Overview`

没有 Sessions picker。

### 多 session

当 live session 达到 2 个或更多时，设备进入 picker 驱动模式：

`Sessions -> Overview -> Cost -> Limits -> Workspace -> Sessions`

Sessions 是入口页。用户点选某个 session 后进入该 session 的 `Overview`。在详情页里，普通内容区点击继续翻到下一页；从 `Workspace` 再点击一次回到 Sessions。

详情页 header 区域是快捷返回区。多 session 模式下，点击 `Overview/Cost/Limits/Workspace` 的顶部 header，直接返回 Sessions。这个行为只在详情页生效；Sessions 页的 header 点击无动作。

### Sessions picker

Sessions picker 是列表页，不再是“上半区换选中、下半区确认”的双步交互。

- 每页最多显示 3 个 session 行。
- 每个 session 行是大触摸目标，约 44-48px 高。
- 点击 session 行直接进入该 session 的 `Overview`。
- 点击行间空白、header、底部左右空白无动作。
- 列表超过 3 个 session 时，底部中间显示 `NEXT n/m`。
- `NEXT n/m` 使用原 page indicator 的位置，但触摸命中区是底部中间大区域，避免点小文字。
- 点击 `NEXT n/m` 只翻 Sessions 列表页，不进入详情页。
- 不显示 scrollbar；最多 8 个 session 时，简单分页比滚动更可靠。

CoreS3 SE 是 2.0 英寸 320x240 屏幕。27px 行高约 3.4mm，不适合手指点击；3 行大目标比 5 行紧密列表更适合触摸。

### activity 显示

每个 session 行继续显示 activity：

- `WORKING`
- `YOUR TURN`
- `NEEDS YOU`

当非当前详情页的 session 收到 hook 更新，例如 `needs_attention`，只更新 Sessions picker 中对应行的 activity，不自动切换当前详情页。

### session 消失

如果当前详情页对应的 session 消失：

- 仍有 2 个或更多 live session：回到 Sessions picker。
- 只剩 1 个 live session：退出 picker 模式，显示剩余 session 的四页循环。
- 没有 live session：daemon 发送 idle，设备回到 Linked/Waiting 状态。

如果 Sessions picker 当前分页偏移超出新的 session 数量，固件把分页偏移夹到有效范围。

## 协议设计

状态 payload 不再表达 auto/pin 模式：

- 删除 `focus.mode=auto|pinned` 的产品语义。
- 删除 session summary 的 `pinned` 和 `auto` 语义。
- daemon 不再发送 `AUTO` synthetic row。
- `sessions[]` 只表达真实 live sessions 的摘要：`index`、`id`、`name`、`activity`。

为了兼容逐步实现，可以先让解析端忽略旧字段，但新的 daemon 输出不再生成这些字段。协议 schema 和测试应收紧到新语义，避免后续继续依赖 auto/pin。

设备到 host 的 `device.event focus` 不再用于 pin 模式。选择 session 可以继续复用 `target:'session'` 事件，但含义改为“当前设备正在查看这个 session”。不再发送 `target:'auto'`。

## Daemon 设计

`SessionAggregator` 继续负责：

- 维护 live terminal slots。
- 用 statusLine 更新各 session 的最新 frame。
- 用 hook 更新对应 session 的 activity。
- 推送一个 consolidated `status` frame 到设备。

选择策略改为稳定的显式选择：

- daemon 默认选择第一个有 frame 的 live session，保证设备有详情页数据可显示。
- 收到设备 session 选择事件后，更新当前 selected slot。
- selected slot 存在时，hook 或 statusLine 更新不会自动切换 selected slot。
- selected slot 消失时，按 session 消失规则选择回 picker 或剩余 session。

`needs_attention` 不参与 foreground selection，只是 session summary 的 activity。

## 固件设计

### 状态模型

`StatusModel` 增加本地 UI 状态：

- `selectedSessionId` 或等价字段，用于标识当前详情页展示的 session。
- `sessionPageOffset` 或 `sessionPageIndex`，用于 Sessions picker 分页。

解析新的 `sessions[]` 时，只接收真实 session。固件忽略旧的 `auto` / `pinned` 字段。

### 触摸坐标

CoreS3 当前 HAL 把触摸压成上下半区，无法可靠命中列表行。需要把 `InputEvent` 扩展为可携带 `x/y`：

- CoreS3 的 `TouchInput` 从 `M5.Touch.getDetail()` 写入 `x/y`。
- `tap` RPC 已经有 `x/y`，测试路径也用同一套 hit testing。
- App 层根据坐标判断 header、session row、NEXT 区域、内容区。

### 页面导航

多 session 模式下：

- first live frame 进入 Sessions。
- Sessions 页点击 session row：设置本地 selected session，发送 session 选择事件给 daemon，页面切到 `Overview`。
- 详情页 header 点击：切到 Sessions。
- 详情页内容区点击：按四页顺序前进；`Workspace` 后回 Sessions。
- Sessions 页空白点击：无动作。
- Sessions 页 `NEXT` 区域点击：翻到下一组 session。

如果 daemon 选择事件的 ack 不存在，固件仍可先本地切页；后续 status frame 会刷新内容。

## 测试设计

### Protocol / TS

- `statusPayload` 不接受新生成的 `pinned` / `auto` session summary。
- `focus` 字段不再作为新状态输出的一部分。
- `device.event` 仍接受 `target:'session'`，不再接受 `target:'auto'`。

### Daemon / TS

- 多 session frame 的 `sessions[]` 不包含 `AUTO`。
- session summary 不包含 `pinned`。
- `needs_attention` 更新非 selected session 时，不切换当前 frame。
- 设备选择 session 后，selected session 的详情 frame 被推送。
- selected session 消失时，选择状态被清理，并按剩余 session 数量输出合理 frame。

### Firmware / native

- Sessions 页点击第一、第二、第三行分别选择对应 session。
- Sessions 页点击空白无动作。
- Sessions 页点击底部中间 `NEXT` 翻页。
- 多 session 详情页 header 点击回 Sessions。
- 多 session 详情页从 `Workspace` 点击回 Sessions。
- 非当前 session 的 activity 更新不改变当前页面。
- parser 忽略旧 `auto` / `pinned` 字段。

## 文档更新

更新 README 和 architecture status-display 文档：

- 删除“auto-focus / pin session”的描述。
- 描述多 session picker、activity 只在 picker 中提示、详情页 header 返回 picker。
