#include <WiFi.h>
#include <time.h>
#include <PubSubClient.h>

// ============ UART2 → STM32 (PA9/PA10 = USART1) ============
#define RXD2  16    // ← STM32 PA9  (USART1_TX)
#define TXD2  17    // → STM32 PA10 (USART1_RX)

// ============ WIFI ============
const char* WIFI_SSID = "Ken Lun 2.4G";
const char* WIFI_PASS = "khongcomatkhau1308";

// ============ MQTT ============
const char* MQTT_SERVER = "103.161.17.249";
const int   MQTT_PORT   = 1883;
const char* MQTT_USER   = "airwatch";
const char* MQTT_PASS   = "1804H";
const char* MQTT_TOPIC  = "airwatch/data";
const char* MQTT_CLIENT = "esp32_gateway_01";

// ============ NTP ============
const char* NTP_SERVER = "pool.ntp.org";
const long  GMT_OFFSET = 7 * 3600;    // GMT+7
const int   DST_OFFSET = 0;

WiFiClient espClient;
PubSubClient mqtt(espClient);

bool     time_synced = false;
String   uart_buf = "";
uint32_t last_mqtt_retry = 0;
uint32_t last_time_sync  = 0;

// ============ WIFI ============
void wifi_connect() {
    if (WiFi.status() == WL_CONNECTED) return;
    Serial.print("[WiFi] Connecting");
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
        delay(500);
        Serial.print(".");
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[WiFi] OK: " + WiFi.localIP().toString());
        configTime(GMT_OFFSET, DST_OFFSET, NTP_SERVER);
    } else {
        Serial.println("\n[WiFi] FAIL");
    }
}

// ============ MQTT ============
void mqtt_connect() {
    if (mqtt.connected()) return;
    if (millis() - last_mqtt_retry < 5000) return;
    last_mqtt_retry = millis();

    Serial.print("[MQTT] Connecting...");
    mqtt.setServer(MQTT_SERVER, MQTT_PORT);
    mqtt.setKeepAlive(60);

    if (mqtt.connect(MQTT_CLIENT, MQTT_USER, MQTT_PASS)) {
        Serial.println("OK");
    } else {
        Serial.print("FAIL, rc=");
        Serial.println(mqtt.state());
    }
}

// ============ SYNC RTC → STM32 ============
void send_time_to_stm32() {
    if (WiFi.status() != WL_CONNECTED) return;

    struct tm timeinfo;
    if (!getLocalTime(&timeinfo, 5000)) {
        Serial.println("[NTP] Get fail");
        return;
    }

    char buf[64];
    snprintf(buf, sizeof(buf),
        "SET %02d:%02d:%02d %02d/%02d/%04d\n",
        timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec,
        timeinfo.tm_mday, timeinfo.tm_mon + 1,
        timeinfo.tm_year + 1900);

    Serial.print("[RTC] → STM32: ");
    Serial.print(buf);
    Serial2.print(buf);
    time_synced = true;
    last_time_sync = millis();
}

// ============ SEND MQTT ============
void send_to_mqtt(String json) {
    if (!mqtt.connected()) {
        Serial.println("[MQTT] Offline, drop");
        return;
    }
    if (mqtt.publish(MQTT_TOPIC, json.c_str())) {
        Serial.println("[MQTT] Published OK");
    } else {
        Serial.println("[MQTT] Publish FAIL");
    }
}

// ============ SETUP ============
void setup() {
    Serial.begin(115200);       // USB debug
    Serial2.begin(115200, SERIAL_8N1, RXD2, TXD2);   // → STM32

    delay(500);
    Serial.println("\n=== ESP32 Gateway ===");

    wifi_connect();
    mqtt_connect();

    if (WiFi.status() == WL_CONNECTED) {
        delay(500);
        send_time_to_stm32();
    }
}

// ============ LOOP ============
void loop() {
    wifi_connect();
    mqtt_connect();
    mqtt.loop();

    // Đọc data từ STM32
    while (Serial2.available()) {
        char c = Serial2.read();

        if (c == '\n') {
            uart_buf.trim();

            if (uart_buf.length() > 0) {
                Serial.print("[STM32] ← ");
                Serial.println(uart_buf);

                if (uart_buf.startsWith("{")) {
                    send_to_mqtt(uart_buf);
                }
                else if (uart_buf.startsWith("PASS:")) {
                    Serial.println("[CMD] PASS change");
                }
            }
            uart_buf = "";
        }
        else if (c != '\r') {
            uart_buf += c;
            if (uart_buf.length() > 512) uart_buf = "";
        }
    }

    // Sync RTC mỗi 1h
    if (time_synced && millis() - last_time_sync > 3600000UL) {
        send_time_to_stm32();
    }

    // Reconnect WiFi → sync lại
    static bool was_offline = true;
    if (WiFi.status() == WL_CONNECTED && was_offline) {
        was_offline = false;
        if (time_synced) {
            delay(1000);
            send_time_to_stm32();
        }
    }
    if (WiFi.status() != WL_CONNECTED) was_offline = true;

    delay(50);
}