#include <Arduino.h>
#include <Wire.h>
#include "stm32f1xx_hal.h"

#include "PCF8574.h"
#include "KeypadPCF.h"
#include "er.h"
#include "ps.h"
#include "SHT31.h"
#include "DS3231.h"
#include "ina226.h"
#include "power.h"
#include "comm.h"

// ================= PIN =================
#define LED_SCAN   PA5
#define LED_A      PA8
#define LED_B      PB14
#define FAN_PIN    PB0
#define PCF_ADDR   0x20

// ================= TIMING =================
#define T_WAIT     500
#define T_SCAN     30000
#define T_READ     90000
#define T_KEY      20000
#define T_MAINT    3600000
#define T_CYCLE    420

// ================= SAMPLES =================
#define N_SAMPLE   450

// ================= KẾT QUẢ SCAN =================
#define RES_NONE    0
#define RES_PASS_A  1
#define RES_PASS_B  2
#define RES_LOCKED  3
#define RES_TIMEOUT 4

// ================= EXTI PA0 =================
static void exti_pa0_init()
{
    GPIO_InitTypeDef gpio = {0};
    gpio.Pin  = GPIO_PIN_0;
    gpio.Mode = GPIO_MODE_IT_FALLING;
    gpio.Pull = GPIO_PULLUP;
    HAL_GPIO_Init(GPIOA, &gpio);

    HAL_NVIC_SetPriority(EXTI0_IRQn, 0, 0);
    HAL_NVIC_EnableIRQ(EXTI0_IRQn);

    Serial.println("[EXTI] PA0 ready");
}


// ================= I2C WRAPPERS =================
static bool pcf_write(uint8_t addr, uint8_t data)
{
    Wire.beginTransmission(addr);
    Wire.write(data);
    return Wire.endTransmission() == 0;
}

static bool pcf_read(uint8_t addr, uint8_t *data)
{
    if(Wire.requestFrom(addr, (uint8_t)1) != 1) return false;
    *data = Wire.read();
    return true;
}

static bool rtc_write(uint8_t addr, uint8_t *data, uint8_t len)
{
    Wire.beginTransmission(addr);
    for(uint8_t i = 0; i < len; i++) Wire.write(data[i]);
    return Wire.endTransmission() == 0;
}

static bool rtc_read(uint8_t addr, uint8_t *data, uint8_t len)
{
    if(Wire.requestFrom(addr, len) != len) return false;
    for(uint8_t i = 0; i < len; i++) data[i] = Wire.read();
    return true;
}

static bool sht_write(uint8_t addr, uint8_t *data, uint8_t len)
{
    Wire.beginTransmission(addr);
    for(uint8_t i = 0; i < len; i++) Wire.write(data[i]);
    return Wire.endTransmission() == 0;
}

static bool sht_read(uint8_t addr, uint8_t *data, uint8_t len)
{
    if(Wire.requestFrom(addr, len) != len) return false;
    for(uint8_t i = 0; i < len; i++) data[i] = Wire.read();
    return true;
}

// ================= OBJECTS =================
PCF8574  pcf(PCF_ADDR, pcf_write, pcf_read);
KeypadPCF keypad(&pcf);
SHT31    sht(0x45, sht_write, sht_read);
DS3231   rtc(0x68, rtc_write, rtc_read);

// ================= LED / FAN =================
static void blink(int pin, int times, int ms)
{
    for(int i = 0; i < times; i++)
    {
        digitalWrite(pin, HIGH);
        delay(ms);
        digitalWrite(pin, LOW);
        delay(ms);
    }
}

static void fan_on()  { digitalWrite(FAN_PIN, HIGH); }
static void fan_off() { digitalWrite(FAN_PIN, LOW);  }

// ================= FILTER =================
static float median9(float *arr)
{
    float t[9];
    for(int i = 0; i < 9; i++) t[i] = arr[i];

    for(int i = 0; i < 8; i++)
        for(int j = i + 1; j < 9; j++)
            if(t[i] > t[j]) { float tmp = t[i]; t[i] = t[j]; t[j] = tmp; }

    return t[4];
}

static float filter_pipeline(float *raw, int n)
{
    float med[N_SAMPLE / 9];
    int mn = 0;

    for(int i = 0; i + 8 < n; i += 9)
        med[mn++] = median9(&raw[i]);

    if(mn == 0) return 0;

    float sum = 0;
    for(int i = 0; i < mn; i++) sum += med[i];
    return sum / mn;
}

// ================= SCAN PASS =================
static int scan_pass(uint32_t window_ms)
{
    uint8_t buf[PS_LEN];
    uint8_t idx = 0;
    char lv = 0;
    uint32_t start = millis();
    uint32_t last = start;

    while(millis() - start < window_ms)
    {
        char k = keypad.getKey();

        if(k != 0)
        {
            last = millis();
            Serial.print("[KEY] ");
            Serial.println(k);

            if(k == 'A' || k == 'B')
            {
                lv = k;
                idx = 0;
            }
            else if(k >= '1' && k <= '9' && lv != 0)
            {
                if(idx < PS_LEN) buf[idx++] = k - '0';

                if(idx == PS_LEN)
                {
                    if(ps_check(lv, buf))
                    {
                        Serial.print("[PASS] ");
                        Serial.print(lv);
                        Serial.println(" OK");
                        ps_set_fail(lv, 0);
                        return lv == 'A' ? RES_PASS_A : RES_PASS_B;
                    }

                    uint8_t f = ps_fail(lv) + 1;
                    ps_set_fail(lv, f);
                    Serial.print("[PASS] WRONG ");
                    Serial.println(f);

                    if(f >= 3)
                    {
                        ps_kill(lv);
                        return RES_LOCKED;
                    }
                    idx = 0;
                }
            }
        }

        if(idx > 0 && millis() - last > T_KEY)
        {
            Serial.println("[PASS] Key timeout");
            idx = 0;
            lv = 0;
        }

        delay(20);
    }
    return RES_TIMEOUT;
}

// ================= MAINTENANCE =================
static void maintenance(char lv)
{
    Serial.print("[MAINT] Enter level ");
    Serial.println(lv);
    uint32_t start = millis();

    while(millis() - start < T_MAINT)
    {
        char k = keypad.getKey();
        if(k == '0')
        {
            Serial.println("[MAINT] Exit by '0'");
            break;
        }
        uart_read_pass();
        delay(200);
    }
    Serial.println("[MAINT] Done");
}

// ================= ĐỌC SENSOR =================
static void read_one_sample(float *t, float *h, float *v, float *i)
{
    sht.startMeasurement();
    delay(20);
    sht.read(t, h);

    *v = ina226_vbus();
    *i = ina226_current();
}

static SensorData read_sensor_window()
{
    static float t_arr[N_SAMPLE];
    static float h_arr[N_SAMPLE];
    static float v_arr[N_SAMPLE];
    static float i_arr[N_SAMPLE];

    int n = 0;
    Serial.println("[SENSOR] Reading 1p30s...");
    uint32_t start = millis();

    while(millis() - start < T_READ && n < N_SAMPLE)
    {
        float t, h, v, i;
        read_one_sample(&t, &h, &v, &i);

        t_arr[n] = t;
        h_arr[n] = h;
        v_arr[n] = v;
        i_arr[n] = i;
        n++;

        delay(180);
    }

    Serial.print("[SENSOR] Samples = ");
    Serial.println(n);

    SensorData d;
    d.temp = filter_pipeline(t_arr, n);
    d.hum  = filter_pipeline(h_arr, n);
    d.vpin = filter_pipeline(v_arr, n);
    d.ipin = filter_pipeline(i_arr, n);

    Serial.print("[SENSOR] T=");
    Serial.print(d.temp, 2);
    Serial.print(" H=");
    Serial.print(d.hum, 2);
    Serial.print(" V=");
    Serial.print(d.vpin, 3);
    Serial.print(" I=");
    Serial.println(d.ipin, 3);

    return d;
}

// ================= RTC ALARM =================
static uint32_t now_sec()
{
    RTC_Time t;
    rtc.getTime(&t);
    return (uint32_t)t.hour * 3600 + (uint32_t)t.min * 60 + t.sec;
}

static void set_next_alarm(uint32_t wake_sec)
{
    uint32_t next = (wake_sec + T_CYCLE) % 86400;

    uint8_t h = (next / 3600) % 24;
    uint8_t m = (next / 60) % 60;
    uint8_t s = next % 60;

    rtc.setAlarm(s, m, h);
    rtc.clearAlarm();

    Serial.print("[RTC] Next alarm ");
    Serial.print(h);
    Serial.print(":");
    Serial.print(m);
    Serial.print(":");
    Serial.println(s);
}

// ================= SETUP =================
void setup()
{
    Serial.begin(115200);
    Serial1.begin(115200);

    delay(500);

    pinMode(LED_SCAN, OUTPUT);
    pinMode(LED_A, OUTPUT);
    pinMode(LED_B, OUTPUT);
    pinMode(FAN_PIN, OUTPUT);
    digitalWrite(LED_SCAN, LOW);
    digitalWrite(LED_A, LOW);
    digitalWrite(LED_B, LOW);
    digitalWrite(FAN_PIN, LOW);

    Wire.begin();
    Wire.setClock(100000);

    // Config PA0 EXTI cho DS3231 wake
    exti_pa0_init();

    // Init PCF8574
    pcf.begin();
    for(int i = 0; i < 8; i++) pcf.digitalWrite(i, true);

    // Init modules
    ps_init();
    sht.begin();
    ina226_init();
    rtc.begin();

    Serial.println("=== SYSTEM READY ===");
}

// ================= LOOP =================
void loop()
{
    uint32_t t_wake = now_sec();
    Serial.println();
    Serial.println("=== CYCLE START ===");

    blink(LED_SCAN, 3, 100);
    delay(T_WAIT);

    Serial.println("[FAN] ON 30s + scan...");
    fan_on();
    int res = scan_pass(T_SCAN);
    fan_off();

    blink(LED_SCAN, 5, 100);

    if(res == RES_PASS_A || res == RES_PASS_B)
    {
        char lv = (res == RES_PASS_A) ? 'A' : 'B';
        Serial.print("passed:");
        Serial.println(lv);

        digitalWrite((lv == 'A') ? LED_A : LED_B, HIGH);
        delay(2000);
        digitalWrite((lv == 'A') ? LED_A : LED_B, LOW);

        maintenance(lv);

        ps_set_used(lv, 1);
        if(lv == 'A') Serial1.println("{\"useda\":1}");
        else          Serial1.println("{\"usedb\":1}");

        delay(500);
        uart_read_pass();
    }
    else if(res == RES_LOCKED)
    {
        Serial.println("locked");
        blink(LED_SCAN, 10, 50);

        if(ps_used('A')) Serial1.println("{\"useda\":1}");
        if(ps_used('B')) Serial1.println("{\"usedb\":1}");

        delay(500);
        uart_read_pass();
    }
    else
    {
        Serial.println("[CYCLE] Normal measurement");
        SensorData d = read_sensor_window();
        uart_send_data(d);
        uart_read_pass();
    }

    set_next_alarm(t_wake);

    Serial.println("=== CYCLE END ===");
    Serial.println();

    enter_stop();
}