#include "transport_mux.h"

namespace m5hal {

bool TransportMux::begin() {
    bool ok = true;
    if (serial_) ok = serial_->begin() && ok;
    if (ble_) ok = ble_->begin() && ok;
    return ok;
}

bool TransportMux::connected() {
    clearInactiveActive();
    return active_ && active_->connected();
}

int TransportMux::read(uint8_t* buf, std::size_t n) {
    clearInactiveActive();
    if (serial_ && serial_->connected()) {
        int got = serial_->read(buf, n);
        if (got > 0) {
            active_ = serial_;
            return got;
        }
    }
    if (active_ && active_->connected()) {
        int got = active_->read(buf, n);
        if (got > 0) return got;
    }
    if (ble_ && ble_ != active_ && ble_->connected()) {
        int got = ble_->read(buf, n);
        if (got > 0) {
            active_ = ble_;
            return got;
        }
    }
    return 0;
}

int TransportMux::write(const uint8_t* buf, std::size_t n) {
    clearInactiveActive();
    if (!active_ || !active_->connected()) return 0;
    return active_->write(buf, n);
}

TransportKind TransportMux::kind() const {
    if (!active_) return TransportKind::None;
    return active_->kind();
}

TransportUiStatus TransportMux::uiStatus() const {
    TransportUiStatus st{};
    st.active = kind();
    if (ble_) st.ble = ble_->uiStatus().ble;
    return st;
}

void TransportMux::clearInactiveActive() {
    if (active_ && !active_->connected()) active_ = nullptr;
}

}  // namespace m5hal
