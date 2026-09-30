#include <Arduino.h>

#include <WiFiClient.h>
#include <PubSubClient.h>

#include "wifi.h"
#include "mqtt.h"


// ================= WIFI MQTT =================

WiFiClient espClient;

PubSubClient client(
    espClient
);


wifi net(
    "Ken Lun 2.4G",
    "khongcomatkhau1308"
);


mqtt broker(
    &client,
    "ESP32_NODE"
);



// ================= UART =================

HardwareSerial STM32Serial(2);


#define RX2_PIN 16
#define TX2_PIN 17



// ================= DATA =================

char rxBuffer[300];

uint16_t rxLen = 0;



// ================= SETUP =================

void setup()
{

    Serial.begin(115200);



    STM32Serial.begin(
        115200,
        SERIAL_8N1,
        RX2_PIN,
        TX2_PIN
    );


    delay(100);



    // WIFI

    if(net.con())
        Serial.println("WIFI OK");

    else
        Serial.println("WIFI FAIL");




    // MQTT

    client.setServer(
        "192.168.1.18",
        1883
    );


    if(broker.con())
        Serial.println("MQTT OK");


    Serial.println("READY");

}



// ================= LOOP =================

void loop()
{

    net.loop();

    broker.loop();





    // ---------- UART ----------

    while(STM32Serial.available())
    {

        char c = STM32Serial.read();



        if(c == '\r')
            continue;



        if(c == '\n')
        {

            rxBuffer[rxLen] = '\0';



            Serial.print("RX: ");

            Serial.println(rxBuffer);




            // ===== ADD RSSI =====


            char msg[350];


            strcpy(
                msg,
                rxBuffer
            );



            char *p = strrchr(
                msg,
                '}'
            );



            if(p)
            {

                *p = '\0';



                char rssiData[32];


                sprintf(
                    rssiData,
                    ",\"rssi\":%d}",
                    net.rssi()
                );



                strcat(
                    msg,
                    rssiData
                );

            }



            Serial.print("MQTT DATA: ");

            Serial.println(msg);




            if(broker.pub(
                "a/nv/d",
                msg
            ))
            {

                Serial.println("MQTT SEND");

            }



            rxLen = 0;

        }

        else
        {

            if(rxLen < sizeof(rxBuffer)-1)
            {

                rxBuffer[rxLen++] = c;

            }

        }

    }





    // ---------- RSSI DEBUG ----------


    static unsigned long rssiTimer = 0;



    if(millis() - rssiTimer >= 5000)
    {

        rssiTimer = millis();



        Serial.print("RSSI: ");

        Serial.println(
            net.rssi()
        );



        Serial.print("WIFI: ");

        Serial.println(
            net.status()
        );

    }

}