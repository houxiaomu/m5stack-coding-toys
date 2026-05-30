#include "time_util.h"

namespace m5render {

namespace {

// Days since 1970-01-01 for a proleptic-Gregorian civil date (Howard Hinnant's
// algorithm). Portable, branch-only integer math — no libc time functions, so
// it works identically on the ESP32 toolchain (which lacks timegm) and on host.
long long daysFromCivil(int y, int m, int d) {
  y -= m <= 2;
  const long long era = (y >= 0 ? y : y - 399) / 400;
  const int       yoe = static_cast<int>(y - era * 400);
  const int       doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const int       doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097LL + doe - 719468;
}

// Inverse of daysFromCivil: civil date for a day count since 1970-01-01.
void civilFromDays(long long z, int& y, int& m, int& d) {
  z += 719468;
  const long long era = (z >= 0 ? z : z - 146096) / 146097;
  const int       doe = static_cast<int>(z - era * 146097);
  const int       yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  y                   = static_cast<int>(yoe + era * 400);
  const int doy       = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const int mp        = (5 * doy + 2) / 153;
  d                   = doy - (153 * mp + 2) / 5 + 1;
  m                   = mp + (mp < 10 ? 3 : -9);
  y += (m <= 2);
}

}  // namespace

LocalClock localFromUtc(int year, int month, int day, int hour, int minute, int second,
                        int offsetMin) {
  long long secs = daysFromCivil(year, month, day) * 86400LL + hour * 3600LL + minute * 60LL +
                   second + static_cast<long long>(offsetMin) * 60;
  // Floor-divide into whole days + seconds-of-day so negative epochs roll back
  // the date correctly.
  long long days = secs / 86400;
  long long sod  = secs % 86400;
  if (sod < 0) {
    sod += 86400;
    days -= 1;
  }
  LocalClock lc{};
  civilFromDays(days, lc.year, lc.month, lc.day);
  lc.hour   = static_cast<int>(sod / 3600);
  lc.minute = static_cast<int>((sod % 3600) / 60);
  lc.second = static_cast<int>(sod % 60);
  return lc;
}

}  // namespace m5render
