#include "time_util.h"

#include <ctime>

namespace m5render {

LocalClock localFromUtc(int year, int month, int day, int hour, int minute, int second,
                        int offsetMin) {
  std::tm u{};
  u.tm_year = year - 1900;
  u.tm_mon  = month - 1;
  u.tm_mday = day;
  u.tm_hour = hour;
  u.tm_min  = minute;
  u.tm_sec  = second;
  // timegm interprets the fields as UTC (no local-timezone application).
  std::time_t t = timegm(&u) + static_cast<std::time_t>(offsetMin) * 60;
  std::tm l{};
  gmtime_r(&t, &l);
  return LocalClock{l.tm_year + 1900, l.tm_mon + 1, l.tm_mday, l.tm_hour, l.tm_min, l.tm_sec};
}

}  // namespace m5render
