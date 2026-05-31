#pragma once

#include <cstddef>
#include <cstdint>

#include "m5hal.h"
#include "ring_buffer.h"

class NimBLECharacteristic;
class NimBLEServer;

namespace m5board::cores3_se {

class BleGattTransport : public m5hal::Transport {
public:
    void configure(const char* board, const char* fw, const char* deviceId);

    bool begin() override;
    bool connected() override;
    int  read(uint8_t* buf, std::size_t n) override;
    int  write(const uint8_t* buf, std::size_t n) override;
    m5hal::TransportKind kind() const override { return m5hal::TransportKind::Ble; }
    m5hal::TransportUiStatus uiStatus() const override;

    bool startPairing(uint32_t nowMs);
    bool stopPairing();
    bool pairingActive() const { return pairing_; }
    const char* pairCode() const { return pairing_ ? pair_code_ : ""; }

    void onConnect();
    void onDisconnect();
    void onRx(const uint8_t* data, std::size_t len);
    void updateInfoValue();

private:
    void updateAdvertising();
    void generatePairCode(uint32_t nowMs);

    const char* board_ = "cores3-se";
    const char* fw_ = "0.0.0";
    const char* device_id_ = "";
    bool begun_ = false;
    bool connected_ = false;
    bool pairing_ = false;
    char pair_code_[7] = "";
    char local_name_[48] = "";
    char info_json_[256] = "";

    NimBLEServer* server_ = nullptr;
    NimBLECharacteristic* tx_ = nullptr;
    NimBLECharacteristic* info_ = nullptr;
    m5hal::ByteRingBuffer<4096> rx_;
};

}  // namespace m5board::cores3_se
