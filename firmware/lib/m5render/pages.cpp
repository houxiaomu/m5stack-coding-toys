#include "pages.h"

#include <cstdio>

#include "dbg.h"

namespace m5render {

// Placeholder rendered for any data group whose has* flag is false.
static const char* kDash = "—";

// ── shared header (top bar across all 4 data pages) ─────────────────────────
void renderHeader(const StatusModel& m, Canvas& c) {
  M5CT_DBG("hdr start");
  c.fillRoundRect(0, 0, 320, 34, 0, color::bg);  // header band
  M5CT_DBG("hdr fillRoundRect ok");

  // Pages only render while Live, so the dot is always the active accent.
  c.fillCircle(15, 17, 4, color::accent);

  // Model name.
  const char* model = m.modelShort[0] ? m.modelShort : "Claude";
  c.text(model, 26, 17, Font::Title, Align::MiddleLeft, color::ink);

  // State badge top-right. Warning takes precedence (ctx>=80 or exceeds200k).
  bool ctxWarn = m.hasContext && (m.exceeds200k || m.ctxUsedPct >= 80);
  const char* badge = "WORKING";
  uint16_t bColor = color::accent, bBg = color::accSoft;
  if (ctxWarn) { badge = "CTX HIGH"; bColor = color::warn; bBg = color::accSoft; }

  int bw = c.measureText(badge, Font::Label) + 8;
  M5CT_DBG("hdr measureText bw=%d", bw);
  c.fillRoundRect(316 - bw, 9, bw, 16, 3, bBg);
  c.text(badge, 316 - bw / 2, 17, Font::Label, Align::MiddleCenter, bColor);

  // Hairline under header.
  c.drawHLine(10, 32, 300, color::hairline);
  M5CT_DBG("hdr end");
}

// ── page indicator overlay (active page among kPageCount) ───────────────────
void renderPageDots(PageId active, Canvas& c) {
  const int gap = 6, r = 2, total = kPageCount;
  const int totalW = (total - 1) * gap + total * (r * 2);
  int x = (320 - totalW) / 2 + r;
  int y = 232;
  for (int i = 0; i < total; ++i) {
    c.fillCircle(x, y, r,
                 i == static_cast<int>(active) ? color::ink : color::cardLine);
    x += r * 2 + gap;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────
static void microBarOrDash(Canvas& c, bool has, int x, int y, int w, int h,
                           int pct, uint16_t fg) {
  if (has) c.microBar(x, y, w, h, pct, fg);
}

// Tile: label + big value + optional sub + optional bar. `has` false → big="—".
static void drawTile(Canvas& c, int x, int y, int w, int h,
                     const char* label, bool has, const char* big,
                     const char* sub, int barPct, bool barWarn) {
  c.fillRoundRect(x, y, w, h, 4, color::card);
  c.drawRoundRect(x, y, w, h, 4, color::cardLine);

  c.text(label, x + 6, y + 6, Font::Label, Align::TopLeft, color::mute);

  c.text(has ? big : kDash, x + 6, y + 18, Font::Body, Align::TopLeft,
         barWarn ? color::warn : color::ink);

  if (has && sub && *sub)
    c.text(sub, x + 6, y + 44, Font::Label, Align::TopLeft, color::ink2);

  if (has && barPct >= 0)
    c.microBar(x + 6, y + h - 10, w - 12, 3, barPct,
               barWarn ? color::warn : color::ink);
}

// ── PAGE · Overview ─────────────────────────────────────────────────────────
static void drawOverview(const StatusModel& m, Canvas& c) {
  M5CT_DBG("ov start");
  c.fillScreen(color::bg);
  M5CT_DBG("ov fillScreen ok");
  renderHeader(m, c);
  M5CT_DBG("ov header ok");

  // workspace strip
  c.text("$", 10, 40, Font::Label, Align::TopLeft, color::mute);
  c.text(m.wsDir[0] ? m.wsDir : kDash, 18, 40, Font::Label, Align::TopLeft, color::ink2);

  char buf[32], sub1[40];
  // CONTEXT tile
  snprintf(buf, sizeof(buf), "%d%%", m.ctxUsedPct);
  // Only show the "/ Nk" denominator when the host actually sent a limit;
  // assuming 200k would be wrong for million-token-context models.
  if (m.ctxLimit)
    snprintf(sub1, sizeof(sub1), "%dk / %dk tok",
             int(m.ctxTokens / 1000), int(m.ctxLimit / 1000));
  else
    snprintf(sub1, sizeof(sub1), "%dk tok", int(m.ctxTokens / 1000));
  drawTile(c, 10, 56, 150, 74, "CONTEXT", m.hasContext, buf, sub1,
           m.ctxUsedPct, m.hasContext && (m.exceeds200k || m.ctxUsedPct >= 80));

  // 5H BLOCK tile
  char blk[24], blkSub[24];
  snprintf(blk, sizeof(blk), "%d%%", m.blockPct);
  if (m.blockResetInMin > 0)
    snprintf(blkSub, sizeof(blkSub), "resets %dm", m.blockResetInMin);
  else
    blkSub[0] = 0;
  drawTile(c, 165, 56, 150, 74, "5H BLOCK", m.hasBlock, blk, blkSub,
           m.blockPct, m.hasBlock && m.blockPct >= 80);

  // SESSION tile
  char cost[16], burn[24];
  snprintf(cost, sizeof(cost), "$%.2f", m.costSessionUsd);
  snprintf(burn, sizeof(burn), "$%.2f/hr", m.costBurnPerHr);
  drawTile(c, 10, 135, 150, 74, "SESSION", m.hasCost, cost, burn, -1, false);

  // DIFF tile (git)
  char diff[32], gs[24];
  snprintf(diff, sizeof(diff), "+%d / -%d", m.linesAdded, m.linesRemoved);
  snprintf(gs, sizeof(gs), "%dS %dM %dU", m.staged, m.unstaged, m.untracked);
  drawTile(c, 165, 135, 150, 74, "DIFF", m.hasGit, diff, gs, -1, false);
  M5CT_DBG("ov tiles ok");

  renderPageDots(PageId::Overview, c);
  M5CT_DBG("ov dots ok");
}

// ── PAGE · Cost ──────────────────────────────────────────────────────────────
static void drawCost(const StatusModel& m, Canvas& c) {
  c.fillScreen(color::bg);
  renderHeader(m, c);

  c.text("SESSION", 10, 42, Font::Label, Align::TopLeft, color::mute);

  if (!m.hasCost) {
    c.text(kDash, 10, 54, Font::BigNumber, Align::TopLeft, color::ink);
    renderPageDots(PageId::Cost, c);
    return;
  }

  char cost[16];
  snprintf(cost, sizeof(cost), "$%.2f", m.costSessionUsd);
  c.text(cost, 10, 54, Font::BigNumber, Align::TopLeft, color::ink);

  char burn[40];
  snprintf(burn, sizeof(burn), "%dm  $%.2f/hr", m.costDurationMin, m.costBurnPerHr);
  c.text(burn, 10, 100, Font::Label, Align::TopLeft, color::ink2);

  // Burn-rate sparkline (added per plan; handoff had no sparkline).
  if (m.burnN > 1)
    c.sparkline(165, 50, 145, 50, m.burn, m.burnN, color::accent);

  // Rows: TODAY, then aggregate WEEKLY (no per-model split).
  int y = 130;
  auto row = [&](const char* l, bool has, const char* v) {
    c.text(l, 10, y, Font::Label, Align::TopLeft, color::mute);
    c.text(has ? v : kDash, 310, y, Font::Label, Align::TopRight, color::ink);
    c.drawHLine(10, y + 12, 300, color::hairline);
    y += 22;
  };
  char tBuf[16], wBuf[16];
  snprintf(tBuf, sizeof(tBuf), "$%.2f", m.todayCost);
  snprintf(wBuf, sizeof(wBuf), "%d%%", m.weeklyPct);
  row("TODAY",  m.hasToday,  tBuf);
  row("WEEKLY", m.hasWeekly, wBuf);

  renderPageDots(PageId::Cost, c);
}

// ── PAGE · Limits (single aggregate weekly) ──────────────────────────────────
static void drawLimits(const StatusModel& m, Canvas& c) {
  c.fillScreen(color::bg);
  renderHeader(m, c);

  int y = 44;
  auto bar = [&](const char* label, bool has, int pct, bool hero, bool warn) {
    c.text(label, 10, y, Font::Label, Align::TopLeft, color::ink);

    char pctBuf[8];
    snprintf(pctBuf, sizeof(pctBuf), "%d%%", pct);
    c.text(has ? pctBuf : kDash, 310, y - (hero ? 2 : 0),
           hero ? Font::Body : Font::Title, Align::TopRight,
           warn ? color::warn : color::ink);

    int barH = hero ? 7 : 4;
    microBarOrDash(c, has, 10, y + (hero ? 22 : 14), 300, barH, pct,
                   warn ? color::warn : color::ink);
    y += hero ? 42 : 32;
  };

  // CONTEXT / 5H BLOCK / WEEKLY — single aggregate weekly row.
  bar("CONTEXT",  m.hasContext, m.ctxUsedPct, true,
      m.hasContext && (m.exceeds200k || m.ctxUsedPct >= 80));
  bar("5H BLOCK", m.hasBlock,   m.blockPct,   false, m.hasBlock && m.blockPct >= 80);
  bar("WEEKLY",   m.hasWeekly,  m.weeklyPct,  false, false);

  renderPageDots(PageId::Limits, c);
}

// ── PAGE · Workspace ─────────────────────────────────────────────────────────
static void drawWorkspace(const StatusModel& m, Canvas& c) {
  c.fillScreen(color::bg);
  renderHeader(m, c);

  if (!m.hasGit) {
    c.text(m.wsDir[0] ? m.wsDir : kDash, 10, 42, Font::Title, Align::TopLeft, color::ink);
    c.text(kDash, 10, 90, Font::Body, Align::TopLeft, color::ink2);
    renderPageDots(PageId::Workspace, c);
    return;
  }

  c.text(m.branch[0] ? m.branch : kDash, 10, 42, Font::Title, Align::TopLeft, color::ink);

  char ab[24];
  snprintf(ab, sizeof(ab), "^%d v%d", m.ahead, m.behind);
  c.text(ab, 310, 44, Font::Label, Align::TopRight, color::mute);

  c.text(m.wsDir[0] ? m.wsDir : kDash, 10, 62, Font::Label, Align::TopLeft, color::ink2);
  c.drawHLine(10, 78, 300, color::hairline);

  char diff[48];
  snprintf(diff, sizeof(diff), "+%d  -%d   %dS %dM %dU",
           m.linesAdded, m.linesRemoved, m.staged, m.unstaged, m.untracked);
  c.text(diff, 10, 90, Font::Label, Align::TopLeft, color::ink);

  if (m.lastCommitMsg[0]) {
    c.text(m.lastCommitHash, 10, 200, Font::Mono, Align::TopLeft, color::mute);
    c.text(m.lastCommitMsg, 60, 200, Font::Label, Align::TopLeft, color::ink);
  }

  renderPageDots(PageId::Workspace, c);
}

// ── PAGE · Waiting (uses DeviceInfo, NOT StatusModel) ───────────────────────
void renderWaiting(const DeviceInfo& d, bool linked, Canvas& c) {
  c.fillScreen(color::bg);

  // Top device strip: board + fw.
  char strip[48];
  snprintf(strip, sizeof(strip), "%s  %s",
           d.board[0] ? d.board : "M5STACK", d.fw[0] ? d.fw : "");
  c.text(strip, 10, 10, Font::Label, Align::TopLeft, color::mute);

  // Clock / date top-right.
  if (d.clock[0])
    c.text(d.clock, 310, 10, Font::Label, Align::TopRight, color::ink2);

  // Connection indicator: green when linked, muted when not.
  c.fillCircle(160, 90, 5, linked ? color::accent : color::mute);
  if (linked) {
    c.text("Connected", 160, 145, Font::BigNumber, Align::MiddleCenter, color::ink);
    c.text("waiting for Claude", 160, 170, Font::Label, Align::MiddleCenter, color::mute);
    c.text("run  claude  in a terminal", 160, 184, Font::Label,
           Align::MiddleCenter, color::ink2);
  } else {
    c.text("Waiting for host", 160, 145, Font::BigNumber, Align::MiddleCenter, color::ink);
    c.text("USB · no host", 160, 170, Font::Label, Align::MiddleCenter, color::mute);
    c.text("connect this device to your Mac", 160, 184, Font::Label,
           Align::MiddleCenter, color::ink2);
  }

  // Bottom status row: clock left, battery right.
  c.drawHLine(10, 215, 300, color::hairline);
  c.text(d.date[0] ? d.date : "USB no host", 10, 226, Font::Label,
         Align::MiddleLeft, color::mute);

  char bat[24];
  snprintf(bat, sizeof(bat), "%s %d%%", d.charging ? "Chg" : "Bat", d.batteryPct);
  c.text(bat, 310, 226, Font::Label, Align::MiddleRight, color::ink2);
}

// ── router ───────────────────────────────────────────────────────────────────
void renderPage(PageId id, const StatusModel& m, Canvas& c) {
  switch (id) {
    case PageId::Overview:  drawOverview(m, c);  break;
    case PageId::Cost:      drawCost(m, c);      break;
    case PageId::Limits:    drawLimits(m, c);    break;
    case PageId::Workspace: drawWorkspace(m, c); break;
  }
}

}  // namespace m5render
