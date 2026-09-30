#include "wifi.h"

#include <Arduino.h>
#include <WiFi.h>



wifi::wifi(
    const char *ssid,
    const char *password
)
{

    this->ssid = ssid;

    this->password = password;


    connected = false;

}



bool wifi::con()
{

    WiFi.disconnect(true);

    delay(100);


    WiFi.begin(
        ssid,
        password
    );


    uint8_t count = 0;


    while(
        WiFi.status() != WL_CONNECTED
    )
    {

        delay(500);


        count++;


        if(count >= 20)
        {

            connected = false;

            return false;

        }

    }


    connected = true;


    return true;

}





void wifi::loop()
{

    if(
        WiFi.status() == WL_CONNECTED
    )
    {

        connected = true;

        return;

    }


    connected = false;



    static unsigned long timer = 0;



    if(
        millis() - timer >= 5000
    )
    {

        timer = millis();


        con();

    }

}






bool wifi::status()
{

    return connected;

}






int wifi::rssi()
{

    if(!connected)
        return -127;


    return WiFi.RSSI();

}