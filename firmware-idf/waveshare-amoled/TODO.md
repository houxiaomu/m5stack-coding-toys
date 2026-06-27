# Waveshare AMOLED 圆屏 — 待办 / 死机调试笔记

> 记录于 2026-06-27。只是 TODO,暂不改任何代码。

## 背景:BLE 供电下死机

现象:拔掉 USB、改用**电池供电 + BLE 传输**时,发一会儿信号就死机(黑屏闪一下重启)。
USB 供电时完全正常。

### 诊断结论(高置信,尚缺最终实锤)

**根因:电池供电下,BLE 发射的瞬时电流尖峰把供电电压拉到欠压阈值以下,触发 ESP32-S3 的
brownout 检测 → 硬件复位重启。不是软件 bug。**

三条独立证据:
1. **对照实验** — 唯一变量是供电源(传输一直是 BLE)。USB 供电=稳,电池供电=死 → 问题在供电。
2. **现象** — 死机=黑屏闪一下重启=掉电复位,正是 brownout 典型表现(软件 hang 不会重启)。
3. **配置** — `sdkconfig` 里 `CONFIG_ESP_BROWNOUT_DET_LVL=7`,brownout 卡在最敏感档
   (~3.0V 就触发),给电池电压波动留的余量极小,BLE 发射尖峰一来就跌破。

排除项:板子硬件损坏(短路/虚焊)——USB 下完全正常、不发烫、无电涌告警,基本排除。

### 还缺的"铁证"

理论铁证是读到上次复位原因 `ESP_RST_BROWNOUT`,但当前固件:
- console 走 UART0(`CONFIG_ESP_CONSOLE_UART_DEFAULT=y`),USB 口看不到 panic/复位日志;
- coredump 全关(`CONFIG_ESP_COREDUMP_ENABLE_TO_NONE=y`),事后捞不到现场。

且复现条件(拔 USB 走电池)和取证条件(插 USB 读串口)互斥 → 不能靠 USB 串口取证。

---

## 待办

### 1. 零成本验证(不改代码,先做)
- [ ] 把电池**充满**,再拔 USB,用 BLE 持续发数据,看是否还死机。
  - 充满后变稳 → 电量/电池老化是主因(余量随电量下降)。
  - 充满照样秒死 → 是峰值电流 vs 电池/DCDC 瞬时供给能力的硬限制,需固件层治理。

### 2. 取证改造:FPS 行复用成 debug 行(改 ui.c 一个文件)
> 注(2026-06-27):此方案曾完整实现并 HW 验证过(屏幕显示 `USB 9s 95%`,设计上
> brownout 时会红色 `BROWN` + uptime 归零),但 debug 行不美观、且目前没再复现死机,
> 已回退。`SHOW_FPS` 现默认 0(整行关闭);改回 1 即恢复原 FPS 行。要重做取证,
> 按下面待办在 `fps_lbl` 上改文本即可(`esp_reset_reason()` + `esp_timer_get_time()`)。
- [ ] 复用 `ui.c` 里的 `fps_lbl`(FPS 那行,`SHOW_FPS` 区域,创建在 ~720 行,
      更新在 ~1204 行 `snprintf(f, "%d FPS", s_fps)`)。
- [ ] 显示内容:`<reset_reason 缩写> <uptime>s <batt>%`,例如 `BROWN 13s 84%`。
  - reset reason 直接在 ui.c 调 `esp_reset_reason()`(IDF 启动早期已缓存,任何文件/时刻
    调用都返回本次启动的复位原因 → **不必动 app_main.c / model.h**)。
  - 缩写:`BROWN`=brownout(标红)、`POR`=正常上电、`PANIC`=崩溃、`WDT`=看门狗、`SW`=软复位。
  - uptime 用已有的 `esp_timer_get_time()`;batt 用 `g_model.batt_pct`。
- [ ] **取证杀手锏**:电池供电复现时,屏幕会反复显示 `BROWN` + uptime 不断归零,
      双重实锤,完全不依赖 USB/串口。

### 3. 修复方向(取证确认后,治标→治本)
- [ ] 治标:`sdkconfig` 把 `CONFIG_ESP_BROWNOUT_DET_LVL` 从 7 降到 ~2/3(阈值降到 ~2.8V 以下),
      给电压波动更多余量。代价:削弱欠压保护(但 LVL7 对电池设备本就过激进)。
- [ ] 治本:查 AXP2101(I2C 0x34)给 ESP32 那路 DCDC 的输出电压/限流配置,
      适当抬高输出、放宽限流,从源头给 BLE 尖峰留电。
- [ ] 辅助:降低 NimBLE 发射功率(削电流尖峰,代价是通信距离)。

### 4. 顺带留意(与死机无关)
- [ ] WiFi:硬件支持,但当前固件未实现 WiFi 传输(只有 USB-serial + BLE);
      WiFi/WebSocket 是 roadmap M7(V1.x)。**注意:WiFi TX 电流尖峰比 BLE 更大,
      若为绕过死机而上 WiFi 会适得其反。**

---

## ⚠️ 环境告警:本次会话工具输出层出现污染

排查死机期间,工具结果回传层出现 4 种损坏:**串台**(devices.json 内容混入 model.h 输出)、
**重复**(`wc -l` 单行结果复读几十遍)、**膨胀**(Read 把 41 行 model.h 显示成 122 行假重复)、
**吞行**(多命令中间输出整段丢失)。还出现疑似 prompt injection(混入日文"用户消息" +
伪造的 system-reminder 诱导停止工具调用)。

- model.h / ui.c 等**文件本身是好的**(`git status` 干净、`grep -c`/`wc` 数字一致),
  之前看到的"model.h 乱了"是渲染假象,不是磁盘内容。
- **下次动代码前建议先 `/clear` 重开会话**,避免基于被污染的读取做精确编辑。
