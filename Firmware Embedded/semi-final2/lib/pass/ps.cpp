#include "ps.h"
#include "er.h"

// Trả về địa chỉ pass theo cấp
static uint16_t addr_pass(char lv) { return lv == 'A' ? PS_A : PS_B; }

// Trả về địa chỉ used
static uint16_t addr_used(char lv) { return PS_ST + (lv == 'A' ? 0 : 1); }

// Trả về địa chỉ fail
static uint16_t addr_fail(char lv) { return PS_ST + (lv == 'A' ? 2 : 3); }

// Ghi pass + CRC, verify lại
bool ps_save(char lv, uint8_t *pass) {
    uint16_t a = addr_pass(lv);
    uint32_t c = er_crc(pass, PS_LEN);

    er_wn(a, pass, PS_LEN);
    er_w32(a + PS_LEN, c);

    // Verify
    uint8_t chk[PS_LEN];
    uint32_t c_chk;
    er_rn(a, chk, PS_LEN);
    er_r32(a + PS_LEN, &c_chk);

    if (memcmp(pass, chk, PS_LEN) != 0 || c != c_chk) {
        Serial.print("[PS] Write fail ");
        Serial.println(lv);
        return false;
    }
    return true;
}

// Đọc pass + verify CRC, so sánh input
bool ps_check(char lv, uint8_t *in) {
    uint16_t a = addr_pass(lv);
    uint8_t s[PS_LEN];
    uint32_t c;

    if (!er_rn(a, s, PS_LEN)) return false;
    if (!er_r32(a + PS_LEN, &c)) return false;

    if (er_crc(s, PS_LEN) != c) {
        Serial.print("[PS] Corrupt ");
        Serial.println(lv);
        return false;
    }
    return memcmp(in, s, PS_LEN) == 0;
}

// Vô hiệu hóa pass + set used = 1
void ps_kill(char lv) {
    uint16_t a = addr_pass(lv);
    uint8_t z[PS_LEN] = {0};
    er_wn(a, z, PS_LEN);
    er_w32(a + PS_LEN, er_crc(z, PS_LEN));
    ps_set_used(lv, 1);
    Serial.print("[PS] Kill ");
    Serial.println(lv);
}

// Init toàn bộ EEPROM
void ps_init() {
    uint8_t mg = 0;
    er_r(PS_MG, &mg);

    if (mg != 0x50) {
        uint8_t a[PS_LEN] = {1,2,3,4,5,6,7,8};
        uint8_t b[PS_LEN] = {8,7,6,5,4,3,2,1};
        ps_save('A', a);
        ps_save('B', b);
        ps_set_used('A', 0);
        ps_set_used('B', 0);
        ps_set_fail('A', 0);
        ps_set_fail('B', 0);
        er_w(PS_MG, 0x50);
        Serial.println("[PS] Init default");
    }
}

uint8_t ps_used(char lv) {
    uint8_t v = 0;
    er_r(addr_used(lv), &v);
    return v;
}

void ps_set_used(char lv, uint8_t v) {
    er_w(addr_used(lv), v);
}

uint8_t ps_fail(char lv) {
    uint8_t v = 0;
    er_r(addr_fail(lv), &v);
    return v;
}

void ps_set_fail(char lv, uint8_t v) {
    er_w(addr_fail(lv), v);
}