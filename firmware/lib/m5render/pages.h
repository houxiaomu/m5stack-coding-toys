#pragma once
#include "canvas.h"
#include "status_model.h"

namespace m5render {

enum class PageId : uint8_t { Overview = 0, Cost = 1, Limits = 2, Workspace = 3 };
constexpr int kPageCount = 4;

// Badge label/color for an activity (single source of truth for the header).
const char* activityLabel(Activity a);
uint16_t    activityColor(Activity a);
// Linear RGB565 blend: t=255 -> fg, t=0 -> bg, per 5/6/5 channel.
uint16_t    blend565(uint16_t fg, uint16_t bg, uint8_t t);

// Device-agnostic page renderers. Each draws using only Canvas primitives and
// semantic Font tiers; they never touch device GFX directly.
void renderPage(PageId id, const StatusModel& m, Canvas& c);
// `linked` = host/daemon link is alive but no live Claude session yet.
void renderWaiting(const DeviceInfo& d, bool linked, Canvas& c);
void renderHeader(const StatusModel& m, Canvas& c);   // shared top bar
void renderPageDots(PageId active, Canvas& c);         // page indicator

}  // namespace m5render
