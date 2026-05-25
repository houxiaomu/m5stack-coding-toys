#include "transport_serial.h"

#include <Arduino.h>

namespace m5board::cardputer_adv {

bool SerialTransport::begin() {
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

}  // namespace m5board::cardputer_adv
