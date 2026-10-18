#include "ina226.h"
#include <Wire.h>

static uint16_t ina_read(uint8_t reg)
{
    Wire.beginTransmission(INA226_ADDR);
    Wire.write(reg);
    if(Wire.endTransmission() != 0) return 0xFFFF;   // ← STOP, không repeated start
    delayMicroseconds(200);
    if(Wire.requestFrom(INA226_ADDR, (uint8_t)2) != 2) return 0xFFFF;
    uint8_t hi = Wire.read();
    uint8_t lo = Wire.read();
    return ((uint16_t)hi << 8) | lo;
}

void ina226_init()
{
    // Config: AVG=16, VBUS CT=1.1ms, VSH CT=1.1ms, continuous
    Wire.beginTransmission(INA226_ADDR);
    Wire.write(0x00);
    Wire.write(0x29);
    Wire.write(0x3F);
    Wire.endTransmission();

    // Calibration: shunt 0.1Ω, LSB 100µA
    Wire.beginTransmission(INA226_ADDR);
    Wire.write(0x05);
    Wire.write(0x02);
    Wire.write(0x00);
    Wire.endTransmission();

    Serial.println("[INA] Init done");
}

float ina226_vbus()
{
    uint16_t raw = ina_read(0x02);
    if(raw == 0xFFFF) return 0;
    return raw * 1.25e-3;
}

float ina226_current()
{
    int16_t raw = (int16_t)ina_read(0x04);
    if(raw == (int16_t)0xFFFF) return 0;
    return raw * 1e-4;
}