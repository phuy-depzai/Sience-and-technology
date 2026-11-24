#include "DS3231.h"

DS3231::DS3231(uint8_t addr,
    bool (*writeFunc)(uint8_t, uint8_t*, uint8_t),
    bool (*readFunc)(uint8_t, uint8_t*, uint8_t))
{
    address = addr;
    writeBytes = writeFunc;
    readBytes = readFunc;
}

bool DS3231::begin()
{
    uint8_t reg = 0x00;
    return writeBytes(address, &reg, 1);
}

uint8_t DS3231::bcdToDec(uint8_t val)
{
    return ((val >> 4) * 10) + (val & 0x0F);
}

uint8_t DS3231::decToBcd(uint8_t val)
{
    return ((val / 10) << 4) | (val % 10);
}

bool DS3231::getTime(RTC_Time *time)
{
    uint8_t reg = 0x00;
    if(!writeBytes(address, &reg, 1)) return false;

    uint8_t data[7];
    if(!readBytes(address, data, 7)) return false;

    time->sec   = bcdToDec(data[0] & 0x7F);
    time->min   = bcdToDec(data[1]);
    time->hour  = bcdToDec(data[2] & 0x3F);
    time->day   = bcdToDec(data[3]);
    time->date  = bcdToDec(data[4]);
    time->month = bcdToDec(data[5] & 0x1F);
    time->year  = bcdToDec(data[6]);

    return true;
}

bool DS3231::setTime(RTC_Time time)
{
    uint8_t data[8];
    data[0] = 0x00;
    data[1] = decToBcd(time.sec);
    data[2] = decToBcd(time.min);
    data[3] = decToBcd(time.hour);
    data[4] = decToBcd(time.day);
    data[5] = decToBcd(time.date);
    data[6] = decToBcd(time.month);
    data[7] = decToBcd(time.year);

    return writeBytes(address, data, 8);
}

// ================= ALARM =================

bool DS3231::setAlarm(uint8_t sec, uint8_t min, uint8_t hour)
{
    // Ghi 4 reg: 0x07 (sec), 0x08 (min), 0x09 (hour), 0x0A (day)
    uint8_t data[5];
    data[0] = 0x07;
    data[1] = decToBcd(sec);           // bit7=0 → match sec
    data[2] = decToBcd(min);           // bit7=0 → match min
    data[3] = decToBcd(hour) & 0x3F;   // bit7=0 → match hour
    data[4] = 0x80;                    // day/date: don't care

    if(!writeBytes(address, data, 5)) return false;

    // Enable A1IE + INTCN (reg 0x0E)
    uint8_t ctrl[2] = {0x0E, 0x05};    // A1IE=1, INTCN=1
    return writeBytes(address, ctrl, 2);
}

bool DS3231::clearAlarm()
{
    uint8_t reg = 0x0F;
    if(!writeBytes(address, &reg, 1)) return false;

    uint8_t st;
    if(!readBytes(address, &st, 1)) return false;

    st &= ~0x01;                       // clear A1F

    uint8_t data[2] = {0x0F, st};
    return writeBytes(address, data, 2);
}

bool DS3231::checkAlarm()
{
    uint8_t reg = 0x0F;
    if(!writeBytes(address, &reg, 1)) return false;

    uint8_t st;
    if(!readBytes(address, &st, 1)) return false;

    return (st & 0x01) != 0;           // A1F
}