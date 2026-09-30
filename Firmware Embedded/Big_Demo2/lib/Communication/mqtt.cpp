#include "mqtt.h"


mqtt::mqtt(
    PubSubClient *client,
    const char *id
)
{

    this->client = client;

    this->id = id;

    connected = false;

}



bool mqtt::con()
{

    if(client->connect(id))
    {
        connected = true;
        return true;
    }


    connected = false;

    return false;

}



bool mqtt::pub(
    const char *topic,
    const char *data
)
{

    if(!connected)
        return false;


    return client->publish(
        topic,
        data
    );

}



bool mqtt::sub(
    const char *topic
)
{

    if(!connected)
        return false;


    return client->subscribe(
        topic
    );

}



void mqtt::loop()
{

    client->loop();


    if(!client->connected())
        connected = false;

}



bool mqtt::status()
{

    return connected;

}