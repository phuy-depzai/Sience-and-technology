#include <Arduino.h>
#include <Wire.h>
#include "stm32f1xx_hal.h"

#include <Adafruit_DPS310.h>

#include "er.h"
#include "SHT31.h"
#include "DS3231.h"
#include "ina226.h"
#include "power.h"
#include "comm.h"
#include "pms.h"
#include "sgp41.h"
#include "lora.h"

extern bool g_just_woke;

// ============================================================
// ====== DEBUG CONFIG ========================================
// ============================================================
// Board co USB CDC (Black Pill / custom):
// #define DBG SerialUSB
//
// Board khong USB CDC (Blue Pill clone) — tat debug:
struct NullSerial {
    void begin(int) {}
    void end() {}
    void flush() {}
    void print(const char*) {}
    void println(const char*) {}
    void println() {}
    template<typename T> void print(T) {}
    template<typename T> void print(T, int) {}
    template<typename T> void println(T) {}
    template<typename T> void println(T, int) {}
};
#define DBG NullSerial()

// ZE07-CO dung Serial3 (USART3: PB10=TX, PB11=RX)
#define ZE07_SERIAL Serial3

#define NODE_ID  "001"

#define LED_PIN       PC13
#define PMS_PIN       PB13
#define LOCK_PIN      PB14
#define RST_LORA      PA8
#define FAN_COOL      PB3
#define FAN_SENSOR    PB4
#define NTC1_PIN      PA1
#define NTC2_PIN      PA6
#define NTC3_PIN      PB0

#define T_SCAN          30000
#define T_CYCLE         300
#define N_SAMPLE        450
#define TARGET_SAMPLES  420
#define FAIL_MAX        100
#define MEAS_MAX_MS     180000
#define T_PRESLEEP      500

float g_co_ppm = NAN;
uint32_t g_cycle_num = 0;

Adafruit_DPS310 dps;
static bool  g_dps_ok = false;
static float g_press_last = NAN;

// ================= ZE07-CO UART READ =================
// Winsen ZE07-CO, 9-byte frame @ 9600 8N1:
//   buf[0] = 0xFF   start byte
//   buf[1] = 0x04   command (CO)
//   buf[2] = 0x00   high byte dummy
//   buf[3] = 0x00   low byte dummy
//   buf[4] = HIGH   CO high byte
//   buf[5] = LOW    CO low byte
//   buf[6] = full_range
//   buf[7] = full_scale
//   buf[8] = checksum = (~(sum buf[1..7]) + 1) & 0xFF
//
// CO (ppm) = ((buf[4] << 8) | buf[5]) * 0.1
static float read_ze07_co() {
    static uint8_t buf[9];
    static uint8_t idx = 0;
    static float   last_ppm = NAN;
    static uint32_t last_ok = 0;

    while (ZE07_SERIAL.available()) {
        uint8_t b = ZE07_SERIAL.read();

        // Sync on start byte
        if (idx == 0 && b != 0xFF) continue;
        buf[idx++] = b;

        if (idx >= 9) {
            idx = 0;

            // Checksum = (~sum(buf[1..7]) + 1) & 0xFF
            uint8_t sum = 0;
            for (int i = 1; i < 8; i++) sum += buf[i];
            uint8_t checksum = (uint8_t)(~sum) + 1;

            if (checksum == buf[8] && buf[1] == 0x04) {
                uint16_t co_raw = ((uint16_t)buf[4] << 8) | buf[5];
                float ppm = co_raw * 0.1f;
                if (ppm >= 0.0f && ppm <= 1000.0f) {
                    last_ppm = ppm;
                    last_ok  = millis();
                }
            }
        }
    }

    if (millis() - last_ok > 5000) return NAN;
    return last_ppm;
}

// ================= FORMAT HELPERS =================
static void print_2dig(uint32_t v) {
    if (v < 10) DBG.print('0');
    DBG.print(v);
}

static void print_hms(uint32_t s) {
    uint32_t h = s / 3600;
    uint32_t m = (s / 60) % 60;
    uint32_t sec = s % 60;
    print_2dig(h); DBG.print(':');
    print_2dig(m); DBG.print(':');
    print_2dig(sec);
}

static void print_hex_2(uint8_t v) {
    const char* hex = "0123456789ABCDEF";
    DBG.print(hex[(v >> 4) & 0xF]);
    DBG.print(hex[v & 0xF]);
}

static void build_ts_str(char* buf, uint32_t s) {
    uint32_t h = s / 3600;
    uint32_t m = (s / 60) % 60;
    uint32_t sec = s % 60;
    buf[0] = '0' + (h / 10);
    buf[1] = '0' + (h % 10);
    buf[2] = '0' + (m / 10);
    buf[3] = '0' + (m % 10);
    buf[4] = '0' + (sec / 10);
    buf[5] = '0' + (sec % 10);
    buf[6] = '\0';
}

// ================= LED =================
static void led_blink(int n) {
    pinMode(LED_PIN, OUTPUT);
    for (int i = 0; i < n; i++) {
        digitalWrite(LED_PIN, LOW);  delay(150);
        digitalWrite(LED_PIN, HIGH); delay(150);
    }
    delay(800);
}

// ================= GPIO =================
static void gpio_init_all() {
    GPIO_InitTypeDef gpio = {0};
    gpio.Mode  = GPIO_MODE_OUTPUT_PP;
    gpio.Pull  = GPIO_NOPULL;
    gpio.Speed = GPIO_SPEED_FREQ_LOW;

    gpio.Pin = GPIO_PIN_13; HAL_GPIO_Init(GPIOB, &gpio);
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_13, GPIO_PIN_RESET);
    gpio.Pin = GPIO_PIN_14; HAL_GPIO_Init(GPIOB, &gpio);
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_14, GPIO_PIN_RESET);
    gpio.Pin = GPIO_PIN_8; HAL_GPIO_Init(GPIOA, &gpio);
    HAL_GPIO_WritePin(GPIOA, GPIO_PIN_8, GPIO_PIN_SET);
    gpio.Pin = GPIO_PIN_3; HAL_GPIO_Init(GPIOB, &gpio);
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_3, GPIO_PIN_RESET);
    gpio.Pin = GPIO_PIN_4; HAL_GPIO_Init(GPIOB, &gpio);
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_4, GPIO_PIN_RESET);
}

// ================= I2C =================
static bool rtc_write(uint8_t addr, uint8_t *data, uint8_t len) {
    Wire.beginTransmission(addr);
    for (uint8_t i = 0; i < len; i++) Wire.write(data[i]);
    return Wire.endTransmission() == 0;
}
static bool rtc_read(uint8_t addr, uint8_t *data, uint8_t len) {
    if (Wire.requestFrom(addr, len) != len) return false;
    for (uint8_t i = 0; i < len; i++) data[i] = Wire.read();
    return true;
}
static bool sht_write(uint8_t addr, uint8_t *data, uint8_t len) {
    Wire.beginTransmission(addr);
    for (uint8_t i = 0; i < len; i++) Wire.write(data[i]);
    return Wire.endTransmission() == 0;
}
static bool sht_read(uint8_t addr, uint8_t *data, uint8_t len) {
    if (Wire.requestFrom(addr, len) != len) return false;
    for (uint8_t i = 0; i < len; i++) data[i] = Wire.read();
    return true;
}

static void i2c_recover() {
    pinMode(PB6, OUTPUT); pinMode(PB7, OUTPUT);
    digitalWrite(PB6, HIGH); digitalWrite(PB7, HIGH);
    delayMicroseconds(10);
    for (int i = 0; i < 9; i++) {
        digitalWrite(PB6, LOW);  delayMicroseconds(5);
        digitalWrite(PB6, HIGH); delayMicroseconds(5);
    }
    digitalWrite(PB6, LOW);  delayMicroseconds(5);
    digitalWrite(PB7, LOW);  delayMicroseconds(5);
    digitalWrite(PB6, HIGH); delayMicroseconds(5);
    digitalWrite(PB7, HIGH); delayMicroseconds(5);
    Wire.begin(); Wire.setClock(100000); Wire.setTimeout(100);
    delay(1);
}

static int check_i2c_health(const char* tag) {
    const uint8_t addrs[] = {0x40, 0x44, 0x57, 0x59, 0x68};
    int found = 0;
    for (uint8_t i = 0; i < 5; i++) {
        Wire.beginTransmission(addrs[i]);
        if (Wire.endTransmission() == 0) found++;
    }
    int dps_found = 0;
    if (g_dps_ok) {
        Wire.beginTransmission(0x77);
        if (Wire.endTransmission() == 0) dps_found = 1;
    }
    int total    = found + dps_found;
    int expected = 5 + (g_dps_ok ? 1 : 0);

    if (total < expected) {
        DBG.print("[I2C:"); DBG.print(tag);
        DBG.print("] ");    DBG.print(total);
        DBG.print('/');     DBG.print(expected);
        DBG.print(" -> RECOVER... ");
        i2c_recover();
        delay(50);
        found = 0;
        for (uint8_t i = 0; i < 5; i++) {
            Wire.beginTransmission(addrs[i]);
            if (Wire.endTransmission() == 0) found++;
        }
        dps_found = 0;
        if (g_dps_ok) {
            Wire.beginTransmission(0x77);
            if (Wire.endTransmission() == 0) dps_found = 1;
        }
        total = found + dps_found;
        DBG.print("-> "); DBG.print(total);
        DBG.print('/');   DBG.println(expected);
    } else {
        DBG.print("[I2C:"); DBG.print(tag);
        DBG.print("] ");    DBG.print(total);
        DBG.print('/');     DBG.println(expected);
    }
    return total;
}

// ================= OBJECTS =================
SHT31   sht(0x44, sht_write, sht_read);
DS3231  rtc(0x68, rtc_write, rtc_read);
PMS7003 pms(&Serial2);
SGP41   sgp;
static bool sgp_ready = false;

// ================= EXTI =================
static void exti_pa0_init() {
    GPIO_InitTypeDef gpio = {0};
    gpio.Pin  = GPIO_PIN_0;
    gpio.Mode = GPIO_MODE_IT_FALLING;
    gpio.Pull = GPIO_PULLUP;
    HAL_GPIO_Init(GPIOA, &gpio);
    HAL_NVIC_SetPriority(EXTI0_IRQn, 0, 0);
    HAL_NVIC_EnableIRQ(EXTI0_IRQn);
}

// ================= FAN/PMS =================
static void fan_sensor_on()  { HAL_GPIO_WritePin(GPIOB, GPIO_PIN_4, GPIO_PIN_SET); }
static void fan_sensor_off() { HAL_GPIO_WritePin(GPIOB, GPIO_PIN_4, GPIO_PIN_RESET); }
static void pms_on()         { HAL_GPIO_WritePin(GPIOB, GPIO_PIN_13, GPIO_PIN_SET); }
static void pms_off()        { HAL_GPIO_WritePin(GPIOB, GPIO_PIN_13, GPIO_PIN_RESET); }

// ================= FILTER =================
static float median9(float *arr) {
    float t[9];
    for (int i = 0; i < 9; i++) t[i] = arr[i];
    for (int i = 0; i < 8; i++)
        for (int j = i + 1; j < 9; j++)
            if (t[i] > t[j]) { float tmp = t[i]; t[i] = t[j]; t[j] = tmp; }
    return t[4];
}
static float filter_pipeline(float *raw, int n) {
    float med[N_SAMPLE / 9];
    int mn = 0;
    for (int i = 0; i + 8 < n; i += 9) med[mn++] = median9(&raw[i]);
    if (mn == 0) return 0;
    float sum = 0;
    for (int i = 0; i < mn; i++) sum += med[i];
    return sum / mn;
}

// ================= SCAN PHASE =================
static void scan_phase(uint32_t window_ms, float *maxv, float *minv, float *maxi, float *mini) {
    uint32_t start = millis();
    uint32_t last_ina = start;

    DBG.println("[SCAN] 30s (do INA song song)...");

    while (millis() - start < window_ms) {
        if (millis() - last_ina > 200 && (millis() - start) > 3000) {
            last_ina = millis();
            float v = ina226_vbus();
            float i = ina226_current();
            if (!isnan(v) && !isnan(i) && v > 1.0f && i > 0.001f) {
                if (v > *maxv) *maxv = v;
                if (v < *minv) *minv = v;
                if (i > *maxi) *maxi = i;
                if (i < *mini) *mini = i;
            }
        }
        // Drain ZE07 song song
        while (ZE07_SERIAL.available()) ZE07_SERIAL.read();
        delay(20);
    }
    if (*minv >= 900) *minv = -1;
    if (*mini >= 900) *mini = -1;

    DBG.print("[SCAN] OK | INA max="); DBG.print(*maxi, 3);
    DBG.print("A min=");               DBG.print(*mini, 3);
    DBG.println("A");
}

// ================= DPS POLL =================
static void poll_dps() {
    if (!g_dps_ok) return;
    static uint32_t last_poll = 0;
    if (millis() - last_poll < 200) return;
    last_poll = millis();

    sensors_event_t te, pe;
    if (dps.getEvents(&te, &pe)) {
        if (!isnan(pe.pressure) && pe.pressure > 300 && pe.pressure < 1100) {
            g_press_last = pe.pressure;
        }
    }
}

// ================= SENSOR =================
static void read_one_sample(float *t, float *h, float *v, float *i) {
    sht.startMeasurement();
    delay(20);
    if (!sht.read(t, h)) { *t = NAN; *h = NAN; }
    *v = ina226_vbus();
    *i = ina226_current();
}

static void ensure_sensors_ready() {
    if (!sgp_ready) {
        DBG.println("[MEAS] SGP41 chua ready -> init lai...");
        for (int r = 0; r < 3; r++) {
            if (sgp.begin()) { sgp_ready = true; DBG.println("[MEAS] SGP41 OK"); break; }
            i2c_recover();
            delay(100);
        }
        if (!sgp_ready) DBG.println("[MEAS] SGP41 van FAIL");
    }
}

// ================= READ SENSOR WINDOW =================
static SensorData read_sensor_window(float *maxv, float *minv, float *maxi, float *mini) {
    ensure_sensors_ready();

    // Reset CO truoc khi do
    g_co_ppm = NAN;

    // Drain ZE07 frame cu
    while (ZE07_SERIAL.available()) ZE07_SERIAL.read();

    static float t_arr[N_SAMPLE], h_arr[N_SAMPLE], v_arr[N_SAMPLE], i_arr[N_SAMPLE];
    int n = 0;
    int fail_count = 0;
    int consecutive_fail = 0;
    PMSData pms_d = {0};
    uint16_t voc_last = 0, nox_last = 0;
    uint8_t  sgp_ok_last = 0;
    bool err_pms = false;

    DBG.print("[MEAS] Target "); DBG.print(TARGET_SAMPLES);
    DBG.print(" mau (fail max "); DBG.print(FAIL_MAX);
    DBG.println(")...");

    uint32_t t_start = millis();
    while (n < TARGET_SAMPLES && fail_count < FAIL_MAX && (millis() - t_start) < MEAS_MAX_MS) {
        pms.poll();
        poll_dps();

        // Drain ZE07 song song
        while (ZE07_SERIAL.available()) ZE07_SERIAL.read();

        float t, h, v, i;
        read_one_sample(&t, &h, &v, &i);

        bool t_bad   = isnan(t) || isnan(h) || (t <= 0) || (t > 60) || (h <= 0) || (h > 100);
        bool ina_bad = isnan(v) || isnan(i) || (v < 1.0f) || (i < 0.001f);

        if (t_bad || ina_bad) {
            fail_count++;
            consecutive_fail++;
            if (consecutive_fail >= 10 && consecutive_fail % 10 == 0) {
                DBG.print("[MEAS] "); DBG.print(consecutive_fail);
                DBG.println(" fail lien tiep -> recover");
                i2c_recover();
                delay(200);
            } else {
                delay(50);
            }
            if (fail_count % 5 == 0) {
                DBG.print("[MEAS] fail "); DBG.print(fail_count);
                DBG.print('/'); DBG.print(FAIL_MAX);
                DBG.print(" (n="); DBG.print(n);
                DBG.print(", consec="); DBG.print(consecutive_fail);
                DBG.println(")");
            }
            continue;
        }
        consecutive_fail = 0;

        t_arr[n] = t; h_arr[n] = h; v_arr[n] = v; i_arr[n] = i;
        if (v > *maxv) *maxv = v;
        if (v < *minv) *minv = v;
        if (i > *maxi) *maxi = i;
        if (i < *mini) *mini = i;
        n++;

        if (sgp_ready && (n % 10 == 0)) {
            delay(50);
            uint16_t rh_i = (h > 0.1f && h <= 100.0f) ? (uint16_t)h : 50;
            uint16_t t_i  = (t > -45.0f && t < 130.0f) ? (uint16_t)t : 25;
            uint16_t voc, nox;
            if (sgp.measureRaw(rh_i, t_i, &voc, &nox)) {
                voc_last = voc; nox_last = nox; sgp_ok_last = 1;
            } else { i2c_recover(); }
            delay(50);
        }
        delay(180);
    }

    uint32_t elapsed = millis() - t_start;
    bool emergency = (n < TARGET_SAMPLES);
    if (emergency) {
        DBG.print("[MEAS] EMER: "); DBG.print(n);
        DBG.print('/');             DBG.print(TARGET_SAMPLES);
        DBG.print(" mau, fail=");   DBG.print(fail_count);
        DBG.print(", ");            DBG.print(elapsed/1000);
        DBG.println("s");
    } else {
        DBG.print("[MEAS] OK: "); DBG.print(n);
        DBG.print(" mau, ");      DBG.print(elapsed/1000);
        DBG.println("s");
    }

    if (!pms.read(&pms_d)) {
        for (int r = 0; r < 3; r++) {
            delay(200); pms.poll();
            if (pms.read(&pms_d)) { err_pms = false; break; }
            err_pms = true;
        }
    }
    if (err_pms) DBG.println("ERROR:PMS_NAN");

    // ===== DOC ZE07 CO (cho toi da 2s) =====
    uint32_t t_co = millis();
    while (millis() - t_co < 2000) {
        float co = read_ze07_co();
        if (!isnan(co)) { g_co_ppm = co; break; }
        delay(100);
    }
    DBG.print("[CO] ");
    if (isnan(g_co_ppm)) DBG.println("-1 (NAN)");
    else { DBG.print(g_co_ppm, 1); DBG.println(" ppm"); }

    SensorData d;
    d.temp  = (n > 0) ? filter_pipeline(t_arr, n) : NAN;
    d.hum   = (n > 0) ? filter_pipeline(h_arr, n) : NAN;
    d.vpin  = (n > 0) ? filter_pipeline(v_arr, n) : 0;
    d.ipin  = (n > 0) ? filter_pipeline(i_arr, n) : 0;
    d.press = isnan(g_press_last) ? NAN : g_press_last;
    d.pm1 = pms_d.pm1; d.pm25 = pms_d.pm25; d.pm10 = pms_d.pm10;
    d.voc_sraw = voc_last; d.nox_sraw = nox_last; d.sgp_ok = sgp_ok_last;
    d.emer = emergency ? 1 : 0;

    if (n == 0) {
        *maxv = -1; *minv = -1; *maxi = -1; *mini = -1;
        DBG.println("[MEAS] KHONG CO MAU VALID -> max=min=-1");
    }
    return d;
}

// ================= RTC =================
static uint32_t now_sec() {
    RTC_Time t;
    rtc.getTime(&t);
    if (t.hour > 23 || t.min > 59 || t.sec > 59) {
        DBG.println("[RTC] Invalid, recover...");
        i2c_recover();
        rtc.getTime(&t);
        if (t.hour > 23 || t.min > 59 || t.sec > 59) return 0xFFFFFFFF;
    }
    return (uint32_t)t.hour * 3600 + (uint32_t)t.min * 60 + t.sec;
}

static bool set_next_alarm(uint32_t now_s) {
    if (now_s == 0xFFFFFFFF) return false;
    rtc.clearAlarm();
    uint32_t next = ((now_s / T_CYCLE) + 1) * T_CYCLE;
    next = next % 86400;
    if (!rtc.setAlarm(next % 60, (next / 60) % 60, (next / 3600) % 24)) return false;

    DBG.print("[RTC] ");   print_hms(now_s);
    DBG.print(" -> ");      print_hms(next);
    DBG.println();
    return true;
}

// ================= SEND DATA (A/B split) =================
static void send_data(SensorData d, float maxv, float minv,
                      float maxi, float mini, uint32_t ts_wake) {
    char ts_buf[7] = "000000";
    if (ts_wake != 0xFFFFFFFF) build_ts_str(ts_buf, ts_wake);
    else                       strcpy(ts_buf, "0");

    // ===== GOI A: sensor chinh =====
    String csvA = "";
    csvA += NODE_ID;  csvA += '|';
    csvA += ts_buf;   csvA += '|';
    csvA += 'A';      csvA += '|';
    csvA += String((int32_t)(d.temp * 10));  csvA += '|';
    csvA += String((int32_t)(d.hum * 10));   csvA += '|';
    if (isnan(d.press)) csvA += "-1";
    else                csvA += String((int32_t)(d.press * 10));
    csvA += '|';
    csvA += String((int32_t)(d.vpin * 1000)); csvA += '|';
    csvA += String((int32_t)(d.ipin * 1000)); csvA += '|';
    csvA += String(d.pm1);        csvA += '|';
    csvA += String(d.pm25);       csvA += '|';
    csvA += String(d.pm10);       csvA += '|';
    if (isnan(g_co_ppm)) csvA += "-1";
    else                 csvA += String((int32_t)(g_co_ppm * 10));
    csvA += '|';
    csvA += String(d.voc_sraw);   csvA += '|';
    csvA += String(d.nox_sraw);

    // ===== GOI B: min/max =====
    String csvB = "";
    csvB += NODE_ID;  csvB += '|';
    csvB += ts_buf;   csvB += '|';
    csvB += 'B';      csvB += '|';
    csvB += String((int32_t)(maxv * 1000));  csvB += '|';
    csvB += String((int32_t)(minv * 1000));  csvB += '|';
    csvB += String((int32_t)(maxi * 1000));  csvB += '|';
    csvB += String((int32_t)(mini * 1000));

    DBG.print("[CSV-A] len="); DBG.print(csvA.length()); DBG.print("B: "); DBG.println(csvA);
    DBG.print("[CSV-B] len="); DBG.print(csvB.length()); DBG.print("B: "); DBG.println(csvB);

    if (csvA.length() > 63) DBG.println("[LORA] WARN: csvA > 63B!");

    if (!LoRa_IsReady()) {
        DBG.println("[LORA] NOT READY, skip burst");
        return;
    }

    if (LoRa_SendBurst(csvA.c_str(), 3, 1500)) DBG.println("[LORA] Burst A OK");
    else                                       DBG.println("[LORA] Burst A FAIL");

    delay(500);

    if (LoRa_SendBurst(csvB.c_str(), 3, 1500)) DBG.println("[LORA] Burst B OK");
    else                                       DBG.println("[LORA] Burst B FAIL");
}

// ================= REINIT =================
static void reinit_all_system() {
    DBG.println("[REINIT] === Bat dau ===");

    gpio_init_all();
    delay(10);

    DBG.begin(115200);
    Serial.begin(9600);
    Serial2.begin(9600);
    ZE07_SERIAL.begin(9600);
    delay(100);

    Wire.begin();
    Wire.setClock(100000);
    Wire.setTimeout(100);
    delay(50);

    int found = check_i2c_health("REINIT-I2C");
    if (found < 5) {
        DBG.println("[REINIT] I2C bus yeu, recover...");
        i2c_recover();
        delay(100);
        check_i2c_health("REINIT-I2C-2");
    }

    sht.begin();
    ina226_init();
    rtc.begin();
    delay(50);

    sgp_ready = false;
    for (int r = 0; r < 3; r++) {
        if (sgp.begin()) {
            sgp_ready = true;
            DBG.println("[REINIT] SGP41 OK");
            break;
        }
        DBG.print("[REINIT] SGP41 fail lan ");
        DBG.print(r + 1);
        DBG.println(", recover...");
        i2c_recover();
        delay(100);
    }
    if (!sgp_ready) DBG.println("[REINIT] SGP41 FAIL hoan toan");

    if (g_dps_ok) {
        if (!dps.begin_I2C(0x77)) {
            g_dps_ok = false;
            DBG.println("[REINIT] DPS310 lost");
        } else {
            dps.configurePressure(DPS310_16HZ, DPS310_16SAMPLES);
            dps.configureTemperature(DPS310_16HZ, DPS310_16SAMPLES);
            DBG.println("[REINIT] DPS310 OK");
        }
    }

    pms.begin();
    delay(50);

    g_press_last = NAN;
    check_i2c_health("REINIT-DONE");
    DBG.println("[REINIT] === Hoan tat ===");
}

// ================= SHUTDOWN =================
static void shutdown_all_system() {
    DBG.println("[SHUTDOWN] === Tat toan bo ===");

    pms_off();
    fan_sensor_off();
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_3, GPIO_PIN_RESET);
    delay(200);

    Serial.end();
    Serial2.end();
    ZE07_SERIAL.end();

    delay(50);

    Wire.end();
    delay(10);

    sgp_ready = false;
    g_press_last = NAN;

    DBG.println("[SHUTDOWN] === Hoan tat ===");
}

// ================= SETUP =================
void setup() {
    Serial.begin(9600);
    Serial2.begin(9600);
    DBG.begin(115200);
    ZE07_SERIAL.begin(9600);
    delay(500);

    DBG.println("=== BOOT ===");

    __HAL_RCC_AFIO_CLK_ENABLE();
    __HAL_AFIO_REMAP_SWJ_NOJTAG();

    gpio_init_all();
    led_blink(1);

    Wire.begin();
    Wire.setClock(100000);
    Wire.setTimeout(100);

    check_i2c_health("BOOT-1");
    led_blink(2);

    exti_pa0_init();

    sht.begin();
    ina226_init();
    rtc.begin();
    pms.begin();

    if (dps.begin_I2C(0x77)) {
        dps.configurePressure(DPS310_16HZ, DPS310_16SAMPLES);
        dps.configureTemperature(DPS310_16HZ, DPS310_16SAMPLES);
        Wire.beginTransmission(0x77);
        Wire.write(0x0D);
        if (Wire.endTransmission(false) == 0 && Wire.requestFrom(0x77, (uint8_t)1) == 1) {
            uint8_t id = Wire.read();
            if (id == 0x10) {
                g_dps_ok = true;
                DBG.println("[DPS310] OK");
            } else {
                g_dps_ok = false;
                DBG.print("[DPS310] WHO_AM_I=0x");
                print_hex_2(id);
                DBG.println(" (fake?)");
            }
        } else {
            g_dps_ok = false;
        }
    }

    if (sgp.begin()) {
        sgp_ready = true;
        DBG.println("[SGP41] OK");
    } else {
        DBG.println("[SGP41] FAIL");
    }

    check_i2c_health("BOOT-2");

    DBG.println("=== SYSTEM READY ===");
    led_blink(3);
}

// ================= LOOP =================
void loop() {
    if (g_just_woke) {
        g_just_woke = false;
        reinit_all_system();
        delay(100);
    }

    g_cycle_num++;
    DBG.print("\n=== CYCLE "); DBG.print(g_cycle_num); DBG.println(" ===");

    led_blink(1);

    DBG.println("[LORA] Reset + init TX...");
    if (!LoRa_Init_TX(&Serial)) {
        DBG.println("[LORA] Init TX FAIL - skip burst cycle nay");
    }

    check_i2c_health("WAKE");

    bool is_rtc_wake = rtc.checkAlarm();
    if (is_rtc_wake) {
        DBG.println("[WAKE] RTC Alarm OK");
        rtc.clearAlarm();
    } else {
        DBG.println("[WAKE] ABNORMAL");
    }

    uint32_t t_wake = now_sec();

    led_blink(2);
    float maxv = 0, minv = 999, maxi = 0, mini = 999;
    fan_sensor_on();
    pms_on();
    scan_phase(T_SCAN, &maxv, &minv, &maxi, &mini);
    fan_sensor_off();
    check_i2c_health("PRE-MEAS");

    led_blink(3);
    SensorData d = read_sensor_window(&maxv, &minv, &maxi, &mini);
    check_i2c_health("POST-MEAS");

    led_blink(4);
    send_data(d, maxv, minv, maxi, mini, t_wake);

    led_blink(5);
    delay(T_PRESLEEP);

    uint32_t t_now = now_sec();
    bool alarm_ok = false;
    if (t_now != 0xFFFFFFFF) {
        for (int retry = 0; retry < 3; retry++) {
            if (set_next_alarm(t_now)) { alarm_ok = true; break; }
            DBG.print("[SLEEP] setAlarm FAIL (");
            DBG.print(retry + 1);
            DBG.println(")");
            check_i2c_health("SLEEP-RCVR");
        }
    }

    shutdown_all_system();

    if (alarm_ok) {
        DBG.println("[SLEEP] Vao STOP mode...");
        delay(10);
        enter_stop();
    } else {
        DBG.println("[SLEEP] FATAL: setAlarm fail 3 lan");
        delay(T_CYCLE * 1000);
        reinit_all_system();
    }
}