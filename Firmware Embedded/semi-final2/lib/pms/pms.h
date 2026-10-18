#ifndef PMS_H
#define PMS_H

#include <Arduino.h>

#define PMS_FRAME_LEN 32

struct PMSData {
    uint16_t pm1;
    uint16_t pm25;
    uint16_t pm10;
    uint16_t pm1_cf;
    uint16_t pm25_cf;
    uint16_t pm10_cf;
    bool valid;
};

class PMS7003 {
public:
    PMS7003(HardwareSerial* serial);
    void begin();
    void poll();
    bool read(PMSData* out);
    bool hasNew();

private:
    HardwareSerial* _serial;
    uint8_t _frame[PMS_FRAME_LEN];
    uint8_t _idx;
    uint8_t _state;
    volatile bool _new;
    PMSData _latest;
    uint8_t _checksumOk(uint8_t* buf);
};

#endif