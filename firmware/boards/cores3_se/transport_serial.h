#pragma once
#include "m5hal.h"

namespace m5board::cores3_se {

class SerialTransport : public m5hal::Transport {
public:
    bool begin() override;
    bool connected() override;
    int  read(uint8_t* buf, std::size_t n) override;
    int  write(const uint8_t* buf, std::size_t n) override;
};

}  // namespace m5board::cores3_se
