#include "transport_ble.h"

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <cstdio>
#include <cstring>

#include "ble_uuid.h"

namespace m5board::cores3_se {

namespace {

constexpr std::size_t kNotifyChunk = 180;

class ServerCallbacks : public NimBLEServerCallbacks {
public:
    explicit ServerCallbacks(BleGattTransport& owner) : owner_(owner) {}

    void onConnect(NimBLEServer* /*server*/, NimBLEConnInfo& /*connInfo*/) override {
        owner_.onConnect();
    }

    void onDisconnect(
        NimBLEServer* /*server*/,
        NimBLEConnInfo& /*connInfo*/,
        int /*reason*/) override {
        owner_.onDisconnect();
        NimBLEDevice::startAdvertising();
    }

private:
    BleGattTransport& owner_;
};

class RxCallbacks : public NimBLECharacteristicCallbacks {
public:
    explicit RxCallbacks(BleGattTransport& owner) : owner_(owner) {}

    void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo& /*connInfo*/) override {
        auto value = characteristic->getValue();
        owner_.onRx(reinterpret_cast<const uint8_t*>(value.data()), value.length());
    }

private:
    BleGattTransport& owner_;
};

class InfoCallbacks : public NimBLECharacteristicCallbacks {
public:
    explicit InfoCallbacks(BleGattTransport& owner) : owner_(owner) {}

    void onRead(NimBLECharacteristic* /*characteristic*/, NimBLEConnInfo& /*connInfo*/) override {
        owner_.updateInfoValue();
    }

private:
    BleGattTransport& owner_;
};

}  // namespace

void BleGattTransport::configure(const char* board, const char* fw, const char* deviceId) {
    board_ = board ? board : "cores3-se";
    fw_ = fw ? fw : "0.0.0";
    device_id_ = deviceId ? deviceId : "";
}

bool BleGattTransport::begin() {
    if (begun_) return true;
    std::snprintf(local_name_, sizeof(local_name_), "m5ct-%s", device_id_);
    NimBLEDevice::init(local_name_);
    server_ = NimBLEDevice::createServer();
    static ServerCallbacks serverCallbacks(*this);
    server_->setCallbacks(&serverCallbacks);

    NimBLEService* service = server_->createService(ble_uuid::service);
    NimBLECharacteristic* rx = service->createCharacteristic(
        ble_uuid::rx,
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
    tx_ = service->createCharacteristic(ble_uuid::tx, NIMBLE_PROPERTY::NOTIFY);
    info_ = service->createCharacteristic(ble_uuid::info, NIMBLE_PROPERTY::READ);

    static RxCallbacks rxCallbacks(*this);
    static InfoCallbacks infoCallbacks(*this);
    rx->setCallbacks(&rxCallbacks);
    info_->setCallbacks(&infoCallbacks);
    updateInfoValue();
    begun_ = true;
    updateAdvertising();
    return true;
}

bool BleGattTransport::connected() {
    return connected_;
}

int BleGattTransport::read(uint8_t* buf, std::size_t n) {
    return static_cast<int>(rx_.read(buf, n));
}

int BleGattTransport::write(const uint8_t* buf, std::size_t n) {
    if (!connected_ || !tx_) return 0;
    std::size_t sent = 0;
    while (sent < n) {
        std::size_t take = n - sent;
        if (take > kNotifyChunk) take = kNotifyChunk;
        tx_->setValue(buf + sent, take);
        if (!tx_->notify()) break;
        sent += take;
        delay(2);
    }
    return static_cast<int>(sent);
}

m5hal::TransportUiStatus BleGattTransport::uiStatus() const {
    m5hal::TransportUiStatus st{};
    st.active = connected_ ? m5hal::TransportKind::Ble : m5hal::TransportKind::None;
    if (pairing_) st.ble = m5hal::BleUiState::Pairing;
    else if (connected_) st.ble = m5hal::BleUiState::Connected;
    else st.ble = m5hal::BleUiState::Ready;
    return st;
}

bool BleGattTransport::startPairing(uint32_t nowMs) {
    generatePairCode(nowMs);
    pairing_ = true;
    updateInfoValue();
    updateAdvertising();
    return true;
}

bool BleGattTransport::stopPairing() {
    if (!pairing_) return true;
    pairing_ = false;
    pair_code_[0] = '\0';
    updateInfoValue();
    updateAdvertising();
    return true;
}

void BleGattTransport::onConnect() {
    connected_ = true;
    updateInfoValue();
}

void BleGattTransport::onDisconnect() {
    connected_ = false;
    updateInfoValue();
}

void BleGattTransport::onRx(const uint8_t* data, std::size_t len) {
    if (!data || len == 0) return;
    rx_.write(data, len);
}

void BleGattTransport::updateInfoValue() {
    std::snprintf(
        info_json_,
        sizeof(info_json_),
        "{\"v\":1,\"board\":\"%s\",\"fw\":\"%s\",\"device_id\":\"%s\",\"pairing\":%s%s%s%s}",
        board_,
        fw_,
        device_id_,
        pairing_ ? "true" : "false",
        pairing_ ? ",\"pair_code\":\"" : "",
        pairing_ ? pair_code_ : "",
        pairing_ ? "\"" : "");
    if (info_) info_->setValue(reinterpret_cast<const uint8_t*>(info_json_), std::strlen(info_json_));
}

void BleGattTransport::updateAdvertising() {
    if (!begun_) return;
    std::snprintf(
        local_name_,
        sizeof(local_name_),
        pairing_ ? "m5ct-%s-PAIR" : "m5ct-%s",
        device_id_);
    NimBLEDevice::setDeviceName(local_name_);
    NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
    adv->stop();
    adv->clearData();
    adv->enableScanResponse(true);
    adv->addServiceUUID(ble_uuid::service);
    adv->setName(local_name_);
    adv->start();
}

void BleGattTransport::generatePairCode(uint32_t nowMs) {
    uint32_t v = (esp_random() ^ nowMs) % 1000000;
    std::snprintf(pair_code_, sizeof(pair_code_), "%06u", static_cast<unsigned>(v));
}

}  // namespace m5board::cores3_se
