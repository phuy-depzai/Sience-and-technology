#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>

#include "mqtt.h"


// ================= WIFI =================

const char* ssid = "Ken Lun 2.4G";
const char* password = "khongcomatkhau1308";

IPAddress local_IP(192, 168, 1, 18);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress dns(8, 8, 8, 8);



// ================= MQTT =================

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

mqtt MQTT(&mqttClient, "esp32_uart_bridge");

const char* mqtt_ip = "192.168.1.54";
const char* topic = "a/nv/d";
const char* topic_pass = "a/nv/p";   // ← thêm ở đây



// ================= UART =================

#define UART_RX 16
#define UART_TX 17



// ================= PKT COUNTER =================

uint32_t pkt_count = 0;



// ================= WIFI =================

void wifiConnect()
{
    if(WiFi.status() == WL_CONNECTED) return;

    Serial.println("[WIFI] Connecting...");
    WiFi.config(local_IP, gateway, subnet, dns);
    WiFi.begin(ssid, password);

    while(WiFi.status() != WL_CONNECTED)
    {
        delay(500);
        Serial.print(".");
    }

    Serial.println();
    Serial.print("[WIFI] IP: ");
    Serial.println(WiFi.localIP());
}



// ================= MQTT =================

void mqttConnect()
{
    if(MQTT.status()) return;

    Serial.println("[MQTT] Connecting...");
    while(!MQTT.con())
    {
        Serial.println("[MQTT] retry");
        delay(1000);
    }
    Serial.println("[MQTT] OK");
}



// ================= RANDOM PASS =================

String genPass(char level)
{
    String p = String(level);

    for(int i = 0; i < 8; i++)
    {
        p += String((esp_random() % 9) + 1);
    }

    return p;
}



void sendPass(char level)
{
    String p = genPass(level);

    Serial2.print("PASS:");
    Serial2.println(p);

    Serial.println("==========");
    Serial.print("[SEND] Level = ");
    Serial.println(level);
    Serial.print("[SEND] PASS  = ");
    Serial.println(p);
    Serial.println("==========");

    // Pub lên MQTT
    String msg = "{\"level\":\"";
    msg += level;
    msg += "\",\"pass\":\"";
    msg += p;
    msg += "\"}";

    if(MQTT.pub(topic_pass, msg.c_str()))
        Serial.println("[MQTT] PASS OK");
    else
        Serial.println("[MQTT] PASS FAIL");
}



// đọc cờ useda / usedb
void checkUsed(String data)
{
    if(data.indexOf("\"useda\":1") >= 0) sendPass('A');
    if(data.indexOf("\"usedb\":1") >= 0) sendPass('B');
}



// ================= SETUP =================

void setup()
{
    Serial.begin(115200);
    delay(500);

    Serial.println();
    Serial.println("=== BOOT ===");

    Serial2.begin(
        115200,
        SERIAL_8N1,
        UART_RX,
        UART_TX
    );

    mqttClient.setServer(mqtt_ip, 1883);

    wifiConnect();
    mqttConnect();

    Serial.println("=== READY ===");
}



// ================= LOOP =================

void loop()
{
    wifiConnect();
    mqttConnect();
    MQTT.loop();

    while(Serial2.available())
    {
        String data = Serial2.readStringUntil('\n');
        data.trim();

        if(!data.length()) continue;

        bool is_json = data.startsWith("{");

        if(is_json) pkt_count++;

        String out = data;
        if(is_json && out.endsWith("}"))
        {
            out = out.substring(0, out.length() - 1);
            out += ",\"pkt\":" + String(pkt_count) + "}";
        }

        Serial.println();
        Serial.print("[RX] ");
        Serial.println(data);
        Serial.print("[TX] ");
        Serial.println(out);

        if(MQTT.pub(topic, out.c_str()))
            Serial.println("[MQTT] OK");
        else
            Serial.println("[MQTT] FAIL");

        checkUsed(data);
    }

    delay(10);
}