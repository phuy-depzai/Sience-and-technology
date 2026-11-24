#include "bmp280.h"

// ============================================================
// BUFFER PARSERS (static)
// ============================================================
uint16_t BMP280::bufU16(const uint8_t *b) {
    return (uint16_t)b[0] | ((uint16_t)b[1] << 8);
}

int16_t BMP280::bufS16(const uint8_t *b) {
    return (int16_t)((uint16_t)b[0] | ((uint16_t)b[1] << 8));
}

int32_t BMP280::bufAdc20(const uint8_t *b) {
    // 3 bytes [msb, lsb, xlsb] → 20-bit raw
    int32_t v = ((int32_t)b[0] << 16) | ((int32_t)b[1] << 8) | (int32_t)b[2];
    return v >> 4;
}

// ============================================================
// CALIBRATION
// ============================================================
bool BMP280::calib(const uint8_t *buf) {
    dig_T1 = bufU16(buf + 0);
    dig_T2 = bufS16(buf + 2);
    dig_T3 = bufS16(buf + 4);
    dig_P1 = bufU16(buf + 6);
    dig_P2 = bufS16(buf + 8);
    dig_P3 = bufS16(buf + 10);
    dig_P4 = bufS16(buf + 12);
    dig_P5 = bufS16(buf + 14);
    dig_P6 = bufS16(buf + 16);
    dig_P7 = bufS16(buf + 18);
    dig_P8 = bufS16(buf + 20);
    dig_P9 = bufS16(buf + 22);

    // Sanity: giá trị 0 hoặc 0xFFFF = chip fake
    _valid = (dig_T1 != 0     && dig_T1 != 0xFFFF &&
              dig_P1 != 0     && dig_P1 != 0xFFFF);

    _tFine = 0;
    _t = _p = _alt = 0;

    return _valid;
}

void BMP280::setSeaLevel(float hpa) {
    if (hpa > 900.0f && hpa < 1100.0f) _seaLevel = hpa;
}

// ============================================================
// READ (parse raw 6 bytes: P + T)
// ============================================================
bool BMP280::read(const uint8_t *raw6, uint32_t ts_ms) {
    if (!_valid) return false;

    int32_t adcP = bufAdc20(raw6);        // 3 bytes đầu
    int32_t adcT = bufAdc20(raw6 + 3);    // 3 bytes sau

    _compensate(adcT, adcP);

    if (isnan(_p)) return false;

    // Update trend (chỉ khi có timestamp)
    if (ts_ms != 0) {
        _hist[_hIdx]   = _p;
        _histMs[_hIdx] = ts_ms;
        _hIdx = (_hIdx + 1) % 5;
        if (_hIdx == 0) _hFull = true;
    }

    return true;
}

// ============================================================
// COMPENSATION (datasheet Bosch section 8.1)
// ============================================================
void BMP280::_compensate(int32_t adcT, int32_t adcP) {
    // ============ TEMPERATURE ============
    double var1, var2;
    var1 = ((double)adcT / 16384.0 - (double)dig_T1 / 1024.0) * (double)dig_T2;
    var2 = ((double)adcT / 131072.0 - (double)dig_T1 / 8192.0);
    var2 = var2 * var2 * (double)dig_T3;

    _tFine = (int32_t)(var1 + var2);           // Bắt buộc cho pressure
    _t     = (float)((var1 + var2) / 5120.0);

    // ============ PRESSURE ============
    var1 = ((double)_tFine / 2.0) - 64000.0;
    var2 = var1 * var1 * (double)dig_P6 / 32768.0;
    var2 = var2 + var1 * (double)dig_P5 * 2.0;
    var2 = (var2 / 4.0) + ((double)dig_P4 * 65536.0);
    var1 = ((double)dig_P3 * var1 * var1 / 524288.0 + (double)dig_P2 * var1) / 524288.0;
    var1 = (1.0 + var1 / 32768.0) * (double)dig_P1;

    if (var1 == 0.0) {
        _p   = NAN;
        _alt = NAN;
        return;
    }

    double p = 1048576.0 - (double)adcP;
    p = (p - (var2 / 4096.0)) * 6250.0 / var1;
    var1 = (double)dig_P9 * p * p / 2147483648.0;
    var2 = p * (double)dig_P8 / 32768.0;
    p = p + (var1 + var2 + (double)dig_P7) / 16.0;

    _p = (float)(p / 100.0);                    // Pa → hPa

    // ============ ALTITUDE ============
    _alt = altitude(_p, _seaLevel);
}

// ============================================================
// SANITIZE
// ============================================================
bool BMP280::isValidP() const {
    return !isnan(_p) && _p >= 900.0f && _p <= 1100.0f;
}

bool BMP280::isValidT() const {
    return !isnan(_t) && _t >= -40.0f && _t <= 85.0f;
}

// ============================================================
// TREND (hPa/giờ, cần 5 mẫu có timestamp)
// ============================================================
float BMP280::trend() const {
    if (!_hFull) return 0.0f;
    int oldest = _hIdx;
    int newest = (_hIdx + 4) % 5;
    uint32_t dt = _histMs[newest] - _histMs[oldest];
    if (dt == 0) return 0.0f;
    float dp = _hist[newest] - _hist[oldest];
    return dp / (float)dt * 3600000.0f;   // → hPa/giờ
}

// ============================================================
// ALTITUDE HELPER
// ============================================================
float BMP280::altitude(float press_hpa, float sea_level_hpa) {
    if (press_hpa <= 0 || sea_level_hpa <= 0) return NAN;
    return 44330.0f * (1.0f - powf(press_hpa / sea_level_hpa, 0.1903f));
}

// ============================================================
// DEBUG
// ============================================================
void BMP280::dump() const {
    // Dùng printf để không phụ thuộc Arduino.h
    // Mày có thể thay bằng printf/Serial.print tùy platform
    // printf("[BMP280] T=%.2f°C P=%.2fhPa Alt=%.1fm Trend=%.2fhPa/h\n",
    //        _t, _p, _alt, trend());
}