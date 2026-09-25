#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>
#include <RTClib.h>
#include <WiFi.h>
#include <PubSubClient.h>

#define SDA_PIN 21
#define SCL_PIN 22
#define PCF8574_ADDR 0x20

#define TOPIC_DATA "a/nv/d"
#define TOPIC_STATUS "a/nv/s"

const char* ssid = "Ken Lun 2.4G";
const char* password = "khongcomatkhau1308";
const char* mqtt_server = "192.168.1.8";
WiFiClient espClient;
PubSubClient mqtt(espClient);
Adafruit_SHT31 sht31 = Adafruit_SHT31();
RTC_DS3231 rtc;
char keymap[4][4] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};
unsigned long lastSensor = 0;

bool keyLock = false;
String pressedKey = "";

//truyền thông
void setupWiFi()
{
  Serial.print("Connecting WiFi");

  WiFi.begin(ssid,password);

  while(WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi OK");
  Serial.println(WiFi.localIP());
}


void reconnectMQTT()
{
  while(!mqtt.connected())
  {
    Serial.print("Connecting MQTT...");

    if(mqtt.connect("ESP32_NODE01"))
    {
      Serial.println("OK");

      mqtt.publish(TOPIC_STATUS,"ok its working");
    }
    else
    {
      Serial.print("Fail: ");
      Serial.println(mqtt.state());

      delay(2000);
    }
  }
}

// keyboard
void pcfWrite(uint8_t data)
{
  Wire.beginTransmission(PCF8574_ADDR);
  Wire.write(data);
  Wire.endTransmission();
}

uint8_t pcfRead()
{
  Wire.requestFrom(PCF8574_ADDR,(uint8_t)1);
  if(Wire.available())
    return Wire.read();
  return 0xFF;
}

char scanKey()
{
  for(int col = 0; col < 4; col++)
  {
    uint8_t data = 0xFF;

    data &= ~(1 << (col + 4));

    pcfWrite(data);
    delayMicroseconds(200);
    uint8_t input = pcfRead();
    for(int row = 0; row < 4; row++)
    {
      if(!(input & (1 << row)))
      {
        return keymap[row][col];
      }
    }
  }

  return 0;
}
// setup

void setup()
{
  Serial.begin(115200);
  Wire.begin(SDA_PIN,SCL_PIN);
  setupWiFi();
  mqtt.setServer(mqtt_server,1883);

  // RTC
  if(!rtc.begin())
  {
    Serial.println("Khong tim thay DS3231!");
    while(1);
  }

  Serial.println("DS3231 OK");

  // SHT31
  if(!sht31.begin(0x44))
  {
    Serial.println("Khong tim thay SHT31!");
    while(1);
  }

  Serial.println("SHT31 OK");

  // PCF8574
  pcfWrite(0xFF);

  Serial.println("PCF8574 Keypad OK");
}

void loop()
{

  if(!mqtt.connected())
  {
    reconnectMQTT();
  }

  mqtt.loop();

  char key = scanKey();

  if(key)
  {
    if(!keyLock)
    {
      keyLock = true;
      pressedKey += key;
    }
  }
  else
  {
    keyLock = false;
  }

  if(millis() - lastSensor >= 1000)
  {
    lastSensor = millis();
    DateTime now = rtc.now();

    float t = sht31.readTemperature();
    float h = sht31.readHumidity();



    Serial.println("----------------------------");

    Serial.printf("%02d:%02d:%02d  ",
                  now.hour(),
                  now.minute(),
                  now.second());

    Serial.printf("%02d/%02d/%04d\n",
                  now.day(),
                  now.month(),
                  now.year());

    if(pressedKey.length() > 0)
    {
      Serial.print("Pressed : ");
      Serial.println(pressedKey);
    }
    else
    {
      Serial.println("Pressed : None");
    }

    if(!isnan(t) && !isnan(h))
    {
      Serial.print("Nhiet do: ");
      Serial.print(t,2);

      Serial.print(" C\tDo am: ");
      Serial.print(h,2);

      Serial.println(" %");
      char payload[250];

      sprintf(payload,
      "{\"temp\":%.2f,\"hum\":%.2f,\"time\":\"%02d:%02d:%02d\",\"date\":\"%02d/%02d/%04d\",\"key\":\"%s\"}",
      t,
      h,
      now.hour(),
      now.minute(),
      now.second(),
      now.day(),
      now.month(),
      now.year(),
      pressedKey.c_str());
      mqtt.publish(TOPIC_DATA,payload);
    }
    else
    {
      Serial.println("Loi doc SHT31");
    }
    pressedKey = "";
  }

}