#include "er.h"

// ============================================================
// INIT
// ============================================================
bool er_init() {
    Wire.begin();
    Wire.setClock(100000);

    // Ping EEPROM để check kết nối
    Wire.beginTransmission(ER_ADDR);
    uint8_t err = Wire.endTransmission();

    if (err != 0) {
        Serial.print("[ER] Init FAIL, code=");
        Serial.println(err);
        return false;
    }

    Serial.println("[ER] EEPROM OK");
    return true;
}

// ============================================================
// TEST (self-test)
// ============================================================
bool er_test() {
    Serial.println("\n=== EEPROM SELF-TEST ===");

    // Test 1: write 1 byte
    Serial.print("[1] Write 0xAB @ 0x0000... ");
    if (!er_w(0x0000, 0xAB)) { Serial.println("FAIL"); return false; }

    uint8_t v = 0;
    if (!er_r(0x0000, &v)) { Serial.println("Read FAIL"); return false; }
    Serial.print("Read: 0x"); Serial.print(v, HEX);
    if (v != 0xAB) { Serial.println(" ❌ (mismatch)"); return false; }
    Serial.println(" ✅");

    // Test 2: write 8 bytes
    Serial.print("[2] Write 8 bytes @ 0x0010... ");
    uint8_t wbuf[8] = {0xDE, 0xAD, 0xBE, 0xEF, 0x12, 0x34, 0x56, 0x78};
    if (!er_wn(0x0010, wbuf, 8)) { Serial.println("FAIL"); return false; }

    uint8_t rbuf[8];
    if (!er_rn(0x0010, rbuf, 8)) { Serial.println("Read FAIL"); return false; }
    if (memcmp(wbuf, rbuf, 8) != 0) { Serial.println("❌ (mismatch)"); return false; }
    Serial.println("✅");

    // Test 3: write 32 bytes (full page)
    Serial.print("[3] Write 32 bytes @ 0x0020... ");
    uint8_t page[32];
    for (int i = 0; i < 32; i++) page[i] = i;
    if (!er_wn(0x0020, page, 32)) { Serial.println("FAIL"); return false; }

    uint8_t rpage[32];
    if (!er_rn(0x0020, rpage, 32)) { Serial.println("Read FAIL"); return false; }
    if (memcmp(page, rpage, 32) != 0) { Serial.println("❌ (mismatch)"); return false; }
    Serial.println("✅");

    // Test 4: cross-page write (30 bytes @ 0x0030 → ghi qua 2 page)
    Serial.print("[4] Cross-page write @ 0x0030... ");
    uint8_t xbuf[30];
    for (int i = 0; i < 30; i++) xbuf[i] = 0xA0 + i;
    if (!er_wn(0x0030, xbuf, 30)) { Serial.println("FAIL"); return false; }

    uint8_t xrbuf[30];
    if (!er_rn(0x0030, xrbuf, 30)) { Serial.println("Read FAIL"); return false; }
    if (memcmp(xbuf, xrbuf, 30) != 0) { Serial.println("❌ (mismatch)"); return false; }
    Serial.println("✅");

    // Test 5: 32-bit write
    Serial.print("[5] Write u32 0xDEADBEEF @ 0x0050... ");
    if (!er_w32(0x0050, 0xDEADBEEF)) { Serial.println("FAIL"); return false; }

    uint32_t v32;
    if (!er_r32(0x0050, &v32)) { Serial.println("Read FAIL"); return false; }
    Serial.print("Read: 0x"); Serial.print(v32, HEX);
    if (v32 != 0xDEADBEEF) { Serial.println(" ❌"); return false; }
    Serial.println(" ✅");

    // Test 6: CRC
    Serial.print("[6] CRC32 of '12345678'... ");
    uint32_t crc = er_crc((const uint8_t*)"12345678", 8);
    Serial.print("0x"); Serial.println(crc, HEX);

    Serial.println("=== ALL TESTS PASS ===\n");
    return true;
}

// ============================================================
// DUMP (hex view)
// ============================================================
void er_dump(uint16_t addr, uint16_t len) {
    Serial.print("[ER DUMP 0x");
    Serial.print(addr, HEX);
    Serial.print(" - 0x");
    Serial.print(addr + len - 1, HEX);
    Serial.println("]");

    for (uint16_t i = 0; i < len; i += 16) {
        Serial.print("  0x");
        if (addr + i < 0x1000) Serial.print("0");
        if (addr + i < 0x0100) Serial.print("0");
        if (addr + i < 0x0010) Serial.print("0");
        Serial.print(addr + i, HEX);
        Serial.print(": ");

        for (uint16_t j = 0; j < 16 && (i + j) < len; j++) {
            uint8_t v = 0;
            er_r(addr + i + j, &v);
            if (v < 0x10) Serial.print("0");
            Serial.print(v, HEX);
            Serial.print(" ");
        }
        Serial.println();
    }
}

// ============================================================
// CLEAR (về 0xFF)
// ============================================================
void er_clear() {
    Serial.println("[ER] Clearing all...");
    uint8_t blank[32];
    memset(blank, 0xFF, sizeof(blank));

    for (uint16_t a = 0; a < ER_SIZE; a += 32) {
        er_wn(a, blank, 32);
    }
    Serial.println("[ER] Cleared");
}

// ============================================================
// BYTE
// ============================================================
bool er_w(uint16_t addr, uint8_t val) {
    Wire.beginTransmission(ER_ADDR);
    Wire.write(addr >> 8);
    Wire.write(addr & 0xFF);
    Wire.write(val);
    if (Wire.endTransmission() != 0) return false;
    delay(ER_DELAY);
    return true;
}

bool er_r(uint16_t addr, uint8_t *val) {
    Wire.beginTransmission(ER_ADDR);
    Wire.write(addr >> 8);
    Wire.write(addr & 0xFF);
    if (Wire.endTransmission(false) != 0) return false;

    if (Wire.requestFrom(ER_ADDR, (uint8_t)1) != 1) return false;
    *val = Wire.read();
    return true;
}

// ============================================================
// MULTI-BYTE (PAGE WRITE)
// ============================================================
bool er_wn(uint16_t addr, const uint8_t *buf, uint16_t len) {
    while (len > 0) {
        // Số byte còn lại trong page hiện tại (tránh vượt biên page)
        uint16_t page_remain = ER_PAGE - (addr % ER_PAGE);
        uint16_t chunk = (len < page_remain) ? len : page_remain;

        Wire.beginTransmission(ER_ADDR);
        Wire.write(addr >> 8);
        Wire.write(addr & 0xFF);
        for (uint16_t i = 0; i < chunk; i++) {
            Wire.write(buf[i]);
        }
        if (Wire.endTransmission() != 0) return false;

        delay(ER_DELAY);

        addr += chunk;
        buf  += chunk;
        len  -= chunk;
    }
    return true;
}

bool er_rn(uint16_t addr, uint8_t *buf, uint16_t len) {
    // Sequential read: set address 1 lần, đọc nhiều lần liên tiếp
    Wire.beginTransmission(ER_ADDR);
    Wire.write(addr >> 8);
    Wire.write(addr & 0xFF);
    if (Wire.endTransmission(false) != 0) return false;

    uint16_t read = 0;
    while (read < len) {
        // Wire buffer max 32 bytes → chia nhỏ
        uint8_t chunk = (len - read > 32) ? 32 : (len - read);

        if (Wire.requestFrom(ER_ADDR, (uint8_t)chunk) != chunk) return false;

        for (uint8_t i = 0; i < chunk; i++) {
            buf[read + i] = Wire.read();
        }
        read += chunk;
    }
    return true;
}

// ============================================================
// 16-BIT
// ============================================================
bool er_w16(uint16_t addr, uint16_t val) {
    uint8_t b[2] = { (uint8_t)(val >> 8), (uint8_t)(val & 0xFF) };
    return er_wn(addr, b, 2);
}

bool er_r16(uint16_t addr, uint16_t *val) {
    uint8_t b[2];
    if (!er_rn(addr, b, 2)) return false;
    *val = ((uint16_t)b[0] << 8) | b[1];
    return true;
}

// ============================================================
// 32-BIT
// ============================================================
bool er_w32(uint16_t addr, uint32_t val) {
    uint8_t b[4] = {
        (uint8_t)(val >> 24),
        (uint8_t)(val >> 16),
        (uint8_t)(val >> 8),
        (uint8_t)(val)
    };
    return er_wn(addr, b, 4);
}

bool er_r32(uint16_t addr, uint32_t *val) {
    uint8_t b[4];
    if (!er_rn(addr, b, 4)) return false;
    *val = ((uint32_t)b[0] << 24) |
           ((uint32_t)b[1] << 16) |
           ((uint32_t)b[2] << 8)  |
           ((uint32_t)b[3]);
    return true;
}

// ============================================================
// CRC32 (IEEE 802.3, giống zlib)
// ============================================================
uint32_t er_crc(const uint8_t *buf, uint16_t len) {
    uint32_t crc = 0xFFFFFFFF;
    for (uint16_t i = 0; i < len; i++) {
        crc ^= buf[i];
        for (int j = 0; j < 8; j++) {
            crc = (crc & 1) ? (crc >> 1) ^ 0xEDB88320 : (crc >> 1);
        }
    }
    return ~crc;
}

// ============================================================
// VERIFY (ghi + đọc lại so sánh)
// ============================================================
bool er_verify(uint16_t addr, const uint8_t *buf, uint16_t len) {
    // Ghi
    if (!er_wn(addr, buf, len)) return false;

    // Đọc lại
    uint8_t check[64];
    if (len > sizeof(check)) return false;

    if (!er_rn(addr, check, len)) return false;
    return memcmp(buf, check, len) == 0;
}