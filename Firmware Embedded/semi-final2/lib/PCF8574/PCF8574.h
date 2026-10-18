#ifndef PCF8574_H
#define PCF8574_H

#include <stdint.h>

class PCF8574
{
private:
    uint8_t address;
    uint8_t state;

    bool (*writeByte)(uint8_t addr, uint8_t data);
    bool (*readByte)(uint8_t addr, uint8_t *data);

public:
    PCF8574(
        uint8_t addr,
        bool (*writeFunc)(uint8_t, uint8_t),
        bool (*readFunc)(uint8_t, uint8_t*)
    );

    bool begin();

    void digitalWrite(uint8_t pin, bool value);

    bool digitalRead(uint8_t pin);

    uint8_t read();
};

#endif