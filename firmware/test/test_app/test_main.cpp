#include <unity.h>
#include <cstring>

#include "app.h"
#include "mock_canvas.h"
#include "mock_hal.h"

using namespace m5render;
using namespace m5hal;
using m5hal::mock::MockTransport;

static uint32_t g_now = 0;
static uint32_t mockNow() { return g_now; }

static Board makeBoard(MockTransport& t) {
  Board b{};
  b.transport = &t;
  b.name = "cores3-se";
  b.fw_ver = "0.4.0";
  b.input = nullptr;
  b.power = nullptr;
  return b;
}

void setUp() { g_now = 0; }
void tearDown() {}

void test_boot_is_nolink() {
  MockTransport t; MockCanvas c; Board b = makeBoard(t);
  App app(c, &b); app.setNowFn(mockNow);
  TEST_ASSERT_EQUAL(static_cast<int>(App::LinkState::NoLink),
                    static_cast<int>(app.link()));
}

void test_any_frame_moves_to_linked() {
  MockTransport t; MockCanvas c; Board b = makeBoard(t);
  App app(c, &b); app.setNowFn(mockNow);
  const char* ping = "{\"v\":1,\"k\":\"ping\",\"t\":0,\"id\":\"a\",\"p\":{}}";
  app.handleLine(ping, std::strlen(ping));
  TEST_ASSERT_EQUAL(static_cast<int>(App::LinkState::Linked),
                    static_cast<int>(app.link()));
}

void test_active_status_moves_to_live() {
  MockTransport t; MockCanvas c; Board b = makeBoard(t);
  App app(c, &b); app.setNowFn(mockNow);
  const char* s = "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\"}}";
  app.handleLine(s, std::strlen(s));
  TEST_ASSERT_EQUAL(static_cast<int>(App::LinkState::Live),
                    static_cast<int>(app.link()));
}

void test_idle_status_moves_to_linked() {
  MockTransport t; MockCanvas c; Board b = makeBoard(t);
  App app(c, &b); app.setNowFn(mockNow);
  const char* a = "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\"}}";
  app.handleLine(a, std::strlen(a));
  const char* i = "{\"v\":1,\"k\":\"status\",\"t\":1,\"p\":{\"state\":\"idle\"}}";
  app.handleLine(i, std::strlen(i));
  TEST_ASSERT_EQUAL(static_cast<int>(App::LinkState::Linked),
                    static_cast<int>(app.link()));
}

// Regression for the original bug: pings keep arriving, no new status —
// device must STAY Live, never revert on content silence.
void test_live_persists_while_only_pings_arrive() {
  MockTransport t; MockCanvas c; Board b = makeBoard(t);
  App app(c, &b); app.setNowFn(mockNow);
  const char* a = "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\"}}";
  app.handleLine(a, std::strlen(a));
  const char* ping = "{\"v\":1,\"k\":\"ping\",\"t\":0,\"id\":\"a\",\"p\":{}}";
  for (int i = 0; i < 10; i++) {
    g_now += 5000;            // a ping every 5s for 50s
    t.feed(ping); t.feed("\n");
    app.tick();
  }
  TEST_ASSERT_EQUAL(static_cast<int>(App::LinkState::Live),
                    static_cast<int>(app.link()));
}

// Link silence > 15s with no frames at all → NoLink.
void test_link_silence_reverts_to_nolink() {
  MockTransport t; MockCanvas c; Board b = makeBoard(t);
  App app(c, &b); app.setNowFn(mockNow);
  const char* a = "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\"}}";
  app.handleLine(a, std::strlen(a));     // lastRxMs_ = 0
  g_now = 16000;                          // 16s later, no frames
  app.tick();
  TEST_ASSERT_EQUAL(static_cast<int>(App::LinkState::NoLink),
                    static_cast<int>(app.link()));
}

// Physical USB unplug: transport->connected() goes false → revert to NoLink
// immediately, well before the 15s silence timeout.
void test_usb_disconnect_reverts_to_nolink_immediately() {
  MockTransport t; MockCanvas c; Board b = makeBoard(t);
  App app(c, &b); app.setNowFn(mockNow);
  const char* a = "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\"}}";
  app.handleLine(a, std::strlen(a));        // Live, lastRxMs_ = 0
  t.set_connected(false);                   // cable yanked
  g_now = 1000;                             // only 1s later — far under 15s
  app.tick();
  TEST_ASSERT_EQUAL(static_cast<int>(App::LinkState::NoLink),
                    static_cast<int>(app.link()));
}

void test_screenshot_returns_ack_with_png() {
  MockTransport t; MockCanvas c; Board b = makeBoard(t);
  App app(c, &b); app.setNowFn(mockNow);
  const char* req = "{\"v\":1,\"k\":\"screenshot\",\"t\":0,\"id\":\"m1\",\"p\":{\"fmt\":\"png\"}}";
  app.handleLine(req, std::strlen(req));

  TEST_ASSERT_TRUE(c.calledPrefix("capturePng"));   // MockCanvas recorded "capturePng"
  const std::string tx = t.drain_tx();
  TEST_ASSERT_TRUE(tx.find("\"k\":\"screenshot.ack\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"id\":\"m1\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"png_b64\":\"iVBORw==\"") != std::string::npos);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_boot_is_nolink);
  RUN_TEST(test_any_frame_moves_to_linked);
  RUN_TEST(test_active_status_moves_to_live);
  RUN_TEST(test_idle_status_moves_to_linked);
  RUN_TEST(test_live_persists_while_only_pings_arrive);
  RUN_TEST(test_link_silence_reverts_to_nolink);
  RUN_TEST(test_usb_disconnect_reverts_to_nolink_immediately);
  RUN_TEST(test_screenshot_returns_ack_with_png);
  return UNITY_END();
}
