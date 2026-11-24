#ifndef PS_H
#define PS_H

#include <Arduino.h>

#define PS_LEN       6       // ← THÊM DÒNG NÀY

#define PS_MAGIC     0x51
#define PS_MG_ADDR   0x0000
#define PS_NODE_ADDR 0x0020
#define PS_PASS_ADDR 0x0040
#define PS_FAIL_ADDR 0x0048

void     ps_init();
bool     ps_save_pin(uint32_t pin);
uint32_t ps_load_pin();
bool     ps_clear_pin();
void     ps_set_fail(uint8_t f);
uint8_t  ps_get_fail();

#endif