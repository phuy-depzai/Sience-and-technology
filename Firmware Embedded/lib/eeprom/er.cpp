#include "er.h"

bool er_w(uint16_t a, uint8_t d) {
    Wire.beginTransmission(ER_ADDR);
    Wire.write(a >> 8);
    Wire.write(a & 0xFF);
    Wire.write(d);
    if (Wire.endTransmission() != 0) return false;
    delay(5);
    return true;
}

bool er_r(uint16_t a, uint8_t *d) {
    Wire.beginTransmission(ER_ADDR);
    Wire.write(a >> 8);
    Wire.write(a & 0xFF);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(ER_ADDR, (uint8_t)1) != 1) return false;
    *d = Wire.read();
    return true;
}

bool er_wn(uint16_t a, uint8_t *d, uint16_t n) {
    for (uint16_t i = 0; i < n; i++)
        if (!er_w(a + i, d[i])) return false;
    return true;
}

bool er_rn(uint16_t a, uint8_t *d, uint16_t n) {
    for (uint16_t i = 0; i < n; i++)
        if (!er_r(a + i, &d[i])) return false;
    return true;
}

bool er_w32(uint16_t a, uint32_t v) {
    uint8_t b[4] = {
        (uint8_t)(v >> 24), (uint8_t)(v >> 16),
        (uint8_t)(v >> 8),  (uint8_t)v
    };
    return er_wn(a, b, 4);
}

bool er_r32(uint16_t a, uint32_t *v) {
    uint8_t b[4];
    if (!er_rn(a, b, 4)) return false;
    *v = ((uint32_t)b[0] << 24) | ((uint32_t)b[1] << 16)
       | ((uint32_t)b[2] << 8)  | b[3];
    return true;
}

uint32_t er_crc(uint8_t *d, uint16_t n) {
    uint32_t c = 0xFFFFFFFF;
    for (uint16_t i = 0; i < n; i++) {
        c ^= d[i];
        for (int j = 0; j < 8; j++)
            c = (c & 1) ? (c >> 1) ^ 0xEDB88320 : c >> 1;
    }
    return ~c;
}