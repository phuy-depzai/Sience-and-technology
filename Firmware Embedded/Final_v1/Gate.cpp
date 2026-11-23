#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <LittleFS.h>
#include <esp_task_wdt.h>

// ============================================================
// ================== WIFI ====================================
// ============================================================
const char* WIFI_SSID = "Ken Lun 2.4G";
const char* WIFI_PASS = "khongcomatkhau1308";
IPAddress   LOCAL_IP (192, 168, 1, 18);
IPAddress   GATEWAY  (192, 168, 1, 1);
IPAddress   SUBNET   (255, 255, 255, 0);
IPAddress   DNS1     (8, 8, 8, 8);

// ============================================================
// ================== MQTT ====================================
// ============================================================
const char* MQTT_IP       = "103.161.17.249";
const char* MQTT_USER     = "airwatch";
const char* MQTT_PASS     = "1804H";
const char* MQTT_CLIENTID = "esp32_airwatch";
const char* TOPIC_DATA    = "airwatch/data";
const char* TOPIC_ERROR   = "airwatch/emergency";

// ============================================================
// ================== LORA ====================================
// ============================================================
HardwareSerial LoRaSerial(2);
#define LORA_RX_PIN      16
#define LORA_TX_PIN      17
#define LORA_LOCAL_ADDR  2

// ============================================================
// ================== QUEUE ===================================
// ============================================================
#define QUEUE_FILE    "/queue.jsonl"
#define QUEUE_MAX     1048576
#define QUEUE_TRIM    100

// ============================================================
// ================== TUNING ==================================
// ============================================================
#define WDT_TIMEOUT_S             30
#define RECONNECT_INTERVAL_MS     5000
#define LORA_HEARTBEAT_MS         (30UL*60*1000)
#define DRAIN_INTERVAL_MS         30000
#define DEDUP_WINDOW_MS           60000
#define MQTT_RETRY                3
#define MQTT_RETRY_DELAY_MS       500
#define SUMMARY_INTERVAL_MS       300000
#define WIFI_SETUP_TIMEOUT_MS     15000
#define MQTT_SETUP_RETRY          5
#define MQTT_SETUP_RETRY_DELAY_MS 1000
#define PENDING_B_TIMEOUT_MS      5000

// ============================================================
// ================== GLOBALS =================================
// ============================================================
WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);

uint32_t g_rx_count      = 0;
uint32_t g_tx_count      = 0;
uint32_t g_fail_count    = 0;
uint32_t g_dedup_count   = 0;
uint32_t g_last_rx_ms    = 0;
uint32_t g_last_wifi_try = 0;
uint32_t g_last_mqtt_try = 0;
uint32_t g_last_drain    = 0;
uint32_t g_last_summary  = 0;

String   uartBuf = "";

// Dedup state — theo (node_id, ts, marker)
String   last_key     = "";
uint32_t last_ts_time = 0;

// Pending B (chờ RSSI+SNR đến rồi mới publish)
String   pending_B_payload = "";
String   pending_B_node_id = "";
String   pending_B_ts      = "";
uint32_t pending_B_time    = 0;

// ============================================================
// ================== WIFI ====================================
// ============================================================
void wifiConnectBlocking() {
    if (WiFi.status() == WL_CONNECTED) return;
    WiFi.config(LOCAL_IP, GATEWAY, SUBNET, DNS1);
    WiFi.setAutoReconnect(true);
    WiFi.persistent(false);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED &&
           (millis() - start) < WIFI_SETUP_TIMEOUT_MS) {
        delay(500);
        esp_task_wdt_reset();
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.print("[WiFi] OK IP="); Serial.println(WiFi.localIP());
    } else {
        Serial.println("[WiFi] FAIL - loop se retry");
    }
}

void wifiTick() {
    if (WiFi.status() == WL_CONNECTED) return;
    if (millis() - g_last_wifi_try < RECONNECT_INTERVAL_MS) return;
    g_last_wifi_try = millis();
    WiFi.disconnect();
    delay(10);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.printf("[WiFi] retry (status=%d)\n", WiFi.status());
}

// ============================================================
// ================== MQTT ====================================
// ============================================================
void mqttConnectBlocking() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[MQTT] Skip (WiFi chua OK)");
        return;
    }
    if (mqttClient.connected()) return;
    for (int retry = 0; retry < MQTT_SETUP_RETRY; retry++) {
        Serial.print("[MQTT] try...");
        if (mqttClient.connect(MQTT_CLIENTID, MQTT_USER, MQTT_PASS)) {
            Serial.println(" OK"); return;
        }
        Serial.printf(" fail rc=%d\n", mqttClient.state());
        delay(MQTT_SETUP_RETRY_DELAY_MS);
        esp_task_wdt_reset();
    }
    Serial.println("[MQTT] FAIL - loop se retry");
}

void mqttTick() {
    if (WiFi.status() != WL_CONNECTED) return;
    if (mqttClient.connected()) return;
    if (millis() - g_last_mqtt_try < RECONNECT_INTERVAL_MS) return;
    g_last_mqtt_try = millis();
    Serial.print("[MQTT] retry...");
    if (mqttClient.connect(MQTT_CLIENTID, MQTT_USER, MQTT_PASS)) Serial.println(" OK");
    else Serial.printf(" fail rc=%d\n", mqttClient.state());
}

bool mqttPublish(const char* topic, const String &payload) {
    if (!mqttClient.connected()) return false;
    for (int i = 0; i < MQTT_RETRY; i++) {
        if (mqttClient.publish(topic, payload.c_str())) return true;
        delay(MQTT_RETRY_DELAY_MS);
        esp_task_wdt_reset();
    }
    return false;
}

// ============================================================
// ================== QUEUE (LittleFS) ========================
// ============================================================
int queueSize() {
    if (!LittleFS.exists(QUEUE_FILE)) return 0;
    File f = LittleFS.open(QUEUE_FILE, "r");
    if (!f) return 0;
    int s = f.size();
    f.close();
    return s;
}

void trimQueue() {
    if (!LittleFS.exists(QUEUE_FILE)) return;
    File f = LittleFS.open(QUEUE_FILE, "r");
    if (!f) return;
    String remain = "";
    int skip = QUEUE_TRIM;
    while (f.available()) {
        String line = f.readStringUntil('\n');
        if (skip > 0) { skip--; continue; }
        remain += line + "\n";
    }
    f.close();
    File w = LittleFS.open(QUEUE_FILE, "w");
    if (w) { w.print(remain); w.close(); }
}

void enqueue(const String &json) {
    if (queueSize() > QUEUE_MAX) trimQueue();
    File f = LittleFS.open(QUEUE_FILE, "a");
    if (f) { f.println(json); f.close(); }
}

void drainQueue() {
    if (!mqttClient.connected()) return;
    if (!LittleFS.exists(QUEUE_FILE)) return;
    File f = LittleFS.open(QUEUE_FILE, "r");
    if (!f) return;
    int sent = 0;
    String remain = "";
    while (f.available()) {
        String line = f.readStringUntil('\n');
        line.trim();
        if (line.length() == 0) continue;
        if (mqttClient.publish(TOPIC_DATA, line.c_str())) sent++;
        else remain += line + "\n";
        esp_task_wdt_reset();
    }
    f.close();
    if (remain.length() > 0) {
        File w = LittleFS.open(QUEUE_FILE, "w");
        if (w) { w.print(remain); w.close(); }
    } else {
        LittleFS.remove(QUEUE_FILE);
    }
    if (sent > 0) {
        g_tx_count += sent;
        Serial.printf("[Q] Drained %d\n", sent);
    }
}

// ============================================================
// ================== LORA ====================================
// ============================================================
bool loraSendCmd(const String &cmd, uint32_t wait_ms = 300) {
    while (LoRaSerial.available()) LoRaSerial.read();
    LoRaSerial.print(cmd);
    LoRaSerial.print("\r\n");
    String resp = "";
    uint32_t start = millis();
    while (millis() - start < wait_ms) {
        if (LoRaSerial.available()) {
            String line = LoRaSerial.readStringUntil('\n');
            line.trim();
            if (line.length() > 0) { resp += line; resp += "\n"; }
        }
        esp_task_wdt_reset();
    }
    if (resp.indexOf("ERROR") >= 0) return false;
    if (resp.length() == 0)         return false;
    return true;
}

bool loraInit() {
    // FIX CRASH: begin() chỉ 1 lần duy nhất
    static bool hw_inited = false;
    Serial.print("[LoRa] Init...");

    if (!hw_inited) {
        LoRaSerial.begin(9600, SERIAL_8N1, LORA_RX_PIN, LORA_TX_PIN);
        LoRaSerial.setTimeout(200);
        hw_inited = true;
        delay(500);
    }

    while (LoRaSerial.available()) LoRaSerial.read();
    loraSendCmd("+++", 500);
    if (!loraSendCmd("AT+CADDRSET=" + String(LORA_LOCAL_ADDR), 500)) {
        Serial.println(" FAIL CADDRSET"); return false;
    }
    if (!loraSendCmd("AT+CRXS=923000000,3,0,1,0", 500)) {
        Serial.println(" FAIL CRXS"); return false;
    }

    delay(500);
    while (LoRaSerial.available()) LoRaSerial.read();
    g_last_rx_ms = millis();
    Serial.println(" OK");
    return true;
}

// ============================================================
// ================== EXTRACT =================================
// ============================================================
String extractNodeId(const String &line) {
    if (line.startsWith("{")) {
        int p = line.indexOf("\"id\":\"");
        if (p < 0) return "";
        int e = line.indexOf("\"", p + 6);
        if (e <= p) return "";
        return line.substring(p + 6, e);
    }
    int s1 = line.indexOf('|');
    if (s1 <= 0) return "";
    return line.substring(0, s1);
}

String extractTs(const String &line) {
    if (line.startsWith("{")) {
        int p = line.indexOf("\"ts\":\"");
        if (p < 0) return "";
        int e = line.indexOf("\"", p + 6);
        if (e <= p) return "";
        return line.substring(p + 6, e);
    }
    int s1 = line.indexOf('|');
    if (s1 < 0) return "";
    int s2 = line.indexOf('|', s1 + 1);
    if (s2 < 0) return "";
    return line.substring(s1 + 1, s2);
}

String extractMarker(const String &line) {
    int s1 = line.indexOf('|');
    if (s1 < 0) return "";
    int s2 = line.indexOf('|', s1 + 1);
    if (s2 < 0) return "";
    int s3 = line.indexOf('|', s2 + 1);
    if (s3 < 0) return "";
    return line.substring(s2 + 1, s3);
}

// ============================================================
// ================== PUBLISH PAYLOAD (dedup + queue) =========
// ============================================================
void publishPayload(const String &payload, const String &key, const char* tag) {
    bool same_key  = (key.length() > 2) && (key == last_key);
    bool in_window = (millis() - last_ts_time) < DEDUP_WINDOW_MS;

    if (same_key && in_window) {
        g_dedup_count++;
        Serial.printf("[RX#%u] %s DEDUP\n", g_rx_count, tag);
        return;
    }

    last_key     = key;
    last_ts_time = millis();

    if (mqttPublish(TOPIC_DATA, payload)) {
        g_tx_count++;
        Serial.printf("[RX#%u] %s TX OK len=%d\n", g_rx_count, tag, payload.length());
    } else {
        enqueue(payload);
        g_fail_count++;
        Serial.printf("[RX#%u] %s QUEUE\n", g_rx_count, tag);
    }
}

// ============================================================
// ================== HANDLE LINE =============================
// ============================================================
void handleLine(String line) {
    line.trim();
    if (line.length() == 0) return;
    g_rx_count++;
    g_last_rx_ms = millis();

    // ===== Skip notification lines =====
    if (line == "[sy;1]")          return;
    if (line == "OnRxDone")        return;
    if (line == "Recv:")           return;
    if (line.startsWith("from: ")) return;

    // ===== RSSI line — kết thúc pending B (parse cả rssi + snr) =====
    if (line.startsWith("rssi")) {
        Serial.printf("[LORA RSSI RAW] <%s>\n", line.c_str());

        // ==== Tách RSSI ====
        int rssi_val = 0;
        int rssi_eq = line.indexOf('=');
        if (rssi_eq >= 0) {
            String s = line.substring(rssi_eq + 1);
            int comma = s.indexOf(',');
            if (comma >= 0) s = s.substring(0, comma);
            s.trim();
            rssi_val = s.toInt();
        }

        // ==== Tách SNR (nếu có) ====
        int snr_val = 0;
        bool has_snr = false;
        int snr_pos = line.indexOf("snr");
        if (snr_pos >= 0) {
            int snr_eq = line.indexOf('=', snr_pos);
            if (snr_eq >= 0) {
                String s2 = line.substring(snr_eq + 1);
                s2.trim();
                int cut = 0;
                while (cut < s2.length() &&
                       (s2[cut] == '-' || (s2[cut] >= '0' && s2[cut] <= '9'))) cut++;
                if (cut > 0) {
                    snr_val = s2.substring(0, cut).toInt();
                    has_snr = true;
                }
            }
        }

        Serial.printf("[RSSI PARSED] rssi=%d dBm, snr=%d dB (has_snr=%d)\n",
                      rssi_val, snr_val, has_snr);

        // ==== Sanity check ====
        if (rssi_val > 0) {
            Serial.printf("[RSSI WARN] rssi=%d duong — KHONG hop le, skip\n", rssi_val);
            return;
        }

        if (pending_B_payload.length() > 0) {
            // Payload cuối: node_id|ts|...|rssi|snr
            String final_payload = pending_B_payload + "|" + String(rssi_val);
            if (has_snr) final_payload += "|" + String(snr_val);

            String key = pending_B_node_id + ":" + pending_B_ts + ":B";
            String tag = pending_B_node_id + "/" + pending_B_ts + "/B(rssi=" +
                         String(rssi_val) +
                         (has_snr ? ",snr=" + String(snr_val) : "") + ")";

            publishPayload(final_payload, key, tag.c_str());

            pending_B_payload = "";
            pending_B_node_id = "";
            pending_B_ts = "";
            pending_B_time = 0;
        } else {
            Serial.println("[RSSI WARN] Khong co pending B — RSSI bi bo qua");
        }
        return;
    }

    // ===== ERROR =====
    if (line.startsWith("ERROR:")) {
        Serial.printf("[RX#%u] ERROR: %s\n", g_rx_count, line.c_str());
        mqttPublish(TOPIC_ERROR, line);
        return;
    }

    // ===== Payload validate =====
    bool is_json = line.startsWith("{");
    bool is_csv  = line.indexOf('|') >= 0;
    if (!is_json && !is_csv) {
        g_fail_count++;
        Serial.printf("[RX#%u] SKIP len=%d: %.50s\n", g_rx_count, line.length(), line.c_str());
        return;
    }

    String node_id = extractNodeId(line);
    String ts      = extractTs(line);
    String marker  = extractMarker(line);

    // ===== Gói B — chờ RSSI+SNR, chưa publish =====
    if (marker == "B") {
        pending_B_payload = line;
        pending_B_node_id = node_id;
        pending_B_ts      = ts;
        pending_B_time    = millis();
        Serial.printf("[RX#%u] B pending (cho rssi+snr)\n", g_rx_count);
        return;
    }

    // ===== Gói A (hoặc gói khác) — publish ngay =====
    String key = node_id + ":" + ts + ":" + marker;
    String tag = node_id + "/" + ts + "/" + marker;
    publishPayload(line, key, tag.c_str());
}

// ============================================================
// ================== SETUP ===================================
// ============================================================
void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== GATE ESP32 ===");

    esp_task_wdt_init(WDT_TIMEOUT_S, true);
    esp_task_wdt_add(NULL);

    if (!LittleFS.begin(true)) {
        Serial.println("[FS] FAIL");
    } else {
        File f = LittleFS.open(QUEUE_FILE, "a");
        if (f) f.close();
        Serial.printf("[FS] queue=%dB\n", queueSize());
    }

    mqttClient.setServer(MQTT_IP, 1883);
    mqttClient.setBufferSize(2048);
    mqttClient.setKeepAlive(60);
    mqttClient.setSocketTimeout(3);

    Serial.println("[WiFi] Connecting (blocking 15s)...");
    wifiConnectBlocking();

    Serial.println("[MQTT] Connecting (blocking 5 retry)...");
    mqttConnectBlocking();

    if (mqttClient.connected() && queueSize() > 0) drainQueue();

    if (!loraInit()) {
        Serial.println("[FATAL] LoRa init fail - restart 10s");
        delay(10000);
        ESP.restart();
    }

    g_last_summary = millis();
    Serial.println("=== READY ===");
}

// ============================================================
// ================== LOOP ====================================
// ============================================================
void loop() {
    esp_task_wdt_reset();

    wifiTick();
    mqttTick();
    if (mqttClient.connected()) mqttClient.loop();

    // LoRa heartbeat (30 phút không nhận → reinit)
    if (millis() - g_last_rx_ms > LORA_HEARTBEAT_MS) {
        Serial.println("[LoRa] Heartbeat -> reinit");
        if (!loraInit()) {
            Serial.println("[FATAL] LoRa reinit fail - restart 30s");
            delay(30000);
            ESP.restart();
        }
    }

    // Đọc LoRa UART char-by-char
    while (LoRaSerial.available()) {
        char c = LoRaSerial.read();
        if (c == '\n') {
            if (uartBuf.length() > 0) {
                handleLine(uartBuf);
                uartBuf = "";
            }
        } else if (c != '\r') {
            uartBuf += c;
            if (uartBuf.length() > 512) uartBuf = "";
        }
    }

    // Timeout pending B (RSSI không đến trong 5s)
    if (pending_B_payload.length() > 0 &&
        millis() - pending_B_time > PENDING_B_TIMEOUT_MS) {
        Serial.println("[RX] B timeout - publish khong rssi/snr");
        String key = pending_B_node_id + ":" + pending_B_ts + ":B";
        String tag = pending_B_node_id + "/" + pending_B_ts + "/B(timeout)";
        publishPayload(pending_B_payload, key, tag.c_str());
        pending_B_payload = "";
        pending_B_node_id = "";
        pending_B_ts = "";
        pending_B_time = 0;
    }

    // Drain queue định kỳ
    if (mqttClient.connected() && queueSize() > 0 &&
        millis() - g_last_drain > DRAIN_INTERVAL_MS) {
        g_last_drain = millis();
        drainQueue();
    }

    // Summary 5 phút
    if (millis() - g_last_summary > SUMMARY_INTERVAL_MS) {
        g_last_summary = millis();
        Serial.printf("[STAT] RX=%u TX=%u FAIL=%u DEDUP=%u Q=%dB WiFi=%s MQTT=%s\n",
            g_rx_count, g_tx_count, g_fail_count, g_dedup_count, queueSize(),
            WiFi.status() == WL_CONNECTED ? "OK" : "FAIL",
            mqttClient.connected() ? "OK" : "FAIL");
    }

    delay(10);
}