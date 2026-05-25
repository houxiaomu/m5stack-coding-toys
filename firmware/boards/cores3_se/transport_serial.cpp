#include "transport_serial.h"

#include <Arduino.h>

namespace m5board::cores3_se {

bool SerialTransport::begin() {
    // ESP32-S3 HWCDC default RX FIFO is 256 bytes — too small for status frames
    // (git enrichment pushes them past 700B). Without this, large frames arrive
    // truncated and fail to decode. Must be called before begin().
    Serial.setRxBufferSize(4096);
    Serial.begin(115200);
    delay(50);
    return true;
}

bool SerialTransport::connected() {
    return static_cast<bool>(Serial);
}

int SerialTransport::read(uint8_t* buf, std::size_t n) {
    int avail = Serial.available();
    if (avail <= 0) return 0;
    std::size_t take = (n < static_cast<std::size_t>(avail)) ? n : static_cast<std::size_t>(avail);
    return Serial.readBytes(buf, take);
}

int SerialTransport::write(const uint8_t* buf, std::size_t n) {
    return Serial.write(buf, n);
}

}  // namespace m5board::cores3_se
