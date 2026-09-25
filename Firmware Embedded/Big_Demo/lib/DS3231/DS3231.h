#ifndef DS3231_H
#define DS3231_H

#include <stdint.h>


struct RTC_Time
{
    uint8_t sec;
    uint8_t min;
    uint8_t hour;

    uint8_t day;
    uint8_t date;
    uint8_t month;
    uint8_t year;
};



class DS3231
{

private:

    uint8_t address;


    bool (*writeBytes)(
        uint8_t addr,
        uint8_t *data,
        uint8_t len
    );


    bool (*readBytes)(
        uint8_t addr,
        uint8_t *data,
        uint8_t len
    );



    uint8_t bcdToDec(uint8_t val);

    uint8_t decToBcd(uint8_t val);



public:


    DS3231(
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
    );


    bool begin();


    bool getTime(
        RTC_Time *time
    );


    bool setTime(
        RTC_Time time
    );


};


#endif