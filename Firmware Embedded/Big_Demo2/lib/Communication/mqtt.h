#ifndef MQTT_H
#define MQTT_H

#include <PubSubClient.h>


class mqtt
{

private:

    PubSubClient *client;

    bool connected;


    const char *id;



public:


    mqtt(
        PubSubClient *client,
        const char *id
    );


    bool con();


    bool pub(
        const char *topic,
        const char *data
    );


    bool sub(
        const char *topic
    );


    void loop();


    bool status();


};


#endif