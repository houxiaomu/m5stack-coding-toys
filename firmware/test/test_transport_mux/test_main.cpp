#include <unity.h>

#include <cstring>
#include <string>

#include "transport_mux.h"

using namespace m5hal;

class FakeTransport : public Transport {
public:
    explicit FakeTransport(TransportKind k) : kind_(k) {}

    bool begin() override {
        begun = true;
        return true;
    }

    bool connected() override { return isConnected; }

    int read(uint8_t* buf, std::size_t n) override {
        if (rx.empty()) return 0;
        std::size_t take = rx.size() < n ? rx.size() : n;
        std::memcpy(buf, rx.data(), take);
        rx.erase(0, take);
        return static_cast<int>(take);
    }

    int write(const uint8_t* buf, std::size_t n) override {
        tx.append(reinterpret_cast<const char*>(buf), n);
        return static_cast<int>(n);
    }

    TransportKind kind() const override { return kind_; }

    bool          begun       = false;
    bool          isConnected = true;
    std::string   rx;
    std::string   tx;
    TransportKind kind_;
};

void test_first_readable_transport_becomes_active() {
    FakeTransport serial(TransportKind::Serial);
    FakeTransport ble(TransportKind::Ble);
    ble.rx = "hi";
    TransportMux mux(&serial, &ble);
    mux.begin();

    uint8_t buf[8]{};
    TEST_ASSERT_EQUAL_INT(2, mux.read(buf, sizeof(buf)));
    TEST_ASSERT_EQUAL_INT(static_cast<int>(TransportKind::Ble), static_cast<int>(mux.kind()));
    TEST_ASSERT_EQUAL_STRING("hi", reinterpret_cast<const char*>(buf));
}

void test_writes_go_to_active_transport() {
    FakeTransport serial(TransportKind::Serial);
    FakeTransport ble(TransportKind::Ble);
    ble.rx = "x";
    TransportMux mux(&serial, &ble);
    uint8_t buf[2]{};
    mux.read(buf, sizeof(buf));

    const uint8_t out[] = {'o', 'k'};
    TEST_ASSERT_EQUAL_INT(2, mux.write(out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("", serial.tx.c_str());
    TEST_ASSERT_EQUAL_STRING("ok", ble.tx.c_str());
}

void test_serial_can_override_ble_active_transport() {
    FakeTransport serial(TransportKind::Serial);
    FakeTransport ble(TransportKind::Ble);
    ble.rx = "b";
    TransportMux mux(&serial, &ble);
    uint8_t buf[2]{};
    mux.read(buf, sizeof(buf));

    serial.rx = "s";
    TEST_ASSERT_EQUAL_INT(1, mux.read(buf, sizeof(buf)));
    TEST_ASSERT_EQUAL_INT(static_cast<int>(TransportKind::Serial), static_cast<int>(mux.kind()));
    TEST_ASSERT_EQUAL_CHAR('s', buf[0]);
}

void test_disconnected_active_transport_clears_active() {
    FakeTransport serial(TransportKind::Serial);
    FakeTransport ble(TransportKind::Ble);
    ble.rx = "b";
    TransportMux mux(&serial, &ble);
    uint8_t buf[2]{};
    mux.read(buf, sizeof(buf));
    ble.isConnected = false;

    TEST_ASSERT_FALSE(mux.connected());
    TEST_ASSERT_EQUAL_INT(static_cast<int>(TransportKind::None), static_cast<int>(mux.kind()));
}

void setUp() {}
void tearDown() {}

int main(int /*argc*/, char** /*argv*/) {
    UNITY_BEGIN();
    RUN_TEST(test_first_readable_transport_becomes_active);
    RUN_TEST(test_writes_go_to_active_transport);
    RUN_TEST(test_serial_can_override_ble_active_transport);
    RUN_TEST(test_disconnected_active_transport_clears_active);
    return UNITY_END();
}
