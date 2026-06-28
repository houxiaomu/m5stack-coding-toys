#include "ble.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/stream_buffer.h"
#include "freertos/task.h"

#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

#include "model.h"

static const char *TAG = "ble";

// ---- tunables ----
#define BLE_RX_STREAM 4096      // RX byte-stream buffer (central -> device)
#define BLE_TX_CHUNK 180        // notify payload per packet (fits MTU 23..247)
#define BLE_TX_RETRY_MS 4       // backoff when the mbuf pool is momentarily dry
#define BLE_TX_MAX_RETRY 64     // give up a chunk rather than hang forever
#define BLE_PAIR_TIMEOUT_MS 300000  // 5 min, mirrors CoreS3
#define BLE_NAME_LEN 40

// ---- m5ct GATT UUIDs (128-bit, little-endian byte order for NimBLE) ----
// 7d9a000X-6f4f-4f24-9b56-6d3563740000
#define M5CT_UUID128(x) \
    BLE_UUID128_INIT(0x00, 0x00, 0x74, 0x63, 0x35, 0x6d, 0x56, 0x9b, \
                     0x24, 0x4f, 0x4f, 0x6f, (x), 0x00, 0x9a, 0x7d)
static const ble_uuid128_t svc_uuid = M5CT_UUID128(0x00);
static const ble_uuid128_t rx_uuid = M5CT_UUID128(0x01);
static const ble_uuid128_t tx_uuid = M5CT_UUID128(0x02);
static const ble_uuid128_t info_uuid = M5CT_UUID128(0x03);

// ---- identity (owned by caller, valid for program lifetime) ----
static const char *s_device_id = "";
static const char *s_board = "";
static const char *s_fw = "";

// ---- runtime state ----
static StreamBufferHandle_t s_rx_stream;
static uint16_t s_tx_handle;
static uint16_t s_conn = BLE_HS_CONN_HANDLE_NONE;
static bool s_suspended = false; // radio parked for sleep (see ble_suspend)
static uint16_t s_mtu = 23;
static bool s_subscribed;
static bool s_synced;
static bool s_pairing;
static char s_pair_code[7];
static int64_t s_pair_start_ms;
static uint8_t s_own_addr_type;
static char s_name[BLE_NAME_LEN];

static int gap_event(struct ble_gap_event *event, void *arg);

// ---- UI hand-off ----
static void set_model_state(ble_ui_state_t st) {
    model_lock();
    g_model.ble_state = st;
    if (st == BLE_UI_PAIRING) {
        memcpy(g_model.pair_code, s_pair_code, sizeof(g_model.pair_code));
    } else {
        g_model.pair_code[0] = '\0';
    }
    g_model.dirty = true;
    model_unlock();
}

// ---- Info characteristic payload ----
static int build_info_json(char *out, size_t cap) {
    if (s_pairing) {
        return snprintf(out, cap,
                        "{\"v\":1,\"board\":\"%s\",\"fw\":\"%s\",\"device_id\":\"%s\","
                        "\"pairing\":true,\"pair_code\":\"%s\"}",
                        s_board, s_fw, s_device_id, s_pair_code);
    }
    return snprintf(out, cap,
                    "{\"v\":1,\"board\":\"%s\",\"fw\":\"%s\",\"device_id\":\"%s\","
                    "\"pairing\":false}",
                    s_board, s_fw, s_device_id);
}

// ---- GATT access: RX write (-> stream buffer), Info read (-> JSON) ----
static int gatt_access(uint16_t conn, uint16_t attr, struct ble_gatt_access_ctxt *ctxt, void *arg) {
    (void)conn;
    (void)attr;
    (void)arg;
    const ble_uuid_t *uuid = ctxt->chr->uuid;

    if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR && ble_uuid_cmp(uuid, &rx_uuid.u) == 0) {
        uint8_t tmp[256];
        uint16_t len = 0;
        int rc = ble_hs_mbuf_to_flat(ctxt->om, tmp, sizeof(tmp), &len);
        if (rc != 0) return BLE_ATT_ERR_UNLIKELY;
        if (s_rx_stream && len) xStreamBufferSend(s_rx_stream, tmp, len, 0);
        return 0;
    }
    if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR && ble_uuid_cmp(uuid, &info_uuid.u) == 0) {
        char json[256];
        int n = build_info_json(json, sizeof(json));
        if (n < 0) return BLE_ATT_ERR_UNLIKELY;
        int rc = os_mbuf_append(ctxt->om, json, (size_t)n);
        return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    return BLE_ATT_ERR_UNLIKELY;
}

static const struct ble_gatt_svc_def gatt_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &svc_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]){
            {
                .uuid = &rx_uuid.u,
                .access_cb = gatt_access,
                .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
            },
            {
                .uuid = &tx_uuid.u,
                .access_cb = gatt_access,
                .flags = BLE_GATT_CHR_F_NOTIFY,
                .val_handle = &s_tx_handle,
            },
            {
                .uuid = &info_uuid.u,
                .access_cb = gatt_access,
                .flags = BLE_GATT_CHR_F_READ,
            },
            {0},
        },
    },
    {0},
};

// ---- advertising (service UUID in adv packet, name in scan response) ----
static void start_advertising(void) {
    if (!s_synced) return;
    if (s_suspended) return; // radio parked for sleep; ble_resume() re-arms it
    ble_gap_adv_stop();

    snprintf(s_name, sizeof(s_name), s_pairing ? "m5ct-%s-PAIR" : "m5ct-%s", s_device_id);
    ble_svc_gap_device_name_set(s_name);

    struct ble_hs_adv_fields adv;
    memset(&adv, 0, sizeof(adv));
    adv.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    adv.uuids128 = (ble_uuid128_t[]){svc_uuid};
    adv.num_uuids128 = 1;
    adv.uuids128_is_complete = 1;
    int rc = ble_gap_adv_set_fields(&adv);
    if (rc != 0) ESP_LOGE(TAG, "adv_set_fields rc=%d", rc);

    struct ble_hs_adv_fields rsp;
    memset(&rsp, 0, sizeof(rsp));
    rsp.name = (uint8_t *)s_name;
    rsp.name_len = strlen(s_name);
    rsp.name_is_complete = 1;
    rc = ble_gap_adv_rsp_set_fields(&rsp);
    if (rc != 0) ESP_LOGE(TAG, "adv_rsp_set_fields rc=%d", rc);

    struct ble_gap_adv_params params;
    memset(&params, 0, sizeof(params));
    params.conn_mode = BLE_GAP_CONN_MODE_UND;
    params.disc_mode = BLE_GAP_DISC_MODE_GEN;
    rc = ble_gap_adv_start(s_own_addr_type, NULL, BLE_HS_FOREVER, &params, gap_event, NULL);
    if (rc != 0) ESP_LOGE(TAG, "adv_start rc=%d", rc);
}

static int gap_event(struct ble_gap_event *event, void *arg) {
    (void)arg;
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) {
            s_conn = event->connect.conn_handle;
            s_subscribed = false;
            if (s_pairing) {
                s_pairing = false;
                s_pair_code[0] = '\0';
            }
            set_model_state(BLE_UI_CONNECTED);
            ESP_LOGI(TAG, "central connected (conn=%d)", s_conn);
        } else {
            start_advertising();
        }
        return 0;

    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "central disconnected (reason=%d)", event->disconnect.reason);
        s_conn = BLE_HS_CONN_HANDLE_NONE;
        s_subscribed = false;
        s_mtu = 23;
        set_model_state(s_pairing ? BLE_UI_PAIRING : BLE_UI_READY);
        start_advertising();
        return 0;

    case BLE_GAP_EVENT_SUBSCRIBE:
        if (event->subscribe.attr_handle == s_tx_handle) {
            s_subscribed = event->subscribe.cur_notify;
        }
        return 0;

    case BLE_GAP_EVENT_MTU:
        s_mtu = event->mtu.value;
        return 0;

    case BLE_GAP_EVENT_ADV_COMPLETE:
        start_advertising();
        return 0;

    default:
        return 0;
    }
}

static void on_sync(void) {
    ble_hs_util_ensure_addr(0);
    int rc = ble_hs_id_infer_auto(0, &s_own_addr_type);
    if (rc != 0) {
        ESP_LOGE(TAG, "infer_auto rc=%d", rc);
        return;
    }
    ble_att_set_preferred_mtu(247);
    s_synced = true;
    set_model_state(s_pairing ? BLE_UI_PAIRING : BLE_UI_READY);
    start_advertising();
}

static void on_reset(int reason) {
    ESP_LOGW(TAG, "nimble reset; reason=%d", reason);
    s_synced = false;
}

static void host_task(void *param) {
    (void)param;
    nimble_port_run();
    nimble_port_freertos_deinit();
}

// ---- public API ----
void ble_start(const char *device_id, const char *board, const char *fw) {
    s_device_id = device_id ? device_id : "";
    s_board = board ? board : "";
    s_fw = fw ? fw : "";

    s_rx_stream = xStreamBufferCreate(BLE_RX_STREAM, 1);
    if (!s_rx_stream) {
        ESP_LOGE(TAG, "rx stream alloc failed");
        return;
    }

    esp_err_t ret = nimble_port_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "nimble_port_init %d", ret);
        return;
    }

    ble_svc_gap_init();
    ble_svc_gatt_init();
    int rc = ble_gatts_count_cfg(gatt_svcs);
    if (rc != 0) {
        ESP_LOGE(TAG, "gatts_count_cfg %d", rc);
        return;
    }
    rc = ble_gatts_add_svcs(gatt_svcs);
    if (rc != 0) {
        ESP_LOGE(TAG, "gatts_add_svcs %d", rc);
        return;
    }

    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.reset_cb = on_reset;
    ble_hs_cfg.sm_io_cap = BLE_HS_IO_NO_INPUT_OUTPUT;

    nimble_port_freertos_init(host_task);
    ESP_LOGI(TAG, "nimble up; advertising as m5ct-%s", s_device_id);
}

bool ble_connected(void) {
    return s_conn != BLE_HS_CONN_HANDLE_NONE;
}

// Park the radio for sleep: stop advertising and drop any link. The suspend
// flag makes start_advertising() (incl. the auto-restart on disconnect) a no-op
// until ble_resume() clears it.
void ble_suspend(void) {
    s_suspended = true;
    if (s_conn != BLE_HS_CONN_HANDLE_NONE)
        ble_gap_terminate(s_conn, BLE_ERR_REM_USER_CONN_TERM);
    ble_gap_adv_stop();
}

// Re-arm advertising after sleep so the daemon can rediscover and reconnect.
void ble_resume(void) {
    s_suspended = false;
    start_advertising();
}

int ble_read(uint8_t *buf, size_t n) {
    if (!s_rx_stream || !buf || n == 0) return 0;
    return (int)xStreamBufferReceive(s_rx_stream, buf, n, 0);
}

int ble_write(const uint8_t *buf, size_t n) {
    if (s_conn == BLE_HS_CONN_HANDLE_NONE || !s_subscribed || !buf) return 0;

    size_t chunk = (s_mtu > 3) ? (size_t)(s_mtu - 3) : BLE_TX_CHUNK;
    if (chunk > BLE_TX_CHUNK) chunk = BLE_TX_CHUNK;

    size_t sent = 0;
    int retry = 0;
    while (sent < n) {
        size_t take = n - sent;
        if (take > chunk) take = chunk;
        struct os_mbuf *om = ble_hs_mbuf_from_flat(buf + sent, take);
        if (!om) {
            if (++retry > BLE_TX_MAX_RETRY) break;
            vTaskDelay(pdMS_TO_TICKS(BLE_TX_RETRY_MS));
            continue;
        }
        // notify_custom consumes (frees) om regardless of return.
        int rc = ble_gatts_notify_custom(s_conn, s_tx_handle, om);
        if (rc != 0) break;  // peer gone / not subscribed — stop
        sent += take;
        retry = 0;
    }
    return (int)sent;
}

void ble_toggle_pairing(int64_t now_ms) {
    if (s_pairing) {
        s_pairing = false;
        s_pair_code[0] = '\0';
        set_model_state(ble_connected() ? BLE_UI_CONNECTED : BLE_UI_READY);
    } else {
        uint32_t v = esp_random() % 1000000u;
        snprintf(s_pair_code, sizeof(s_pair_code), "%06u", (unsigned)v);
        s_pairing = true;
        s_pair_start_ms = now_ms;
        set_model_state(BLE_UI_PAIRING);
    }
    start_advertising();
}

bool ble_pairing_active(void) {
    return s_pairing;
}

void ble_tick(int64_t now_ms) {
    if (s_pairing && now_ms - s_pair_start_ms > BLE_PAIR_TIMEOUT_MS) {
        s_pairing = false;
        s_pair_code[0] = '\0';
        set_model_state(ble_connected() ? BLE_UI_CONNECTED : BLE_UI_READY);
        start_advertising();
    }
}
