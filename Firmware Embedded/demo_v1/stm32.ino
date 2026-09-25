#include <Arduino.h>

#define IR_PIN PA3

void setup()
{
    pinMode(IR_PIN, INPUT);

    Serial.begin(115200);
}

void loop()
{
    int data = digitalRead(IR_PIN);

    Serial.println(data);

    delay(1000);
}