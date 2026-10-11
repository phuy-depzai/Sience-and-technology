#include "ina226.h"
#include <Wire.h>

static uint16_t ina_read(uint8_t reg)
{
    Wire.beginTransmission(INA226_ADDR);
    Wire.write(reg);
    if(Wire.endTransmission(false) != 0) return 0xFFFF;
    if(Wire.requestFrom(INA226_ADDR, (uint8_t)2) != 2) return 0xFFFF;
    return (Wire.read() << 8) | Wire.read();
}

void ina226_init()
{
    // Config: 16 avg, 1.1ms, continuous
    Wire.beginTransmission(INA226_ADDR);
    Wire.write(0x00);
    Wire.write(0x41);
    Wire.write(0x27);
    Wire.endTransmission();

    // Calib: shunt 0.1Ω, LSB 100µA
    Wire.beginTransmission(INA226_ADDR);
    Wire.write(0x06);
    Wire.write(0x02);
    Wire.write(0x00);
    Wire.endTransmission();

    Serial.println("[INA] Init done");
}

float ina226_vbus()
{
    uint16_t raw = ina_read(0x02);
    return raw * 1.25e-3 * INA226_CAL;
}

float ina226_current()
{
    int16_t raw = (int16_t)ina_read(0x01);
    float vsh = raw * 2.5e-6;
    return vsh / INA226_SHUNT;
}