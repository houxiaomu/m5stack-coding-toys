#include "device_id.h"

#include <cstdio>

namespace m5hal {

std::string formatDeviceId(const char* prefix, uint32_t suffix) {
    char out[24];
    std::snprintf(out, sizeof(out), "%s-%06X", prefix ? prefix : "M5CT", suffix & 0xFFFFFFu);
    return std::string(out);
}

}  // namespace m5hal
