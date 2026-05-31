#pragma once

#include <cstddef>
#include <cstdint>

namespace m5hal {

enum class IconId : uint8_t {
    None = 0,
};

enum class TransportKind : uint8_t {
    None = 0,
    Serial = 1,
    Ble = 2,
};

enum class BleUiState : uint8_t {
    Off = 0,
    Ready = 1,
    Pairing = 2,
    Connected = 3,
    Lost = 4,
};

struct TransportUiStatus {
    TransportKind active = TransportKind::None;
    BleUiState    ble    = BleUiState::Off;
};

struct InputEvent {
    enum Kind : uint8_t {
        ButtonPress = 0,
        ButtonRelease = 1,
        KeyChar = 2,
        TouchTap = 3,
        TouchLongPress = 4,
        Shake = 5,
    };
    Kind     kind;
    uint16_t code;
    int16_t  x;
    int16_t  y;
    uint32_t t_ms;
};

class Display {
public:
    virtual ~Display() = default;
    virtual void clear() = 0;
    virtual void drawText(int x, int y, const char* utf8, uint8_t size) = 0;
    virtual void drawIcon(int x, int y, IconId id) = 0;
    virtual void fillRect(int x, int y, int w, int h, uint32_t rgb) = 0;
    virtual void push() = 0;
    virtual void setBrightness(uint8_t pct) = 0;
    virtual int  width()  const = 0;
    virtual int  height() const = 0;
};

class Input {
public:
    virtual ~Input() = default;
    virtual bool poll(InputEvent& out) = 0;
    virtual bool hasKeyboard() const = 0;
    virtual bool hasTouch()    const = 0;
};

class Power {
public:
    virtual ~Power() = default;
    virtual uint8_t batteryPct() = 0;
    virtual bool    charging() = 0;
    virtual void    vibrate(uint16_t /*ms*/) {}
};

class Transport {
public:
    virtual ~Transport() = default;
    virtual bool begin() = 0;
    virtual bool connected() = 0;
    virtual int  read(uint8_t* buf, std::size_t n) = 0;
    virtual int  write(const uint8_t* buf, std::size_t n) = 0;
    virtual TransportKind kind() const { return TransportKind::None; }
    virtual TransportUiStatus uiStatus() const { return {}; }
};

struct Board {
    Display*    display;
    Input*      input;
    Power*      power;
    Transport*  transport;
    const char* name;
    const char* fw_ver;
    const char* device_id;
    bool (*start_ble_pairing)(uint32_t now_ms);
    bool (*stop_ble_pairing)();
    bool (*ble_pairing_active)();
    const char* (*ble_pair_code)();
};

Board* create_board();

}  // namespace m5hal
