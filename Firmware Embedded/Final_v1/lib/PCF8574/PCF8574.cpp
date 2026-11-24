#include "PCF8574.h"

PCF8574::PCF8574(uint8_t addr, WriteFn writeFunc, ReadFn readFunc)
    : _addr(addr), _write(writeFunc), _read(readFunc) {}

bool PCF8574::begin() {
    _error = false;
    return _write(_addr, _state);
}

void PCF8574::setState(uint8_t newState) {
    _state = newState;
    _error = !_write(_addr, _state);
}

void PCF8574::digitalWrite(uint8_t pin, bool val) {
    if (pin > 7) return;
    if (val) _state |=  (1 << pin);
    else     _state &= ~(1 << pin);
    _error = !_write(_addr, _state);
}

bool PCF8574::digitalRead(uint8_t pin) {
    if (pin > 7) return false;
    uint8_t data;
    if (!read(&data)) return false;
    return (data >> pin) & 1;
}

bool PCF8574::read(uint8_t *data) {
    _error = !_read(_addr, data);
    return !_error;
}