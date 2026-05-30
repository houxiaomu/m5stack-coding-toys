#pragma once

namespace m5render {

// Broken-down local wall-clock fields produced by localFromUtc().
struct LocalClock {
  int year;
  int month;
  int day;
  int hour;
  int minute;
  int second;
};

// Convert a UTC broken-down time plus an east-of-UTC offset (minutes) into
// local wall-clock fields. offsetMin is minutes EAST of UTC (UTC+8 → +480),
// so local = utc + offsetMin. Handles day/month/year rollover.
LocalClock localFromUtc(int year, int month, int day, int hour, int minute, int second,
                        int offsetMin);

}  // namespace m5render
