
#include "DS3231.h"



DS3231::DS3231(
    uint8_t addr,

    bool (*writeFunc)(
        uint8_t,
        uint8_t*,
        uint8_t
    ),

    bool (*readFunc)(
        uint8_t,
        uint8_t*,
        uint8_t
    )
)
{

    address = addr;

    writeBytes = writeFunc;

    readBytes = readFunc;

}



bool DS3231::begin()
{

    uint8_t reg = 0x00;


    return writeBytes(
        address,
        &reg,
        1
    );

}



uint8_t DS3231::bcdToDec(
    uint8_t val
)
{

    return ((val >> 4) * 10)
           + (val & 0x0F);

}



uint8_t DS3231::decToBcd(
    uint8_t val
)
{

    return ((val / 10) << 4)
           | (val % 10);

}




bool DS3231::getTime(
    RTC_Time *time
)
{

    uint8_t reg = 0x00;


    if(!writeBytes(
        address,
        &reg,
        1
    ))
        return false;



    uint8_t data[7];


    if(!readBytes(
        address,
        data,
        7
    ))
        return false;



    time->sec =
        bcdToDec(data[0] & 0x7F);


    time->min =
        bcdToDec(data[1]);


    time->hour =
        bcdToDec(data[2] & 0x3F);


    time->day =
        bcdToDec(data[3]);


    time->date =
        bcdToDec(data[4]);


    time->month =
        bcdToDec(data[5] & 0x1F);


    time->year =
        bcdToDec(data[6]);



    return true;

}




bool DS3231::setTime(
    RTC_Time time
)
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



    return writeBytes(
        address,
        data,
        8
    );

}