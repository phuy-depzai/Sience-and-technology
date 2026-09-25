#include <Arduino.h>

#include <Wire.h>

#include <WiFiClient.h>
#include <PubSubClient.h>

#include "wifi.h"
#include "mqtt.h"

#include "PCF8574.h"
#include "KeypadPCF.h"
#include "SHT31.h"
#include "DS3231.h"



// ================= WIFI MQTT =================


WiFiClient espClient;


PubSubClient client(
    espClient
);



wifi net(
    "SSID",
    "PASSWORD"
);



mqtt broker(
    &client,
    "ESP32_NODE"
);




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



char keyBuffer[17] = "";

uint8_t keyLen = 0;



char rtcTime[12] = "00:00:00";





// ================= TIMER =================


unsigned long shtTimer = 0;

unsigned long rtcTimer = 0;

unsigned long mqttTimer = 0;





// ================= SETUP =================


void setup()
{

    Serial.begin(115200);



    Wire.begin(
        21,
        22
    );


    delay(100);




    // WIFI

    if(net.con())
        Serial.println("WIFI OK");

    else
        Serial.println("WIFI FAIL");




    // MQTT

    client.setServer(
        "IP ADRESS",
        1883
    );


    if(broker.con())
        Serial.println("MQTT OK");





    // DEVICE


    if(!pcf.begin())
        Serial.println("PCF ERROR");



    if(!sht31.begin())
        Serial.println("SHT31 ERROR");



    if(!rtc.begin())
        Serial.println("RTC ERROR");



    Serial.println("READY");



    sht31.startMeasurement();

}






// ================= LOOP =================


void loop()
{

    net.loop();

    broker.loop();





    // ---------- KEYPAD ----------


    char key = keypad.getKey();


    if(key)
    {

        if(keyLen < sizeof(keyBuffer)-1)
        {
            keyBuffer[keyLen++] = key;
            keyBuffer[keyLen] = '\0';
        }


        Serial.print("KEY: ");

        Serial.println(key);


        Serial.print("BUFFER: ");

        Serial.println(keyBuffer);

    }





    // ---------- SHT31 ----------


    if(millis()-shtTimer >= 1000)
    {

        shtTimer = millis();



        if(sht31.available())
        {

            if(sht31.read(
                &temp,
                &hum
            ))
            {

                Serial.print("TEMP: ");

                Serial.print(temp);



                Serial.print(" HUM: ");

                Serial.println(hum);



                sht31.startMeasurement();

            }

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


            Serial.print("TIME: ");

            Serial.println(rtcTime);

        }

    }





    // ---------- MQTT ----------


    if(millis()-mqttTimer >= 1000)
    {

        mqttTimer = millis();



        char msg[128];



        sprintf(
            msg,
            "{\"temp\":%.2f,\"hum\":%.2f,\"time\":\"%s\",\"key\":\"%s\"}",
            temp,
            hum,
            rtcTime,
            keyBuffer
        );



        if(broker.pub(
            "a/nv/d",
            msg
        ))
        {

            Serial.println("MQTT SEND");

            Serial.println(msg);



            // xóa phím sau khi gửi

            keyLen = 0;

            keyBuffer[0] = '\0';

        }

    }

}
