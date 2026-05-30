#include "pages.h"

#include <cstring>
#include <cstdio>

#include "dbg.h"

namespace m5render {

// Placeholder rendered for any data group whose has* flag is false.
static const char* kDash = "-";

const char* activityLabel(Activity a) {
  switch (a) {
    case Activity::AwaitingInput:  return "YOUR TURN";
    case Activity::NeedsAttention: return "NEEDS YOU";
    default:                       return "WORKING";
  }
}

uint16_t activityColor(Activity a) {
  switch (a) {
    case Activity::AwaitingInput:  return color::accent;
    case Activity::NeedsAttention: return color::warn;
    default:                       return color::good;
  }
}

uint16_t blend565(uint16_t fg, uint16_t bg, uint8_t t) {
  auto lerp = [&](int a, int b) { return b + ((a - b) * t) / 255; };
  int rf = (fg >> 11) & 0x1F, gf = (fg >> 5) & 0x3F, bf = fg & 0x1F;
  int rb = (bg >> 11) & 0x1F, gb = (bg >> 5) & 0x3F, bb = bg & 0x1F;
  int r = lerp(rf, rb), g = lerp(gf, gb), b = lerp(bf, bb);
  return static_cast<uint16_t>((r << 11) | (g << 5) | b);
}

uint8_t badgeBrightnessFor(Activity a, uint32_t nowMs) {
  uint32_t period; uint8_t floorB;
  switch (a) {
    case Activity::NeedsAttention: period = 500;  floorB = 0;  break; // hard blink
    case Activity::AwaitingInput:  period = 1200; floorB = 100; break; // gentle pulse
    default:                       period = 2000; floorB = 60;  break; // calm breathe
  }
  // Triangle wave: 255 at phase 0, floorB at half period, back up.
  uint32_t t = nowMs % period;
  uint32_t half = period / 2;
  uint32_t up = t < half ? (half - t) : (t - half);   // half..0..half across the period
  uint32_t span = 255 - floorB;
  return static_cast<uint8_t>(floorB + (span * up) / half);
}

static const char* basenameOf(const char* path);

static const char* selectedSessionName(const StatusModel& m) {
  for (int i = 0; i < m.sessionN; ++i) {
    const auto& s = m.sessions[i];
    if (s.selected && s.name[0]) return s.name;
  }
  return nullptr;
}

static const char* headerTitle(PageId id, const StatusModel& m) {
  if (id == PageId::Sessions) return "TERMINALS";
  if (const char* selected = selectedSessionName(m)) return selected;
  if (m.wsWorktree[0]) return m.wsWorktree;
  const char* base = basenameOf(m.wsDir);
  if (std::strcmp(base, kDash) != 0) return base;
  return "Claude";
}

// ── shared header (top bar across data pages) ───────────────────────────────
void renderHeader(PageId id, const StatusModel& m, Canvas& c) {
  M5CT_DBG("hdr start");
  c.fillRoundRect(0, 0, 320, 34, 0, color::bg);  // header band
  M5CT_DBG("hdr fillRoundRect ok");

  // Pages only render while Live, so the dot is always the active accent.
  c.fillCircle(15, 17, 4, color::accent);

  c.text(headerTitle(id, m), 26, 17, Font::Title, Align::MiddleLeft, color::ink);

  // Activity badge top-right. Color + label come from m.activity; brightness is
  // the app's animation phase (255 = full color). Context warning is NOT shown
  // here — the data-page context tiles already render warn color over threshold.
  const char* badge = activityLabel(m.activity);
  uint16_t bColor = blend565(activityColor(m.activity), color::bg, m.badgeBrightness);
  int bw = c.measureText(badge, Font::Label) + 8;
  c.fillRoundRect(316 - bw, 9, bw, 16, 3, color::accSoft);
  c.text(badge, 316 - bw / 2, 17, Font::Label, Align::MiddleCenter, bColor);

  // Hairline under header.
  c.drawHLine(10, 32, 300, color::hairline);
  M5CT_DBG("hdr end");
}

// ── footer: date + page indicator + clock ───────────────────────────────────
void renderPageDots(PageId active, int total, Canvas& c) {
  const int gap = 6, r = 2;
  const int totalW = (total - 1) * gap + total * (r * 2);
  int x = (320 - totalW) / 2 + r;
  int y = 232;
  for (int i = 0; i < total; ++i) {
    c.fillCircle(x, y, r,
                 i == static_cast<int>(active) ? color::ink : color::cardLine);
    x += r * 2 + gap;
  }
}

void renderFooter(PageId active, int total, const DeviceInfo& d, Canvas& c) {
  c.drawHLine(10, 215, 300, color::hairline);
  c.text(d.date[0] ? d.date : "--", 10, 226, Font::Label,
         Align::MiddleLeft, color::mute);
  renderPageDots(active, total, c);
  c.text(d.clock[0] ? d.clock : "--:--", 310, 226, Font::Label,
         Align::MiddleRight, color::ink2);
}

// ── helpers ─────────────────────────────────────────────────────────────────
static void microBarOrDash(Canvas& c, bool has, int x, int y, int w, int h,
                           int pct, uint16_t fg) {
  if (has) c.microBar(x, y, w, h, pct, fg);
}

// Tile: label + big value + optional sub + optional bar. `has` false -> big="-".
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

static const char* basenameOf(const char* path) {
  if (!path || !*path) return kDash;
  const char* slash = std::strrchr(path, '/');
  return slash && slash[1] ? slash + 1 : path;
}

static const char* tailPath(const char* path, int segments, char* out, size_t cap) {
  if (!path || !*path) {
    snprintf(out, cap, "%s", kDash);
    return out;
  }

  const char* start = path + std::strlen(path);
  int seen = 0;
  while (start > path) {
    --start;
    if (*start == '/' && ++seen >= segments) {
      ++start;
      break;
    }
  }
  snprintf(out, cap, "/%s", start);
  return out;
}

static const char* truncateHead(const char* s, int maxChars, char* out, size_t cap) {
  if (!s) s = "";
  int len = static_cast<int>(std::strlen(s));
  if (len <= maxChars) return s;
  int keep = maxChars > 3 ? maxChars - 3 : maxChars;
  snprintf(out, cap, "%.*s...", keep, s);
  return out;
}

static const char* truncateTail(const char* s, int maxChars, char* out, size_t cap) {
  if (!s) s = "";
  int len = static_cast<int>(std::strlen(s));
  if (len <= maxChars) return s;
  int keep = maxChars > 3 ? maxChars - 3 : maxChars;
  snprintf(out, cap, "...%s", s + len - keep);
  return out;
}

static void formatResetIn(char* out, size_t cap, int minutes) {
  if (minutes >= 60) {
    snprintf(out, cap, "resets %dh%dm", minutes / 60, minutes % 60);
    return;
  }
  snprintf(out, cap, "resets %dm", minutes);
}

// ── PAGE · Overview ─────────────────────────────────────────────────────────
static void drawOverview(const StatusModel& m, const DeviceInfo& d, Canvas& c) {
  M5CT_DBG("ov start");
  c.fillScreen(color::bg);
  M5CT_DBG("ov fillScreen ok");
  renderHeader(PageId::Overview, m, c);
  M5CT_DBG("ov header ok");

  // workspace strip
  c.text("$", 10, 40, Font::Label, Align::TopLeft, color::mute);
  c.text(m.wsDir[0] ? m.wsDir : kDash, 18, 40, Font::Label, Align::TopLeft, color::ink2);

  char buf[32], sub1[40], ctxLabel[40];
  // CONTEXT tile
  snprintf(buf, sizeof(buf), "%d%%", m.ctxUsedPct);
  // Only show the "/ Nk" denominator when the host actually sent a limit;
  // assuming 200k would be wrong for million-token-context models.
  if (m.ctxLimit)
    snprintf(sub1, sizeof(sub1), "%dk / %dk tok",
             int(m.ctxTokens / 1000), int(m.ctxLimit / 1000));
  else
    snprintf(sub1, sizeof(sub1), "%dk tok", int(m.ctxTokens / 1000));
  if (m.modelShort[0])
    snprintf(ctxLabel, sizeof(ctxLabel), "CONTEXT / %s", m.modelShort);
  else
    snprintf(ctxLabel, sizeof(ctxLabel), "CONTEXT");
  drawTile(c, 10, 56, 150, 74, ctxLabel, m.hasContext, buf, sub1,
           m.ctxUsedPct, m.hasContext && (m.exceeds200k || m.ctxUsedPct >= 80));

  // 5H BLOCK tile
  char blk[24], blkSub[24];
  snprintf(blk, sizeof(blk), "%d%%", m.blockPct);
  if (m.blockResetInMin > 0)
    formatResetIn(blkSub, sizeof(blkSub), m.blockResetInMin);
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
  const int linesAdded = m.hasDiff ? m.diffLinesAdded : m.linesAdded;
  const int linesRemoved = m.hasDiff ? m.diffLinesRemoved : m.linesRemoved;
  snprintf(diff, sizeof(diff), "+%d / -%d", linesAdded, linesRemoved);
  snprintf(gs, sizeof(gs), "%dS %dM %dU", m.staged, m.unstaged, m.untracked);
  drawTile(c, 165, 135, 150, 74, "DIFF", m.hasGit, diff, gs, -1, false);
  M5CT_DBG("ov tiles ok");

  renderFooter(PageId::Overview, pageCountFor(m), d, c);
  M5CT_DBG("ov dots ok");
}

// ── PAGE · Cost ──────────────────────────────────────────────────────────────
static void drawCost(const StatusModel& m, const DeviceInfo& d, Canvas& c) {
  c.fillScreen(color::bg);
  renderHeader(PageId::Cost, m, c);

  c.text("THIS SESSION", 10, 42, Font::Label, Align::TopLeft, color::mute);

  if (!m.hasCost) {
    c.text(kDash, 10, 54, Font::BigNumber, Align::TopLeft, color::ink);
    renderFooter(PageId::Cost, pageCountFor(m), d, c);
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

  // Rows: account-level today total, then aggregate WEEKLY (no per-model split).
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
  row("TODAY TOTAL",  m.hasToday,  tBuf);
  row("WEEKLY", m.hasWeekly, wBuf);

  renderFooter(PageId::Cost, pageCountFor(m), d, c);
}

// ── PAGE · Limits (single aggregate weekly) ──────────────────────────────────
static void drawLimits(const StatusModel& m, const DeviceInfo& d, Canvas& c) {
  c.fillScreen(color::bg);
  renderHeader(PageId::Limits, m, c);

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

  renderFooter(PageId::Limits, pageCountFor(m), d, c);
}

// ── PAGE · Workspace ─────────────────────────────────────────────────────────
static void drawWorkspace(const StatusModel& m, const DeviceInfo& d, Canvas& c) {
  c.fillScreen(color::bg);
  renderHeader(PageId::Workspace, m, c);

  if (!m.hasGit) {
    c.text(m.wsDir[0] ? m.wsDir : kDash, 10, 42, Font::Title, Align::TopLeft, color::ink);
    c.text(kDash, 10, 90, Font::Body, Align::TopLeft, color::ink2);
    renderFooter(PageId::Workspace, pageCountFor(m), d, c);
    return;
  }

  const bool dirty = m.staged > 0 || m.unstaged > 0 || m.untracked > 0;
  const int linesAdded = m.hasDiff ? m.diffLinesAdded : m.linesAdded;
  const int linesRemoved = m.hasDiff ? m.diffLinesRemoved : m.linesRemoved;

  char ab[24];
  snprintf(ab, sizeof(ab), "^%d v%d", m.ahead, m.behind);

  c.text(m.branch[0] ? m.branch : kDash, 10, 42, Font::Title, Align::TopLeft, color::ink);
  c.text(dirty ? "dirty" : "clean", 310, 42, Font::Label, Align::TopRight,
         dirty ? color::warn : color::accent);
  c.text(ab, 310, 58, Font::Label, Align::TopRight, color::mute);

  char repoName[24], rawPathHint[48], pathHint[32];
  const char* workspaceName = m.wsWorktree[0] ? m.wsWorktree : basenameOf(m.wsDir);
  c.text(truncateHead(workspaceName, 18, repoName, sizeof(repoName)),
         10, 64, Font::Label, Align::TopLeft, color::ink2);
  c.text(truncateTail(tailPath(m.wsDir, 2, rawPathHint, sizeof(rawPathHint)),
                      24, pathHint, sizeof(pathHint)),
         310, 64, Font::Label, Align::TopRight, color::mute);
  c.drawHLine(10, 80, 300, color::hairline);

  int y = 92;
  auto row = [&](const char* label, const char* value) {
    c.text(label, 10, y, Font::Label, Align::TopLeft, color::mute);
    c.text(value, 310, y, Font::Label, Align::TopRight, color::ink);
    y += 24;
  };

  if (dirty) {
    char files[48];
    snprintf(files, sizeof(files), "%d staged   %d modified   %d new",
             m.staged, m.unstaged, m.untracked);
    row("Files", files);

    char lines[32];
    snprintf(lines, sizeof(lines), "+%d       -%d", linesAdded, linesRemoved);
    row("Lines", lines);

    c.text("Top", 10, y, Font::Label, Align::TopLeft, color::mute);
    y += 16;
    if (m.topFileN > 0) {
      const int n = m.topFileN > 2 ? 2 : m.topFileN;
      for (int i = 0; i < n; ++i) {
        char churn[24];
        snprintf(churn, sizeof(churn), "+%d / -%d",
                 m.topFiles[i].added, m.topFiles[i].removed);
        c.text(basenameOf(m.topFiles[i].path), 10, y, Font::Label,
               Align::TopLeft, color::ink);
        c.text(churn, 310, y, Font::Label, Align::TopRight, color::ink2);
        y += 18;
      }
    } else {
      c.text("uncommitted changes", 10, y, Font::Label, Align::TopLeft, color::ink);
    }
  } else {
    row("Status", "no local changes");

    if (m.lastCommitHash[0]) {
      char age[16];
      snprintf(age, sizeof(age), "%dm", m.lastCommitMins);
      c.text("Commit", 10, y, Font::Label, Align::TopLeft, color::mute);
      c.text(age, 310, y, Font::Label, Align::TopRight, color::ink2);
      y += 18;
      c.text(m.lastCommitHash, 10, y, Font::Mono, Align::TopLeft, color::ink);
      if (m.lastCommitMsg[0])
        c.text(m.lastCommitMsg, 70, y, Font::Label, Align::TopLeft, color::ink2);
    }
  }

  renderFooter(PageId::Workspace, pageCountFor(m), d, c);
}

// ── PAGE · Sessions ─────────────────────────────────────────────────────────
static void drawSessions(const StatusModel& m, const DeviceInfo& d, Canvas& c) {
  c.fillScreen(color::bg);
  renderHeader(PageId::Sessions, m, c);

  if (m.sessionN <= 0) {
    c.text(kDash, 10, 58, Font::Body, Align::TopLeft, color::ink);
    renderFooter(PageId::Sessions, pageCountFor(m), d, c);
    return;
  }

  const int totalPages = sessionPageCountFor(m);
  const int page = m.sessionPageIndex < totalPages ? m.sessionPageIndex : totalPages - 1;
  const int start = page * kSessionRowsPerPage;
  int y = kSessionRowY;
  for (int row = 0; row < kSessionRowsPerPage; ++row) {
    const int i = start + row;
    if (i >= m.sessionN) break;
    const auto& s = m.sessions[i];
    const uint16_t border = s.selected ? color::ink2 : color::cardLine;
    c.fillRoundRect(kSessionRowX, y, kSessionRowW, kSessionRowH, 4,
                    s.selected ? color::accSoft : color::card);
    c.drawRoundRect(kSessionRowX, y, kSessionRowW, kSessionRowH, 4, border);
    c.text(s.name[0] ? s.name : kDash, 18, y + kSessionRowH / 2, Font::Label,
           Align::MiddleLeft, color::ink);
    c.text(activityLabel(s.activity), 302, y + kSessionRowH / 2, Font::Label,
           Align::MiddleRight, activityColor(s.activity));
    y += kSessionRowH + kSessionRowGap;
  }

  c.drawHLine(10, 215, 300, color::hairline);
  c.text(d.date[0] ? d.date : "--", 10, 226, Font::Label,
         Align::MiddleLeft, color::mute);
  if (totalPages > 1) {
    char next[16];
    snprintf(next, sizeof(next), "NEXT %d/%d", page + 1, totalPages);
    c.text(next, 160, 226, Font::Label, Align::MiddleCenter, color::ink);
  }
  c.text(d.clock[0] ? d.clock : "--:--", 310, 226, Font::Label,
         Align::MiddleRight, color::ink2);
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
void renderPage(PageId id, const StatusModel& m, const DeviceInfo& d, Canvas& c) {
  switch (id) {
    case PageId::Overview:  drawOverview(m, d, c);  break;
    case PageId::Cost:      drawCost(m, d, c);      break;
    case PageId::Limits:    drawLimits(m, d, c);    break;
    case PageId::Workspace: drawWorkspace(m, d, c); break;
    case PageId::Sessions:  drawSessions(m, d, c);  break;
  }
}

bool hasSessionsPage(const StatusModel& m) {
  return m.sessionN >= 2;
}

int pageCountFor(const StatusModel& m) {
  (void)m;
  return kPageCount;
}

int sessionPageCountFor(const StatusModel& m) {
  if (m.sessionN <= 0) return 1;
  return (m.sessionN + kSessionRowsPerPage - 1) / kSessionRowsPerPage;
}

}  // namespace m5render
