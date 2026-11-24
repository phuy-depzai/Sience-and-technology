#include "ps.h"
#include "er.h"

void ps_init() {
    uint8_t mg = 0;
    er_r(PS_MG_ADDR, &mg);
    if (mg != PS_MAGIC) {
        Serial.println("[PS] Init EEPROM");
        er_w(PS_MG_ADDR, PS_MAGIC);
        ps_clear_pin();
        ps_set_fail(0);
    }
}

bool ps_save_pin(uint32_t pin) {
    if (pin < 100000 || pin > 999999) return false;
    if (!er_w32(PS_PASS_ADDR, pin)) return false;
    uint32_t c = er_crc((const uint8_t*)&pin, 4);
    if (!er_w32(PS_PASS_ADDR + 4, c)) return false;
    return true;
}

uint32_t ps_load_pin() {
    uint32_t pin, c;
    if (!er_r32(PS_PASS_ADDR, &pin)) return 0xFFFFFFFF;
    if (!er_r32(PS_PASS_ADDR + 4, &c)) return 0xFFFFFFFF;
    if (c != er_crc((const uint8_t*)&pin, 4)) return 0xFFFFFFFF;
    if (pin < 100000 || pin > 999999) return 0xFFFFFFFF;
    return pin;
}

bool ps_clear_pin() {
    uint32_t inv = 0xFFFFFFFF;
    if (!er_w32(PS_PASS_ADDR, inv)) return false;
    if (!er_w32(PS_PASS_ADDR + 4, er_crc((const uint8_t*)&inv, 4))) return false;
    return true;
}

void ps_set_fail(uint8_t f) {
    er_w(PS_FAIL_ADDR, f);
}

uint8_t ps_get_fail() {
    uint8_t f = 0;
    er_r(PS_FAIL_ADDR, &f);
    return f;
}