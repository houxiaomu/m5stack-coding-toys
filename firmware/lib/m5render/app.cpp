#include "app.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "base64.h"
#include "codec.h"
#include "dbg.h"
#include "messages.h"

#ifndef BOARD_MOCK
#include <M5Unified.h>  // millis(), M5.Rtc
#endif

namespace m5render {

namespace {

// Capabilities CoreS3 announces in hello.ack. Valid under protocol CAPS
// (display / buttons / touch / haptic / notify); CoreS3 has a display + touch.
const char* CAPS_CORES3[] = {"display", "touch"};
constexpr std::size_t CAPS_CORES3_N = sizeof(CAPS_CORES3) / sizeof(CAPS_CORES3[0]);

// No inbound frame (incl. ping) for this long → link is dead → NoLink.
constexpr uint32_t LINK_TIMEOUT_MS = 15000;

}  // namespace

App::App(Canvas& canvas, m5hal::Board* board)
    : canvas_(canvas), board_(board), framer_() {
#ifdef BOARD_MOCK
    now_ = nullptr;   // tests inject via setNowFn; until then now()==0
#else
    now_ = +[]() -> uint32_t { return millis(); };
#endif
}

void App::boot() {
    if (board_ && board_->transport) board_->transport->begin();
    refreshDeviceInfo();
    link_  = LinkState::NoLink;
    dirty_ = true;
    render();
    M5CT_DBG("boot done; transport=%d", board_ && board_->transport ? 1 : 0);
}

void App::tick() {
    if (!board_) return;
    pollInput();
    checkLink();

    if (board_->transport) {
        uint8_t buf[256];
        int n = board_->transport->read(buf, sizeof(buf));
        if (n > 0) {
            M5CT_DBG("rx n=%d", n);
            framer_.push(buf, static_cast<std::size_t>(n),
                         [this](const char* line, std::size_t len) {
                             this->handleLine(line, len);
                         });
        }
    }
    render();
}

void App::handleLine(const char* line, std::size_t len) {
    M5CT_DBG("line len=%u: %.100s", static_cast<unsigned>(len), line);
    m5proto::DecodedEnvelope env;
    m5proto::DecodeResult dr = m5proto::decode(line, len, env);
    if (dr != m5proto::DecodeResult::Ok) {
        M5CT_DBG("decode FAIL r=%d", static_cast<int>(dr));
        return;
    }
    M5CT_DBG("decode ok kind=%s", env.kind);

    // Any decoded frame proves the host link is alive.
    lastRxMs_ = now();
    if (link_ == LinkState::NoLink) {
        link_  = LinkState::Linked;
        dirty_ = true;
    }

    if (std::strcmp(env.kind, m5proto::kind::hello) == 0) {
        // Minimal handshake: reply hello.ack with board/fw/caps.
        const char* boardName = (board_ && board_->name) ? board_->name : "cores3-se";
        const char* fw        = (board_ && board_->fw_ver) ? board_->fw_ver : "0.0.0";
        static char deviceId[40];
        std::snprintf(deviceId, sizeof(deviceId), "M5SE-%s", boardName);
        char out[512];
        std::size_t n = m5proto::encode_hello_ack(
            env.id, 0, boardName, fw, CAPS_CORES3, CAPS_CORES3_N, deviceId, out, sizeof(out));
        if (n > 0) send(out, n);
        return;
    }

    if (std::strcmp(env.kind, m5proto::kind::ping) == 0) {
        char out[128];
        std::size_t n = m5proto::encode_pong(env.id, 0, out, sizeof(out));
        if (n > 0) send(out, n);
        return;
    }

    if (std::strcmp(env.kind, m5proto::kind::screenshot) == 0) {
        std::vector<uint8_t> png;
        if (canvas_.capturePng(png) && !png.empty()) {
            std::string b64 = m5proto::base64Encode(png.data(), png.size());
            std::string line = m5proto::encode_screenshot_ack(
                env.id, 0, true, canvas_.width(), canvas_.height(), b64, nullptr);
            send(line.c_str(), line.size());
        } else {
            std::string line = m5proto::encode_screenshot_ack(
                env.id, 0, false, 0, 0, std::string(), "capture_unsupported");
            send(line.c_str(), line.size());
        }
        return;
    }

    if (std::strcmp(env.kind, m5proto::kind::status) == 0) {
        bool wasLive = (link_ == LinkState::Live);
        bool ok = parseStatusFrame(env.doc["p"].as<JsonObjectConst>(), model_);
        M5CT_DBG("status parse=%d active=%d", ok ? 1 : 0, model_.sessionActive ? 1 : 0);
        if (ok) {
            if (model_.sessionActive) {
                if (!wasLive) page_ = PageId::Overview;  // first live frame → overview
                link_ = LinkState::Live;
            } else {
                link_ = LinkState::Linked;               // explicit idle
            }
            dirty_ = true;
        }
        return;
    }
    // Unknown kinds (notify, etc.) are silently ignored by the status display.
}

void App::pollInput() {
    if (!board_ || !board_->input) return;
    m5hal::InputEvent e{};
    if (!board_->input->poll(e)) return;
    if (e.kind != m5hal::InputEvent::TouchTap) return;
    if (link_ != LinkState::Live) return;  // paging only on status pages
    page_ = static_cast<PageId>((static_cast<int>(page_) + 1) % kPageCount);
    dirty_ = true;
}

void App::checkLink() {
    if (link_ == LinkState::NoLink) return;
    // Physical USB unplug: the CDC link drops immediately. Revert without
    // waiting out the silence timeout so the screen returns to "waiting"
    // promptly instead of freezing on the last frame for up to 15s.
    if (board_->transport && !board_->transport->connected()) {
        link_  = LinkState::NoLink;
        dirty_ = true;
        return;
    }
    // lastRxMs_ is always set when leaving NoLink (handleLine sets it before
    // lifting NoLink), so the timer is well-defined here.
    if (now() - lastRxMs_ > LINK_TIMEOUT_MS) {
        link_  = LinkState::NoLink;
        dirty_ = true;
    }
}

void App::render() {
    if (!dirty_) return;
    M5CT_DBG("render link=%d page=%d", static_cast<int>(link_), static_cast<int>(page_));
    canvas_.begin();
    if (link_ == LinkState::Live) {
        renderPage(page_, model_, canvas_);
    } else {
        refreshDeviceInfo();
        renderWaiting(dev_, link_ == LinkState::Linked, canvas_);
    }
    canvas_.end();
    M5CT_DBG("render end");
    dirty_ = false;
}

void App::refreshDeviceInfo() {
    if (board_) {
        if (board_->name)   std::strncpy(dev_.board, board_->name, sizeof(dev_.board) - 1);
        if (board_->fw_ver) std::strncpy(dev_.fw, board_->fw_ver, sizeof(dev_.fw) - 1);
        dev_.board[sizeof(dev_.board) - 1] = '\0';
        dev_.fw[sizeof(dev_.fw) - 1]       = '\0';
        if (board_->power) {
            dev_.batteryPct = board_->power->batteryPct();
            dev_.charging   = board_->power->charging();
        }
    }
#ifndef BOARD_MOCK
    auto dt = M5.Rtc.getDateTime();
    std::snprintf(dev_.clock, sizeof(dev_.clock), "%02d:%02d", dt.time.hours, dt.time.minutes);
    std::snprintf(dev_.date, sizeof(dev_.date), "%04d-%02d-%02d",
                  dt.date.year, dt.date.month, dt.date.date);
#endif
}

void App::send(const char* line, std::size_t len) {
    if (!board_ || !board_->transport) return;
    board_->transport->write(reinterpret_cast<const uint8_t*>(line), len);
    const uint8_t nl = '\n';
    board_->transport->write(&nl, 1);
}

}  // namespace m5render
