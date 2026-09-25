#ifndef SHT31_H
#define SHT31_H

#include <stdint.h>

class SHT31
{

private:

    uint8_t address;

    bool (*writeBytes)(uint8_t,uint8_t*,uint8_t);
    bool (*readBytes)(uint8_t,uint8_t*,uint8_t);

    uint32_t startTime;
    bool measuring;


public:

    SHT31(
        uint8_t addr,
        bool (*writeFunc)(uint8_t,uint8_t*,uint8_t),
        bool (*readFunc)(uint8_t,uint8_t*,uint8_t)
    );


    bool begin();

    bool startMeasurement();

    bool available();

    bool read(float *temperature,float *humidity);

};


#endif