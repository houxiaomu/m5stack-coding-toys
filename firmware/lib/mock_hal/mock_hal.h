#pragma once
#include "m5hal.h"

#include <cstddef>
#include <string>
#include <vector>

namespace m5hal::mock {

struct FillRectCall {
    int x, y, w, h;
    uint32_t rgb;
};
struct DrawTextCall {
    int x, y;
    std::string text;
    uint8_t size;
};

class MockDisplay : public Display {
public:
    void clear() override {
        last_text_.clear();
        texts_.clear();
        rects_.clear();
        cleared_count_++;
    }
    void drawText(int x, int y, const char* utf8, uint8_t size) override {
        last_text_ = utf8;
        texts_.push_back({x, y, utf8, size});
    }
    void drawIcon(int, int, IconId) override {}
    void fillRect(int x, int y, int w, int h, uint32_t rgb) override {
        rects_.push_back({x, y, w, h, rgb});
    }
    void push() override {}
    void setBrightness(uint8_t) override {}
    int  width()  const override { return 320; }
    int  height() const override { return 240; }
    const std::string& last_text() const { return last_text_; }
    const std::vector<DrawTextCall>& texts() const { return texts_; }
    const std::vector<FillRectCall>& rects() const { return rects_; }
    int cleared_count() const { return cleared_count_; }
    // True if any drawText anywhere contained the substring.
    bool contains_text(const char* needle) const {
        for (const auto& t : texts_) {
            if (t.text.find(needle) != std::string::npos) return true;
        }
        return false;
    }
    void reset() {
        last_text_.clear();
        texts_.clear();
        rects_.clear();
        cleared_count_ = 0;
    }
private:
    std::string last_text_;
    std::vector<DrawTextCall> texts_;
    std::vector<FillRectCall> rects_;
    int cleared_count_ = 0;
};

class MockInput : public Input {
public:
    bool poll(InputEvent& /*out*/) override { return false; }
    bool hasKeyboard() const override { return false; }
    bool hasTouch()    const override { return true; }
};

class MockPower : public Power {
public:
    uint8_t batteryPct() override { return 100; }
    bool    charging() override { return true; }
};

class MockTransport : public Transport {
public:
    bool begin() override { return true; }
    bool connected() override { return connected_; }
    void set_connected(bool v) { connected_ = v; }
    int  read(uint8_t* buf, std::size_t n) override {
        std::size_t avail = rx_.size();
        std::size_t take  = n < avail ? n : avail;
        for (std::size_t i = 0; i < take; ++i) buf[i] = rx_[i];
        rx_.erase(rx_.begin(), rx_.begin() + take);
        return static_cast<int>(take);
    }
    int  write(const uint8_t* buf, std::size_t n) override {
        tx_.insert(tx_.end(), buf, buf + n);
        return static_cast<int>(n);
    }
    void feed(const char* s) {
        for (const char* p = s; *p; ++p) rx_.push_back(static_cast<uint8_t>(*p));
    }
    std::string drain_tx() {
        std::string s(tx_.begin(), tx_.end());
        tx_.clear();
        return s;
    }
private:
    std::vector<uint8_t> rx_;
    std::vector<uint8_t> tx_;
    bool connected_ = true;
};

MockDisplay&   display();
MockTransport& transport();

}  // namespace m5hal::mock
