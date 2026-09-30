#include "SHT31.h"
#include <Arduino.h>

extern unsigned long millis();


SHT31::SHT31(
    uint8_t addr,
    bool (*writeFunc)(uint8_t,uint8_t*,uint8_t),
    bool (*readFunc)(uint8_t,uint8_t*,uint8_t)
)
{
    address=addr;

    writeBytes=writeFunc;
    readBytes=readFunc;

    measuring=false;
}



bool SHT31::begin()
{
    uint8_t cmd[2]={0x30,0xA2};

    return writeBytes(address,cmd,2);
}



bool SHT31::startMeasurement()
{

    uint8_t cmd[2]={0x24,0x00};


    if(writeBytes(address,cmd,2))
    {
        startTime=millis();
        measuring=true;
        return true;
    }


    return false;
}



bool SHT31::available()
{

    if(!measuring)
        return false;


    if(millis()-startTime >= 20)
        return true;


    return false;

}



bool SHT31::read(float *temperature,float *humidity)
{

    if(!available())
        return false;


    uint8_t data[6];


    if(!readBytes(address,data,6))
        return false;


    uint16_t t_raw =
    ((uint16_t)data[0]<<8)|data[1];


    uint16_t h_raw =
    ((uint16_t)data[3]<<8)|data[4];



    *temperature =
        -45 + 175*(t_raw/65535.0);


    *humidity =
        100*(h_raw/65535.0);



    measuring=false;

    return true;

}