#pragma once
#include "canvas.h"
#include "m5hal.h"
#include "status_model.h"

namespace m5render {

enum class PageId : uint8_t { Overview = 0, Cost = 1, Limits = 2, Workspace = 3, Sessions = 4 };
constexpr int kPageCount = 4;
constexpr int kMaxPageCount = 5;
constexpr int kSessionRowsPerPage = 3;
constexpr int kSessionRowX = 10;
constexpr int kSessionRowY = 46;
constexpr int kSessionRowW = 300;
constexpr int kSessionRowH = 44;
constexpr int kSessionRowGap = 8;
constexpr int kSessionNextX1 = 90;
constexpr int kSessionNextX2 = 230;
constexpr int kSessionNextY1 = 190;
constexpr int kSessionNextY2 = 239;
bool hasSessionsPage(const StatusModel& m);
int pageCountFor(const StatusModel& m);
int sessionPageCountFor(const StatusModel& m);

// Badge label/color for an activity (single source of truth for the header).
const char* activityLabel(Activity a);
uint16_t    activityColor(Activity a);
// Linear RGB565 blend: t=255 -> fg, t=0 -> bg, per 5/6/5 channel.
uint16_t    blend565(uint16_t fg, uint16_t bg, uint8_t t);
// Animation brightness (0..255) for an activity at wall-clock nowMs. Breathe
// for Working, gentle pulse for AwaitingInput, hard blink for NeedsAttention.
uint8_t badgeBrightnessFor(Activity a, uint32_t nowMs);

// Device-agnostic page renderers. Each draws using only Canvas primitives and
// semantic Font tiers; they never touch device GFX directly.
void renderPage(PageId id, const StatusModel& m, const DeviceInfo& d, Canvas& c);
// `linked` = host/daemon link is alive but no live Claude session yet.
void renderWaiting(const DeviceInfo& d, bool linked, Canvas& c);
void renderWaiting(
    const DeviceInfo& d,
    bool linked,
    m5hal::TransportUiStatus transport,
    const char* pairCode,
    Canvas& c);
void renderHeader(PageId id, const StatusModel& m, Canvas& c);  // shared top bar
void renderPageDots(PageId active, int total, Canvas& c);       // page indicator
void renderFooter(PageId active, int total, const DeviceInfo& d, Canvas& c);

}  // namespace m5render
