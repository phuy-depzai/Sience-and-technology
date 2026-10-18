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
    // Config: 16 avg, 1.1ms VBUS, 1.1ms VSH, continuous shunt+bus
    Wire.beginTransmission(INA226_ADDR);
    Wire.write(0x00);      // Config register
    Wire.write(0x29);      // high byte: AVG=16, VBUS CT=1.1ms
    Wire.write(0x3F);      // low byte: VSH CT=1.1ms, MODE=continuous
    Wire.endTransmission();

    // Calibration: shunt 0.1Ω, current LSB = 100µA
    // CAL = 0.00512 / (current_LSB × R_shunt) = 0.00512 / (100µA × 0.1Ω) = 512 = 0x0200
    Wire.beginTransmission(INA226_ADDR);
    Wire.write(0x05);      // ← FIX: Calibration register (was 0x06)
    Wire.write(0x02);
    Wire.write(0x00);
    Wire.endTransmission();

    Serial.println("[INA] Init done");
}

float ina226_vbus()
{
    uint16_t raw = ina_read(0x02);  // Bus voltage register
    return raw * 1.25e-3;            // 1.25mV per LSB
}

float ina226_current()
{
    int16_t raw = (int16_t)ina_read(0x04);  // ← FIX: Current register 0x04, không phải 0x01
    return raw * 1e-4;                       // 100µA per LSB (theo calib)
}