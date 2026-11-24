#ifndef INA226_H
#define INA226_H

#include <Arduino.h>

#define INA226_ADDR   0x40        // ← FIX: 0x44 -> 0x40
#define INA226_SHUNT  0.1f
#define INA226_CAL    0.9261f

void  ina226_init();
float ina226_vbus();
float ina226_current();

#endif