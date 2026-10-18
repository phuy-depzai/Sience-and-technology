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
#include "pms.h"
#include "sgp41.h"

// ================= PIN =================
#define FAN_PIN    PA5      // MOSFET quạt × 3 (chỉ 30s đầu)
#define PMS_PIN    PB13     // MOSFET PMS7003 (cả cycle)
#define LED_A      PA8
#define LED_B      PB14
#define PCF_ADDR   0x20

// ================= TIMING =================
#define T_WAIT     500
#define T_SCAN     30000
#define T_READ     90000
#define T_KEY      20000
#define T_MAINT    3600000
#define T_CYCLE    300    // Test: 2 phút. Production: 420

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
PCF8574   pcf(PCF_ADDR, pcf_write, pcf_read);
KeypadPCF keypad(&pcf);
SHT31     sht(0x44, sht_write, sht_read);
DS3231    rtc(0x68, rtc_write, rtc_read);
PMS7003   pms(&Serial2);
SGP41     sgp;

static bool sgp_ready = false;

// ================= FAN / PMS =================
static void fan_on()  { digitalWrite(FAN_PIN, HIGH); }
static void fan_off() { digitalWrite(FAN_PIN, LOW);  }
static void pms_on()  { digitalWrite(PMS_PIN, HIGH); }
static void pms_off() { digitalWrite(PMS_PIN, LOW);  }

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

// ================= I2C BUS RECOVERY =================
static void i2c_bus_recovery()
{
    Wire.end();
    delay(10);

    pinMode(PB6, OUTPUT);
    pinMode(PB7, INPUT);

    for(int i = 0; i < 9; i++)
    {
        digitalWrite(PB6, LOW);
        delayMicroseconds(5);
        digitalWrite(PB6, HIGH);
        delayMicroseconds(5);
    }

    pinMode(PB7, OUTPUT);
    digitalWrite(PB7, LOW);
    delayMicroseconds(5);
    digitalWrite(PB6, HIGH);
    delayMicroseconds(5);
    digitalWrite(PB7, HIGH);
    delayMicroseconds(5);

    Wire.begin();
    Wire.setClock(100000);
    Serial.println("[I2C] Bus recovered");
}

// ================= I2C SCAN =================
static void i2c_scan(const char* tag)
{
    Serial.print("[SCAN ");
    Serial.print(tag);
    Serial.println("] Devices on bus:");
    for(uint8_t a = 1; a < 127; a++)
    {
        Wire.beginTransmission(a);
        if(Wire.endTransmission() == 0)
        {
            Serial.print("  0x");
            if(a < 16) Serial.print("0");
            Serial.println(a, HEX);
        }
    }
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
    *t = 0;
    *h = 0;

    sht.startMeasurement();
    delay(20);
    if(!sht.read(t, h)) { /* fail */ }

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

    PMSData  pms_d = {0};
    uint16_t voc_last = 0;
    uint16_t nox_last = 0;
    uint8_t  sgp_ok_last = 0;
    int      sgp_count = 0;

    Serial.println("[SENSOR] Reading 30s...");
    uint32_t start = millis();

    while(millis() - start < T_READ && n < N_SAMPLE)
    {
        pms.poll();

        float t, h, v, i;
        read_one_sample(&t, &h, &v, &i);

        t_arr[n] = t;
        h_arr[n] = h;
        v_arr[n] = v;
        i_arr[n] = i;
        n++;

        if(sgp_ready && (n % 5 == 0))
        {
            uint16_t rh_i = (h > 0.1f && h <= 100.0f) ? (uint16_t)h : 50;
            uint16_t t_i  = (t > -45.0f && t < 130.0f) ? (uint16_t)t : 25;

            uint16_t voc, nox;
            if(sgp.measureRaw(rh_i, t_i, &voc, &nox))
            {
                voc_last = voc;
                nox_last = nox;
                sgp_ok_last = 1;
                sgp_count++;
            }
        }

        delay(180);
    }

    if(pms.read(&pms_d))
    {
        Serial.print("[PMS] PM1.0=");
        Serial.print(pms_d.pm1);
        Serial.print(" PM2.5=");
        Serial.print(pms_d.pm25);
        Serial.print(" PM10=");
        Serial.println(pms_d.pm10);
    }

    Serial.print("[SENSOR] Samples = ");
    Serial.println(n);
    Serial.print("[SGP41] Measurements = ");
    Serial.println(sgp_count);

    SensorData d;
    d.temp = filter_pipeline(t_arr, n);
    d.hum  = filter_pipeline(h_arr, n);
    d.vpin = filter_pipeline(v_arr, n);
    d.ipin = filter_pipeline(i_arr, n);

    d.pm1  = pms_d.pm1;
    d.pm25 = pms_d.pm25;
    d.pm10 = pms_d.pm10;

    d.voc_sraw = voc_last;
    d.nox_sraw = nox_last;
    d.sgp_ok   = sgp_ok_last;

    Serial.print("[SENSOR] T=");
    Serial.print(d.temp, 2);
    Serial.print(" H=");
    Serial.print(d.hum, 2);
    Serial.print(" V=");
    Serial.print(d.vpin, 3);
    Serial.print(" I=");
    Serial.println(d.ipin, 3);

    Serial.print("[SGP41] VOC_SRAW=");
    Serial.print(d.voc_sraw);
    Serial.print(" NOx_SRAW=");
    Serial.println(d.nox_sraw);
    Serial.print("[SGP41] sgp_ok=");
    Serial.println(d.sgp_ok);

    return d;
}

// ================= RTC ALARM =================
static uint32_t now_sec()
{
    RTC_Time t;
    rtc.getTime(&t);
    return (uint32_t)t.hour * 3600 + (uint32_t)t.min * 60 + t.sec;
}

static void set_next_alarm(uint32_t now_sec_val)
{
    uint32_t next = (now_sec_val + T_CYCLE) % 86400;

    uint8_t h = (next / 3600) % 24;
    uint8_t m = (next / 60) % 60;
    uint8_t s = next % 60;

    rtc.setAlarm(s, m, h);
    rtc.clearAlarm();

    Serial.print("[RTC] Now ");
    Serial.print(now_sec_val / 3600); Serial.print(":");
    Serial.print((now_sec_val / 60) % 60); Serial.print(":");
    Serial.print(now_sec_val % 60);
    Serial.print(" → Next ");
    Serial.print(h); Serial.print(":");
    Serial.print(m); Serial.print(":");
    Serial.println(s);
}

// ================= SETUP =================
void setup()
{
    Serial.begin(115200);
    Serial1.begin(115200);

    delay(500);

    pinMode(FAN_PIN, OUTPUT);
    pinMode(PMS_PIN, OUTPUT);
    pinMode(LED_A, OUTPUT);
    pinMode(LED_B, OUTPUT);
    digitalWrite(FAN_PIN, LOW);
    digitalWrite(PMS_PIN, LOW);
    digitalWrite(LED_A, LOW);
    digitalWrite(LED_B, LOW);

    Serial.println();
    Serial.println("========== BOOT ==========");

    Wire.begin();
    Wire.setClock(100000);
    Serial.println("[BOOT] Wire.begin OK");

    i2c_scan("BOOT");

    exti_pa0_init();

    Serial.println("[BOOT] pcf.begin()...");
    if(!pcf.begin()) Serial.println("[PCF] FAIL");
    else {
        Serial.println("[PCF] OK");
        for(int i = 0; i < 8; i++) pcf.digitalWrite(i, true);
    }

    Serial.println("[BOOT] ps_init()...");
    ps_init();
    Serial.println("[PS] done");

    Serial.println("[BOOT] sht.begin()...");
    if(!sht.begin()) Serial.println("[SHT] FAIL");
    else             Serial.println("[SHT] OK");

    Serial.println("[BOOT] ina226_init()...");
    ina226_init();
    Serial.println("[INA] done");

    Serial.println("[BOOT] rtc.begin()...");
    if(!rtc.begin()) Serial.println("[RTC] FAIL");
    else             Serial.println("[RTC] OK");

    Serial.println("[BOOT] pms.begin()...");
    pms.begin();
    Serial.println("[PMS] OK (Serial2 @ 9600)");

    Serial.println("[BOOT] sgp.begin()...");
    if(sgp.begin())
    {
        Serial.print("[SGP41] conditioning... ");
        if(sgp.executeConditioning(50, 25))
        {
            sgp_ready = true;
            Serial.println("OK");
        }
        else Serial.println("FAIL");
    }
    else Serial.println("[SGP41] init FAIL");

    Serial.println("=== SYSTEM READY ===");
}

// ================= LOOP =================
void loop()
{
    Serial.println();
    Serial.println("=== CYCLE START ===");

    // Bật fan + PMS
    Serial.println("[FAN+PMS] ON");
    fan_on();
    pms_on();

    // 30s scan + fan tạo luồng khí + PMS warm-up
    int res = scan_pass(T_SCAN);

    // CHỈ tắt fan sau 30s — PMS vẫn ON
    Serial.println("[FAN] OFF, PMS vẫn ON");
    fan_off();

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

        if(ps_used('A')) Serial1.println("{\"useda\":1}");
        if(ps_used('B')) Serial1.println("{\"usedb\":1}");

        delay(500);
        uart_read_pass();
    }
    else
    {
        // Đọc sensor trong khi PMS vẫn ON
        Serial.println("[CYCLE] Normal measurement");
        SensorData d = read_sensor_window();
        uart_send_data(d);
        uart_read_pass();
    }

    // Tắt PMS sau khi đọc xong
    Serial.println("[PMS] OFF");
    pms_off();

    // Set alarm từ giờ HIỆN TẠI (sau cycle)
    uint32_t t_now = now_sec();
    set_next_alarm(t_now);

    Serial.println("=== CYCLE END ===");
    Serial.println();

    enter_stop();
}