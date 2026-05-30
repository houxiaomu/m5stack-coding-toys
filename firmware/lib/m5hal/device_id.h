#pragma once

#include <cstdint>
#include <string>

namespace m5hal {

std::string formatDeviceId(const char* prefix, uint32_t suffix);

}  // namespace m5hal
