#include "lora.h"

#define DBG Serial3

#define LORA_LOCAL_ADDR   1
#define LORA_TARGET_ADDR  2

#define LORA_FREQ   923000000UL
#define LORA_DR     3
#define LORA_BW     0
#define LORA_CR     1
#define LORA_PWR    22
#define LORA_IQ     0

#define TX_TIMEOUT_MS     5000
#define RST_LORA          PA8

static Stream* g_serial = nullptr;
static bool    g_ready  = false;
static uint32_t g_tx_ok   = 0;
static uint32_t g_tx_fail = 0;

static void log_ts() {
    uint32_t ms = millis();
    DBG.print('[');
    DBG.print(ms / 1000);
    DBG.print('.');
    if (ms % 1000 < 100) DBG.print('0');
    if (ms % 1000 < 10)  DBG.print('0');
    DBG.print(ms % 1000);
    DBG.print("] ");
}

static void flush_rx() {
    if (!g_serial) return;
    while (g_serial->available()) g_serial->read();
}

static void hw_reset_lora() {
    pinMode(RST_LORA, OUTPUT);
    digitalWrite(RST_LORA, LOW);
    delay(200);
    digitalWrite(RST_LORA, HIGH);
    delay(2500);
    flush_rx();
}

static bool lora_cmd(const String &cmd, uint32_t wait_ms = 300) {
    if (!g_serial) return false;
    flush_rx();
    log_ts(); DBG.print(">> "); DBG.println(cmd);
    g_serial->print(cmd);
    g_serial->print("\r\n");

    String resp = "";
    uint32_t start = millis();
    while (millis() - start < wait_ms) {
        if (g_serial->available()) {
            String line = g_serial->readStringUntil('\n');
            line.trim();
            if (line.length() > 0) {
                log_ts(); DBG.print("<< "); DBG.println(line);
                resp += line;
                resp += "\n";
            }
        }
    }
    if (resp.indexOf("ERROR") >= 0) {
        log_ts(); DBG.println("!! ERROR in response");
        return false;
    }
    if (resp.length() == 0) {
        log_ts(); DBG.println("!! No response");
        return false;
    }
    return true;
}

static bool lora_wait_tx_done(uint32_t timeout_ms) {
    if (!g_serial) return false;
    uint32_t start = millis();
    bool got_done = false;
    bool got_send = false;

    while (millis() - start < timeout_ms) {
        if (g_serial->available()) {
            String line = g_serial->readStringUntil('\n');
            line.trim();
            if (line.length() > 0) {
                log_ts(); DBG.print("<< "); DBG.println(line);

                if (line.indexOf("OnTxDone") >= 0) got_done = true;
                if (line.indexOf("send data:") >= 0) {
                    got_send = true;
                    int idx = line.indexOf("send data:");
                    String hex_part = line.substring(idx + 10);
                    hex_part.trim();
                    int n_bytes = 0;
                    for (unsigned int i = 0; i < hex_part.length(); i++) {
                        if (hex_part[i] == ' ') n_bytes++;
                    }
                    if (hex_part.length() > 0) n_bytes++;
                    log_ts(); DBG.print("[TX] Packet = ");
                    DBG.print(n_bytes); DBG.println(" bytes");
                }
                if (line.indexOf("ERROR") >= 0) {
                    log_ts(); DBG.println("[TX] ERROR notification");
                    return false;
                }
                if (got_done && !got_send) {
                    delay(50);
                    continue;
                }
                if (got_done && got_send) return true;
            }
        }
    }
    if (got_done) {
        log_ts(); DBG.println("[TX] OnTxDone (thieu send data, van OK)");
        return true;
    }
    return false;
}

bool LoRa_Init_TX(Stream* serial) {
    g_serial = serial;
    g_ready  = false;
    g_tx_ok = 0;
    g_tx_fail = 0;

    if (!g_serial) return false;

    DBG.println("\n[LoRa] === INIT TX ===");
    DBG.println("[LoRa] HW reset (PA8 toggle)...");
    hw_reset_lora();

    if (!lora_cmd("AT+CADDRSET=" + String(LORA_LOCAL_ADDR), 500)) {
        DBG.println("[LoRa] FAIL: CADDRSET khong echo");
        return false;
    }
    if (!lora_cmd("AT+CTXADDRSET=" + String(LORA_TARGET_ADDR), 500)) {
        DBG.println("[LoRa] FAIL: CTXADDRSET khong echo");
        return false;
    }

    String ctx = "AT+CTX=";
    ctx += String(LORA_FREQ); ctx += ",";
    ctx += String(LORA_DR);   ctx += ",";
    ctx += String(LORA_BW);   ctx += ",";
    ctx += String(LORA_CR);   ctx += ",";
    ctx += String(LORA_PWR);  ctx += ",";
    ctx += String(LORA_IQ);

    if (!lora_cmd(ctx, 1500)) {
        DBG.println("[LoRa] FAIL: AT+CTX khong echo");
        return false;
    }

    delay(500);
    flush_rx();
    DBG.println("[LoRa] Transparent TX mode ON");

    g_ready = true;
    return true;
}

bool LoRa_IsReady() {
    return g_ready;
}

static uint32_t send_one(const char* payload) {
    if (!g_serial) return 0;
    int len = strlen(payload);

    log_ts();
    DBG.print("TX ("); DBG.print(len); DBG.print("B): ");
    for (int i = 0; i < len && i < 40; i++) DBG.print(payload[i]);
    if (len > 40) DBG.print("...");
    DBG.println();

    flush_rx();

    uint32_t t_start = millis();
    g_serial->print(payload);
    g_serial->print("\r\n");

    bool ok = lora_wait_tx_done(TX_TIMEOUT_MS);
    uint32_t elapsed = millis() - t_start;

    if (ok) {
        g_tx_ok++;
        log_ts(); DBG.print("[TX] DONE "); DBG.print(elapsed); DBG.println("ms");
        return elapsed;
    } else {
        g_tx_fail++;
        log_ts(); DBG.print("[TX] FAIL/Timeout "); DBG.print(elapsed); DBG.println("ms");
        return 0;
    }
}

bool LoRa_SendBurst(const char* data, int n_packets, uint32_t spacing_ms) {
    if (!g_ready || !g_serial || !data) return false;

    for (int i = 0; i < n_packets; i++) {
        uint32_t elapsed = send_one(data);
        if (i < n_packets - 1) {
            if (elapsed > 0 && elapsed < spacing_ms) {
                delay(spacing_ms - elapsed);
            } else if (elapsed == 0) {
                delay(spacing_ms);
            }
        }
    }

    log_ts(); DBG.print("[BURST] OK="); DBG.print(g_tx_ok);
    DBG.print(" FAIL="); DBG.println(g_tx_fail);
    return (g_tx_fail == 0);
}