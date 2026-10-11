#ifndef COMM_H
#define COMM_H

#include <Arduino.h>

struct SensorData
{
    float temp;
    float hum;
    float vpin;
    float ipin;
};

void uart_read_pass();
void uart_send_data(SensorData d);

#endif