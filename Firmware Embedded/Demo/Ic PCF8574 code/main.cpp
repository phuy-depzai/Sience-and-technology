#include <Arduino.h>
#include <Wire.h>

#define PCF8574_ADDR 0x20


char keymap[4][4] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};


// Ghi dữ liệu ra PCF8574
void pcfWrite(uint8_t data)
{
  Wire.beginTransmission(PCF8574_ADDR);
  Wire.write(data);
  Wire.endTransmission();
}


// Đọc dữ liệu từ PCF8574
uint8_t pcfRead()
{
  Wire.requestFrom(PCF8574_ADDR, (uint8_t)1);

  if(Wire.available())
  {
    return Wire.read();
  }

  return 0xFF;
}


// Quét keypad
char scanKey()
{
  for(int col = 0; col < 4; col++)
  {
    // tất cả HIGH
    uint8_t data = 0xFF;

    // kéo 1 cột xuống LOW
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



void setup()
{
  Serial.begin(115200);

  // ESP32 I2C
  Wire.begin(21,22);

  // reset PCF: tất cả chân HIGH
  pcfWrite(0xFF);

  Serial.println("PCF8574 keypad ready");
}



void loop()
{
  char key = scanKey();

  if(key)
  {
    Serial.print("Pressed: ");
    Serial.println(key);

    delay(250); // debounce
  }
}