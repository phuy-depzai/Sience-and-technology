#include "KeypadPCF.h"
#include <Arduino.h>

#define KEYPAD_DEBOUNCE_MS    50
#define KEYPAD_RELEASE_MS     30

KeypadPCF::KeypadPCF(PCF8574 *device) : _pcf(device) {}

// ============================================================
// QUICK CHECK: Có phím nào bấm không (1 I2C write)
// ============================================================
bool KeypadPCF::isPressed() {
    // Row 0-3 = LOW (0), Col 4-7 = HIGH (1)
    _pcf->setState(0x0F);
    uint8_t data;
    if (!_pcf->read(&data)) return false;

    // Cột nào bị kéo xuống LOW = có phím
    return (data & 0xF0) != 0xF0;
}

// ============================================================
// SCAN: Quét keypad có debounce (4 I2C writes/scan)
// ============================================================
char KeypadPCF::getKey() {
    // --- Scan phím ---
    char key = 0;
    for (uint8_t row = 0; row < 4; row++) {
        uint8_t out = 0xFF & ~(1 << row);   // Row = LOW, còn lại HIGH
        _pcf->setState(out);

        uint8_t data;
        if (!_pcf->read(&data)) return 0;   // I2C error

        for (uint8_t col = 0; col < 4; col++) {
            if (!(data & (1 << (col + 4)))) {
                key = _keys[row][col];
                break;
            }
        }
        if (key) break;
    }

    unsigned long now = millis();

    // --- Nhả phím ---
    if (key == 0) {
        if (_lastKey != 0 && (now - _lastTime) > KEYPAD_RELEASE_MS) {
            _lastKey = 0;
            _lastReported = 0;
        }
        return 0;
    }

    // --- Phím mới nhấn ---
    if (key != _lastKey) {
        _lastKey = key;
        _lastTime = now;
        _lastReported = 0;
        return 0;   // Chờ debounce
    }

    // --- Đang giữ phím, đã đủ debounce, chưa report ---
    if ((now - _lastTime) >= KEYPAD_DEBOUNCE_MS && _lastReported != key) {
        _lastReported = key;
        return key;
    }

    return 0;
}