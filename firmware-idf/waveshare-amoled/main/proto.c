#include "proto.h"

#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/time.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "driver/usb_serial_jtag.h"
#include "esp_mac.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "cJSON.h"

#include "model.h"
#include "ui.h"
#include "ble.h"

static const char *TAG = "proto";

// Framing / buffers
#define RX_CHUNK 256       // serial read granularity (bytes)
#define LINE_BUF 4096      // max NDJSON line we will assemble (named to avoid POSIX LINE_MAX)
#define B64_OUT 4096       // base64 staging buffer
#define B64_FLUSH 1020     // flush every ~1KB (multiple of 4) so writes fit the TX ring
#define DEVICE_ID_LEN 24

// USB-Serial/JTAG driver
#define USB_TX_BUF 8192
#define USB_RX_BUF 2048
#define RX_TASK_STACK 16384 // lv_snapshot (screenshot path) is stack-hungry; 6K overflows
#define RX_TASK_PRIO 5

// Timing (ms)
#define SEND_LINE_MS 100     // per small-frame TX timeout
#define WRITE_CHUNK_MS 1000  // per screenshot-chunk TX timeout
#define WRITE_STALL_MS 2     // backoff between stalled writes
#define WRITE_MAX_STALLS 200 // give up streaming after this many empty writes
#define READ_POLL_MS 50      // RX poll interval
#define LINK_TIMEOUT_MS 15000 // host silence → NoLink

static char s_device_id[DEVICE_ID_LEN];
static SemaphoreHandle_t s_tx_lock;

// ---- transport mux (USB primary, BLE secondary) ----
// s_active tracks where the most recent inbound frame arrived, so replies go
// back out the same link. The daemon only ever drives one transport at a time
// (serial outranks BLE host-side), so this stays unambiguous in practice.
typedef enum { TR_USB, TR_BLE } tr_kind_t;
static volatile tr_kind_t s_active = TR_USB;

// ---------------------------------------------------------------- helpers ----

static int64_t now_ms(void) { return esp_timer_get_time() / 1000; }

// Chunked USB-Serial/JTAG writer: retries around a full TX ring, gives up rather
// than hang forever if the host stops reading.
static void usb_write_all(const uint8_t *p, size_t n) {
    size_t off = 0;
    int stall = 0;
    while (off < n) {
        int w = usb_serial_jtag_write_bytes(p + off, n - off, pdMS_TO_TICKS(WRITE_CHUNK_MS));
        if (w > 0) {
            off += (size_t)w;
            stall = 0;
        } else if (++stall > WRITE_MAX_STALLS) {
            break;
        } else {
            vTaskDelay(pdMS_TO_TICKS(WRITE_STALL_MS));
        }
    }
}

// Route a byte run to the active transport. BLE only when it's the live link;
// USB is the default and fallback.
static void transport_write(const uint8_t *p, size_t n) {
    if (s_active == TR_BLE && ble_connected()) {
        ble_write(p, n);
    } else {
        usb_write_all(p, n);
    }
}

static void make_device_id(void) {
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(s_device_id, sizeof(s_device_id), "WAVE-%02X%02X%02X%02X%02X%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

// Frame a JSON string as one NDJSON line and push it out the active transport.
static void send_line(const char *json) {
    if (!json) return;
    xSemaphoreTake(s_tx_lock, portMAX_DELAY);
    transport_write((const uint8_t *)json, strlen(json));
    const uint8_t nl = '\n';
    transport_write(&nl, 1);
    xSemaphoreGive(s_tx_lock);
}

// Build an envelope {v,k,t,p,id?} around an already-built payload object and
// send it. Takes ownership of `payload` (deleted here).
static void send_envelope(const char *kind, const char *id, cJSON *payload) {
    cJSON *env = cJSON_CreateObject();
    cJSON_AddNumberToObject(env, "v", 1);
    cJSON_AddStringToObject(env, "k", kind);
    cJSON_AddNumberToObject(env, "t", (double)now_ms());
    cJSON_AddItemToObject(env, "p", payload ? payload : cJSON_CreateObject());
    if (id) cJSON_AddStringToObject(env, "id", id);
    char *txt = cJSON_PrintUnformatted(env);
    if (txt) {
        send_line(txt);
        cJSON_free(txt);
    }
    cJSON_Delete(env);
}

// --------------------------------------------------------------- replies ----

static void send_hello_ack(const char *id) {
    cJSON *p = cJSON_CreateObject();
    cJSON_AddStringToObject(p, "board", FW_BOARD);
    cJSON_AddStringToObject(p, "fw", FW_VERSION);
    cJSON *caps = cJSON_CreateArray();
    cJSON_AddItemToArray(caps, cJSON_CreateString("display"));
    cJSON_AddItemToArray(caps, cJSON_CreateString("touch"));
    cJSON_AddItemToArray(caps, cJSON_CreateString("notify"));
    cJSON_AddItemToObject(p, "caps", caps);
    cJSON_AddStringToObject(p, "device_id", s_device_id);
    send_envelope("hello.ack", id, p);
}

static void send_pong(const char *id) { send_envelope("pong", id, NULL); }
static void send_notify_ack(const char *id) { send_envelope("notify.ack", id, NULL); }

static void send_tap_ack(const char *id, bool ok) {
    cJSON *p = cJSON_CreateObject();
    cJSON_AddBoolToObject(p, "ok", ok);
    send_envelope("tap.ack", id, p);
}

static void send_screenshot_ack_unsupported(const char *id) {
    cJSON *p = cJSON_CreateObject();
    cJSON_AddBoolToObject(p, "ok", false);
    cJSON_AddStringToObject(p, "err", "capture_failed");
    send_envelope("screenshot.ack", id, p);
}

static const char B64[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

#define write_all(p, n) transport_write((const uint8_t *)(p), (n))

// Capture the screen and stream the screenshot.ack as one NDJSON line, base64-
// encoding the raw frame in small chunks so we never hold the whole string and
// never overflow the USB-Serial/JTAG TX ring (or, over BLE, the notify path).
static void send_screenshot(const char *id) {
    unsigned char *buf = NULL;
    int w = 0, h = 0;
    if (!ui_capture_take(&buf, &w, &h)) {
        send_screenshot_ack_unsupported(id);
        return;
    }
    size_t n = (size_t)w * h * 2;

    xSemaphoreTake(s_tx_lock, portMAX_DELAY);
    char hdr[192];
    int hn = snprintf(hdr, sizeof(hdr), "{\"v\":1,\"k\":\"screenshot.ack\",\"t\":%lld,",
                      (long long)now_ms());
    if (id) hn += snprintf(hdr + hn, sizeof(hdr) - hn, "\"id\":\"%s\",", id);
    hn += snprintf(hdr + hn, sizeof(hdr) - hn,
                   "\"p\":{\"ok\":true,\"w\":%d,\"h\":%d,\"fmt\":\"rgb565\",\"data_b64\":\"", w, h);
    write_all(hdr, hn);

    char out[B64_OUT];
    int oi = 0;
    for (size_t i = 0; i < n; i += 3) {
        uint32_t b0 = buf[i];
        uint32_t b1 = (i + 1 < n) ? buf[i + 1] : 0;
        uint32_t b2 = (i + 2 < n) ? buf[i + 2] : 0;
        uint32_t triple = (b0 << 16) | (b1 << 8) | b2;
        out[oi++] = B64[(triple >> 18) & 0x3F];
        out[oi++] = B64[(triple >> 12) & 0x3F];
        out[oi++] = (i + 1 < n) ? B64[(triple >> 6) & 0x3F] : '=';
        out[oi++] = (i + 2 < n) ? B64[triple & 0x3F] : '=';
        if (oi >= B64_FLUSH) { // keep writes small so they fit the USB-Serial/JTAG ring
            write_all(out, oi);
            oi = 0;
        }
    }
    if (oi) write_all(out, oi);
    write_all("\"}}\n", 4);
    xSemaphoreGive(s_tx_lock);
    free(buf);
}

void proto_send_focus(const char *session_id) {
    if (!session_id || !*session_id) return;
    cJSON *p = cJSON_CreateObject();
    cJSON_AddStringToObject(p, "kind", "focus");
    cJSON_AddStringToObject(p, "target", "session");
    cJSON_AddStringToObject(p, "sessionId", session_id);
    send_envelope("device.event", NULL, p);
}

// --------------------------------------------------------------- parsing ----

static activity_t parse_activity(const cJSON *s) {
    if (!cJSON_IsString(s)) return ACT_NONE;
    if (!strcmp(s->valuestring, "working")) return ACT_WORKING;
    if (!strcmp(s->valuestring, "awaiting_input")) return ACT_AWAITING;
    if (!strcmp(s->valuestring, "needs_attention")) return ACT_ATTENTION;
    return ACT_NONE;
}

static int jint(const cJSON *o, const char *k, int dflt) {
    cJSON *v = cJSON_GetObjectItemCaseSensitive(o, k);
    return cJSON_IsNumber(v) ? (int)v->valuedouble : dflt;
}
static float jflt(const cJSON *o, const char *k, float dflt) {
    cJSON *v = cJSON_GetObjectItemCaseSensitive(o, k);
    return cJSON_IsNumber(v) ? (float)v->valuedouble : dflt;
}
static bool jbool(const cJSON *o, const char *k) {
    cJSON *v = cJSON_GetObjectItemCaseSensitive(o, k);
    return cJSON_IsBool(v) ? cJSON_IsTrue(v) : false;
}
static void jstr(const cJSON *o, const char *k, char *dst, size_t n) {
    cJSON *v = cJSON_GetObjectItemCaseSensitive(o, k);
    if (cJSON_IsString(v) && v->valuestring) {
        strncpy(dst, v->valuestring, n - 1);
        dst[n - 1] = '\0';
    } else {
        dst[0] = '\0';
    }
}

static void apply_time(const cJSON *time) {
    if (!cJSON_IsObject(time)) return;
    cJSON *utc = cJSON_GetObjectItemCaseSensitive(time, "utc_ms");
    cJSON *off = cJSON_GetObjectItemCaseSensitive(time, "offset_min");
    if (!cJSON_IsNumber(utc)) return;
    double utc_ms = utc->valuedouble;
    struct timeval tv = {.tv_sec = (time_t)(utc_ms / 1000.0),
                         .tv_usec = (suseconds_t)(((int64_t)utc_ms % 1000) * 1000)};
    settimeofday(&tv, NULL);
    if (cJSON_IsNumber(off)) {
        // POSIX TZ offset is positive WEST of UTC, i.e. -(east minutes).
        long west = -(long)off->valuedouble;
        char sign = west < 0 ? '-' : '+';
        long a = labs(west);
        char tz[24];
        // POSIX TZ std-name must be letters only (a digit makes newlib's tzset
        // reject the whole string and silently fall back to UTC).
        snprintf(tz, sizeof(tz), "LCL%c%02ld:%02ld", sign, a / 60, a % 60);
        setenv("TZ", tz, 1);
        tzset();
    }
    ESP_LOGI(TAG, "host time applied");
}

static void apply_status(const cJSON *p) {
    if (!cJSON_IsObject(p)) return;

    model_lock();
    model_t *m = &g_model;

    cJSON *state = cJSON_GetObjectItemCaseSensitive(p, "state");
    bool active = cJSON_IsString(state) && !strcmp(state->valuestring, "active");
    m->link = active ? LINK_LIVE : LINK_LINKED;

    m->activity = parse_activity(cJSON_GetObjectItemCaseSensitive(p, "activity"));

    cJSON *model = cJSON_GetObjectItemCaseSensitive(p, "model");
    if (cJSON_IsObject(model)) {
        char shortn[24];
        jstr(model, "short", shortn, sizeof(shortn));
        if (shortn[0]) {
            strncpy(m->model_short, shortn, sizeof(m->model_short) - 1);
            m->model_short[sizeof(m->model_short) - 1] = '\0';
        }
    }

    cJSON *ctx = cJSON_GetObjectItemCaseSensitive(p, "context");
    if (cJSON_IsObject(ctx)) {
        m->has_ctx = true;
        m->ctx_used_pct = jint(ctx, "usedPct", 0);
        m->ctx_tokens = jint(ctx, "tokens", 0);
        m->ctx_limit = jint(ctx, "limit", 0);
        m->ctx_exceeds_200k = jbool(ctx, "exceeds200k");
    } else {
        m->has_ctx = false;
    }

    cJSON *cost = cJSON_GetObjectItemCaseSensitive(p, "cost");
    if (cJSON_IsObject(cost)) {
        m->has_cost = true;
        m->cost_session_usd = jflt(cost, "sessionUsd", 0);
        m->cost_burn_per_hr = jflt(cost, "burnPerHr", 0);
        m->cost_duration_min = jint(cost, "durationMin", 0);
        m->lines_added = jint(cost, "linesAdded", 0);
        m->lines_removed = jint(cost, "linesRemoved", 0);
    } else {
        m->has_cost = false;
    }

    cJSON *block = cJSON_GetObjectItemCaseSensitive(p, "block");
    if (cJSON_IsObject(block)) {
        m->has_block = true;
        m->block_used_pct = jint(block, "usedPct", 0);
        m->block_reset_in_min = jint(block, "resetInMin", 0);
    } else {
        m->has_block = false;
    }

    cJSON *weekly = cJSON_GetObjectItemCaseSensitive(p, "weekly");
    if (cJSON_IsObject(weekly)) {
        m->has_weekly = true;
        m->weekly_used_pct = jint(weekly, "usedPct", 0);
    } else {
        m->has_weekly = false;
    }

    cJSON *git = cJSON_GetObjectItemCaseSensitive(p, "git");
    if (cJSON_IsObject(git)) {
        m->has_git = true;
        jstr(git, "branch", m->git_branch, sizeof(m->git_branch));
        m->git_staged = jint(git, "staged", 0);
        m->git_unstaged = jint(git, "unstaged", 0);
        m->git_untracked = jint(git, "untracked", 0);
    } else {
        m->has_git = false;
    }

    cJSON *sessions = cJSON_GetObjectItemCaseSensitive(p, "sessions");
    m->session_count = 0;
    if (cJSON_IsArray(sessions)) {
        cJSON *it = NULL;
        cJSON_ArrayForEach(it, sessions) {
            if (m->session_count >= MODEL_MAX_SESSIONS) break;
            session_t *s = &m->sessions[m->session_count++];
            s->index = jint(it, "index", 0);
            jstr(it, "id", s->id, sizeof(s->id));
            jstr(it, "name", s->name, sizeof(s->name));
            s->activity = parse_activity(cJSON_GetObjectItemCaseSensitive(it, "activity"));
            s->selected = jbool(it, "selected");
        }
    }

    m->dirty = true;
    model_unlock();
}

static void apply_notify(const cJSON *p) {
    model_lock();
    model_t *m = &g_model;
    jstr(p, "title", m->notify_title, sizeof(m->notify_title));
    jstr(p, "body", m->notify_body, sizeof(m->notify_body));
    cJSON *u = cJSON_GetObjectItemCaseSensitive(p, "urgency");
    m->notify_urgency = URG_NORMAL;
    if (cJSON_IsString(u)) {
        if (!strcmp(u->valuestring, "low")) m->notify_urgency = URG_LOW;
        else if (!strcmp(u->valuestring, "high")) m->notify_urgency = URG_HIGH;
    }
    m->notify_active = true;
    m->notify_shown_ms = now_ms();
    m->dirty = true;
    model_unlock();
}

// ---------------------------------------------------------- line dispatch ----

static void handle_line(const char *line) {
    cJSON *env = cJSON_Parse(line);
    if (!env) return; // ignore boot noise / partial frames

    cJSON *k = cJSON_GetObjectItemCaseSensitive(env, "k");
    cJSON *idj = cJSON_GetObjectItemCaseSensitive(env, "id");
    cJSON *p = cJSON_GetObjectItemCaseSensitive(env, "p");
    const char *id = cJSON_IsString(idj) ? idj->valuestring : NULL;

    if (cJSON_IsString(k)) {
        const char *kind = k->valuestring;
        model_lock();
        g_model.last_rx_ms = now_ms();
        if (g_model.link == LINK_NOLINK) g_model.link = LINK_LINKED;
        model_unlock();

        if (!strcmp(kind, "hello")) {
            apply_time(cJSON_GetObjectItemCaseSensitive(p, "time"));
            send_hello_ack(id);
        } else if (!strcmp(kind, "ping")) {
            send_pong(id);
        } else if (!strcmp(kind, "status")) {
            apply_status(p);
        } else if (!strcmp(kind, "notify")) {
            apply_notify(p);
            send_notify_ack(id);
        } else if (!strcmp(kind, "screenshot")) {
            send_screenshot(id);
        } else if (!strcmp(kind, "tap")) {
            ui_tap();
            send_tap_ack(id, true);
        }
    }
    cJSON_Delete(env);
}

// ------------------------------------------------------------------- task ----

// Frame a byte run from one transport into NDJSON lines. Each transport keeps
// its own line buffer so interleaved bytes can't corrupt a frame; on a complete
// line we mark that transport active (replies go back out the same link).
static void feed_bytes(tr_kind_t src, char *line, size_t *len, const uint8_t *data, int n) {
    for (int i = 0; i < n; i++) {
        char c = (char)data[i];
        if (c == '\n') {
            line[*len] = '\0';
            if (*len > 0) {
                s_active = src;
                handle_line(line);
            }
            *len = 0;
        } else if (c != '\r') {
            if (*len < LINE_BUF - 1) {
                line[(*len)++] = c;
            } else {
                *len = 0; // overflow — drop the runaway frame
            }
        }
    }
}

static void rx_task(void *arg) {
    (void)arg;
    static char usb_line[LINE_BUF];
    static char ble_line[LINE_BUF];
    size_t usb_len = 0, ble_len = 0;
    uint8_t chunk[RX_CHUNK];

    for (;;) {
        // USB first (blocking poll), so it wins "active" on simultaneous traffic.
        int n = usb_serial_jtag_read_bytes(chunk, sizeof(chunk), pdMS_TO_TICKS(READ_POLL_MS));
        if (n > 0) feed_bytes(TR_USB, usb_line, &usb_len, chunk, n);

        // Then drain whatever BLE buffered (non-blocking).
        if (ble_connected()) {
            int m = ble_read(chunk, sizeof(chunk));
            if (m > 0) feed_bytes(TR_BLE, ble_line, &ble_len, chunk, m);
        }

        ble_tick(now_ms());

        // Local NoLink detection: 15s of host silence drops us to the idle face.
        model_lock();
        if (g_model.link != LINK_NOLINK && now_ms() - g_model.last_rx_ms > LINK_TIMEOUT_MS) {
            g_model.link = LINK_NOLINK;
            g_model.activity = ACT_NONE;
            g_model.session_count = 0;
            g_model.dirty = true;
        }
        model_unlock();
    }
}

void proto_start(void) {
    s_tx_lock = xSemaphoreCreateMutex();
    make_device_id();
    ESP_LOGI(TAG, "device_id=%s board=%s fw=%s", s_device_id, FW_BOARD, FW_VERSION);

    usb_serial_jtag_driver_config_t cfg = {
        .tx_buffer_size = USB_TX_BUF,
        .rx_buffer_size = USB_RX_BUF,
    };
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&cfg));

    // BLE is the secondary transport: same NDJSON protocol, same device_id, so
    // the daemon reconnects over either link with no host changes.
    ble_start(s_device_id, FW_BOARD, FW_VERSION);

    xTaskCreate(rx_task, "proto_rx", RX_TASK_STACK, NULL, RX_TASK_PRIO, NULL);
}
