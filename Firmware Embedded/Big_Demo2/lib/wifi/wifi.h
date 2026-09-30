#ifndef WIFI_H
#define WIFI_H

#include <stdint.h>


class wifi
{

private:

    const char *ssid;
    const char *password;


    bool connected;


public:


    wifi(
        const char *ssid,
        const char *password
    );


    bool con();


    void loop();


    bool status();


    int rssi();


};


#endif