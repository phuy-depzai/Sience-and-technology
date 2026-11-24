#ifndef KEYPADPCF_H
#define KEYPADPCF_H

#include <stdint.h>
#include "PCF8574.h"

class KeypadPCF {
public:
    KeypadPCF(PCF8574 *device);
    char getKey();         // Trả phím (chỉ 1 lần/nhấn), 0 nếu không
    bool isPressed();      // Quick check có phím nào bấm không

private:
    PCF8574 *_pcf;

    const char _keys[4][4] = {
        {'1','2','3','A'},
        {'4','5','6','B'},
        {'7','8','9','C'},
        {'*','0','#','D'}
    };

    char          _lastKey     = 0;   // Phím đang giữ
    char          _lastReported = 0;  // Phím đã trả về
    unsigned long _lastTime    = 0;   // Timestamp lần nhấn
};

#endif