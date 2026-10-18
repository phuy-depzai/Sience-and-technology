#include "wifi.h"

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
    }

    else
    {
        connected = false;
    }

}



bool wifi::status()
{

    return connected;

}



int wifi::rssi()
{

    if(!connected)
        return 0;


    return WiFi.RSSI();

}