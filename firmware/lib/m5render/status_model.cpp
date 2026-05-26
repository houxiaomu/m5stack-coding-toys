#include "status_model.h"
#include <ArduinoJson.h>
#include <cstring>

namespace m5render {

static void copyStr(char* dst, size_t cap, const char* src) {
  if (!src) { dst[0] = 0; return; }
  strncpy(dst, src, cap - 1); dst[cap - 1] = 0;
}

bool parseStatusFrame(JsonObjectConst doc, StatusModel& m) {
  m.sessionActive = strcmp(doc["state"] | "active", "idle") != 0;
  if (doc["model"]["short"].is<const char*>()) copyStr(m.modelShort, sizeof(m.modelShort), doc["model"]["short"]);

  if (doc["context"].is<JsonObjectConst>()) {
    m.hasContext = true;
    m.ctxUsedPct = doc["context"]["usedPct"] | 0;
    m.ctxTokens  = doc["context"]["tokens"]  | 0u;
    m.ctxLimit   = doc["context"]["limit"]   | 0u;
    m.exceeds200k = doc["context"]["exceeds200k"] | false;
  }
  if (doc["cost"].is<JsonObjectConst>()) {
    m.hasCost = true;
    m.costSessionUsd = doc["cost"]["sessionUsd"] | 0.0f;
    m.costBurnPerHr  = doc["cost"]["burnPerHr"]  | 0.0f;
    m.costDurationMin = doc["cost"]["durationMin"] | 0;
    m.linesAdded = doc["cost"]["linesAdded"] | 0;
    m.linesRemoved = doc["cost"]["linesRemoved"] | 0;
  }
  if (doc["block"].is<JsonObjectConst>()) {
    m.hasBlock = true;
    m.blockPct = doc["block"]["usedPct"] | 0;
    m.blockResetInMin = doc["block"]["resetInMin"] | 0;
  }
  if (doc["weekly"].is<JsonObjectConst>()) {
    m.hasWeekly = true;
    m.weeklyPct = doc["weekly"]["usedPct"] | 0;
  }
  if (doc["today"].is<JsonObjectConst>()) {
    m.hasToday = true;
    m.todayCost = doc["today"]["costUsd"] | 0.0f;
    m.todaySessions = doc["today"]["sessions"] | 0;
  }
  if (doc["burnHistory"].is<JsonArrayConst>()) {
    JsonArrayConst arr = doc["burnHistory"].as<JsonArrayConst>();
    size_t total = arr.size();
    size_t skip = total > 16 ? total - 16 : 0;
    m.burnN = 0;
    size_t i = 0;
    for (JsonVariantConst v : arr) {
      if (i++ >= skip) m.burn[m.burnN++] = v.as<float>();
    }
  }
  if (doc["workspace"].is<JsonObjectConst>()) {
    copyStr(m.wsDir, sizeof(m.wsDir), doc["workspace"]["dir"] | "");
    copyStr(m.wsWorktree, sizeof(m.wsWorktree), doc["workspace"]["worktree"] | "");
  }
  if (doc["git"].is<JsonObjectConst>()) {
    m.hasGit = true;
    copyStr(m.branch, sizeof(m.branch), doc["git"]["branch"] | "");
    m.ahead = doc["git"]["ahead"] | 0; m.behind = doc["git"]["behind"] | 0;
    m.staged = doc["git"]["staged"] | 0; m.unstaged = doc["git"]["unstaged"] | 0;
    m.untracked = doc["git"]["untracked"] | 0;
    copyStr(m.lastCommitHash, sizeof(m.lastCommitHash), doc["git"]["lastCommit"]["hash"] | "");
    copyStr(m.lastCommitMsg, sizeof(m.lastCommitMsg), doc["git"]["lastCommit"]["msg"] | "");
    m.lastCommitMins = doc["git"]["lastCommit"]["minsAgo"] | 0;
    if (doc["git"]["diff"].is<JsonObjectConst>()) {
      JsonObjectConst diff = doc["git"]["diff"].as<JsonObjectConst>();
      m.hasDiff = true;
      m.diffFilesChanged = diff["filesChanged"] | 0;
      m.diffLinesAdded = diff["linesAdded"] | 0;
      m.diffLinesRemoved = diff["linesRemoved"] | 0;
      if (diff["topFiles"].is<JsonArrayConst>()) {
        m.topFileN = 0;
        for (JsonObjectConst file : diff["topFiles"].as<JsonArrayConst>()) {
          if (m.topFileN >= 3) break;
          StatusModel::TopFile& topFile = m.topFiles[m.topFileN++];
          copyStr(topFile.path, sizeof(topFile.path), file["path"] | "");
          topFile.added = file["added"] | 0;
          topFile.removed = file["removed"] | 0;
        }
      }
    }
  }
  if (doc["pr"].is<JsonObjectConst>()) {
    m.hasPr = true;
    m.prNumber = doc["pr"]["number"] | 0;
    copyStr(m.prReview, sizeof(m.prReview), doc["pr"]["reviewState"] | "");
  }
  return true;
}

bool parseStatusFrame(const char* json, StatusModel& m) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  return parseStatusFrame(doc.as<JsonObjectConst>(), m);
}

}  // namespace m5render
