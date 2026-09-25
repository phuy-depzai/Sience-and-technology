#include "PCF8574.h"


PCF8574::PCF8574(
    uint8_t addr,
    bool (*writeFunc)(uint8_t, uint8_t),
    bool (*readFunc)(uint8_t, uint8_t*)
)
{
    address = addr;
    writeByte = writeFunc;
    readByte = readFunc;

    state = 0xFF;   // PCF8574 mặc định tất cả HIGH
}


bool PCF8574::begin()
{
    return writeByte(address, state);
}


void PCF8574::digitalWrite(uint8_t pin, bool value)
{
    if(pin > 7) return;

    if(value)
        state |= (1 << pin);
    else
        state &= ~(1 << pin);

    writeByte(address, state);
}


bool PCF8574::digitalRead(uint8_t pin)
{
    uint8_t data;

    if(pin > 7)
        return false;

    if(!readByte(address, &data))
        return false;

    return (data >> pin) & 1;
}


uint8_t PCF8574::read()
{
    uint8_t data;

    if(readByte(address, &data))
        return data;

    return 0xFF;
}