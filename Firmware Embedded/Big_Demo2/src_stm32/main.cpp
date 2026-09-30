#include <Arduino.h>
#include <Wire.h>

#include "PCF8574.h"
#include "KeypadPCF.h"
#include "SHT31.h"
#include "DS3231.h"


// ================= LSM6DS3 =================

#define LSM6DS3_ADDR 0x6B
#define WHO_AM_I 0x0F



uint8_t readIMU(uint8_t reg)
{
    Wire.beginTransmission(LSM6DS3_ADDR);

    Wire.write(reg);


    if(Wire.endTransmission(false)!=0)
        return 0xFF;



    Wire.requestFrom(
        LSM6DS3_ADDR,
        (uint8_t)1
    );


    if(Wire.available())
        return Wire.read();



    return 0xFF;
}



// ================= I2C HAL =================


bool i2cWriteByte(
    uint8_t addr,
    uint8_t data
)
{
    Wire.beginTransmission(addr);

    Wire.write(data);

    return Wire.endTransmission() == 0;
}



bool i2cReadByte(
    uint8_t addr,
    uint8_t *data
)
{
    Wire.requestFrom(addr,(uint8_t)1);


    if(Wire.available())
    {
        *data = Wire.read();

        return true;
    }


    return false;
}



bool i2cWriteBytes(
    uint8_t addr,
    uint8_t *data,
    uint8_t len
)
{
    Wire.beginTransmission(addr);


    for(uint8_t i=0;i<len;i++)
        Wire.write(data[i]);


    return Wire.endTransmission()==0;
}



bool i2cReadBytes(
    uint8_t addr,
    uint8_t *data,
    uint8_t len
)
{
    Wire.requestFrom(addr,len);


    if(Wire.available()!=len)
        return false;


    for(uint8_t i=0;i<len;i++)
        data[i]=Wire.read();


    return true;
}



// ================= DEVICE =================


PCF8574 pcf(
    0x20,
    i2cWriteByte,
    i2cReadByte
);



KeypadPCF keypad(
    &pcf
);



SHT31 sht31(
    0x44,
    i2cWriteBytes,
    i2cReadBytes
);



DS3231 rtc(
    0x68,
    i2cWriteBytes,
    i2cReadBytes
);




// ================= DATA =================


float temp = 0;

float hum = 0;


bool shtOK = false;


uint8_t imuID = 0;



char keyBuffer[17] = "";

uint8_t keyLen = 0;



char rtcTime[12] = "00:00:00";




// ================= TIMER =================


unsigned long shtTimer = 0;

unsigned long rtcTimer = 0;

unsigned long uartTimer = 0;




// ================= SETUP =================


void setup()
{

    Serial1.begin(115200);


    Wire.begin();



    delay(100);



    // ---------- IMU ----------

    imuID = readIMU(WHO_AM_I);


    Serial1.print("WHO_AM_I: 0x");

    Serial1.println(
        imuID,
        HEX
    );




    // ---------- DEVICE ----------


    if(!pcf.begin())
        Serial1.println("PCF ERROR");



    if(!sht31.begin())
        Serial1.println("SHT31 ERROR");



    if(!rtc.begin())
        Serial1.println("RTC ERROR");




    Serial1.println("STM32 READY");



    sht31.startMeasurement();

}







// ================= LOOP =================


void loop()
{


    // ---------- KEYPAD ----------


    char key = keypad.getKey();



    if(key)
    {

        if(keyLen < sizeof(keyBuffer)-1)
        {
            keyBuffer[keyLen++] = key;

            keyBuffer[keyLen] = '\0';
        }

    }






    // ---------- SHT31 ----------


    if(millis()-shtTimer >= 1000)
    {

        shtTimer = millis();



        if(sht31.available())
        {

            shtOK = sht31.read(
                &temp,
                &hum
            );


            sht31.startMeasurement();

        }

    }







    // ---------- RTC ----------


    if(millis()-rtcTimer >= 1000)
    {

        rtcTimer = millis();



        RTC_Time t;



        if(rtc.getTime(&t))
        {

            sprintf(
                rtcTime,
                "%02d:%02d:%02d",
                t.hour,
                t.min,
                t.sec
            );

        }

    }








    // ---------- UART SEND ----------


    if(millis()-uartTimer >= 1000)
    {

        uartTimer = millis();



        Serial1.print(
            "{\"imu\":\"0x"
        );


        Serial1.print(
            imuID,
            HEX
        );



        Serial1.print(
            "\",\"temp\":"
        );



        if(shtOK)
            Serial1.print(temp,2);
        else
            Serial1.print("null");



        Serial1.print(
            ",\"hum\":"
        );



        if(shtOK)
            Serial1.print(hum,2);
        else
            Serial1.print("null");



        Serial1.print(
            ",\"time\":\""
        );


        Serial1.print(
            rtcTime
        );



        Serial1.print(
            "\",\"key\":\""
        );


        Serial1.print(
            keyBuffer
        );



        Serial1.println(
            "\"}"
        );





        keyLen = 0;

        keyBuffer[0]='\0';

    }


}