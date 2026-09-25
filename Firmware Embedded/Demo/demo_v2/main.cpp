#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>

#define SDA_PIN 21
#define SCL_PIN 22

#define PCF8574_ADDR 0x20

Adafruit_SHT31 sht31 = Adafruit_SHT31();

char keymap[4][4] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};

unsigned long lastSensor = 0;

bool keyLock = false;


// ===== PCF8574 =====

void pcfWrite(uint8_t data)
{
  Wire.beginTransmission(PCF8574_ADDR);
  Wire.write(data);
  Wire.endTransmission();
}


uint8_t pcfRead()
{
  Wire.requestFrom(PCF8574_ADDR, (uint8_t)1);

  if(Wire.available())
    return Wire.read();

  return 0xFF;
}


char scanKey()
{
  for(int col = 0; col < 4; col++)
  {
    uint8_t data = 0xFF;

    // kéo cột LOW
    data &= ~(1 << (col + 4));

    pcfWrite(data);

    delayMicroseconds(200);

    uint8_t input = pcfRead();


    // đọc hàng P0-P3
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


// ===== SETUP =====

void setup()
{
  Serial.begin(115200);

  Wire.begin(SDA_PIN, SCL_PIN);


  // SHT31
  if(!sht31.begin(0x44))
  {
    Serial.println("Khong tim thay SHT31!");
    while(1);
  }

  Serial.println("SHT31 OK");


  // PCF8574
  pcfWrite(0xFF);

  Serial.println("PCF8574 keypad ready");
}


// ===== LOOP =====

void loop()
{
  // ===== KEYPAD =====

  char key = scanKey();

  if(key)
  {
    if(!keyLock)
    {
      keyLock = true;

      Serial.print("Pressed: ");
      Serial.println(key);
    }
  }
  else
  {
    keyLock = false;
  }



  // ===== SHT31 =====

  if(millis() - lastSensor >= 1000)
  {
    lastSensor = millis();

    float t = sht31.readTemperature();
    float h = sht31.readHumidity();

    if(isnan(t) || isnan(h))
    {
      Serial.println("Loi doc SHT31");
    }
    else
    {
      Serial.print("Nhiet do: ");
      Serial.print(t, 2);

      Serial.print(" °C\tDo am: ");
      Serial.print(h, 2);

      Serial.println(" %");
    }
  }
}