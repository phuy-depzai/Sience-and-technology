#ifndef SGP41_H
#define SGP41_H

#include <Arduino.h>

#define SGP41_ADDR              0x59
#define SGP41_CMD_CONDITIONING  0x2612
#define SGP41_CMD_MEASURE_RAW   0x2619
#define SGP41_CMD_HEATER_OFF    0x3615

class SGP41 {
public:
    SGP41(uint8_t addr = SGP41_ADDR);
    bool begin();
    bool executeConditioning(uint16_t rh_pct, uint16_t t_c);
    bool measureRaw(uint16_t rh_pct, uint16_t t_c, uint16_t* voc, uint16_t* nox);
    bool heaterOff();

private:
    uint8_t _addr;
    uint8_t _crc8(uint8_t* data, uint8_t len);
    bool _writeCmdWithParams(uint16_t cmd, uint16_t p1, uint16_t p2);
};

#endif