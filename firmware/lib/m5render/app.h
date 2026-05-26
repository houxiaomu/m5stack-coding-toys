#pragma once

#include <cstddef>
#include <cstdint>

#include "canvas.h"
#include "m5hal.h"
#include "ndjson.h"
#include "pages.h"
#include "status_model.h"

namespace m5render {

// App owns the device-agnostic loop: it drains the transport, runs the minimal
// hello/ping handshake, parses `status` frames into the StatusModel, handles
// touch page-cycling, falls back to a Waiting screen after host silence, and
// redraws (only when dirty) through the injected Canvas. The old m5core
// Dispatcher is retired — App replaces it end-to-end.
class App {
public:
    enum class LinkState : uint8_t { NoLink, Linked, Live };
    LinkState link() const { return link_; }
    PageId page() const { return page_; }       // test helper
    void setNowFn(uint32_t (*fn)()) { now_ = fn; }  // test seam

    App(Canvas& canvas, m5hal::Board* board);

    void boot();
    void tick();  // call each loop: drain transport, handle input, redraw if dirty

    // Inject a complete envelope line (without trailing newline). Test helper.
    void handleLine(const char* line, std::size_t len);

private:
    void render();
    void refreshDeviceInfo();  // RTC / battery / fw / board into DeviceInfo
    void pollInput();
    void handleTouchTapAction(uint32_t t_ms);
    void checkLink();          // link silence → NoLink
    void send(const char* line, std::size_t len);
    uint32_t now() const { return now_ ? now_() : 0; }

    Canvas&               canvas_;
    m5hal::Board*         board_;
    m5proto::NdjsonFramer framer_;
    StatusModel           model_;
    DeviceInfo            dev_;
    PageId                page_       = PageId::Overview;
    LinkState             link_       = LinkState::NoLink;
    uint32_t              lastRxMs_   = 0;
    bool                  dirty_      = true;
    uint32_t            (*now_)()     = nullptr;  // set in ctor to platform clock
};

}  // namespace m5render
