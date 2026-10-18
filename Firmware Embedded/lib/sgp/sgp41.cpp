#include "sgp41.h"
#include <Wire.h>

SGP41::SGP41(uint8_t addr) {
    _addr = addr;
}

uint8_t SGP41::_crc8(uint8_t* data, uint8_t len) {
    uint8_t crc = 0xFF;
    for (uint8_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (uint8_t j = 0; j < 8; j++) {
            if (crc & 0x80) crc = (crc << 1) ^ 0x31;
            else crc <<= 1;
        }
    }
    return crc;
}

bool SGP41::_writeCmdWithParams(uint16_t cmd, uint16_t p1, uint16_t p2) {
    Wire.beginTransmission(_addr);
    Wire.write((uint8_t)(cmd >> 8));
    Wire.write((uint8_t)(cmd & 0xFF));

    uint8_t buf[2];
    buf[0] = (uint8_t)(p1 >> 8);
    buf[1] = (uint8_t)(p1 & 0xFF);
    Wire.write(buf[0]); Wire.write(buf[1]); Wire.write(_crc8(buf, 2));

    buf[0] = (uint8_t)(p2 >> 8);
    buf[1] = (uint8_t)(p2 & 0xFF);
    Wire.write(buf[0]); Wire.write(buf[1]); Wire.write(_crc8(buf, 2));

    return Wire.endTransmission() == 0;
}

bool SGP41::begin() {
    Wire.beginTransmission(_addr);
    return Wire.endTransmission() == 0;
}

bool SGP41::executeConditioning(uint16_t rh_pct, uint16_t t_c) {
    uint16_t rh_ticks = (uint32_t)rh_pct * 65536 / 100;
    uint16_t t_ticks  = (uint32_t)(t_c + 45) * 65535 / 175;

    if (!_writeCmdWithParams(SGP41_CMD_CONDITIONING, rh_ticks, t_ticks))
        return false;

    delay(60);

    uint8_t data[3];
    if (Wire.requestFrom(_addr, (uint8_t)3) != 3) return false;
    for (int i = 0; i < 3; i++) data[i] = Wire.read();

    delay(10000);
    return true;
}

bool SGP41::measureRaw(uint16_t rh_pct, uint16_t t_c, uint16_t* voc, uint16_t* nox) {
    uint16_t rh_ticks = (uint32_t)rh_pct * 65536 / 100;
    uint16_t t_ticks  = (uint32_t)(t_c + 45) * 65535 / 175;

    if (!_writeCmdWithParams(SGP41_CMD_MEASURE_RAW, rh_ticks, t_ticks))
        return false;

    delay(60);

    uint8_t data[6];
    if (Wire.requestFrom(_addr, (uint8_t)6) != 6) return false;
    for (int i = 0; i < 6; i++) data[i] = Wire.read();

    *voc = ((uint16_t)data[0] << 8) | data[1];
    *nox = ((uint16_t)data[3] << 8) | data[4];

    return true;
}