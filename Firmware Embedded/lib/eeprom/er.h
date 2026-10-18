#ifndef ER_H
#define ER_H

#include <Arduino.h>
#include <Wire.h>

#define ER_ADDR 0x57  // AT24C32

bool er_w(uint16_t a, uint8_t d);
bool er_r(uint16_t a, uint8_t *d);
bool er_wn(uint16_t a, uint8_t *d, uint16_t n);
bool er_rn(uint16_t a, uint8_t *d, uint16_t n);
bool er_w32(uint16_t a, uint32_t v);
bool er_r32(uint16_t a, uint32_t *v);
uint32_t er_crc(uint8_t *d, uint16_t n);

#endif