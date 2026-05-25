#pragma once

// Lightweight serial debug logging, gated behind -DM5CT_DEBUG (dev builds only;
// must be OFF for release since it writes free-form lines onto the same USB
// serial the NDJSON protocol uses). Lines are prefixed "[dbg] " so a raw reader
// can pick them out from protocol frames.
#if defined(M5CT_DEBUG) && !defined(BOARD_MOCK)
#include <Arduino.h>
#define M5CT_DBG(...)            \
  do {                           \
    Serial.print("[dbg] ");      \
    Serial.printf(__VA_ARGS__);  \
    Serial.print('\n');          \
  } while (0)
#else
#define M5CT_DBG(...) \
  do {                \
  } while (0)
#endif
