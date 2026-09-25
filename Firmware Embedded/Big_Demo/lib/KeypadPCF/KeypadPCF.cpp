#include "KeypadPCF.h"
#include <Arduino.h>


KeypadPCF::KeypadPCF(PCF8574 *device)
{
    pcf = device;

    lastKey = 0;
    lastTime = 0;
}



bool KeypadPCF::isPressed()
{
    for(uint8_t row = 0; row < 4; row++)
    {
        // tất cả HIGH
        for(uint8_t i = 0; i < 8; i++)
            pcf->digitalWrite(i, true);


        // kéo hàng xuống LOW
        pcf->digitalWrite(row, false);


        uint8_t data = pcf->read();


        for(uint8_t col = 0; col < 4; col++)
        {
            if(!(data & (1 << (col + 4))))
                return true;
        }
    }


    return false;
}



char KeypadPCF::getKey()
{
    char key = 0;


    // quét keypad
    for(uint8_t row = 0; row < 4; row++)
    {
        // reset PCF
        for(uint8_t i = 0; i < 8; i++)
            pcf->digitalWrite(i, true);


        // kéo row xuống
        pcf->digitalWrite(row, false);


        uint8_t data = pcf->read();



        // đọc column
        for(uint8_t col = 0; col < 4; col++)
        {
            if(!(data & (1 << (col + 4))))
            {
                key = keys[row][col];
                break;
            }
        }


        if(key)
            break;
    }



    // không bấm
    if(key == 0)
    {
        lastKey = 0;
        return 0;
    }



    // vẫn đang giữ phím cũ
    if(key == lastKey)
    {
        return 0;
    }



    // phím mới -> trả 1 lần
    lastKey = key;

    return key;
}