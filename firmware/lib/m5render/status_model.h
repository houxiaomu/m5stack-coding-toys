#pragma once
#include <ArduinoJson.h>
#include <cstdint>

namespace m5render {

// What Claude is doing right now (mirrors protocol ACTIVITY). Drives the
// header badge color + animation. Defaults to Working when the host omits it.
enum class Activity : uint8_t { Working, AwaitingInput, NeedsAttention };

struct StatusModel {
  // Coarse session liveness from the daemon: true for `active`, false for `idle`.
  bool sessionActive = true;

  // Activity badge state + transient animation brightness (255 = full color,
  // 0 = faded to background). badgeBrightness is set by the app's animation
  // timer each frame; it is not parsed from the wire.
  Activity activity = Activity::Working;
  uint8_t  badgeBrightness = 255;

  // model
  char modelShort[24] = "";
  // context
  bool hasContext = false;
  int  ctxUsedPct = 0; uint32_t ctxTokens = 0; uint32_t ctxLimit = 0; bool exceeds200k = false;
  // cost
  bool hasCost = false;
  float costSessionUsd = 0, costBurnPerHr = 0; int costDurationMin = 0;
  int linesAdded = 0, linesRemoved = 0;
  // block (5h)
  bool hasBlock = false; int blockPct = 0; int blockResetInMin = 0;
  // weekly (7d aggregate)
  bool hasWeekly = false; int weeklyPct = 0;
  // today
  bool hasToday = false; float todayCost = 0; int todaySessions = 0;
  // burnHistory
  int burnN = 0; float burn[16] = {0};
  // workspace
  char wsDir[96] = ""; char wsWorktree[40] = "";
  // git
  bool hasGit = false;
  char branch[40] = ""; int ahead = 0, behind = 0, staged = 0, unstaged = 0, untracked = 0;
  char lastCommitHash[10] = ""; char lastCommitMsg[48] = ""; int lastCommitMins = 0;
  bool hasDiff = false;
  int diffFilesChanged = 0, diffLinesAdded = 0, diffLinesRemoved = 0;
  struct TopFile {
    char path[40] = "";
    int added = 0;
    int removed = 0;
  };
  int topFileN = 0;
  TopFile topFiles[3];
  // pr
  bool hasPr = false; int prNumber = 0; char prReview[16] = "";
  // multi-session focus metadata
  bool hasFocus = false;
  bool focusPinned = false;
  int focusIndex = 0;
  int focusTotal = 0;
  struct SessionSummary {
    int index = 0;
    char id[32] = "";
    char name[40] = "";
    Activity activity = Activity::Working;
    bool selected = false;
    bool pinned = false;
    bool autoMode = false;
  };
  int sessionN = 0;
  int pickerIndex = 0;  // local UI state; not parsed from the wire
  int sessionPageIndex = 0;  // local Sessions picker page; not parsed from the wire
  SessionSummary sessions[8];
};

struct DeviceInfo {
  char board[24] = "CoreS3";
  char fw[16] = "";
  char clock[8] = "--:--";   // RTC HH:MM
  char date[20] = "";
  int  batteryPct = 0; bool charging = false;
};

// Parse one `status` envelope payload (the `p` object) into the model.
// Missing groups leave has*=false.

// Core parser: consumes an already-parsed payload object directly (no
// re-serialize / re-parse). Always returns true (a JsonObjectConst is, by
// construction, valid JSON).
bool parseStatusFrame(JsonObjectConst obj, StatusModel& out);

// Convenience overload: parses a JSON string then delegates to the core.
// Returns false on invalid JSON. Used by the native string-based tests.
bool parseStatusFrame(const char* json, StatusModel& out);

}  // namespace m5render
