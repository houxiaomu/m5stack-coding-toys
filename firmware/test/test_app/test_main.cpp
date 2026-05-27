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

static Board makeTouchBoard(MockTransport& t, m5hal::mock::MockDisplay& d, m5hal::mock::MockInput& i) {
  Board b = makeBoard(t);
  b.display = &d;
  b.input = &i;
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

void test_screenshot_returns_ack_with_raw_frame() {
  MockTransport t; MockCanvas c; Board b = makeBoard(t);
  App app(c, &b); app.setNowFn(mockNow);
  const char* req = "{\"v\":1,\"k\":\"screenshot\",\"t\":0,\"id\":\"m1\",\"p\":{\"fmt\":\"png\"}}";
  app.handleLine(req, std::strlen(req));

  TEST_ASSERT_TRUE(c.calledPrefix("rawFrame"));   // MockCanvas recorded "rawFrame"
  const std::string tx = t.drain_tx();
  TEST_ASSERT_TRUE(tx.find("\"k\":\"screenshot.ack\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"id\":\"m1\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"fmt\":\"rgb565\"") != std::string::npos);
  // MockCanvas streams a canned 2×2 frame {0x12..0xf0} → base64 "EjRWeJq83vA=".
  TEST_ASSERT_TRUE(tx.find("\"data_b64\":\"EjRWeJq83vA=\"") != std::string::npos);
}

void test_tap_returns_ack_with_matching_id() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* req = "{\"v\":1,\"k\":\"tap\",\"t\":0,\"id\":\"m2\",\"p\":{\"x\":160,\"y\":120,\"duration_ms\":50}}";
  app.handleLine(req, std::strlen(req));

  const std::string tx = t.drain_tx();
  TEST_ASSERT_TRUE(tx.find("\"k\":\"tap.ack\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"id\":\"m2\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"ok\":true") != std::string::npos);
}

void test_tap_advances_page_when_live() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* active = "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\"}}";
  app.handleLine(active, std::strlen(active));
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Overview), static_cast<int>(app.page()));

  const char* req = "{\"v\":1,\"k\":\"tap\",\"t\":1,\"id\":\"m3\",\"p\":{\"x\":160,\"y\":120,\"duration_ms\":50}}";
  app.handleLine(req, std::strlen(req));
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Cost), static_cast<int>(app.page()));
}

void test_tap_does_not_advance_page_when_linked() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* ping = "{\"v\":1,\"k\":\"ping\",\"t\":0,\"id\":\"p1\",\"p\":{}}";
  app.handleLine(ping, std::strlen(ping));
  TEST_ASSERT_EQUAL(static_cast<int>(App::LinkState::Linked), static_cast<int>(app.link()));
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Overview), static_cast<int>(app.page()));

  const char* req = "{\"v\":1,\"k\":\"tap\",\"t\":1,\"id\":\"m4\",\"p\":{\"x\":160,\"y\":120,\"duration_ms\":50}}";
  app.handleLine(req, std::strlen(req));
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Overview), static_cast<int>(app.page()));
  const std::string tx = t.drain_tx();
  TEST_ASSERT_TRUE(tx.find("\"k\":\"tap.ack\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"ok\":true") != std::string::npos);
}

void test_tap_out_of_bounds_returns_error() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* req = "{\"v\":1,\"k\":\"tap\",\"t\":0,\"id\":\"m5\",\"p\":{\"x\":320,\"y\":120,\"duration_ms\":50}}";
  app.handleLine(req, std::strlen(req));

  const std::string tx = t.drain_tx();
  TEST_ASSERT_TRUE(tx.find("\"k\":\"tap.ack\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"ok\":false") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"err\":\"out_of_bounds\"") != std::string::npos);
}

void test_tap_without_touch_returns_unsupported() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d;
  Board b = makeBoard(t);
  b.display = &d;
  b.input = nullptr;
  App app(c, &b); app.setNowFn(mockNow);
  const char* req = "{\"v\":1,\"k\":\"tap\",\"t\":0,\"id\":\"m6\",\"p\":{\"x\":160,\"y\":120,\"duration_ms\":50}}";
  app.handleLine(req, std::strlen(req));

  const std::string tx = t.drain_tx();
  TEST_ASSERT_TRUE(tx.find("\"k\":\"tap.ack\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"ok\":false") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"err\":\"touch_unsupported\"") != std::string::npos);
}

void test_sessions_page_top_tap_moves_highlight() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* active =
    "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":0,\"id\":\"auto\",\"name\":\"AUTO\",\"activity\":\"working\",\"auto\":true},"
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"working\"},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"working\"}"
    "]}}";
  app.handleLine(active, std::strlen(active));
  for (int n = 0; n < 4; ++n) {
    const char* pageTap =
      "{\"v\":1,\"k\":\"tap\",\"t\":1,\"id\":\"p\",\"p\":{\"x\":160,\"y\":120,\"duration_ms\":50}}";
    app.handleLine(pageTap, std::strlen(pageTap));
  }
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Sessions), static_cast<int>(app.page()));

  const char* topTap =
    "{\"v\":1,\"k\":\"tap\",\"t\":2,\"id\":\"m\",\"p\":{\"x\":160,\"y\":20,\"duration_ms\":50}}";
  app.handleLine(topTap, std::strlen(topTap));
  TEST_ASSERT_EQUAL(1, app.pickerIndex());
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Sessions), static_cast<int>(app.page()));
}

void test_sessions_page_bottom_tap_sends_focus_event() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* active =
    "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":0,\"id\":\"auto\",\"name\":\"AUTO\",\"activity\":\"working\",\"auto\":true},"
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"working\"},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"working\"}"
    "]}}";
  app.handleLine(active, std::strlen(active));
  for (int n = 0; n < 4; ++n) {
    const char* pageTap =
      "{\"v\":1,\"k\":\"tap\",\"t\":1,\"id\":\"p\",\"p\":{\"x\":160,\"y\":120,\"duration_ms\":50}}";
    app.handleLine(pageTap, std::strlen(pageTap));
  }
  const char* topTap =
    "{\"v\":1,\"k\":\"tap\",\"t\":2,\"id\":\"m\",\"p\":{\"x\":160,\"y\":20,\"duration_ms\":50}}";
  app.handleLine(topTap, std::strlen(topTap));
  t.drain_tx();

  const char* bottomTap =
    "{\"v\":1,\"k\":\"tap\",\"t\":3,\"id\":\"c\",\"p\":{\"x\":160,\"y\":220,\"duration_ms\":50}}";
  app.handleLine(bottomTap, std::strlen(bottomTap));
  const std::string tx = t.drain_tx();
  TEST_ASSERT_TRUE(tx.find("\"k\":\"device.event\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"kind\":\"focus\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"target\":\"session\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"sessionId\":\"s1\"") != std::string::npos);
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Overview), static_cast<int>(app.page()));
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
  RUN_TEST(test_screenshot_returns_ack_with_raw_frame);
  RUN_TEST(test_tap_returns_ack_with_matching_id);
  RUN_TEST(test_tap_advances_page_when_live);
  RUN_TEST(test_tap_does_not_advance_page_when_linked);
  RUN_TEST(test_tap_out_of_bounds_returns_error);
  RUN_TEST(test_tap_without_touch_returns_unsupported);
  RUN_TEST(test_sessions_page_top_tap_moves_highlight);
  RUN_TEST(test_sessions_page_bottom_tap_sends_focus_event);
  return UNITY_END();
}
