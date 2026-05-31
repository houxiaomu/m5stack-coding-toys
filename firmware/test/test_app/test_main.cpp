#include <unity.h>
#include <cstring>

#include "app.h"
#include "mock_canvas.h"
#include "mock_hal.h"

using namespace m5render;
using namespace m5hal;
using m5hal::mock::MockTransport;

static uint32_t g_now = 0;
static int g_pair_start_count = 0;
static int g_pair_stop_count = 0;
static bool g_pairing_active = false;
static uint32_t mockNow() { return g_now; }
static bool mockStartBlePairing(uint32_t) {
  g_pair_start_count++;
  g_pairing_active = true;
  return true;
}
static bool mockStopBlePairing() {
  g_pair_stop_count++;
  g_pairing_active = false;
  return true;
}
static bool mockBlePairingActive() { return g_pairing_active; }

static Board makeBoard(MockTransport& t) {
  Board b{};
  b.transport = &t;
  b.name = "cores3-se";
  b.fw_ver = "0.4.0";
  b.device_id = "M5SE-ABCDEF";
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

void setUp() {
  g_now = 0;
  g_pair_start_count = 0;
  g_pair_stop_count = 0;
  g_pairing_active = false;
}
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

void test_waiting_long_press_top_right_starts_ble_pairing() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  b.start_ble_pairing = mockStartBlePairing;
  App app(c, &b); app.setNowFn(mockNow);
  m5hal::InputEvent e{};
  e.kind = m5hal::InputEvent::TouchLongPress;
  e.x = 300;
  e.y = 16;
  e.t_ms = 2000;
  i.feed(e);
  app.tick();
  TEST_ASSERT_EQUAL(1, g_pair_start_count);
}

void test_waiting_long_press_anywhere_starts_ble_pairing() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  b.start_ble_pairing = mockStartBlePairing;
  App app(c, &b); app.setNowFn(mockNow);
  m5hal::InputEvent e{};
  e.kind = m5hal::InputEvent::TouchLongPress;
  e.x = 160;
  e.y = 145;
  e.t_ms = 2000;
  i.feed(e);
  app.tick();
  TEST_ASSERT_EQUAL(1, g_pair_start_count);
}

void test_ble_pairing_stays_active_for_five_minutes() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  b.start_ble_pairing = mockStartBlePairing;
  b.stop_ble_pairing = mockStopBlePairing;
  b.ble_pairing_active = mockBlePairingActive;
  App app(c, &b); app.setNowFn(mockNow);
  g_now = 1000;
  m5hal::InputEvent e{};
  e.kind = m5hal::InputEvent::TouchLongPress;
  e.x = 160;
  e.y = 145;
  e.t_ms = 1000;
  i.feed(e);
  app.tick();

  g_now = 1000 + 299000;
  app.tick();
  TEST_ASSERT_EQUAL(0, g_pair_stop_count);

  g_now = 1000 + 301000;
  app.tick();
  TEST_ASSERT_EQUAL(1, g_pair_stop_count);
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

void test_multi_session_first_status_opens_sessions_page() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* active =
    "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"working\"},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"working\"}"
    "]}}";
  app.handleLine(active, std::strlen(active));
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Sessions), static_cast<int>(app.page()));
}

void test_sessions_page_tap_row_selects_session() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* active =
    "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"working\"},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"working\"}"
    "]}}";
  app.handleLine(active, std::strlen(active));
  const char* row2 =
    "{\"v\":1,\"k\":\"tap\",\"t\":2,\"id\":\"r\",\"p\":{\"x\":160,\"y\":112,\"duration_ms\":50}}";
  app.handleLine(row2, std::strlen(row2));
  const std::string tx = t.drain_tx();
  TEST_ASSERT_TRUE(tx.find("\"k\":\"device.event\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"target\":\"session\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"sessionId\":\"s2\"") != std::string::npos);
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Overview), static_cast<int>(app.page()));
}

void test_sessions_page_empty_tap_does_nothing() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* active =
    "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"working\"},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"working\"}"
    "]}}";
  app.handleLine(active, std::strlen(active));
  t.drain_tx();
  const char* emptyTap =
    "{\"v\":1,\"k\":\"tap\",\"t\":2,\"id\":\"e\",\"p\":{\"x\":5,\"y\":120,\"duration_ms\":50}}";
  app.handleLine(emptyTap, std::strlen(emptyTap));
  const std::string tx = t.drain_tx();
  TEST_ASSERT_TRUE(tx.find("\"k\":\"tap.ack\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"k\":\"device.event\"") == std::string::npos);
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Sessions), static_cast<int>(app.page()));
}

void test_sessions_page_next_tap_advances_picker_page() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* active =
    "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"working\"},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"working\"},"
    "{\"index\":3,\"id\":\"s3\",\"name\":\"repo-c\",\"activity\":\"working\"},"
    "{\"index\":4,\"id\":\"s4\",\"name\":\"repo-d\",\"activity\":\"working\"}"
    "]}}";
  app.handleLine(active, std::strlen(active));
  const char* nextTap =
    "{\"v\":1,\"k\":\"tap\",\"t\":2,\"id\":\"n\",\"p\":{\"x\":160,\"y\":222,\"duration_ms\":50}}";
  app.handleLine(nextTap, std::strlen(nextTap));
  TEST_ASSERT_EQUAL(1, app.sessionPageIndex());
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Sessions), static_cast<int>(app.page()));
}

void test_detail_header_tap_returns_to_sessions_page() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* active =
    "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"working\"},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"working\"}"
    "]}}";
  app.handleLine(active, std::strlen(active));
  const char* row1 =
    "{\"v\":1,\"k\":\"tap\",\"t\":2,\"id\":\"r\",\"p\":{\"x\":160,\"y\":60,\"duration_ms\":50}}";
  app.handleLine(row1, std::strlen(row1));
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Overview), static_cast<int>(app.page()));
  const char* headerTap =
    "{\"v\":1,\"k\":\"tap\",\"t\":3,\"id\":\"h\",\"p\":{\"x\":160,\"y\":16,\"duration_ms\":50}}";
  app.handleLine(headerTap, std::strlen(headerTap));
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Sessions), static_cast<int>(app.page()));
}

void test_workspace_tap_returns_to_sessions_page_when_multi_session() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* active =
    "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"working\"},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"working\"}"
    "]}}";
  app.handleLine(active, std::strlen(active));
  const char* row1 =
    "{\"v\":1,\"k\":\"tap\",\"t\":2,\"id\":\"r\",\"p\":{\"x\":160,\"y\":60,\"duration_ms\":50}}";
  app.handleLine(row1, std::strlen(row1));
  const char* bodyTap =
    "{\"v\":1,\"k\":\"tap\",\"t\":3,\"id\":\"b\",\"p\":{\"x\":160,\"y\":120,\"duration_ms\":50}}";
  app.handleLine(bodyTap, std::strlen(bodyTap));  // Cost
  app.handleLine(bodyTap, std::strlen(bodyTap));  // Limits
  app.handleLine(bodyTap, std::strlen(bodyTap));  // Workspace
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Workspace), static_cast<int>(app.page()));
  app.handleLine(bodyTap, std::strlen(bodyTap));
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Sessions), static_cast<int>(app.page()));
}

void test_non_current_session_activity_update_does_not_leave_detail_page() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* active =
    "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"working\",\"selected\":true},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"working\"}"
    "]}}";
  app.handleLine(active, std::strlen(active));
  const char* row1 =
    "{\"v\":1,\"k\":\"tap\",\"t\":2,\"id\":\"r\",\"p\":{\"x\":160,\"y\":60,\"duration_ms\":50}}";
  app.handleLine(row1, std::strlen(row1));
  const char* update =
    "{\"v\":1,\"k\":\"status\",\"t\":4,\"p\":{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"working\",\"selected\":true},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"needs_attention\"}"
    "]}}";
  app.handleLine(update, std::strlen(update));
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
  RUN_TEST(test_waiting_long_press_top_right_starts_ble_pairing);
  RUN_TEST(test_waiting_long_press_anywhere_starts_ble_pairing);
  RUN_TEST(test_ble_pairing_stays_active_for_five_minutes);
  RUN_TEST(test_tap_out_of_bounds_returns_error);
  RUN_TEST(test_tap_without_touch_returns_unsupported);
  RUN_TEST(test_multi_session_first_status_opens_sessions_page);
  RUN_TEST(test_sessions_page_tap_row_selects_session);
  RUN_TEST(test_sessions_page_empty_tap_does_nothing);
  RUN_TEST(test_sessions_page_next_tap_advances_picker_page);
  RUN_TEST(test_detail_header_tap_returns_to_sessions_page);
  RUN_TEST(test_workspace_tap_returns_to_sessions_page_when_multi_session);
  RUN_TEST(test_non_current_session_activity_update_does_not_leave_detail_page);
  return UNITY_END();
}
