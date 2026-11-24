#ifndef bmp280_H
#define bmp280_H

#include <stdint.h>
#include <math.h>

// Register map
#define BMP280_REG_CALIB   0x88
#define BMP280_REG_CHIPID  0xD0
#define BMP280_REG_CTRL    0xF4
#define BMP280_REG_CONFIG  0xF5
#define BMP280_REG_PRESS   0xF7

#define BMP280_CHIP_ID     0x58

class BMP280 {
public:
    bool  calib(const uint8_t *buf24);
    void  setSeaLevel(float hpa = 1013.25f);
    bool  isReady()  const { return _valid; }

    bool  read(const uint8_t *raw6, uint32_t ts_ms = 0);

    float getT()   const { return _t; }
    float getP()   const { return _p; }
    float getAlt() const { return _alt; }

    float trend() const;

    bool  isValidP() const;
    bool  isValidT() const;

    static uint16_t bufU16  (const uint8_t *b);
    static int16_t  bufS16  (const uint8_t *b);
    static int32_t  bufAdc20(const uint8_t *b);
    static float    altitude(float press_hpa, float sea_level_hpa);

    void  dump() const;                 // ← THÊM DÒNG NÀY

private:
    uint16_t dig_T1;
    int16_t  dig_T2, dig_T3;
    uint16_t dig_P1;
    int16_t  dig_P2, dig_P3, dig_P4, dig_P5, dig_P6, dig_P7, dig_P8, dig_P9;

    int32_t  _tFine = 0;
    float    _t = 0, _p = 0, _alt = 0;
    float    _seaLevel = 1013.25f;
    bool     _valid = false;

    float    _hist[5]   = {0};
    uint32_t _histMs[5] = {0};
    int      _hIdx  = 0;
    bool     _hFull = false;

    void  _compensate(int32_t adcT, int32_t adcP);
};

#endif