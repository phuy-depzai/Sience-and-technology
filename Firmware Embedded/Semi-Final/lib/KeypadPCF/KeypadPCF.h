#ifndef KEYPADPCF_H
#define KEYPADPCF_H

#include <stdint.h>
#include "PCF8574.h"

class KeypadPCF
{
private:
    PCF8574 *pcf;

    const char keys[4][4] =
    {
        {'1','2','3','A'},
        {'4','5','6','B'},
        {'7','8','9','C'},
        {'*','0','#','D'}
    };

    char lastKey;
    unsigned long lastTime;

    bool isPressed();

public:
    KeypadPCF(PCF8574 *device);

    char getKey();
};

#endif