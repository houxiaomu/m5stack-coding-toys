// BOOT (GPIO0) physical button: ~30ms polled debounce with short/long classify
// on release. Short press drives the session picker (open / step cursor); long
// press confirms the highlighted session. See buttons.c.
#pragma once

void buttons_start(void);
