#include "model.h"

#include <string.h>

model_t g_model;
static SemaphoreHandle_t s_lock;

void model_init(void) {
    s_lock = xSemaphoreCreateMutex();
    memset(&g_model, 0, sizeof(g_model));
    g_model.link = LINK_NOLINK;
    g_model.last_rx_ms = 0;
}

void model_lock(void) { xSemaphoreTake(s_lock, portMAX_DELAY); }
void model_unlock(void) { xSemaphoreGive(s_lock); }
