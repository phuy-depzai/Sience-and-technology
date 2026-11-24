#include "LSM6DS3.h"


void LSM6DS3::write(uint8_t reg,uint8_t data)
{
    Wire.beginTransmission(LSM6DS3_ADDR);

    Wire.write(reg);
    Wire.write(data);

    Wire.endTransmission();
}



uint8_t LSM6DS3::read(uint8_t reg)
{
    Wire.beginTransmission(LSM6DS3_ADDR);

    Wire.write(reg);


    if(Wire.endTransmission(false)!=0)
        return 0;



    Wire.requestFrom(LSM6DS3_ADDR,(uint8_t)1);


    if(Wire.available())
        return Wire.read();


    return 0;
}





void LSM6DS3::readBytes(uint8_t reg,uint8_t *buf,uint8_t len)
{
    Wire.beginTransmission(LSM6DS3_ADDR);

    Wire.write(reg);

    Wire.endTransmission(false);



    Wire.requestFrom(LSM6DS3_ADDR,len);



    for(int i=0;i<len;i++)
    {
        if(Wire.available())
            buf[i]=Wire.read();

        else
            buf[i]=0;
    }
}





bool LSM6DS3::begin()
{

    uint8_t id=read(WHO_AM_I);


    Serial.print("WHO_AM_I: ");
    Serial.println(id,HEX);



    if(id!=0x69)
        return false;



    // reset + auto increment
    write(CTRL3_C,0x44);



    // Accel 104Hz +-2g
    write(CTRL1_XL,0x40);



    // Gyro 104Hz 245dps
    write(CTRL2_G,0x40);



    delay(50);


    return true;

}







void LSM6DS3::readAccelRaw(int16_t *x,int16_t *y,int16_t *z)
{

    uint8_t data[6];


    readBytes(OUTX_L_A,data,6);



    *x=(int16_t)(data[1]<<8 | data[0]);

    *y=(int16_t)(data[3]<<8 | data[2]);

    *z=(int16_t)(data[5]<<8 | data[4]);

}






void LSM6DS3::readGyroRaw(int16_t *x,int16_t *y,int16_t *z)
{

    uint8_t data[6];


    readBytes(OUTX_L_G,data,6);



    *x=(int16_t)(data[1]<<8 | data[0]);

    *y=(int16_t)(data[3]<<8 | data[2]);

    *z=(int16_t)(data[5]<<8 | data[4]);

}







void LSM6DS3::readAccel(int16_t *x,int16_t *y,int16_t *z)
{

    readAccelRaw(x,y,z);


    *x -= ax_off;
    *y -= ay_off;
    *z -= az_off;

}







void LSM6DS3::readGyro(int16_t *x,int16_t *y,int16_t *z)
{

    readGyroRaw(x,y,z);


    *x -= gx_off;
    *y -= gy_off;
    *z -= gz_off;

}







int16_t LSM6DS3::readTemp()
{

    uint8_t data[2];


    readBytes(OUT_TEMP_L,data,2);


    return (int16_t)(data[1]<<8 | data[0]);

}







uint8_t LSM6DS3::wakeSource()
{
    return read(WAKE_UP_SRC);
}









void LSM6DS3::calibrate()
{

    long ax=0;
    long ay=0;
    long az=0;


    long gx=0;
    long gy=0;
    long gz=0;



    Serial.println("Keep sensor still...");


    delay(1000);



    for(int i=0;i<500;i++)
    {

        int16_t x,y,z;



        readAccelRaw(&x,&y,&z);

        ax += x;
        ay += y;
        az += z;



        readGyroRaw(&x,&y,&z);

        gx += x;
        gy += y;
        gz += z;



        delay(5);

    }





    // accel offset

    ax_off = ax/500;

    ay_off = ay/500;


    // giữ lại trọng lực

    az_off = (az/500) + 16384;




    // gyro offset

    gx_off = gx/500;

    gy_off = gy/500;

    gz_off = gz/500;





    Serial.println("Calibration finished");


    Serial.print("AX offset: ");
    Serial.println(ax_off);


    Serial.print("AY offset: ");
    Serial.println(ay_off);


    Serial.print("AZ offset: ");
    Serial.println(az_off);


    Serial.print("GX offset: ");
    Serial.println(gx_off);


    Serial.print("GY offset: ");
    Serial.println(gy_off);


    Serial.print("GZ offset: ");
    Serial.println(gz_off);

}







void LSM6DS3::enableWakeup()
{

    write(WAKE_UP_THS,0x02);

    write(MD1_CFG,0x20);

}







void LSM6DS3::enableFreeFall()
{
    write(FREE_FALL,0x33);


    uint8_t cfg = read(MD1_CFG);

    cfg |= 0x10;   // FF INT1

    write(MD1_CFG,cfg);
}





void LSM6DS3::enable6D()
{

    write(TAP_CFG2,0x80);


    uint8_t cfg = read(MD1_CFG);

    cfg |= 0x04;   // 6D INT1

    write(MD1_CFG,cfg);

}





void LSM6DS3::enableFIFO()
{

    write(FIFO_CTRL1,0x10);

    write(FIFO_CTRL5,0x26);

}