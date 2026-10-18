#include "pms.h"

PMS7003::PMS7003(HardwareSerial* serial) {
    _serial = serial;
    _idx = 0;
    _state = 0;
    _new = false;
    _latest.valid = false;
}

void PMS7003::begin() {
    _serial->begin(9600);
}

uint8_t PMS7003::_checksumOk(uint8_t* buf) {
    uint16_t sum = 0;
    for (int i = 0; i < 30; i++) sum += buf[i];
    uint16_t cs = ((uint16_t)buf[30] << 8) | buf[31];
    return (sum == cs);
}

void PMS7003::poll() {
    while (_serial->available()) {
        uint8_t b = _serial->read();
        switch (_state) {
            case 0:
                if (b == 0x42) { _frame[0] = b; _state = 1; }
                break;
            case 1:
                if (b == 0x4D) { _frame[1] = b; _idx = 2; _state = 2; }
                else if (b == 0x42) { _frame[0] = b; }
                else { _state = 0; }
                break;
            case 2:
                _frame[_idx++] = b;
                if (_idx >= PMS_FRAME_LEN) {
                    if (_checksumOk(_frame)) {
                        _latest.pm1_cf  = ((uint16_t)_frame[4]  << 8) | _frame[5];
                        _latest.pm25_cf = ((uint16_t)_frame[6]  << 8) | _frame[7];
                        _latest.pm10_cf = ((uint16_t)_frame[8]  << 8) | _frame[9];
                        _latest.pm1     = ((uint16_t)_frame[10] << 8) | _frame[11];
                        _latest.pm25    = ((uint16_t)_frame[12] << 8) | _frame[13];
                        _latest.pm10    = ((uint16_t)_frame[14] << 8) | _frame[15];
                        _latest.valid   = true;
                        _new = true;
                    }
                    _state = 0;
                }
                break;
        }
    }
}

bool PMS7003::read(PMSData* out) {
    if (!_latest.valid) return false;
    *out = _latest;
    return true;
}

bool PMS7003::hasNew() {
    if (_new) { _new = false; return true; }
    return false;
}