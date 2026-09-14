#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

HardwareSerial STM32Serial(2);


void mqtt_reconnect()
{
    while(!mqttClient.connected())
    {
        Serial.println("MQTT connecting...");

        if(mqttClient.connect("ESP32"))
        {
            Serial.println("MQTT OK");
        }
        else
        {
            Serial.println("MQTT FAIL");
            delay(1000);
        }
    }
}


void setup()
{
    Serial.begin(115200);

    STM32Serial.begin(
        115200,
        SERIAL_8N1,
        16,
        17
    );


    WiFi.begin(
        "Ken Lun 2.4G",
        "khongcomatkhau1308"
    );


    while(!WiFi.isConnected())
    {
        delay(1000);
        Serial.println("Connecting WiFi...");
    }


    Serial.println("WiFi OK");


    mqttClient.setServer(
        "192.168.1.54",
        1883
    );

    mqtt_reconnect();
}


void loop()
{
    if(!mqttClient.connected())
    {
        mqtt_reconnect();
    }

    mqttClient.loop();


    if(STM32Serial.available())
    {
        String data = STM32Serial.readStringUntil('\n');

        data.trim();

        Serial.print("STM32: ");
        Serial.println(data);


        mqttClient.publish(
            "a/nv/d",
            data.c_str()
        );
    }
}