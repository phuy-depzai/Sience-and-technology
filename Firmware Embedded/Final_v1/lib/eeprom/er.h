#ifndef ER_H
#define ER_H

#include <Arduino.h>
#include <Wire.h>

// ============================================================
// CONFIG
// ============================================================
// Module DS3231 ZS-042: AT24C32 EEPROM hàn chung board, địa chỉ 0x57
// (Nếu dùng EEPROM rời: AT24C32 thường 0x50-0x57 tùy jumper A0-A2)
#define ER_ADDR      0x57

// AT24C32: 32Kbit = 4KB = 4096 bytes
#define ER_SIZE      4096

// Page size (write tối đa 32 bytes/lần)
#define ER_PAGE      32

// Write cycle time (datasheet: 5ms max)
#define ER_DELAY     5

// Địa chỉ bắt đầu dùng cho data (tránh vùng 0x0000 magic)
#define ER_DATA_START 0x0010

// ============================================================
// INIT & TEST
// ============================================================
bool er_init();                                // Init Wire + check EEPROM
bool er_test();                                // Self-test write/read/CRC
void er_dump(uint16_t addr, uint16_t len);     // In hex dump
void er_clear();                               // Xóa toàn bộ EEPROM (về 0xFF)

// ============================================================
// BYTE
// ============================================================
bool er_w(uint16_t addr, uint8_t val);         // Ghi 1 byte
bool er_r(uint16_t addr, uint8_t *val);        // Đọc 1 byte

// ============================================================
// MULTI-BYTE (page write tối ưu)
// ============================================================
bool er_wn(uint16_t addr, const uint8_t *buf, uint16_t len);   // Ghi n bytes
bool er_rn(uint16_t addr, uint8_t *buf, uint16_t len);         // Đọc n bytes

// ============================================================
// 16-BIT (Big-endian: MSB trước)
// ============================================================
bool er_w16(uint16_t addr, uint16_t val);
bool er_r16(uint16_t addr, uint16_t *val);

// ============================================================
// 32-BIT (Big-endian: MSB trước)
// ============================================================
bool er_w32(uint16_t addr, uint32_t val);
bool er_r32(uint16_t addr, uint32_t *val);

// ============================================================
// CRC32
// ============================================================
uint32_t er_crc(const uint8_t *buf, uint16_t len);

// ============================================================
// VERIFY (ghi rồi đọc lại so sánh)
// ============================================================
bool er_verify(uint16_t addr, const uint8_t *buf, uint16_t len);

#endif