#ifndef COMM_H
#define COMM_H

#include <Arduino.h>

struct SensorData
{
    // Cũ
    float temp;
    float hum;
    float vpin;
    float ipin;

    // PMS7003
    uint16_t pm1;
    uint16_t pm25;
    uint16_t pm10;

    // SGP41
    uint16_t voc_sraw;
    uint16_t nox_sraw;
    uint8_t  sgp_ok;
};

void uart_read_pass();
void uart_send_data(SensorData d);

#endif