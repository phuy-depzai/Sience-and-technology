#ifndef PS_H
#define PS_H

#include <Arduino.h>

#define PS_LEN   8

// Địa chỉ EEPROM
#define PS_MG    0x0000  // magic
#define PS_A     0x0010  // pass A (8) + crc (4)
#define PS_B     0x0020  // pass B (8) + crc (4)
#define PS_ST    0x0030  // status (4) + crc (4)

void ps_init();
bool ps_check(char lv, uint8_t *in);
bool ps_save(char lv, uint8_t *pass);
void ps_kill(char lv);
uint8_t ps_used(char lv);
void ps_set_used(char lv, uint8_t v);
uint8_t ps_fail(char lv);
void ps_set_fail(char lv, uint8_t v);

#endif