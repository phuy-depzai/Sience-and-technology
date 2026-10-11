#ifndef LSM6DS3_H
#define LSM6DS3_H

#include <Arduino.h>
#include <Wire.h>

#define LSM6DS3_ADDR 0x6B
#define TAP_CFG2 0x16
#define WHO_AM_I 0x0F

#define CTRL1_XL 0x10
#define CTRL2_G  0x11
#define CTRL3_C  0x12

#define OUT_TEMP_L 0x20
#define OUTX_L_G   0x22
#define OUTX_L_A   0x28

#define WAKE_UP_SRC 0x1B

#define MD1_CFG 0x5E
#define WAKE_UP_THS 0x5B
#define WAKE_UP_DUR 0x5C
#define FREE_FALL 0x5D

#define FIFO_CTRL1 0x07
#define FIFO_CTRL5 0x0B


class LSM6DS3
{
public:

    bool begin();

    void readAccel(int16_t *x,int16_t *y,int16_t *z);
    void readGyro(int16_t *x,int16_t *y,int16_t *z);

    int16_t readTemp();

    uint8_t wakeSource();


    void calibrate();


    void enableWakeup();
    void enableFreeFall();
    void enable6D();
    void enableFIFO();


private:

    int16_t ax_off=0;
    int16_t ay_off=0;
    int16_t az_off=0;

    int16_t gx_off=0;
    int16_t gy_off=0;
    int16_t gz_off=0;



    void readAccelRaw(int16_t *x,int16_t *y,int16_t *z);
    void readGyroRaw(int16_t *x,int16_t *y,int16_t *z);



    void write(uint8_t reg,uint8_t data);

    uint8_t read(uint8_t reg);

    void readBytes(uint8_t reg,uint8_t *buf,uint8_t len);

};

#endif