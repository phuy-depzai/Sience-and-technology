#ifndef PCF8574_H
#define PCF8574_H

#include <stdint.h>

class PCF8574 {
public:
    using WriteFn = bool (*)(uint8_t addr, uint8_t data);
    using ReadFn  = bool (*)(uint8_t addr, uint8_t *data);

    PCF8574(uint8_t addr, WriteFn writeFunc, ReadFn readFunc);

    bool begin();
    void setState(uint8_t newState);
    void digitalWrite(uint8_t pin, bool val);
    bool digitalRead(uint8_t pin);
    bool read(uint8_t *data);
    bool hasError() const { return _error; }

private:
    uint8_t _addr;
    uint8_t _state = 0xFF;
    bool    _error = false;
    WriteFn _write;
    ReadFn  _read;
};

#endif