#pragma once

#include "m5hal.h"

namespace m5hal {

class TransportMux : public Transport {
public:
    TransportMux(Transport* serial, Transport* ble) : serial_(serial), ble_(ble) {}

    bool begin() override;
    bool connected() override;
    int  read(uint8_t* buf, std::size_t n) override;
    int  write(const uint8_t* buf, std::size_t n) override;
    TransportKind kind() const override;
    TransportUiStatus uiStatus() const override;

private:
    Transport* serial_;
    Transport* ble_;
    Transport* active_ = nullptr;

    void clearInactiveActive();
};

}  // namespace m5hal
