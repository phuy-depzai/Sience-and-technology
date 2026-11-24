#ifndef COMM_H
#define COMM_H

#include <Arduino.h>
#include <stdint.h>

struct SensorData {
    float temp;
    float hum;
    float vpin;
    float ipin;
    float press;
    uint16_t pm1;
    uint16_t pm25;
    uint16_t pm10;
    uint16_t voc_sraw;
    uint16_t nox_sraw;
    uint8_t  sgp_ok;
    uint8_t  emer;      // <-- THÊM DÒNG NÀY
};

#endif