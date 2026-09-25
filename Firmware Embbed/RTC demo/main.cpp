#include <Arduino.h>
#include <Wire.h>
#include <RTClib.h>

RTC_DS3231 rtc;

void setup()
{
    Serial.begin(115200);
    Wire.begin(21, 22);

    if (!rtc.begin())
    {
        Serial.println("Khong tim thay DS3231");
        while (1);
    }

    // SET THỜI GIAN 1 LẦN
    rtc.adjust(DateTime(2026, 9, 25, 12, 10, 0));

    Serial.println("Da set RTC");
}

void loop()
{
    DateTime now = rtc.now();

    Serial.printf("%02d:%02d:%02d\n",
                  now.hour(),
                  now.minute(),
                  now.second());

    Serial.printf("%02d/%02d/%04d\n",
                  now.day(),
                  now.month(),
                  now.year());

    delay(1000);
}