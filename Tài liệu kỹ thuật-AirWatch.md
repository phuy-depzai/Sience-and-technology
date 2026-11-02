# Hardware

esp32
```cpp
// ============================================================
// ESP32 GATEWAY — AirWatch
// Chức năng: Nhận JSON từ STM32 qua UART2 → publish MQTT lên server
//            Sinh pass mới khi STM32 báo có unlock/lock → gửi ngược lại
// Chạy safe mode: không dùng delay() chặn, chỉ dùng millis() timer
// ============================================================

#include <WiFi.h>
#include <PubSubClient.h>

// ===== CHÂN UART2 KẾT NỐI STM32 =====
// RX2 = GPIO16 nhận từ TX STM32, TX2 = GPIO17 gửi xuống RX STM32
#define RXD2  16
#define TXD2  17

// ===== CẤU HÌNH MẠNG =====
// WiFi 2.4GHz (ESP32 không hỗ trợ 5GHz)
const char* WIFI_SSID = "Ken Lun 2.4G";
const char* WIFI_PASS = "khongcomatkhau1308";

// ===== CẤU HÌNH MQTT BROKER =====
// Server là VPS của dự án, port 1883 = MQTT không TLS
const char* MQTT_SERVER = "103.161.17.249";
const int   MQTT_PORT   = 1883;
const char* MQTT_USER   = "airwatch";     // user Mosquitto đã tạo
const char* MQTT_PASS   = "1804H";        // pass tương ứng
const char* MQTT_CLIENT = "esp32_gateway_01"; // client ID phải unique

// ===== TOPIC MQTT =====
// TOPIC_DATA: STM32 gửi data cảm biến → server (Node-RED insert DB)
// TOPIC_PASS: ESP32 báo có pass mới sinh → server (Node-RED lưu pass_history)
const char* TOPIC_DATA = "airwatch/data";
const char* TOPIC_PASS = "airwatch/pass";

// Đối tượng WiFi + MQTT client
WiFiClient espClient;
PubSubClient mqtt(espClient);

// ===== BIẾN TOÀN CỤC =====
String   uart_buf = "";          // Buffer nhận UART từ STM32
uint32_t last_wifi_try = 0;      // Timestamp lần thử WiFi gần nhất (non-blocking)
uint32_t last_mqtt_try = 0;      // Timestamp lần thử MQTT gần nhất

// ===== SINH PASS NGẪU NHIÊN 6 SỐ =====
// Dùng random(100000, 999999) → 6 chữ số từ 100000-999999
// randomSeed đã được set trong setup() từ analogRead(0) (nhiễu ADC)
// Trả về String để tiện nối vào JSON
String gen_random_pass() {
    return String(random(100000, 999999));
}

// ===== XỬ LÝ SỰ KIỆN PASS =====
// Được gọi khi STM32 gửi {"useda":1} hoặc {"usedb":1}
// Đầu vào: json = raw string từ STM32, level = 'A' hoặc 'B'
// Việc làm:
//   1. Sinh pass mới 6 số
//   2. Gửi xuống STM32 qua UART2 (format {"cmd":"set_pass",...})
//   3. Publish MQTT lên topic airwatch/pass để server lưu DB
void handle_pass_event(String json, char level) {
    String newPass = gen_random_pass();
    Serial.print("[PASS] Cap "); Serial.print(level);
    Serial.print(" -> Pass moi: "); Serial.println(newPass);

    // === BƯỚC 1: Gửi lệnh set_pass xuống STM32 ===
    // Format JSON cố định, STM32 parse và ghi vào EEPROM
    String cmd = "{\"cmd\":\"set_pass\",\"level\":\"";
    cmd += level; cmd += "\",\"pass\":\""; cmd += newPass; cmd += "\"}";
    Serial2.println(cmd);
    Serial.println("[UART -> STM32] " + cmd);

    // === BƯỚC 2: Publish MQTT lên server ===
    // CHỈ publish khi mqtt.connected() để tránh mất gói tin
    // Format: {"event":"pass_used","level":"A","new_pass":"123456"}
    if (mqtt.connected()) {
        String log = "{\"event\":\"pass_used\",\"level\":\"";
        log += level; log += "\",\"new_pass\":\""; log += newPass; log += "\"}";
        mqtt.publish(TOPIC_PASS, log.c_str());
        Serial.println("[MQTT] Da gui pass moi len Server");
    } else {
        // Nếu MQTT đang mất kết nối → pass mới đã ghi EEPROM nhưng server chưa biết
        // Đây là edge case: mất mạng đúng lúc unlock
        Serial.println("[MQTT] Khong the gui, MQTT dang mat ket noi!");
    }
}

// ===== SETUP =====
void setup() {
    // Debug Serial (UART0) @ 115200 → dùng Serial Monitor
    Serial.begin(115200);

    // UART2 @ 115200 nối với STM32 (RX2=16, TX2=17)
    // SERIAL_8N1 = 8 data bits, no parity, 1 stop bit
    Serial2.begin(115200, SERIAL_8N1, RXD2, TXD2);

    // Seed random từ nhiễu ADC chân 0 → pass ngẫu nhiên thật sự
    randomSeed(analogRead(0));

    delay(1000);  // Đợi Serial ổn định để in banner
    Serial.println("\n=== ESP32 Gateway (Safe Mode) ===");

    // === CẤU HÌNH WIFI ===
    WiFi.mode(WIFI_STA);       // Chế độ Station (client), không phải AP
    WiFi.setSleep(false);      // Tắt WiFi power save → kết nối ổn định hơn (tốn pin hơn)
    WiFi.setAutoReconnect(true); // Tự reconnect khi mất WiFi

    // === CẤU HÌNH MQTT ===
    mqtt.setServer(MQTT_SERVER, MQTT_PORT);
    mqtt.setKeepAlive(60);     // Ping broker mỗi 60s để giữ kết nối
}

// ===== LOOP (không dùng delay chặn) =====
void loop() {
    // === PHẦN 1: XỬ LÝ WIFI ===
    // Nếu chưa kết nối → thử connect lại mỗi 10 giây
    // Dùng millis() thay delay() để không block chip
    if (WiFi.status() != WL_CONNECTED) {
        if (millis() - last_wifi_try > 10000) {  // 10s
            last_wifi_try = millis();
            Serial.println("[WiFi] Dang ket noi...");
            WiFi.disconnect();  // Reset trạng thái trước khi begin
            WiFi.begin(WIFI_SSID, WIFI_PASS);
        }
    } else {
        // === PHẦN 2: XỬ LÝ MQTT (chỉ khi WiFi đã OK) ===
        if (!mqtt.connected()) {
            if (millis() - last_mqtt_try > 5000) {  // 5s
                last_mqtt_try = millis();
                Serial.print("[MQTT] Dang ket noi...");
                // Thử connect với user/pass/client_id
                if (mqtt.connect(MQTT_CLIENT, MQTT_USER, MQTT_PASS)) {
                    Serial.println(" OK");
                } else {
                    // rc = return code, xem bảng mã lỗi PubSubClient
                    // 4 = timeout, 5 = unauthorized, ...
                    Serial.print(" FAIL, rc="); Serial.println(mqtt.state());
                }
            }
        } else {
            // Chỉ gọi mqtt.loop() khi đã connected → giữ kết nối + nhận msg
            mqtt.loop();
        }
    }

    // === PHẦN 3: ĐỌC UART TỪ STM32 ===
    // Đọc từng byte, gom lại đến khi gặp '\n' thì xử lý cả gói
    while (Serial2.available()) {
        char c = Serial2.read();
        if (c == '\n') {
            uart_buf.trim();  // Bỏ \r, khoảng trắng 2 đầu
            if (uart_buf.length() > 0) {
                // Debug ra màn hình
                Serial.print("[STM32] <- ");
                Serial.println(uart_buf);

                // === PHÂN LOẠI GÓI TIN ===
                // 1. Có "useda" → STM32 báo unlock cấp A
                if (uart_buf.indexOf("\"useda\"") >= 0) {
                    handle_pass_event(uart_buf, 'A');
                }
                // 2. Có "usedb" → unlock cấp B
                else if (uart_buf.indexOf("\"usedb\"") >= 0) {
                    handle_pass_event(uart_buf, 'B');
                }
                // 3. StartsWith "{" → gói JSON data cảm biến bình thường
                //    Publish lên MQTT topic airwatch/data
                else if (uart_buf.startsWith("{")) {
                    if (mqtt.connected()) {
                        mqtt.publish(TOPIC_DATA, uart_buf.c_str());
                    }
                }
            }
            uart_buf = "";  // Reset buffer cho gói tiếp theo
        }
        else if (c != '\r') {
            // Bỏ qua \r (Windows line ending)
            uart_buf += c;
            // Chống tràn RAM: nếu buffer > 512 bytes mà chưa gặp '\n' → reset
            // 512 bytes đủ cho 1 gói JSON data (khoảng 200 bytes)
            if (uart_buf.length() > 512) uart_buf = "";
        }
    }
}
```

stm32
```cpp
// ============================================================
// app.js — Frontend logic chính
// Chức năng: Fetch data → render cards + charts + AQI, WS realtime,
//            admin panel (debug/log/notes/users/db/incidents)
// Auth token lưu localStorage, mọi API admin gửi header X-Auth-Token
// ============================================================

const API = 'https://airwatch.io.vn';  // Base URL backend

// Format "X phút trước" từ số phút
function fmtAgo(min) {
    if (min < 1) return 'vừa xong';
    if (min < 60) return min + ' phút trước';
    if (min < 1440) return Math.floor(min / 60) + ' giờ trước';
    const d = Math.floor(min / 1440);
    const h = Math.floor((min % 1440) / 60);
    return h > 0 ? d + 'd ' + h + 'h trước' : d + ' ngày trước';
}

// Biến global giữ instance Chart.js (destroy trước khi tạo mới để tránh leak)
let chartEnv = null, chartVolt = null, chartCurr = null,
    chartPm = null, chartGas = null, chartCo = null;

// Lấy ngày hiện tại theo giờ VN (UTC+7) — dùng cho date-picker default
function getLocalDate() {
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 3600 * 1000));
    return vnTime.getUTCFullYear() + '-' +
           String(vnTime.getUTCMonth() + 1).padStart(2, '0') + '-' +
           String(vnTime.getUTCDate()).padStart(2, '0');
}

// Convert "2026-10-26 13:07:05" → milliseconds (cho Chart.js time scale)
function tsToMs(ts) {
    if (!ts) return 0;
    return new Date(String(ts).replace(' ', 'T')).getTime();
}

// ===== INIT (chạy khi DOM ready) =====
// Flow: checkAuth → hiển thị/ẩn admin elements → load data → render
(async () => {
    await checkAuth();  // Hàm ở auth-check.js, set currentRole nếu có token

    const btn = document.getElementById('auth-btn');
    const action = document.getElementById('auth-action');

    // Head admin (role cao nhất) thấy thêm 1 số element
    if (typeof isHeadAdmin === 'function' && isHeadAdmin()) {
        document.querySelectorAll('.head-admin-only').forEach(el => el.style.display = '');
    } else {
        document.querySelectorAll('.head-admin-only').forEach(el => el.style.display = 'none');
    }

    // Admin thường thấy các element .admin-only
    if (isAdmin()) {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
        if (btn) btn.textContent = 'Admin ▾';
        if (action) action.textContent = '🚪 Đăng xuất';
        loadSystemData();  // Load count DB + last seen + role
    } else {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
        if (btn) btn.textContent = 'Guest ▾';
        if (action) action.textContent = '🔑 Đăng nhập';
    }

    applyTheme();  // Dark/light từ localStorage

    // Set date-picker = hôm nay, fetch data
    const today = getLocalDate();
    const dateInput = document.getElementById('date-picker');
    if (dateInput) dateInput.value = today;
    const data = await fetchDataByDate(today);
    updateCards(data);  // Render cards số liệu
    // Render charts nếu đang ở dashboard (có canvas chart-env)
    if (typeof Chart !== 'undefined' && document.getElementById('chart-env')) renderCharts(data);
})();

// ===== UI HELPERS =====
function toggleMenu(e) { e.stopPropagation(); const m = document.getElementById('dropdown-menu'); if (m) m.classList.toggle('open'); }
document.addEventListener('click', () => { const m = document.getElementById('dropdown-menu'); if (m) m.classList.remove('open'); });
function handleAuthAction() { if (isAdmin()) logout(); else window.location.href = '/'; }

function toggleTheme() {
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    updateThemeLabel();
    // Redraw charts vì màu grid/text phụ thuộc theme
    const di = document.getElementById('date-picker');
    if (di && di.value) loadByDate();
}

function applyTheme() {
    const s = localStorage.getItem('theme') || 'dark';
    if (s === 'light') document.body.classList.add('light');
    else document.body.classList.remove('light');
    updateThemeLabel();
}

function updateThemeLabel() {
    const i = document.getElementById('theme-icon'), l = document.getElementById('theme-label');
    if (!i || !l) return;
    if (document.body.classList.contains('light')) {
        i.textContent = '☀️'; l.textContent = 'Chế độ sáng';
    } else {
        i.textContent = '🌙'; l.textContent = 'Chế độ tối';
    }
}

// ===== API CALLS =====
// Load thông tin hệ thống (chỉ admin)
async function loadSystemData() {
    try {
        const r = await fetch(API + '/api/system?token=' + getToken());
        const d = await r.json();
        const c = document.getElementById('db-count');
        const s = document.getElementById('last-seen');
        const ro = document.getElementById('role-display');
        if (c) c.textContent = d.count || '--';
        if (s) s.textContent = d.last_seen || '--';
        if (ro) ro.textContent = currentRole;
    } catch(e) { console.error('System data fail:', e); }
}

// Fetch data cả ngày (dùng cho chart)
async function fetchDataByDate(dateStr) {
    try {
        const r = await fetch(API + '/api/data-by-date?date=' + dateStr);
        return await r.json();
    } catch(e) {
        console.error('API-by-date fail:', e);
        return [];
    }
}

// Cập nhật badge LIVE/OFFLINE
function setStatus(online) {
    const s = document.getElementById('status');
    if (!s) return;
    s.className = online ? 'status' : 'status offline';
    s.textContent = online ? 'LIVE' : 'OFFLINE';
}

// ===== AQI — tính theo QĐ 1459/TCMT =====
// calcSubIndex: interpolate tuyến tính giữa 2 breakpoint
// Công thức: I = (I_high - I_low)/(C_high - C_low) * (C - C_low) + I_low
function calcSubIndex(c, bp) {
    if (c <= bp[0][0]) return bp[0][2];
    for (let i = 0; i < bp.length; i++) {
        const [cL, cH, iL, iH] = bp[i];
        if (c >= cL && c <= cH) {
            if (cH === cL) return iH;
            return Math.round((iH - iL) / (cH - cL) * (c - cL) + iL);
        }
    }
    return 500;  // vượt max → 500
}

// Breakpoints theo QĐ 1459/TCMT (12/11/2019)
// Format: [C_low, C_high, I_low, I_high]
const PM25_BP = [[0,25,0,50],[25,50,51,100],[50,80,101,150],[80,150,151,200],[150,250,201,300],[250,500,301,500]];
const PM10_BP = [[0,50,0,50],[50,150,51,100],[150,250,101,150],[250,350,151,200],[350,430,201,300],[430,600,301,500]];
const CO_BP = [[0,8.7,0,50],[8.7,26,51,100],[26,39,101,150],[39,52,151,200],[52,79,201,300],[79,131,301,500]];

// AQI tổng = max(AQI_PM25, AQI_PM10, AQI_CO)
function calcAQI(pm25, pm10, co) {
    return Math.max(
        calcSubIndex(pm25||0, PM25_BP),
        calcSubIndex(pm10||0, PM10_BP),
        calcSubIndex(co||0, CO_BP)
    );
}

// Render AQI lên banner (số + text + vòng tròn progress)
function updateAQI(pm25, pm10, co) {
    if (pm25 === undefined || pm10 === undefined) return;
    const aqi = calcAQI(pm25, pm10, co);
    const aqiEl = document.getElementById('aqi');
    const aqiText = document.getElementById('aqi-text');
    const progress = document.getElementById('aqi-progress');
    let text = '', color = '';
    // Màu theo bậc AQI
    if (aqi <= 50)        { text = 'Tốt';        color = '#4CAF50'; }
    else if (aqi <= 100)  { text = 'Trung bình'; color = '#FFEB3B'; }
    else if (aqi <= 150)  { text = 'Kém';        color = '#FF9800'; }
    else if (aqi <= 200)  { text = 'Xấu';        color = '#F44336'; }
    else if (aqi <= 300)  { text = 'Rất xấu';    color = '#9C27B0'; }
    else                  { text = 'Nguy hại';   color = '#7B1FA2'; }

    if (aqiEl) { aqiEl.textContent = aqi; aqiEl.style.color = color; }
    if (aqiText) {
        aqiText.textContent = text;
        aqiText.style.backgroundColor = color;
        // Chữ đen trên nền vàng cho dễ đọc
        aqiText.style.color = (color === '#FFEB3B') ? '#000' : '#fff';
    }
    // Vòng tròn SVG: dashoffset theo % của 300 (max scale)
    if (progress) {
        const circ = 2 * Math.PI * 90;  // r=90
        const pct = Math.min(aqi / 300, 1);
        progress.style.strokeDashoffset = circ - (pct * circ);
        progress.style.stroke = color;
    }
}

// ===== RENDER CARDS (số liệu) =====
function updateCards(data) {
    // Trường hợp không có data → xóa hết card về '--'
    if (!data.length) {
        setStatus(false);
        ['temp','hum','volt','curr','pm1','pm25','pm10','aqi','co','voc_pct','nox_pct']
            .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '--'; });
        return;
    }
    const last = data[data.length - 1];  // Data mới nhất

    // Hàm animate số (countup từ giá trị cũ → mới, 800ms)
    const animateNumber = (id, nv, dec = 0, scale = 1) => {
        const el = document.getElementById(id); if (!el) return;
        if (nv === undefined || nv === null) { el.textContent = '--'; return; }
        const target = nv * scale;
        // Đọc giá trị hiện tại trên UI để bắt đầu animation từ đó
        const cur = el.textContent.replace(/[^0-9.-]+/g, '');
        const start = cur && !isNaN(parseFloat(cur)) ? parseFloat(cur) : 0;
        if (Math.abs(start - target) < 0.01) { el.textContent = target.toFixed(dec); return; }
        const st = performance.now(), dur = 800;
        el.style.transition = 'transform 0.3s';
        el.style.transform = 'scale(1.15)';  // Zoom nhẹ khi bắt đầu
        el.style.display = 'inline-block';
        const upd = (ct) => {
            const prog = Math.min((ct - st) / dur, 1);
            const ease = 1 - Math.pow(1 - prog, 4);  // easeOutQuart
            el.textContent = (start + (target - start) * ease).toFixed(dec);
            if (prog < 1) requestAnimationFrame(upd);
            else { el.textContent = target.toFixed(dec); el.style.transform = 'scale(1)'; }
        };
        requestAnimationFrame(upd);
    };

    // Animate từng card
    animateNumber('temp', last.t, 2);
    animateNumber('hum', last.h, 2);
    animateNumber('volt', last.v, 3);
    animateNumber('curr', last.i, 2, 1000);  // A → mA (×1000)
    animateNumber('pm1', last.pm1, 0);
    animateNumber('pm25', last.pm25, 0);
    animateNumber('pm10', last.pm10, 0);
    animateNumber('co', last.co, 2);
    animateNumber('voc_pct', last.voc_pct, 1);
    animateNumber('nox_pct', last.nox_pct, 1);

    // Đổi màu chữ theo ngưỡng cảnh báo
    // warn = ngưỡng vàng (bắt đầu bất thường)
    // danger = ngưỡng đỏ (nguy hiểm)
    const setWarnColor = (id, val, warn, danger, defaultColor) => {
        const el = document.getElementById(id);
        if (!el || val === undefined || val === null) return;
        if (val > danger) el.style.color = '#f44336';
        else if (val > warn) el.style.color = '#ff9800';
        else el.style.color = defaultColor;
    };
    // CO: >4ppm vàng, >9ppm đỏ (QCVN 05:2023)
    setWarnColor('co', last.co, 4, 9, '#FF5722');
    // VOC: >105% vàng, >115% đỏ
    setWarnColor('voc_pct', last.voc_pct, 105, 115, '#9C27B0');
    // NOx: >105% vàng, >115% đỏ
    setWarnColor('nox_pct', last.nox_pct, 105, 115, '#00BCD4');

    const u = document.getElementById('updated');
    if (u) u.textContent = last.ts;
    updateAQI(last.pm25, last.pm10, last.co);
    renderGasChart(last.voc_pct, last.nox_pct);
    setStatus(true);
}
```


# Software
app.js
```js
// ============================================================
// app.js — Frontend logic chính
// Chức năng: Fetch data → render cards + charts + AQI, WS realtime,
//            admin panel (debug/log/notes/users/db/incidents)
// Auth token lưu localStorage, mọi API admin gửi header X-Auth-Token
// ============================================================

const API = 'https://airwatch.io.vn';  // Base URL backend

// Format "X phút trước" từ số phút
function fmtAgo(min) {
    if (min < 1) return 'vừa xong';
    if (min < 60) return min + ' phút trước';
    if (min < 1440) return Math.floor(min / 60) + ' giờ trước';
    const d = Math.floor(min / 1440);
    const h = Math.floor((min % 1440) / 60);
    return h > 0 ? d + 'd ' + h + 'h trước' : d + ' ngày trước';
}

// Biến global giữ instance Chart.js (destroy trước khi tạo mới để tránh leak)
let chartEnv = null, chartVolt = null, chartCurr = null,
    chartPm = null, chartGas = null, chartCo = null;

// Lấy ngày hiện tại theo giờ VN (UTC+7) — dùng cho date-picker default
function getLocalDate() {
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 3600 * 1000));
    return vnTime.getUTCFullYear() + '-' +
           String(vnTime.getUTCMonth() + 1).padStart(2, '0') + '-' +
           String(vnTime.getUTCDate()).padStart(2, '0');
}

// Convert "2026-10-26 13:07:05" → milliseconds (cho Chart.js time scale)
function tsToMs(ts) {
    if (!ts) return 0;
    return new Date(String(ts).replace(' ', 'T')).getTime();
}

// ===== INIT (chạy khi DOM ready) =====
// Flow: checkAuth → hiển thị/ẩn admin elements → load data → render
(async () => {
    await checkAuth();  // Hàm ở auth-check.js, set currentRole nếu có token

    const btn = document.getElementById('auth-btn');
    const action = document.getElementById('auth-action');

    // Head admin (role cao nhất) thấy thêm 1 số element
    if (typeof isHeadAdmin === 'function' && isHeadAdmin()) {
        document.querySelectorAll('.head-admin-only').forEach(el => el.style.display = '');
    } else {
        document.querySelectorAll('.head-admin-only').forEach(el => el.style.display = 'none');
    }

    // Admin thường thấy các element .admin-only
    if (isAdmin()) {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
        if (btn) btn.textContent = 'Admin ▾';
        if (action) action.textContent = '🚪 Đăng xuất';
        loadSystemData();  // Load count DB + last seen + role
    } else {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
        if (btn) btn.textContent = 'Guest ▾';
        if (action) action.textContent = '🔑 Đăng nhập';
    }

    applyTheme();  // Dark/light từ localStorage

    // Set date-picker = hôm nay, fetch data
    const today = getLocalDate();
    const dateInput = document.getElementById('date-picker');
    if (dateInput) dateInput.value = today;
    const data = await fetchDataByDate(today);
    updateCards(data);  // Render cards số liệu
    // Render charts nếu đang ở dashboard (có canvas chart-env)
    if (typeof Chart !== 'undefined' && document.getElementById('chart-env')) renderCharts(data);
})();

// ===== UI HELPERS =====
function toggleMenu(e) { e.stopPropagation(); const m = document.getElementById('dropdown-menu'); if (m) m.classList.toggle('open'); }
document.addEventListener('click', () => { const m = document.getElementById('dropdown-menu'); if (m) m.classList.remove('open'); });
function handleAuthAction() { if (isAdmin()) logout(); else window.location.href = '/'; }

function toggleTheme() {
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    updateThemeLabel();
    // Redraw charts vì màu grid/text phụ thuộc theme
    const di = document.getElementById('date-picker');
    if (di && di.value) loadByDate();
}

function applyTheme() {
    const s = localStorage.getItem('theme') || 'dark';
    if (s === 'light') document.body.classList.add('light');
    else document.body.classList.remove('light');
    updateThemeLabel();
}

function updateThemeLabel() {
    const i = document.getElementById('theme-icon'), l = document.getElementById('theme-label');
    if (!i || !l) return;
    if (document.body.classList.contains('light')) {
        i.textContent = '☀️'; l.textContent = 'Chế độ sáng';
    } else {
        i.textContent = '🌙'; l.textContent = 'Chế độ tối';
    }
}

// ===== API CALLS =====
// Load thông tin hệ thống (chỉ admin)
async function loadSystemData() {
    try {
        const r = await fetch(API + '/api/system?token=' + getToken());
        const d = await r.json();
        const c = document.getElementById('db-count');
        const s = document.getElementById('last-seen');
        const ro = document.getElementById('role-display');
        if (c) c.textContent = d.count || '--';
        if (s) s.textContent = d.last_seen || '--';
        if (ro) ro.textContent = currentRole;
    } catch(e) { console.error('System data fail:', e); }
}

// Fetch data cả ngày (dùng cho chart)
async function fetchDataByDate(dateStr) {
    try {
        const r = await fetch(API + '/api/data-by-date?date=' + dateStr);
        return await r.json();
    } catch(e) {
        console.error('API-by-date fail:', e);
        return [];
    }
}

// Cập nhật badge LIVE/OFFLINE
function setStatus(online) {
    const s = document.getElementById('status');
    if (!s) return;
    s.className = online ? 'status' : 'status offline';
    s.textContent = online ? 'LIVE' : 'OFFLINE';
}

// ===== AQI — tính theo QĐ 1459/TCMT =====
// calcSubIndex: interpolate tuyến tính giữa 2 breakpoint
// Công thức: I = (I_high - I_low)/(C_high - C_low) * (C - C_low) + I_low
function calcSubIndex(c, bp) {
    if (c <= bp[0][0]) return bp[0][2];
    for (let i = 0; i < bp.length; i++) {
        const [cL, cH, iL, iH] = bp[i];
        if (c >= cL && c <= cH) {
            if (cH === cL) return iH;
            return Math.round((iH - iL) / (cH - cL) * (c - cL) + iL);
        }
    }
    return 500;  // vượt max → 500
}

// Breakpoints theo QĐ 1459/TCMT (12/11/2019)
// Format: [C_low, C_high, I_low, I_high]
const PM25_BP = [[0,25,0,50],[25,50,51,100],[50,80,101,150],[80,150,151,200],[150,250,201,300],[250,500,301,500]];
const PM10_BP = [[0,50,0,50],[50,150,51,100],[150,250,101,150],[250,350,151,200],[350,430,201,300],[430,600,301,500]];
const CO_BP = [[0,8.7,0,50],[8.7,26,51,100],[26,39,101,150],[39,52,151,200],[52,79,201,300],[79,131,301,500]];

// AQI tổng = max(AQI_PM25, AQI_PM10, AQI_CO)
function calcAQI(pm25, pm10, co) {
    return Math.max(
        calcSubIndex(pm25||0, PM25_BP),
        calcSubIndex(pm10||0, PM10_BP),
        calcSubIndex(co||0, CO_BP)
    );
}

// Render AQI lên banner (số + text + vòng tròn progress)
function updateAQI(pm25, pm10, co) {
    if (pm25 === undefined || pm10 === undefined) return;
    const aqi = calcAQI(pm25, pm10, co);
    const aqiEl = document.getElementById('aqi');
    const aqiText = document.getElementById('aqi-text');
    const progress = document.getElementById('aqi-progress');
    let text = '', color = '';
    // Màu theo bậc AQI
    if (aqi <= 50)        { text = 'Tốt';        color = '#4CAF50'; }
    else if (aqi <= 100)  { text = 'Trung bình'; color = '#FFEB3B'; }
    else if (aqi <= 150)  { text = 'Kém';        color = '#FF9800'; }
    else if (aqi <= 200)  { text = 'Xấu';        color = '#F44336'; }
    else if (aqi <= 300)  { text = 'Rất xấu';    color = '#9C27B0'; }
    else                  { text = 'Nguy hại';   color = '#7B1FA2'; }

    if (aqiEl) { aqiEl.textContent = aqi; aqiEl.style.color = color; }
    if (aqiText) {
        aqiText.textContent = text;
        aqiText.style.backgroundColor = color;
        // Chữ đen trên nền vàng cho dễ đọc
        aqiText.style.color = (color === '#FFEB3B') ? '#000' : '#fff';
    }
    // Vòng tròn SVG: dashoffset theo % của 300 (max scale)
    if (progress) {
        const circ = 2 * Math.PI * 90;  // r=90
        const pct = Math.min(aqi / 300, 1);
        progress.style.strokeDashoffset = circ - (pct * circ);
        progress.style.stroke = color;
    }
}

// ===== RENDER CARDS (số liệu) =====
function updateCards(data) {
    // Trường hợp không có data → xóa hết card về '--'
    if (!data.length) {
        setStatus(false);
        ['temp','hum','volt','curr','pm1','pm25','pm10','aqi','co','voc_pct','nox_pct']
            .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '--'; });
        return;
    }
    const last = data[data.length - 1];  // Data mới nhất

    // Hàm animate số (countup từ giá trị cũ → mới, 800ms)
    const animateNumber = (id, nv, dec = 0, scale = 1) => {
        const el = document.getElementById(id); if (!el) return;
        if (nv === undefined || nv === null) { el.textContent = '--'; return; }
        const target = nv * scale;
        // Đọc giá trị hiện tại trên UI để bắt đầu animation từ đó
        const cur = el.textContent.replace(/[^0-9.-]+/g, '');
        const start = cur && !isNaN(parseFloat(cur)) ? parseFloat(cur) : 0;
        if (Math.abs(start - target) < 0.01) { el.textContent = target.toFixed(dec); return; }
        const st = performance.now(), dur = 800;
        el.style.transition = 'transform 0.3s';
        el.style.transform = 'scale(1.15)';  // Zoom nhẹ khi bắt đầu
        el.style.display = 'inline-block';
        const upd = (ct) => {
            const prog = Math.min((ct - st) / dur, 1);
            const ease = 1 - Math.pow(1 - prog, 4);  // easeOutQuart
            el.textContent = (start + (target - start) * ease).toFixed(dec);
            if (prog < 1) requestAnimationFrame(upd);
            else { el.textContent = target.toFixed(dec); el.style.transform = 'scale(1)'; }
        };
        requestAnimationFrame(upd);
    };

    // Animate từng card
    animateNumber('temp', last.t, 2);
    animateNumber('hum', last.h, 2);
    animateNumber('volt', last.v, 3);
    animateNumber('curr', last.i, 2, 1000);  // A → mA (×1000)
    animateNumber('pm1', last.pm1, 0);
    animateNumber('pm25', last.pm25, 0);
    animateNumber('pm10', last.pm10, 0);
    animateNumber('co', last.co, 2);
    animateNumber('voc_pct', last.voc_pct, 1);
    animateNumber('nox_pct', last.nox_pct, 1);

    // Đổi màu chữ theo ngưỡng cảnh báo
    // warn = ngưỡng vàng (bắt đầu bất thường)
    // danger = ngưỡng đỏ (nguy hiểm)
    const setWarnColor = (id, val, warn, danger, defaultColor) => {
        const el = document.getElementById(id);
        if (!el || val === undefined || val === null) return;
        if (val > danger) el.style.color = '#f44336';
        else if (val > warn) el.style.color = '#ff9800';
        else el.style.color = defaultColor;
    };
    // CO: >4ppm vàng, >9ppm đỏ (QCVN 05:2023)
    setWarnColor('co', last.co, 4, 9, '#FF5722');
    // VOC: >105% vàng, >115% đỏ
    setWarnColor('voc_pct', last.voc_pct, 105, 115, '#9C27B0');
    // NOx: >105% vàng, >115% đỏ
    setWarnColor('nox_pct', last.nox_pct, 105, 115, '#00BCD4');

    const u = document.getElementById('updated');
    if (u) u.textContent = last.ts;
    updateAQI(last.pm25, last.pm10, last.co);
    renderGasChart(last.voc_pct, last.nox_pct);
    setStatus(true);
}
// ===== CHART HELPERS =====
// Các hàm này trả về màu phụ thuộc theme (light/dark)
// Gọi mỗi lần render để chart đổi màu khi user toggle theme

function getTextColor()   { return document.body.classList.contains('light') ? '#666' : '#8899a6'; }
function getGridColor()   { return document.body.classList.contains('light') ? '#e0e0e0' : '#2a3040'; }
function getLegendColor() { return document.body.classList.contains('light') ? '#1a1f2e' : '#e7e9ea'; }

// Cấu hình trục X dạng time (Chart.js time scale)
// unit: 'hour' = chia theo giờ, tooltip format "HH:mm:ss dd/MM"
// autoSkip: tự bỏ tick nếu trục quá dày
function timeScaleX() {
    return {
        type: 'time',
        time: {
            unit: 'hour',
            displayFormats: { hour: 'HH:mm', minute: 'HH:mm' },
            tooltipFormat: 'HH:mm:ss dd/MM'
        },
        ticks: { color: getTextColor(), maxTicksLimit: 10, autoSkip: true },
        grid: { color: getGridColor() }
    };
}

// Cấu hình chung cho line chart: 2 trục Y (trái + phải) optional
// t = title trục Y, c = màu trục Y
function baseOptions(t, c) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 1500, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },  // tooltip hiện tất cả dataset tại X
        plugins: { legend: { labels: { color: getLegendColor() } } },
        scales: {
            x: timeScaleX(),
            y: {
                position: 'left',
                ticks: { color: c },
                grid: { color: getGridColor() },
                title: { display: true, text: t, color: c }
            }
        }
    };
}

// Giảm số điểm để vẽ chart nhẹ hơn
// VD: 500 điểm → 80 điểm (giữ nguyên hình dáng trend)
// Thuật toán: chia đều mảng, lấy mẫu tại vị trí round(i * step)
function downsample(d, m) {
    if (d.length <= m) return d;  // ít hơn max → giữ nguyên
    const s = (d.length - 1) / (m - 1);
    const o = [];
    for (let i = 0; i < m; i++) o.push(d[Math.round(i * s)]);
    return o;
}

// Convert mảng object {ts, value} → mảng điểm {x: ms, y: value} cho Chart.js
// k = key cần lấy (t, h, pm25...)
// sc = scale factor (VD: ×1000 để đổi A → mA)
// Xử lý null: nếu value null/undefined → điểm y=null (chart có gap)
function toPoints(a, k, sc) {
    sc = sc || 1;
    return a.map(d => {
        const v = d[k] !== undefined && d[k] !== null ? Number(d[k]) : null;
        return { x: tsToMs(d.ts), y: v !== null ? v * sc : null };
    });
}

// ===== CHART VOC/NOx DẠNG CỘT =====
// Khác với chart line, chart này chỉ hiện giá trị mới nhất (không có timeline)
// Mục đích: dashboard thấy nhanh mức VOC/NOx hiện tại
function renderGasChart(vocPct, noxPct) {
    const canvas = document.getElementById('chart-gas');
    if (!canvas || typeof Chart === 'undefined') return;

    // Màu theo ngưỡng: >110% đỏ, >100% vàng cam, còn lại xanh
    const getColor = (v) => v > 110 ? '#f44336' : v > 100 ? '#ff9800' : '#4CAF50';
    // Fallback 100% nếu null/0
    const v = (vocPct && vocPct > 0) ? vocPct : 100;
    const n = (noxPct && noxPct > 0) ? noxPct : 100;

    // Nếu chart đã tồn tại → chỉ update data (mượt hơn destroy + new)
    if (chartGas) {
        chartGas.data.datasets[0].data = [parseFloat(v.toFixed(1)), parseFloat(n.toFixed(1))];
        chartGas.data.datasets[0].backgroundColor = [getColor(v), getColor(n)];
        chartGas.update();
    } else {
        // Tạo mới lần đầu
        chartGas = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: ['VOC (%)', 'NOx (%)'],
                datasets: [{
                    label: 'So với không khí sạch',
                    data: [parseFloat(v.toFixed(1)), parseFloat(n.toFixed(1))],
                    backgroundColor: [getColor(v), getColor(n)],
                    borderWidth: 0,
                    borderRadius: 6,
                    maxBarThickness: 60  // cột không quá to
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 800 },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => ctx.parsed.y + '% so với nền' } }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        suggestedMax: 130,  // luôn hiện đến 130% để thấy ngưỡng
                        ticks: { color: getTextColor(), callback: (v) => v + '%' },
                        grid: { color: getGridColor() }
                    },
                    x: {
                        barPercentage: 0.5,      // độ rộng cột
                        categoryPercentage: 0.5,
                        ticks: { color: getTextColor() },
                        grid: { display: false }
                    }
                }
            }
        });
    }
}

// ===== CHART CO DẠNG LINE THEO THỜI GIAN =====
// CO là khí độc, cần thấy trend theo giờ
function renderCoChart(data) {
    const canvas = document.getElementById('chart-co');
    if (!canvas || typeof Chart === 'undefined') return;
    // Không có data → destroy chart cũ
    if (!data || !data.length) {
        if (chartCo) { chartCo.destroy(); chartCo = null; }
        return;
    }
    const s = downsample(data, 80);  // max 80 điểm
    if (chartCo) chartCo.destroy();  // destroy trước khi new (Chart.js không cho update type)
    chartCo = new Chart(canvas, {
        type: 'line',
        data: {
            datasets: [{
                label: 'CO (ppm)',
                data: toPoints(s, 'co'),
                borderColor: '#FF5722',
                backgroundColor: 'rgba(255,87,34,0.1)',  // fill gradient nhẹ
                tension: 0,                              // 0 = đường thẳng, không cong
                cubicInterpolationMode: 'monotone',
                pointRadius: 0,                          // ẩn điểm tròn
                borderWidth: 2,
                fill: true
            }]
        },
        options: (() => {
            const o = baseOptions('CO (ppm)', '#FF5722');
            o.scales.y.suggestedMax = 20;  // QCVN max 9ppm → cho max 20 để thấy rõ
            return o;
        })()
    });
}

// ===== RENDER TẤT CẢ CHART CHÍNH =====
// Flow: check canvas → destroy cũ → tạo mới với data đã downsample
function renderCharts(data) {
    // Nếu không có canvas chart-env → đang không ở dashboard
    // (VD: đang ở admin tab, map.html) → skip, tránh lỗi
    const envCanvas = document.getElementById('chart-env');
    if (!envCanvas) return;

    // Không có data → destroy tất cả chart
    if (!data.length) {
        if (chartEnv)  { chartEnv.destroy();  chartEnv = null; }
        if (chartPm)   { chartPm.destroy();   chartPm = null; }
        if (chartVolt) { chartVolt.destroy(); chartVolt = null; }
        if (chartCurr) { chartCurr.destroy(); chartCurr = null; }
        if (chartCo)   { chartCo.destroy();   chartCo = null; }
        return;
    }

    const s = downsample(data, 80);

    // === CHART 1: NHIỆT ĐỘ + ĐỘ ẨM (2 trục Y) ===
    if (chartEnv) chartEnv.destroy();
    chartEnv = new Chart(envCanvas, {
        type: 'line',
        data: { datasets: [
            { label: 'Nhiệt độ (°C)', data: toPoints(s, 't'),
              borderColor: '#f44336', backgroundColor: 'rgba(244,67,54,0.1)',
              tension: 0, cubicInterpolationMode: 'monotone',
              pointRadius: 0, borderWidth: 2, yAxisID: 'y_temp' },
            { label: 'Độ ẩm (%)', data: toPoints(s, 'h'),
              borderColor: '#2196F3', backgroundColor: 'rgba(33,150,243,0.1)',
              tension: 0, cubicInterpolationMode: 'monotone',
              pointRadius: 0, borderWidth: 2, yAxisID: 'y_hum' }
        ]},
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 1500, easing: 'easeOutQuart' },
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: getLegendColor() } } },
            scales: {
                x: timeScaleX(),
                // Trục trái cho nhiệt độ
                y_temp: {
                    position: 'left',
                    ticks: { color: '#f44336' },
                    grid: { color: getGridColor() },
                    title: { display: true, text: 'Nhiệt độ (°C)', color: '#f44336' }
                },
                // Trục phải cho độ ẩm (không vẽ grid để không trùng)
                y_hum: {
                    position: 'right',
                    ticks: { color: '#2196F3' },
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'Độ ẩm (%)', color: '#2196F3' }
                }
            }
        }
    });

    // === CHART 2: BỤI MỊN (3 dòng PM1/PM2.5/PM10) ===
    const pmCanvas = document.getElementById('chart-pm');
    if (pmCanvas) {
        if (chartPm) chartPm.destroy();
        chartPm = new Chart(pmCanvas, {
            type: 'line',
            data: { datasets: [
                { label: 'PM1.0 (µg/m³)', data: toPoints(s, 'pm1'),
                  borderColor: '#FFC107', backgroundColor: 'rgba(255,193,7,0.1)',
                  tension: 0, cubicInterpolationMode: 'monotone',
                  pointRadius: 0, borderWidth: 2, yAxisID: 'y_pm' },
                { label: 'PM2.5 (µg/m³)', data: toPoints(s, 'pm25'),
                  borderColor: '#FF5722', backgroundColor: 'rgba(255,87,34,0.1)',
                  tension: 0, cubicInterpolationMode: 'monotone',
                  pointRadius: 0, borderWidth: 2, yAxisID: 'y_pm' },
                { label: 'PM10 (µg/m³)', data: toPoints(s, 'pm10'),
                  borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.1)',
                  tension: 0, cubicInterpolationMode: 'monotone',
                  pointRadius: 0, borderWidth: 2, yAxisID: 'y_pm' }
            ]},
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 1500, easing: 'easeOutQuart' },
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: getLegendColor() } } },
                scales: {
                    x: timeScaleX(),
                    y_pm: {
                        position: 'left',
                        ticks: { color: '#FF5722' },
                        grid: { color: getGridColor() },
                        title: { display: true, text: 'Bụi mịn (µg/m³)', color: '#FF5722' }
                    }
                }
            }
        });
    }

    renderCoChart(data);  // Chart CO (dùng hàm riêng vì chỉ 1 dòng)

    // === CHART 3+4: VOLT + CURR — CHỈ ADMIN MỚI THẤY ===
    // Guest không cần xem thông số pin
    if (!isAdmin()) return;

    const voltCanvas = document.getElementById('chart-volt');
    if (voltCanvas) {
        if (chartVolt) chartVolt.destroy();
        chartVolt = new Chart(voltCanvas, {
            type: 'line',
            data: { datasets: [{
                label: 'Điện áp (V)', data: toPoints(s, 'v'),
                borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.1)',
                tension: 0, cubicInterpolationMode: 'monotone',
                pointRadius: 0, borderWidth: 2, fill: true
            }]},
            options: (() => {
                const o = baseOptions('Điện áp (V)', '#FF9800');
                o.scales.y.min = 2.0;  // Pin 2S Li-ion: 6-8.4V (nhưng đo sau buck = 3.3V)
                o.scales.y.max = 3.6;
                return o;
            })()
        });
    }

    const currCanvas = document.getElementById('chart-curr');
    if (currCanvas) {
        if (chartCurr) chartCurr.destroy();
        chartCurr = new Chart(currCanvas, {
            type: 'line',
            data: { datasets: [{
                label: 'Dòng điện (mA)', data: toPoints(s, 'i', 1000),  // ×1000 A→mA
                borderColor: '#9C27B0', backgroundColor: 'rgba(156,39,176,0.1)',
                tension: 0, cubicInterpolationMode: 'monotone',
                pointRadius: 0, borderWidth: 2, fill: true
            }]},
            options: (() => {
                const o = baseOptions('Dòng điện (mA)', '#9C27B0');
                o.scales.y.min = 0;
                o.scales.y.max = 100;  // max 100mA (thực tế 40-50mA)
                return o;
            })()
        });
    }
}

// ===== LOAD DATA THEO NGÀY =====
async function loadToday() {
    const t = getLocalDate();
    const di = document.getElementById('date-picker');
    if (di) di.value = t;
    const d = await fetchDataByDate(t);
    updateCards(d);
    renderCharts(d);
}

async function loadByDate() {
    const di = document.getElementById('date-picker');
    if (!di.value) { alert('Vui lòng chọn ngày'); return; }
    const d = await fetchDataByDate(di.value);
    if (!d.length) {
        alert('Không có dữ liệu ngày ' + di.value);
        updateCards([]); renderCharts([]);
        return;
    }
    updateCards(d); renderCharts(d);
    const u = document.getElementById('updated');
    if (u) u.textContent = 'Xem ngày ' + di.value + ' (' + d.length + ' điểm)';
}

// ===== WEBSOCKET REALTIME =====
// Flow: connect → onmessage → parse JSON → updateFromWS
// Retry 3s nếu disconnect, ping mỗi 30s để giữ kết nối qua Cloudflare
let ws = null, wsPingInterval = null;
function connectWebSocket() {
    ws = new WebSocket('wss://airwatch.io.vn/ws/data');
    ws.onopen = () => {
        console.log('[WS] connected');
        // Ping mỗi 30s để Cloudflare không cắt idle connection (default 100s)
        wsPingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, 30000);
    };
    ws.onmessage = (e) => {
        if (e.data === 'pong') return;  // response của ping → ignore
        try {
            const d = JSON.parse(e.data);
            if (d.t !== undefined) updateFromWS(d);
        } catch(err) {}  // JSON lỗi → bỏ qua
    };
    ws.onclose = () => {
        console.log('[WS] disconnected, retry 3s');
        clearInterval(wsPingInterval);
        setTimeout(connectWebSocket, 3000);  // auto-reconnect
    };
    ws.onerror = () => console.error('[WS] error');
}

// Cập nhật UI khi có data mới từ WS (không cần F5)
// Chỉ update nếu user đang xem "hôm nay" (không phải ngày khác)
function updateFromWS(d) {
    if (d.t === undefined) return;
    const di = document.getElementById('date-picker');
    const t = getLocalDate();
    if (di && di.value !== t) return;  // đang xem ngày khác → bỏ qua

    // Update từng card trực tiếp (không animate vì WS update liên tục)
    if (d.t !== undefined) document.getElementById('temp') && (document.getElementById('temp').textContent = d.t.toFixed(2));
    if (d.h !== undefined) document.getElementById('hum') && (document.getElementById('hum').textContent = d.h.toFixed(2));
    if (d.v !== undefined) document.getElementById('volt') && (document.getElementById('volt').textContent = d.v.toFixed(3));
    if (d.i !== undefined) document.getElementById('curr') && (document.getElementById('curr').textContent = (d.i * 1000).toFixed(2));
    if (d.pm1 !== undefined) document.getElementById('pm1') && (document.getElementById('pm1').textContent = d.pm1);
    if (d.pm25 !== undefined) document.getElementById('pm25') && (document.getElementById('pm25').textContent = d.pm25);
    if (d.pm10 !== undefined) document.getElementById('pm10') && (document.getElementById('pm10').textContent = d.pm10);

    // VOC/NOx: đổi màu theo ngưỡng như updateCards
    if (d.voc_pct !== undefined) {
        const el = document.getElementById('voc_pct');
        if (el) {
            el.textContent = Number(d.voc_pct).toFixed(1);
            el.style.color = d.voc_pct > 110 ? '#f44336' : d.voc_pct > 100 ? '#ff9800' : '#9C27B0';
        }
    }
    if (d.nox_pct !== undefined) {
        const el = document.getElementById('nox_pct');
        if (el) {
            el.textContent = Number(d.nox_pct).toFixed(1);
            el.style.color = d.nox_pct > 110 ? '#f44336' : d.nox_pct > 100 ? '#ff9800' : '#00BCD4';
        }
    }

    const u = document.getElementById('updated');
    if (u) u.textContent = new Date().toLocaleString('vi-VN');
    updateAQI(d.pm25, d.pm10, d.co);
    renderGasChart(d.voc_pct, d.nox_pct);
    setStatus(true);
    addPointToCharts(d);  // Thêm điểm mới vào chart line (không reload toàn bộ)
}

// Thêm 1 điểm vào chart line realtime
// Nếu data > 200 điểm → shift() bỏ điểm cũ nhất (giữ window trượt)
function addPointToCharts(d) {
    const now = Date.now();
    if (chartEnv) {
        chartEnv.data.datasets[0].data.push({ x: now, y: d.t });
        chartEnv.data.datasets[1].data.push({ x: now, y: d.h });
        if (chartEnv.data.datasets[0].data.length > 200)
            chartEnv.data.datasets.forEach(ds => ds.data.shift());
        chartEnv.update();
    }
    if (chartPm) {
        chartPm.data.datasets[0].data.push({ x: now, y: d.pm1 || 0 });
        chartPm.data.datasets[1].data.push({ x: now, y: d.pm25 || 0 });
        chartPm.data.datasets[2].data.push({ x: now, y: d.pm10 || 0 });
        if (chartPm.data.datasets[0].data.length > 200)
            chartPm.data.datasets.forEach(ds => ds.data.shift());
        chartPm.update();
    }
    if (chartCo && d.co !== undefined) {
        chartCo.data.datasets[0].data.push({ x: now, y: d.co });
        if (chartCo.data.datasets[0].data.length > 200) chartCo.data.datasets[0].data.shift();
        chartCo.update();
    }
    if (!isAdmin()) return;  // Guest không có chart volt/curr
    if (chartVolt) {
        chartVolt.data.datasets[0].data.push({ x: now, y: d.v });
        if (chartVolt.data.datasets[0].data.length > 200) chartVolt.data.datasets[0].data.shift();
        chartVolt.update();
    }
    if (chartCurr) {
        chartCurr.data.datasets[0].data.push({ x: now, y: d.i * 1000 });
        if (chartCurr.data.datasets[0].data.length > 200) chartCurr.data.datasets[0].data.shift();
        chartCurr.update();
    }
}

// Fallback: nếu WS fail, cứ 60s fetch lại toàn bộ data
setInterval(async () => {
    const di = document.getElementById('date-picker');
    const t = getLocalDate();
    if (!di || di.value === t) {
        const d = await fetchDataByDate(t);
        updateCards(d);
        if (document.getElementById('chart-env')) renderCharts(d);
    }
}, 60000);

// ===== TRẠNG THÁI SERVICE (MANUAL STATUS) =====
// Admin tự đánh dấu: NODE đang debug / maintenance / offline...
// Lưu trên server (api/status), poll mỗi 10s
const STATUS_ICONS = { stm32: '🔌 NODE', esp32: '📡 GATEWAY', api: '🌐 Web API', system: '🖥️ SYSTEM' };
const PRESET_NOTES = {
    working: 'Hoạt động bình thường',
    debug: 'Đang debug',
    attach: 'Đang gắn module/sensor',
    testing: 'Đang chạy test',
    maintenance: 'Đang bảo trì',
    offline: 'Tạm tắt'
};

// Khi click preset button → set form value + note default
function applyPreset(status) {
    document.getElementById('sel-status').value = status;
    const n = document.getElementById('inp-note');
    if (!n.value.trim()) n.value = PRESET_NOTES[status] || '';
    document.querySelectorAll('.preset-btn').forEach(b => b.style.opacity = '0.5');
    const btn = document.querySelector(`.preset-btn.${status}`);
    if (btn) btn.style.opacity = '1';
    updateServiceStatus();  // apply luôn
}

// ===== BẢN ĐỒ + NODES =====
// Dùng Leaflet + VietMap tiles (tiles.vietmap.vn)
// Admin click bản đồ → lấy lat/lng → điền form thêm node
let adminMap = null, adminMarkers = [];
const VIETMAP_KEY = '75950d796c1f4a611133660d2ec48258174fc8279da00348';

function initNodesMap() {
    const el = document.getElementById('nodes-map');
    if (!el || typeof L === 'undefined') return;
    // Nếu map đã init → chỉ invalidate (fix khi tab ẩn rồi hiện)
    if (adminMap) { setTimeout(() => adminMap.invalidateSize(), 100); return; }

    adminMap = L.map('nodes-map').setView([16.0, 106.5], 5);  // center VN
    window.adminMap = adminMap;  // expose để HTML gọi
    L.tileLayer('https://maps.vietmap.vn/maps/tiles/st/{z}/{x}/{y}.png?apikey=' + VIETMAP_KEY, {
        attribution: '© VietMap', maxZoom: 19
    }).addTo(adminMap);

    // Click bản đồ → lấy lat/lng, hiện marker tạm
    adminMap.on('click', (e) => {
        const lat = e.latlng.lat.toFixed(6), lng = e.latlng.lng.toFixed(6);
        document.getElementById('node-lat').value = lat;
        document.getElementById('node-lng').value = lng;
        // Xóa marker tạm cũ, tạo marker mới
        if (window._tempMarker) adminMap.removeLayer(window._tempMarker);
        window._tempMarker = L.circleMarker([lat, lng], {
            radius: 8, fillColor: '#58a6ff', color: '#fff', weight: 2, fillOpacity: 0.9
        }).addTo(adminMap).bindPopup('📍 ' + lat + ', ' + lng).openPopup();
    });

    // Fix Leaflet render sai kích thước khi container ẩn
    setTimeout(() => adminMap.invalidateSize(), 200);
    loadNodesOnMap();
}

async function loadNodesOnMap() {
    if (!adminMap) return;
    // Xóa marker cũ
    adminMarkers.forEach(m => adminMap.removeLayer(m));
    adminMarkers = [];
    try {
        const r = await fetch(API + '/api/nodes');
        const nodes = await r.json();
        if (!nodes || !nodes.length) return;
        // Mỗi node = 1 circle marker xanh lá
        nodes.forEach(n => {
            const m = L.circleMarker([n.lat, n.lng], {
                radius: 9, fillColor: '#4CAF50', color: '#fff', weight: 2, fillOpacity: 0.9
            }).addTo(adminMap).bindPopup(
                '<strong>' + (n.name || n.id) + '</strong><br><small>' +
                n.lat.toFixed(4) + ', ' + n.lng.toFixed(4) + '</small>'
            );
            adminMarkers.push(m);
        });
    } catch(e) { console.error('[MAP]', e); }
}

async function addNode() {
    const id = document.getElementById('node-id').value.trim();
    const name = document.getElementById('node-name').value.trim();
    const lat = document.getElementById('node-lat').value.trim();
    const lng = document.getElementById('node-lng').value.trim();
    if (!id || !name || !lat || !lng) { alert('Vui lòng điền đầy đủ + click bản đồ'); return; }
    try {
        const r = await fetch(API + '/api/nodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ id, name, lat: parseFloat(lat), lng: parseFloat(lng) })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        alert('Đã thêm node ' + name);
        // Clear form + xóa marker tạm
        ['node-id','node-name','node-lat','node-lng'].forEach(id => document.getElementById(id).value = '');
        if (window._tempMarker) { adminMap.removeLayer(window._tempMarker); window._tempMarker = null; }
        loadNodesOnMap(); loadNodes();
    } catch(e) { alert('Thêm node thất bại: ' + e.message); }
}

// Load danh sách node + check trạng thái online
// Logic: nếu có data sensor trong 15 phút gần đây → working, 60 phút → delayed, còn lại offline
async function loadNodes() {
    const box = document.getElementById('nodes-list');
    if (!box) return;
    box.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">Đang tải...</div>';
    try {
        // Parallel fetch nodes + data mới nhất
        const [nr, dr] = await Promise.all([fetch(API + '/api/nodes'), fetch(API + '/api/data')]);
        const nodes = await nr.json();
        const data = await dr.json();
        if (!nodes || !nodes.length) {
            box.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">Chưa có node nào.</div>';
            return;
        }
        const lastData = (data && data.length) ? data[data.length - 1] : null;
        const lastMs = lastData ? tsToMs(lastData.ts) : 0;
        const diffMin = lastMs ? Math.floor((Date.now() - lastMs) / 60000) : 99999;
        const status = diffMin < 15 ? 'working' : diffMin < 60 ? 'delayed' : 'offline';

        // Render từng node row với badge status
        box.innerHTML = nodes.map(n => `
            <div class="node-row">
                <div class="node-info">
                    <div class="node-name">${n.name || n.id || 'Node'}</div>
                    <div class="node-meta">${(n.lat||0).toFixed(4)}, ${(n.lng||0).toFixed(4)}</div>
                </div>
                <div class="node-status">
                    <span class="status-dot ${status}"></span>
                    <span class="status-label ${status}">${status}</span>
                </div>
                <div class="node-last">${diffMin < 99999 ? fmtAgo(diffMin) : 'chưa có data'}</div>
                <button class="node-delete" onclick="deleteNode('${n.id}', '${(n.name || n.id).replace(/'/g, "\\'")}')" title="Xóa node">🗑️</button>
            </div>
        `).join('');

        const u = document.getElementById('updated');
        if (u) u.textContent = new Date().toLocaleTimeString('vi-VN');
    } catch(e) {
        box.innerHTML = '<div style="color:#f85149; padding:20px;">Lỗi load node: ' + e.message + '</div>';
    }
}

async function deleteNode(id, name) {
    if (!confirm(`Xóa node "${name}" (ID: ${id})?\n\nHành động này không thể hoàn tác.`)) return;
    try {
        const r = await fetch(API + '/api/nodes/' + encodeURIComponent(id), {
            method: 'DELETE',
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        loadNodes();
        loadNodesOnMap();
    } catch(e) { alert('Xóa thất bại: ' + e.message); }
}
// ===== LOAD TRẠNG THÁI CÁC SERVICE =====
// Gọi API /api/status → render 4 card (NODE, GATEWAY, API, SYSTEM)
// Poll tự động mỗi 10s khi ở tab status
async function loadServiceStatus() {
    try {
        const r = await fetch(API + '/api/status');
        const d = await r.json();
        const grid = document.getElementById('status-grid');
        if (!grid) return;
        // Map 4 service key → HTML card
        grid.innerHTML = Object.keys(STATUS_ICONS).map(k => {
            const svc = (d.services && d.services[k]) || { status: 'offline', note: '' };
            return `<div class="status-card">
                <div class="status-head">
                    <span class="status-name">${STATUS_ICONS[k]}</span>
                    <span class="status-dot ${svc.status}"></span>
                </div>
                <div class="status-label ${svc.status}">${svc.status}</div>
                <div class="status-note">${svc.note || '—'}</div>
            </div>`;
        }).join('');
        const u = document.getElementById('status-updated');
        if (u) u.textContent = new Date().toLocaleTimeString('vi-VN');
    } catch(e) { console.error('[STATUS]', e); }
}

// Cập nhật 1 service (dùng ở form chọn service/status/note)
async function updateServiceStatus() {
    const service = document.getElementById('sel-service').value;
    const status  = document.getElementById('sel-status').value;
    const note    = document.getElementById('inp-note').value.trim();
    try {
        const r = await fetch(API + '/api/set-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ service, status, note })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        document.getElementById('inp-note').value = '';
        await loadServiceStatus();
    } catch(e) { alert('Cập nhật thất bại: ' + e.message); }
}

// Áp dụng 1 status cho TẤT CẢ service (dùng khi maintenance toàn hệ thống)
async function updateAllServices() {
    const status = document.getElementById('sel-status').value;
    const note = document.getElementById('inp-note').value.trim();
    const services = ['stm32', 'esp32', 'api', 'system'];
    if (!confirm('Áp dụng trạng thái "' + status + '" cho TẤT CẢ service?\n\n' + services.join(', '))) return;
    try {
        // Loop tuần tự (không Promise.all để tránh spam server)
        for (const svc of services) {
            await fetch(API + '/api/set-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
                body: JSON.stringify({ service: svc, status, note })
            });
        }
        document.getElementById('inp-note').value = '';
        await loadServiceStatus();
    } catch(e) { alert('Lỗi: ' + e.message); }
}

// Auto-poll nếu tab status tồn tại trên page
if (document.getElementById('tab-status')) {
    loadNodes();
    loadServiceStatus();
    setInterval(loadServiceStatus, 10000);  // 10s/lần
    setInterval(loadNodes, 30000);           // 30s/lần
}

// ===== LOG ACTION (audit trail) =====
// Helper ghi log mọi thao tác admin. Fire-and-forget (không await)
async function logAction(action, target, details, severity) {
    try {
        await fetch(API + '/api/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({
                action,
                target: target || '',
                details: details || '',
                severity: severity || 'info',
                author: 'phuyy'
            })
        });
    } catch(e) { console.warn('[LOG]', e); }  // Không throw, lỗi log không quan trọng
}

// ===== DEBUG DASHBOARD =====
// Đây là sandbox: admin nhập tay data để test UI, không ảnh hưởng DB chính
// Có 3 nguồn data: nhập tay, simulate, clone từ sensor thật
const DEBUG_FIELDS = ['t','h','v','i','pm1','pm25','pm10','voc','nox','sgp_ok'];

// Rules validate từng field (min/max hợp lý)
// Dùng để hiện lỗi ngay khi user gõ
const FIELD_RULES = {
    t:     { min: -10,  max: 60,    label: 'Nhiệt độ' },
    h:     { min: 0,    max: 100,   label: 'Độ ẩm' },
    v:     { min: 1.5,  max: 5.0,   label: 'Điện áp' },
    i:     { min: -1,   max: 2.0,   label: 'Dòng điện' },
    pm1:   { min: 0,    max: 500,   label: 'PM1.0' },
    pm25:  { min: 0,    max: 500,   label: 'PM2.5' },
    pm10:  { min: 0,    max: 1000,  label: 'PM10' },
    voc:   { min: 0,    max: 65535, label: 'VOC' },   // 16-bit max
    nox:   { min: 0,    max: 65535, label: 'NOx' }
};

// State của debug tab
let debugData = [];         // Data gốc từ API
let debugFiltered = [];     // Data sau khi filter search/type
let editingId = null;       // ID record đang edit (null = mode insert)
let selectedRows = new Set(); // Các ID đã tick checkbox
let dbgChartEnv = null, dbgChartPm = null, dbgChartPower = null;
let presetsList = [];       // Danh sách preset user đã lưu

// Validate 1 field khi user gõ → hiện lỗi inline
function validateField(name) {
    const rule = FIELD_RULES[name];
    if (!rule) return true;
    const el = document.getElementById('dbg-' + name);
    const err = document.getElementById('err-' + name);
    if (!el || !err) return true;
    const raw = el.value.trim();
    // Trống = OK (cho phép null)
    if (raw === '') { el.classList.remove('invalid'); err.textContent = ''; return true; }
    const val = parseFloat(raw);
    if (isNaN(val)) { el.classList.add('invalid'); err.textContent = 'Không phải số'; return false; }
    if (val < rule.min || val > rule.max) {
        el.classList.add('invalid');
        err.textContent = `Phải từ ${rule.min} đến ${rule.max}`;
        return false;
    }
    el.classList.remove('invalid');
    err.textContent = '';
    return true;
}

// Validate tất cả field trước khi save
function validateAllFields() {
    let ok = true;
    Object.keys(FIELD_RULES).forEach(f => { if (!validateField(f)) ok = false; });
    return ok;
}

// Reset form về state ban đầu (insert mode)
function resetDebugForm() {
    editingId = null;
    // Clear tất cả input
    DEBUG_FIELDS.forEach(f => {
        const el = document.getElementById('dbg-' + f);
        if (el) el.value = '';
    });
    const sgp = document.getElementById('dbg-sgp');
    if (sgp) sgp.value = '0';
    const tt = document.getElementById('dbg-test-type');
    if (tt) tt.value = 'manual';
    const note = document.getElementById('dbg-note');
    if (note) note.value = '';
    // Xóa error messages
    Object.keys(FIELD_RULES).forEach(f => {
        const err = document.getElementById('err-' + f);
        if (err) err.textContent = '';
        const el = document.getElementById('dbg-' + f);
        if (el) el.classList.remove('invalid');
    });
    // Đổi label mode
    document.getElementById('dbg-form-mode').innerHTML = 'Mode: <strong>INSERT</strong> (id trống)';
    document.getElementById('btn-save-debug').textContent = '💾 Save (Insert)';
    document.getElementById('btn-cancel-edit').style.display = 'none';
    // Xóa highlight edit-mode
    document.querySelectorAll('.debug-table tbody tr').forEach(tr => tr.classList.remove('edit-mode'));
}

function cancelEditMode() { resetDebugForm(); }

// Load toàn bộ record debug từ API
async function loadDebugData() {
    const tbody = document.getElementById('debug-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="16" style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải...</td></tr>';
    try {
        const r = await fetch(API + '/api/debug/data', { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        debugData = await r.json();
        applyDebugFilter();               // Filter theo search/type hiện tại
        renderDebugDashboard(debugData);   // Update cards + charts preview
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="16" style="text-align:center; padding:20px; color:#f85149;">Lỗi: ' + e.message + '</td></tr>';
        console.error('[DEBUG]', e);
    }
}

// Filter local (client-side) — không gọi API
function applyDebugFilter() {
    const search = (document.getElementById('dbg-search')?.value || '').toLowerCase().trim();
    const type = document.getElementById('dbg-filter-type')?.value || '';
    debugFiltered = debugData.filter(d => {
        if (type && d.test_type !== type) return false;
        if (search) {
            const s = (String(d.id) + ' ' + (d.note || '') + ' ' + (d.test_type || '')).toLowerCase();
            if (!s.includes(search)) return false;
        }
        return true;
    });
    renderDebugTable();
}

// Render bảng records
function renderDebugTable() {
    const tbody = document.getElementById('debug-tbody');
    const countEl = document.getElementById('dbg-count');
    if (!tbody) return;
    if (countEl) countEl.textContent = debugFiltered.length + ' records';
    if (!debugFiltered.length) {
        tbody.innerHTML = '<tr><td colspan="16" style="text-align:center; padding:20px; color:var(--text-muted);">Chưa có record. Dùng form trên hoặc Simulate để tạo.</td></tr>';
        return;
    }
    tbody.innerHTML = debugFiltered.map(d => {
        const checked = selectedRows.has(d.id) ? 'checked' : '';
        const selClass = selectedRows.has(d.id) ? 'selected' : '';
        const editClass = editingId === d.id ? 'edit-mode' : '';
        const type = d.test_type || 'manual';
        // Format số với số chữ số thập phân tương ứng
        return `<tr class="${selClass} ${editClass}" data-id="${d.id}">
            <td><input type="checkbox" ${checked} onchange="toggleSelectRow(${d.id}, this.checked)"></td>
            <td>${d.id}</td>
            <td>${d.ts || '--'}</td>
            <td>${(d.t||0).toFixed(2)}</td>
            <td>${(d.h||0).toFixed(1)}</td>
            <td>${(d.v||0).toFixed(3)}</td>
            <td>${(d.i||0).toFixed(3)}</td>
            <td>${d.pm1||0}</td>
            <td>${d.pm25||0}</td>
            <td>${d.pm10||0}</td>
            <td>${d.voc||0}</td>
            <td>${d.nox||0}</td>
            <td>${d.sgp_ok||0}</td>
            <td><span class="type-badge ${type}">${type}</span></td>
            <td title="${(d.note||'').replace(/"/g,'&quot;')}" style="max-width:180px; overflow:hidden; text-overflow:ellipsis;">${d.note||'—'}</td>
            <td>
                <button class="action-btn edit" onclick="editDebugRecord(${d.id})" title="Sửa">✏️</button>
                <button class="action-btn restore" onclick="restoreDebugRecord(${d.id})" title="Restore">↺</button>
                <button class="action-btn del" onclick="deleteDebugRecord(${d.id})" title="Xóa">🗑️</button>
            </td>
        </tr>`;
    }).join('');

    // Update bulk delete button state
    document.getElementById('btn-bulk-del').disabled = selectedRows.size === 0;
    const checkAll = document.getElementById('dbg-check-all');
    if (checkAll) checkAll.checked = debugFiltered.length > 0 && selectedRows.size === debugFiltered.length;
}

// ===== PRESETS =====
// Preset = bộ giá trị mẫu để điền nhanh form (VD: "phòng sạch", "phòng bẩn")
async function loadPresets() {
    try {
        const r = await fetch(API + '/api/debug/presets', { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        presetsList = await r.json();
        const sel = document.getElementById('dbg-preset-select');
        if (!sel) return;
        const current = sel.value;  // Giữ selection hiện tại
        sel.innerHTML = '<option value="">-- Chọn preset --</option>' +
            presetsList.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        if (current) sel.value = current;
    } catch(e) { console.error('[PRESETS]', e); }
}

// Load giá trị preset vào form
function loadPreset() {
    const sel = document.getElementById('dbg-preset-select');
    if (!sel || !sel.value) return;
    const preset = presetsList.find(p => String(p.id) === sel.value);
    if (!preset) return;
    try {
        const vals = JSON.parse(preset.values_json);
        DEBUG_FIELDS.forEach(f => {
            const el = document.getElementById('dbg-' + f);
            if (el && vals[f] !== undefined) el.value = vals[f];
        });
        const sgp = document.getElementById('dbg-sgp');
        if (sgp && vals.sgp_ok !== undefined) sgp.value = vals.sgp_ok;
        const note = document.getElementById('dbg-note');
        if (note) note.value = 'Preset: ' + preset.name + (preset.description ? ' — ' + preset.description : '');
        const tt = document.getElementById('dbg-test-type');
        if (tt) tt.value = preset.name.toLowerCase().includes('edge') ? 'edge' : 'custom';
    } catch(e) { alert('Preset bị lỗi JSON: ' + e.message); }
}

async function savePreset() {
    const name = prompt('Tên preset mới:');
    if (!name || !name.trim()) return;
    const desc = prompt('Mô tả (tùy chọn):') || '';
    // Build object values từ form
    const vals = {};
    DEBUG_FIELDS.forEach(f => {
        const el = document.getElementById('dbg-' + f);
        if (el && el.value.trim() !== '') vals[f] = parseFloat(el.value);
    });
    const sgp = document.getElementById('dbg-sgp');
    if (sgp) vals.sgp_ok = parseInt(sgp.value) || 0;
    try {
        const r = await fetch(API + '/api/debug/presets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({
                name: name.trim(),
                description: desc.trim(),
                values_json: JSON.stringify(vals)  // Lưu dạng string JSON
            })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('preset_created', 'preset:' + name.trim(), desc, 'info');
        await loadPresets();
    } catch(e) { alert('Tạo preset thất bại: ' + e.message); }
}

async function updateCurrentPreset() {
    const sel = document.getElementById('dbg-preset-select');
    if (!sel || !sel.value) { alert('Chọn 1 preset trước'); return; }
    const preset = presetsList.find(p => String(p.id) === sel.value);
    if (!preset) return;
    if (!confirm('Cập nhật preset "' + preset.name + '" bằng giá trị form hiện tại?')) return;
    const vals = {};
    DEBUG_FIELDS.forEach(f => {
        const el = document.getElementById('dbg-' + f);
        if (el && el.value.trim() !== '') vals[f] = parseFloat(el.value);
    });
    const sgp = document.getElementById('dbg-sgp');
    if (sgp) vals.sgp_ok = parseInt(sgp.value) || 0;
    try {
        const r = await fetch(API + '/api/debug/presets/' + preset.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ values_json: JSON.stringify(vals) })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('preset_updated', 'preset:' + preset.name, 'Update từ form', 'info');
        await loadPresets();
    } catch(e) { alert('Cập nhật thất bại: ' + e.message); }
}

async function deleteCurrentPreset() {
    const sel = document.getElementById('dbg-preset-select');
    if (!sel || !sel.value) { alert('Chọn 1 preset trước'); return; }
    const preset = presetsList.find(p => String(p.id) === sel.value);
    if (!preset) return;
    if (!confirm('Xóa preset "' + preset.name + '"?')) return;
    try {
        const r = await fetch(API + '/api/debug/presets/' + preset.id, {
            method: 'DELETE',
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('preset_deleted', 'preset:' + preset.name, '', 'warn');
        await loadPresets();
    } catch(e) { alert('Xóa thất bại: ' + e.message); }
}

// ===== CLONE TỪ SENSOR THẬT =====
// Copy 1 hoặc nhiều record sensor thật vào debug DB để test
let sensorCache = [];

async function openCloneDialog() {
    const dlg = document.getElementById('clone-dialog');
    if (!dlg) return;
    dlg.style.display = 'flex';
    const list = document.getElementById('clone-sensor-list');
    list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải sensor...</div>';
    try {
        const r = await fetch(API + '/api/data');
        sensorCache = await r.json();
        sensorCache = sensorCache.slice().reverse();  // Mới nhất lên đầu
        renderSensorList(sensorCache);
    } catch(e) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:#f85149;">Lỗi: ' + e.message + '</div>';
    }
}

function closeCloneDialog() {
    const dlg = document.getElementById('clone-dialog');
    if (dlg) dlg.style.display = 'none';
}

function renderSensorList(list) {
    const box = document.getElementById('clone-sensor-list');
    if (!box) return;
    if (!list.length) {
        box.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Không có sensor nào.</div>';
        return;
    }
    // Mỗi item click → clone ngay
    box.innerHTML = list.map(s => `
        <div class="clone-item" onclick="cloneSensor(${s.id})">
            <div class="clone-item-id">#${s.id}</div>
            <div class="clone-item-info">T=${(s.t||0).toFixed(2)}°C · H=${(s.h||0).toFixed(1)}% · PM2.5=${s.pm25||0} · V=${(s.v||0).toFixed(3)}V</div>
            <div class="clone-item-ts">${s.ts || '--'}</div>
        </div>
    `).join('');
}

function filterSensorList() {
    const q = (document.getElementById('clone-search')?.value || '').trim().toLowerCase();
    if (!q) { renderSensorList(sensorCache); return; }
    renderSensorList(sensorCache.filter(s =>
        String(s.id).includes(q) || (s.ts || '').toLowerCase().includes(q)
    ));
}

async function cloneSensor(sensorId) {
    if (!confirm('Clone sensor #' + sensorId + ' sang Debug DB?')) return;
    try {
        const r = await fetch(API + '/api/debug/clone/' + sensorId, {
            method: 'POST',
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('debug_cloned', 'sensor#' + sensorId, 'Clone từ sensor thật', 'info');
        closeCloneDialog();
        await loadDebugData();
    } catch(e) { alert('Clone thất bại: ' + e.message); }
}

// ===== SIMULATE PACKETS =====
// Sinh ngẫu nhiên N packet để test dashboard hiển thị
// edge=true → include outlier (giá trị biên) để test validation
async function simulatePackets(edge) {
    const countEl = document.getElementById('dbg-sim-count');
    const count = parseInt(countEl?.value) || 10;
    if (count < 1 || count > 200) { alert('Số lượng phải từ 1 đến 200'); return; }
    if (!confirm('Simulate ' + count + ' packets' + (edge ? ' (có edge cases)' : '') + '?')) return;
    try {
        const r = await fetch(API + '/api/debug/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ count, edge })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('debug_simulated', 'sensor_debug',
            'Simulate ' + count + ' packets' + (edge ? ' (edge)' : ''), 'info');
        await loadDebugData();
    } catch(e) { alert('Simulate thất bại: ' + e.message); }
}

// Load presets khi vào tab debug (delay 300ms để DOM ready)
if (document.getElementById('tab-debug')) {
    setTimeout(() => { if (typeof loadPresets === 'function') loadPresets(); }, 300);
}

function filterDebugTable() { applyDebugFilter(); }

// Checkbox row: thêm/xóa khỏi Set selectedRows
function toggleSelectRow(id, checked) {
    if (checked) selectedRows.add(id);
    else selectedRows.delete(id);
    renderDebugTable();
}

function toggleSelectAll(checked) {
    selectedRows.clear();
    if (checked) debugFiltered.forEach(d => selectedRows.add(d.id));
    renderDebugTable();
}

// Save record: nếu editingId != null → PUT (update), ngược lại → POST (insert)
async function saveDebugRecord() {
    if (!validateAllFields()) { alert('Có field không hợp lệ. Sửa trước khi lưu.'); return; }
    // Build payload từ form
    const payload = {};
    DEBUG_FIELDS.forEach(f => {
        const el = document.getElementById('dbg-' + f);
        if (el && el.value.trim() !== '') payload[f] = parseFloat(el.value);
    });
    const sgp = document.getElementById('dbg-sgp');
    if (sgp) payload.sgp_ok = parseInt(sgp.value) || 0;
    const note = document.getElementById('dbg-note');
    if (note) payload.note = note.value.trim();
    const tt = document.getElementById('dbg-test-type');
    if (tt) payload.test_type = tt.value;

    const isEdit = editingId !== null;
    const url = isEdit ? API + '/api/debug/data/' + editingId : API + '/api/debug/data';
    const method = isEdit ? 'PUT' : 'POST';
    try {
        const r = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify(payload)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction(
            isEdit ? 'debug_updated' : 'debug_created',
            'sensor_debug#' + (editingId || 'new'),
            (isEdit ? 'Sửa' : 'Tạo') + ' record: ' + (note?.value || ''),
            'info'
        );
        resetDebugForm();
        await loadDebugData();
    } catch(e) { alert('Lưu thất bại: ' + e.message); }
}

// Load record vào form để edit
function editDebugRecord(id) {
    const d = debugData.find(x => x.id === id);
    if (!d) return;
    editingId = id;
    // Fill form
    DEBUG_FIELDS.forEach(f => {
        const el = document.getElementById('dbg-' + f);
        if (el) el.value = d[f] !== undefined && d[f] !== null ? d[f] : '';
    });
    const sgp = document.getElementById('dbg-sgp');
    if (sgp) sgp.value = d.sgp_ok || 0;
    const tt = document.getElementById('dbg-test-type');
    if (tt) tt.value = d.test_type || 'manual';
    const note = document.getElementById('dbg-note');
    if (note) note.value = d.note || '';
    // Đổi mode
    document.getElementById('dbg-form-mode').innerHTML = 'Mode: <strong>UPDATE</strong> #' + id;
    document.getElementById('btn-save-debug').textContent = '💾 Update #' + id;
    document.getElementById('btn-cancel-edit').style.display = '';
    renderDebugTable();
    // Scroll form vào view
    document.getElementById('dbg-t').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function deleteDebugRecord(id) {
    if (!confirm('Xóa record #' + id + '?')) return;
    try {
        const r = await fetch(API + '/api/debug/data/' + id, {
            method: 'DELETE',
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('debug_deleted', 'sensor_debug#' + id, 'Xóa record', 'warn');
        selectedRows.delete(id);
        if (editingId === id) resetDebugForm();
        await loadDebugData();
    } catch(e) { alert('Xóa thất bại: ' + e.message); }
}

// Xóa nhiều record đã tick
async function deleteSelectedDebug() {
    if (selectedRows.size === 0) return;
    if (!confirm('Xóa ' + selectedRows.size + ' record đã chọn?')) return;
    const ids = Array.from(selectedRows);
    try {
        // Loop tuần tự (không spam API)
        for (const id of ids) {
            await fetch(API + '/api/debug/data/' + id, {
                method: 'DELETE',
                headers: { 'X-Auth-Token': getToken() }
            });
        }
        logAction('debug_deleted', 'bulk', 'Xóa ' + ids.length + ' records: ' + ids.join(','), 'warn');
        selectedRows.clear();
        await loadDebugData();
    } catch(e) { alert('Xóa thất bại: ' + e.message); }
}

// Clear toàn bộ debug DB (double confirm vì nguy hiểm)
async function clearDebugData() {
    if (!confirm('XÓA TOÀN BỘ record trong Debug DB?\n\nHành động không thể hoàn tác.')) return;
    if (!confirm('Xác nhận lần 2: XÓA HẾT?')) return;
    try {
        const r = await fetch(API + '/api/debug/data', {
            method: 'DELETE',
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('debug_cleared', 'sensor_debug', 'Clear toàn bộ debug DB', 'warn');
        selectedRows.clear();
        resetDebugForm();
        await loadDebugData();
    } catch(e) { alert('Clear thất bại: ' + e.message); }
}

// Restore record về original_data (backup trước khi edit)
async function restoreDebugRecord(id) {
    if (!confirm('Restore record #' + id + ' về original_data?')) return;
    try {
        const r = await fetch(API + '/api/debug/restore/' + id, {
            method: 'POST',
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('debug_restored', 'sensor_debug#' + id, 'Restore về original_data', 'warn');
        await loadDebugData();
    } catch(e) { alert('Restore thất bại: ' + e.message); }
}

// Render cards + charts preview của debug data (data[0] = mới nhất)
function renderDebugDashboard(data) {
    if (!data || !data.length) {
        ['dbg-card-t','dbg-card-h','dbg-card-v','dbg-card-i',
         'dbg-card-pm1','dbg-card-pm25','dbg-card-pm10'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '--';
        });
        const aqiEl = document.getElementById('dbg-aqi');
        if (aqiEl) aqiEl.textContent = '--';
        return;
    }
    const last = data[0];
    const set = (id, val, dec) => {
        const el = document.getElementById(id);
        if (el) el.textContent = (val !== undefined && val !== null) ? Number(val).toFixed(dec) : '--';
    };
    set('dbg-card-t', last.t, 2);
    set('dbg-card-h', last.h, 2);
    set('dbg-card-v', last.v, 3);
    set('dbg-card-i', (last.i||0) * 1000, 2);  // A → mA
    set('dbg-card-pm1', last.pm1, 0);
    set('dbg-card-pm25', last.pm25, 0);
    set('dbg-card-pm10', last.pm10, 0);

    // AQI preview giống dashboard chính
    const aqi = calcAQI(last.pm25 || 0, last.pm10 || 0, last.co || 0);
    const aqiEl = document.getElementById('dbg-aqi');
    const aqiText = document.getElementById('dbg-aqi-text');
    const progress = document.getElementById('dbg-aqi-progress');
    let text = '', color = '';
    if (aqi <= 50)        { text = 'Tốt';        color = '#4CAF50'; }
    else if (aqi <= 100)  { text = 'Trung bình'; color = '#FFEB3B'; }
    else if (aqi <= 150)  { text = 'Kém';        color = '#FF9800'; }
    else if (aqi <= 200)  { text = 'Xấu';        color = '#F44336'; }
    else if (aqi <= 300)  { text = 'Rất xấu';    color = '#9C27B0'; }
    else                  { text = 'Nguy hại';   color = '#7B1FA2'; }
    if (aqiEl) { aqiEl.textContent = aqi; aqiEl.style.color = color; }
    if (aqiText) {
        aqiText.textContent = text;
        aqiText.style.backgroundColor = color;
        aqiText.style.color = (color === '#FFEB3B') ? '#000' : '#fff';
    }
    if (progress) {
        const circ = 2 * Math.PI * 90;
        const pct = Math.min(aqi / 300, 1);
        progress.style.strokeDashoffset = circ - (pct * circ);
        progress.style.stroke = color;
    }
    renderDebugCharts(data);
}

// 3 chart preview: env, pm, power
function renderDebugCharts(data) {
    if (typeof Chart === 'undefined') return;
    // Sort theo ts tăng dần (data API trả mới nhất trước)
    const sorted = data.slice().sort((a,b) => String(a.ts||'').localeCompare(String(b.ts||'')));
    // Downsample để chart nhẹ
    const maxPts = 80;
    const step = Math.max(1, Math.ceil(sorted.length / maxPts));
    const s = sorted.filter((_, i) => i % step === 0);

    // Chart môi trường (T + H 2 trục Y)
    if (dbgChartEnv) dbgChartEnv.destroy();
    const envEl = document.getElementById('dbg-chart-env');
    if (envEl) {
        dbgChartEnv = new Chart(envEl, {
            type: 'line',
            data: { labels: s.map(d => d.ts || ''), datasets: [
                { label: 'Nhiệt độ (°C)', data: s.map(d => d.t),
                  borderColor: '#f44336', backgroundColor: 'rgba(244,67,54,0.1)',
                  tension: 0.2, pointRadius: 0, yAxisID: 'y1' },
                { label: 'Độ ẩm (%)', data: s.map(d => d.h),
                  borderColor: '#2196F3', backgroundColor: 'rgba(33,150,243,0.1)',
                  tension: 0.2, pointRadius: 0, yAxisID: 'y2' }
            ]},
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: getLegendColor() } } },
                scales: {
                    x: { ticks: { color: getTextColor(), maxTicksLimit: 8 }, grid: { color: getGridColor() } },
                    y1: { position: 'left', ticks: { color: '#f44336' }, grid: { color: getGridColor() } },
                    y2: { position: 'right', ticks: { color: '#2196F3' }, grid: { drawOnChartArea: false } }
                }
            }
        });
    }

    // Chart bụi mịn (3 dòng)
    if (dbgChartPm) dbgChartPm.destroy();
    const pmEl = document.getElementById('dbg-chart-pm');
    if (pmEl) {
        dbgChartPm = new Chart(pmEl, {
            type: 'line',
            data: { labels: s.map(d => d.ts || ''), datasets: [
                { label: 'PM1.0', data: s.map(d => d.pm1), borderColor: '#FFC107', backgroundColor: 'rgba(255,193,7,0.1)', tension: 0.2, pointRadius: 0 },
                { label: 'PM2.5', data: s.map(d => d.pm25), borderColor: '#FF5722', backgroundColor: 'rgba(255,87,34,0.1)', tension: 0.2, pointRadius: 0 },
                { label: 'PM10', data: s.map(d => d.pm10), borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.1)', tension: 0.2, pointRadius: 0 }
            ]},
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: getLegendColor() } } },
                scales: {
                    x: { ticks: { color: getTextColor(), maxTicksLimit: 8 }, grid: { color: getGridColor() } },
                    y: { ticks: { color: '#FF5722' }, grid: { color: getGridColor() } }
                }
            }
        });
    }

    // Chart power (V + I 2 trục Y)
    if (dbgChartPower) dbgChartPower.destroy();
    const pwEl = document.getElementById('dbg-chart-power');
    if (pwEl) {
        dbgChartPower = new Chart(pwEl, {
            type: 'line',
            data: { labels: s.map(d => d.ts || ''), datasets: [
                { label: 'Điện áp (V)', data: s.map(d => d.v), borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.1)', tension: 0.2, pointRadius: 0, yAxisID: 'yv' },
                { label: 'Dòng (mA)', data: s.map(d => (d.i||0)*1000), borderColor: '#9C27B0', backgroundColor: 'rgba(156,39,176,0.1)', tension: 0.2, pointRadius: 0, yAxisID: 'yi' }
            ]},
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: getLegendColor() } } },
                scales: {
                    x: { ticks: { color: getTextColor(), maxTicksLimit: 8 }, grid: { color: getGridColor() } },
                    yv: { position: 'left', ticks: { color: '#FF9800' }, grid: { color: getGridColor() } },
                    yi: { position: 'right', ticks: { color: '#9C27B0' }, grid: { drawOnChartArea: false } }
                }
            }
        });
    }
}

// ===== LOG TAB =====
let logsData = [];
let logsFiltered = [];

async function loadLogs() {
    const box = document.getElementById('log-list');
    if (!box) return;
    box.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Đang tải...</div>';
    try {
        const action = document.getElementById('log-filter-action')?.value || '';
        const severity = document.getElementById('log-filter-severity')?.value || '';
        // Chỉ filter theo action ở server (giảm payload), severity filter local
        let url = API + '/api/logs?limit=200';
        if (action) url += '&action=' + encodeURIComponent(action);
        const r = await fetch(url, { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logsData = await r.json();
        if (severity) logsData = logsData.filter(l => l.severity === severity);
        logsFiltered = logsData;
        renderLogs();
    } catch(e) {
        box.innerHTML = '<div style="text-align:center; padding:40px; color:#f85149;">Lỗi: ' + e.message + '</div>';
    }
}

function renderLogs() {
    const box = document.getElementById('log-list');
    const count = document.getElementById('log-count');
    if (!box) return;
    if (count) count.textContent = logsFiltered.length + ' logs';
    if (!logsFiltered.length) {
        box.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Chưa có log nào.</div>';
        return;
    }
    const sevIcon = { info: 'ℹ️', warn: '⚠️', error: '🔴' };
    // Mỗi log entry có border-left màu theo severity
    box.innerHTML = logsFiltered.map(l => `
        <div class="log-entry severity-${l.severity || 'info'}">
            <div class="log-header">
                <div>
                    <span class="log-action">${l.action}</span>
                    <span class="log-severity-badge ${l.severity || 'info'}">${sevIcon[l.severity] || ''} ${l.severity || 'info'}</span>
                </div>
                <button class="log-delete-btn" onclick="deleteLog(${l.id})" title="Xóa log">🗑️</button>
            </div>
            <div class="log-meta">
                <span>🕐 ${l.ts || '--'}</span>
                <span>👤 ${l.author || 'admin'}</span>
                ${l.target ? '<span>🎯 ' + l.target + '</span>' : ''}
                ${l.ip && l.ip !== 'unknown' ? '<span>🌐 ' + l.ip + '</span>' : ''}
            </div>
            ${l.details ? '<div class="log-details">' + l.details + '</div>' : ''}
        </div>
    `).join('');
}

function filterLogTable() {
    const q = (document.getElementById('log-search')?.value || '').toLowerCase().trim();
    if (!q) { logsFiltered = logsData; }
    else {
        logsFiltered = logsData.filter(l =>
            (l.action + ' ' + (l.target || '') + ' ' + (l.details || '') + ' ' + (l.author || ''))
                .toLowerCase().includes(q)
        );
    }
    renderLogs();
}

function openNewLogDialog() {
    const dlg = document.getElementById('log-dialog');
    if (!dlg) return;
    dlg.style.display = 'flex';
    // Reset form
    document.getElementById('log-form-action').value = '';
    document.getElementById('log-form-target').value = '';
    document.getElementById('log-form-details').value = '';
    document.getElementById('log-form-severity').value = 'info';
    document.getElementById('log-form-action').focus();
}

function closeLogDialog() {
    const dlg = document.getElementById('log-dialog');
    if (dlg) dlg.style.display = 'none';
}

async function submitNewLog() {
    const action = document.getElementById('log-form-action').value.trim();
    if (!action) { alert('Vui lòng nhập action'); return; }
    const target = document.getElementById('log-form-target').value.trim();
    const details = document.getElementById('log-form-details').value.trim();
    const severity = document.getElementById('log-form-severity').value;
    try {
        const r = await fetch(API + '/api/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ action, target, details, severity, author: 'phuyy' })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        closeLogDialog();
        await loadLogs();
    } catch(e) { alert('Ghi log thất bại: ' + e.message); }
}

async function deleteLog(id) {
    if (!confirm('Xóa log #' + id + '?')) return;
    try {
        const r = await fetch(API + '/api/logs/' + id, {
            method: 'DELETE',
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadLogs();
    } catch(e) { alert('Xóa thất bại: ' + e.message); }
}

// ===== CLONE ALL SENSORS =====
// Clone N sensor mới nhất (dùng khi muốn có nhiều data để test chart)
function toggleCloneAll() {
    const check = document.getElementById('clone-all-check');
    const wrapper = document.getElementById('clone-list-wrapper');
    const btn = document.getElementById('btn-clone-all');
    if (!check) return;
    if (check.checked) {
        if (wrapper) wrapper.style.display = 'none';  // Ẩn list
        if (btn) btn.style.display = '';              // Hiện nút clone all
    } else {
        if (wrapper) wrapper.style.display = '';
        if (btn) btn.style.display = 'none';
    }
}

async function cloneAllSensors() {
    const limitEl = document.getElementById('clone-all-limit');
    const limit = parseInt(limitEl?.value) || 50;
    if (limit < 1 || limit > 500) { alert('Số lượng phải từ 1 đến 500'); return; }
    if (!confirm('Clone ' + limit + ' sensor mới nhất sang Debug DB?\n\nHành động này có thể tạo nhiều records.')) return;
    try {
        const r = await fetch(API + '/api/debug/clone-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ limit })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        logAction('debug_cloned', 'bulk', 'Clone ' + (d.cloned || limit) + ' sensors', 'info');
        closeCloneDialog();
        await loadDebugData();
    } catch(e) { alert('Clone thất bại: ' + e.message); }
}

// ===== ADMIN NOTES =====
// Hệ thống ghi chú kiểu Notion/Confluence nhưng đơn giản
// Có tag (note/todo/bug/maint/idea/fatal), pinned, comment
let notesData = [];
let notesFiltered = [];
let editingNoteId = null;

function getCurrentAuthor() {
    return localStorage.getItem('admin_user') || 'phuyy';
}

async function loadNotes() {
    const box = document.getElementById('note-list');
    if (!box) return;
    box.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Đang tải...</div>';
    try {
        const author = document.getElementById('note-filter-author')?.value || '';
        const tag = document.getElementById('note-filter-tag')?.value || '';
        let url = API + '/api/notes?';
        if (author) url += 'author=' + encodeURIComponent(author) + '&';
        if (tag) url += 'tag=' + encodeURIComponent(tag);
        const r = await fetch(url, { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        notesData = await r.json();
        notesFiltered = notesData;
        renderNoteList();
    } catch(e) {
        box.innerHTML = '<div style="text-align:center; padding:40px; color:#f85149;">Lỗi: ' + e.message + '</div>';
    }
}

function renderNoteList() {
    const box = document.getElementById('note-list');
    const count = document.getElementById('note-count');
    if (!box) return;
    if (count) count.textContent = notesFiltered.length + ' notes';
    if (!notesFiltered.length) {
        box.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Chưa có ghi chú. Bấm "Ghi chú mới" để tạo.</div>';
        return;
    }
    const tagIcon = { note: '📝', todo: '✅', bug: '🐛', maint: '🔧', idea: '💡', fatal: '💀' };
    box.innerHTML = notesFiltered.map(n => `
        <div class="note-card ${n.pinned ? 'pinned' : ''}" data-id="${n.id}">
            <div class="note-header">
                <div class="note-title-wrap">
                    ${n.pinned ? '<span class="note-pin">📌</span>' : ''}
                    <span class="note-tag tag-${n.tag}">${tagIcon[n.tag] || '📝'} ${n.tag}</span>
                    <h3 class="note-title">${n.title}</h3>
                </div>
                <div class="note-actions">
                    <button class="note-btn" onclick="togglePinNote(${n.id}, ${n.pinned ? 0 : 1})" title="${n.pinned ? 'Bỏ pin' : 'Pin'}">${n.pinned ? '📌' : '📍'}</button>
                    <button class="note-btn" onclick="openEditNoteDialog(${n.id})" title="Sửa">✏️</button>
                    <button class="note-btn note-btn-del" onclick="deleteNote(${n.id})" title="Xóa">🗑️</button>
                </div>
            </div>
            <div class="note-content">${n.content}</div>
            <div class="note-footer">
                <span>👤 <strong>${n.author}</strong></span>
                <span>🕐 ${n.ts || '--'}</span>
                ${n.updated_at ? '<span>✏️ sửa: ' + n.updated_at + '</span>' : ''}
            </div>
            <div class="note-comments">
                <button class="note-comments-toggle" onclick="toggleNoteComments(${n.id})">💬 Bình luận</button>
                <div id="nc-wrap-${n.id}" style="display:none;"></div>
            </div>
        </div>
    `).join('');
}

function filterNoteList() {
    const q = (document.getElementById('note-search')?.value || '').toLowerCase().trim();
    if (!q) { notesFiltered = notesData; }
    else {
        notesFiltered = notesData.filter(n =>
            (n.title + ' ' + n.content + ' ' + n.author + ' ' + n.tag).toLowerCase().includes(q)
        );
    }
    renderNoteList();
}

function openNewNoteDialog() {
    editingNoteId = null;
    document.getElementById('note-dialog-title').textContent = '✏️ Ghi chú mới';
    document.getElementById('note-form-title').value = '';
    document.getElementById('note-form-content').value = '';
    document.getElementById('note-form-tag').value = 'note';
    document.getElementById('note-form-author').value = getCurrentAuthor();
    document.getElementById('note-dialog').style.display = 'flex';
    setTimeout(() => document.getElementById('note-form-title').focus(), 100);
}

function openEditNoteDialog(id) {
    const n = notesData.find(x => x.id === id);
    if (!n) return;
    editingNoteId = id;
    document.getElementById('note-dialog-title').textContent = '✏️ Sửa ghi chú #' + id;
    document.getElementById('note-form-title').value = n.title;
    document.getElementById('note-form-content').value = n.content;
    document.getElementById('note-form-tag').value = n.tag || 'note';
    document.getElementById('note-form-author').value = n.author;
    document.getElementById('note-dialog').style.display = 'flex';
}

function closeNoteDialog() {
    const dlg = document.getElementById('note-dialog');
    if (dlg) dlg.style.display = 'none';
}

async function submitNote() {
    const title = document.getElementById('note-form-title').value.trim();
    const content = document.getElementById('note-form-content').value.trim();
    const tag = document.getElementById('note-form-tag').value;
    const author = document.getElementById('note-form-author').value || getCurrentAuthor();
    if (!title || !content) { alert('Vui lòng nhập tiêu đề và nội dung'); return; }
    try {
        const isEdit = editingNoteId !== null;
        const url = isEdit ? API + '/api/notes/' + editingNoteId : API + '/api/notes';
        const method = isEdit ? 'PUT' : 'POST';
        const body = isEdit ? { title, content, tag } : { title, content, tag, author };
        // Tag fatal → tự động pin
        if (tag === 'fatal') body.pinned = 1;
        const r = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify(body)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction(isEdit ? 'note_updated' : 'note_created',
            'note#' + (editingNoteId || 'new'), title, 'info');
        closeNoteDialog();
        await loadNotes();
    } catch(e) { alert('Lưu thất bại: ' + e.message); }
}

async function deleteNote(id) {
    if (!confirm('Xóa ghi chú #' + id + '?')) return;
    try {
        const r = await fetch(API + '/api/notes/' + id, {
            method: 'DELETE',
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('note_deleted', 'note#' + id, '', 'warn');
        await loadNotes();
    } catch(e) { alert('Xóa thất bại: ' + e.message); }
}

async function togglePinNote(id, pinned) {
    try {
        const r = await fetch(API + '/api/notes/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ pinned: pinned })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadNotes();
    } catch(e) { alert('Đổi pin thất bại: ' + e.message); }
}

// ===== USERS MANAGEMENT =====
// Chỉ head_admin thấy tab này. Admin thường không được tạo user
let usersData = [];
let editingUserId = null;

async function loadUsers() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải...</td></tr>';
    try {
        const r = await fetch(API + '/api/users', { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        usersData = await r.json();
        renderUsersTable();
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#f85149;">Lỗi: ' + e.message + '</td></tr>';
    }
}

function renderUsersTable() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    if (!usersData.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">Chưa có user</td></tr>';
        return;
    }
    tbody.innerHTML = usersData.map(u => `
        <tr>
            <td>${u.id}</td>
            <td><strong>${u.username}</strong></td>
            <td><span class="type-badge ${u.role === 'head_admin' ? 'edge' : 'manual'}">${u.role}</span></td>
            <td>${u.active ? '<span style="color:#3fb950;">✓ Active</span>' : '<span style="color:#f85149;">✗ Disabled</span>'}</td>
            <td>${u.totp_enabled ? '✓' : '—'}</td>
            <td style="font-size:11px;">${u.last_login || '—'}</td>
            <td style="font-size:11px;">${u.created_at || '—'}</td>
            <td>
                <button class="action-btn edit" onclick="editUser(${u.id})" title="Sửa pass/role">✏️</button>
                <button class="action-btn ${u.active ? 'del' : 'restore'}" onclick="toggleUserActive(${u.id}, ${u.active ? 0 : 1})" title="${u.active ? 'Disable' : 'Enable'}">${u.active ? '🔒' : '🔓'}</button>
                <button class="action-btn del" onclick="deleteUser(${u.id}, '${u.username}')" title="Xóa">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function openNewUserDialog() {
    editingUserId = null;
    document.getElementById('user-dialog-title').textContent = 'Thêm user mới';
    document.getElementById('user-form-username').value = '';
    document.getElementById('user-form-username').disabled = false;
    document.getElementById('user-form-password').value = '';
    document.getElementById('user-form-role').value = 'admin';
    document.getElementById('user-dialog-submit').textContent = 'Thêm';
    document.getElementById('user-dialog-error').textContent = '';
    document.getElementById('user-dialog').style.display = 'flex';
    setTimeout(() => document.getElementById('user-form-username').focus(), 100);
}

function editUser(id) {
    const u = usersData.find(x => x.id === id);
    if (!u) return;
    editingUserId = id;
    document.getElementById('user-dialog-title').textContent = 'Sửa user: ' + u.username;
    document.getElementById('user-form-username').value = u.username;
    document.getElementById('user-form-username').disabled = true;  // Không cho đổi username
    document.getElementById('user-form-password').value = '';
    document.getElementById('user-form-role').value = u.role;
    document.getElementById('user-dialog-submit').textContent = 'Lưu';
    document.getElementById('user-dialog-error').textContent = '';
    document.getElementById('user-dialog').style.display = 'flex';
}

function closeUserDialog() {
    document.getElementById('user-dialog').style.display = 'none';
    document.getElementById('user-dialog-error').textContent = '';
}

async function submitUser() {
    const username = document.getElementById('user-form-username').value.trim();
    const password = document.getElementById('user-form-password').value;
    const role = document.getElementById('user-form-role').value;
    const errEl = document.getElementById('user-dialog-error');
    errEl.textContent = '';

    if (editingUserId) {
        // Update: chỉ gửi password nếu user có nhập (không thì giữ nguyên)
        const body = { role };
        if (password) body.password = password;
        try {
            const r = await fetch(API + '/api/users/' + editingUserId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
                body: JSON.stringify(body)
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
            closeUserDialog();
            await loadUsers();
        } catch(e) { errEl.textContent = e.message; errEl.style.color = '#f85149'; }
    } else {
        // Create mới
        if (!username || !password) {
            errEl.textContent = 'Nhập đủ username và password';
            errEl.style.color = '#f85149';
            return;
        }
        try {
            const r = await fetch(API + '/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
                body: JSON.stringify({ username, password, role })
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
            closeUserDialog();
            await loadUsers();
        } catch(e) { errEl.textContent = e.message; errEl.style.color = '#f85149'; }
    }
}

async function toggleUserActive(id, active) {
    const u = usersData.find(x => x.id === id);
    if (!u) return;
    if (!confirm((active ? 'Kích hoạt' : 'Vô hiệu hóa') + ' user "' + u.username + '"?')) return;
    try {
        const r = await fetch(API + '/api/users/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ active: active })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadUsers();
    } catch(e) { alert('Thất bại: ' + e.message); }
}

async function deleteUser(id, name) {
    if (!confirm('Xóa user "' + name + '"?\n\nHành động này không thể hoàn tác.')) return;
    try {
        const r = await fetch(API + '/api/users/' + id, {
            method: 'DELETE',
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadUsers();
    } catch(e) { alert('Xóa thất bại: ' + e.message); }
}

// Enter trong password field → submit form luôn
document.addEventListener('DOMContentLoaded', () => {
    const pwd = document.getElementById('user-form-password');
    if (pwd) pwd.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitUser(); }
    });
});

// ===== DB VIEWER (readonly) =====
// Cho phép xem bất kỳ bảng nào, có phân trang + search
let dbState = { table: 'sensor', offset: 0, limit: 100, total: 0, q: '' };
let dbSearchTimer = null;

// Debounce search 300ms (không spam API mỗi ký tự)
function debouncedDBSearch() {
    clearTimeout(dbSearchTimer);
    dbSearchTimer = setTimeout(() => {
        dbState.q = document.getElementById('db-search').value.trim();
        dbState.offset = 0;  // Reset về trang đầu
        loadDBTable();
    }, 300);
}

async function loadDBTable() {
    const sel = document.getElementById('db-table-select');
    if (!sel) return;
    dbState.table = sel.value;
    const thead = document.getElementById('db-thead');
    const tbody = document.getElementById('db-tbody');
    tbody.innerHTML = '<tr><td style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải...</td></tr>';
    try {
        const params = new URLSearchParams({
            limit: dbState.limit,
            offset: dbState.offset,
            q: dbState.q
        });
        const r = await fetch(API + '/api/db/' + dbState.table + '?' + params.toString(), {
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        dbState.total = d.total || 0;

        // Render header từ d.columns
        thead.innerHTML = '<tr>' + d.columns.map(c => '<th>' + c + '</th>').join('') + '</tr>';

        if (!d.rows || !d.rows.length) {
            tbody.innerHTML = '<tr><td colspan="' + d.columns.length + '" style="text-align:center; padding:20px; color:var(--text-muted);">Không có data</td></tr>';
        } else {
            // Render rows, truncate value dài (>60 ký tự)
            tbody.innerHTML = d.rows.map(row =>
                '<tr>' + d.columns.map(c => {
                    let v = row[c];
                    if (v === null || v === undefined) v = '—';
                    else if (typeof v === 'string' && v.length > 60) v = v.substring(0, 60) + '...';
                    const title = String(row[c] === null ? '' : row[c]).replace(/"/g, '&quot;');
                    return '<td title="' + title + '">' + v + '</td>';
                }).join('') + '</tr>'
            ).join('');
        }

        // Pagination
        const start = dbState.total === 0 ? 0 : dbState.offset + 1;
        const end = Math.min(dbState.offset + dbState.limit, dbState.total);
        document.getElementById('db-pagination').textContent = start + '–' + end + ' / ' + dbState.total;
        document.getElementById('db-prev').disabled = dbState.offset === 0;
        document.getElementById('db-next').disabled = end >= dbState.total;
    } catch(e) {
        tbody.innerHTML = '<tr><td style="text-align:center; padding:20px; color:#f85149;">Lỗi: ' + e.message + '</td></tr>';
    }
}

function dbPrevPage() {
    if (dbState.offset === 0) return;
    dbState.offset = Math.max(0, dbState.offset - dbState.limit);
    loadDBTable();
}

function dbNextPage() {
    if (dbState.offset + dbState.limit >= dbState.total) return;
    dbState.offset += dbState.limit;
    loadDBTable();
}

// ===== NOTE COMMENTS =====
// Comment kiểu GitHub: avatar + name + time + content
async function loadNoteComments(noteId, container) {
    container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Đang tải...</div>';
    try {
        const r = await fetch(API + '/api/notes/' + noteId + '/comments');
        const list = await r.json();
        renderNoteComments(noteId, container, list);
    } catch(e) {
        container.innerHTML = '<div style="font-size:12px; color:var(--red);">Lỗi: ' + e.message + '</div>';
    }
}

function renderNoteComments(noteId, container, list) {
    const currentUser = localStorage.getItem('admin_user') || '';
    const commentsHtml = list.length ? list.map(c => {
        const initial = (c.username || '?').charAt(0).toUpperCase();
        // Chỉ user tạo comment hoặc head_admin mới xóa được
        const canDel = c.username === currentUser || (typeof isHeadAdmin === 'function' && isHeadAdmin());
        return `
            <div class="comment-item">
                <div class="comment-avatar">${initial}</div>
                <div class="comment-body">
                    <div class="comment-header">
                        <span class="comment-user">${c.username}</span>
                        <span class="comment-time">${c.created_at || '--'}</span>
                        ${canDel ? `<button class="comment-del" onclick="delNoteComment(${c.id}, ${noteId}, this)" title="Xóa">🗑️</button>` : ''}
                    </div>
                    <div class="comment-content">${escapeHtml(c.content)}</div>
                </div>
            </div>
        `;
    }).join('') : '<div style="font-size:12px; color:var(--text-muted); font-style:italic;">Chưa có comment</div>';
    container.innerHTML = `
        <div class="note-comments-list" id="nc-list-${noteId}">${commentsHtml}</div>
        <div class="comment-input-row">
            <textarea class="comment-input" id="nc-input-${noteId}" placeholder="Viết comment..." rows="1"></textarea>
            <button class="btn-primary btn-mini" onclick="submitNoteComment(${noteId})">Gửi</button>
        </div>
    `;
}

// Escape HTML để tránh XSS khi render comment
function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

async function submitNoteComment(noteId) {
    const input = document.getElementById('nc-input-' + noteId);
    const content = (input.value || '').trim();
    if (!content) return;
    try {
        const r = await fetch(API + '/api/notes/' + noteId + '/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ content })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        input.value = '';
        await loadNoteComments(noteId, document.getElementById('nc-wrap-' + noteId));
    } catch(e) { alert('Lỗi: ' + e.message); }
}

async function delNoteComment(id, noteId) {
    if (!confirm('Xóa comment này?')) return;
    try {
        const r = await fetch(API + '/api/comments/' + id, {
            method: 'DELETE',
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadNoteComments(noteId, document.getElementById('nc-wrap-' + noteId));
    } catch(e) { alert('Lỗi: ' + e.message); }
}

// Toggle hiện/ẩn comment box (lazy load lần đầu)
function toggleNoteComments(noteId) {
    const wrap = document.getElementById('nc-wrap-' + noteId);
    if (!wrap) return;
    if (wrap.style.display === 'none' || !wrap.style.display) {
        wrap.style.display = 'block';
        loadNoteComments(noteId, wrap);
    } else {
        wrap.style.display = 'none';
    }
}

// ===== INCIDENTS MANAGEMENT =====
// Quản lý sự cố: service nào, bắt đầu khi nào, ETA, resolved
let incidentsData = [];
let editingIncidentId = null;

async function loadIncidents() {
    const tbody = document.getElementById('incidents-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải...</td></tr>';
    try {
        const r = await fetch(API + '/api/incidents?days=90');
        incidentsData = await r.json();
        if (!incidentsData.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">Chưa có sự cố nào</td></tr>';
            return;
        }
        tbody.innerHTML = incidentsData.map(i => `
            <tr>
                <td>${i.id}</td>
                <td>${i.service}</td>
                <td><span class="type-badge ${i.status === 'offline' ? 'edge' : 'manual'}">${i.status}</span></td>
                <td style="font-size:11px;">${i.started_at || '—'}</td>
                <td style="font-size:11px; color:#d29922;">${i.eta || '—'}</td>
                <td style="font-size:11px; color:#3fb950;">${i.resolved_at || '—'}</td>
                <td>${i.note || '—'}</td>
                <td>
                    <button class="action-btn edit" onclick="editIncident(${i.id})" title="Sửa">✏️</button>
                    <button class="action-btn del" onclick="deleteIncident(${i.id})" title="Xóa">🗑️</button>
                </td>
            </tr>
        `).join('');
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:#f85149;">Lỗi: ${e.message}</td></tr>`;
    }
}

function openIncidentDialog() {
    editingIncidentId = null;
    const ttl = document.getElementById('inc-dialog-title');
    if (ttl) ttl.textContent = 'Thêm sự cố';
    // Default thời gian bắt đầu = bây giờ (format datetime-local)
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const localStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' +
                     pad(now.getDate()) + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    const startedEl = document.getElementById('inc-started');
    if (startedEl) startedEl.value = localStr;
    ['inc-eta', 'inc-resolved', 'inc-note'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const dlg = document.getElementById('incident-dialog');
    if (dlg) dlg.style.display = 'flex';
}

function editIncident(id) {
    const inc = incidentsData.find(x => x.id === id);
    if (!inc) return;
    editingIncidentId = id;
    const ttl = document.getElementById('inc-dialog-title');
    if (ttl) ttl.textContent = 'Sửa sự cố #' + id;
    // Convert DB format "2026-10-26 13:07:05" → datetime-local "2026-10-26T13:07"
    document.getElementById('inc-service').value = inc.service || 'stm32';
    document.getElementById('inc-status').value = inc.status || 'offline';
    document.getElementById('inc-started').value = (inc.started_at || '').replace(' ', 'T').slice(0, 16);
    document.getElementById('inc-eta').value = inc.eta ? inc.eta.replace(' ', 'T').slice(0, 16) : '';
    document.getElementById('inc-resolved').value = inc.resolved_at ? inc.resolved_at.replace(' ', 'T').slice(0, 16) : '';
    document.getElementById('inc-note').value = inc.note || '';
    document.getElementById('incident-dialog').style.display = 'flex';
}

function closeIncidentDialog() {
    document.getElementById('incident-dialog').style.display = 'none';
}

async function submitIncident() {
    const service = document.getElementById('inc-service').value;
    const status = document.getElementById('inc-status').value;
    const started = document.getElementById('inc-started').value;
    const eta = document.getElementById('inc-eta').value;
    const resolved = document.getElementById('inc-resolved').value;
    const note = document.getElementById('inc-note').value.trim();
    if (!started) { alert('Vui lòng nhập thời gian bắt đầu'); return; }

    // Convert datetime-local "2026-10-26T13:07" → SQL "2026-10-26 13:07:00"
    const fmtDT = (s) => {
        if (!s) return null;
        return s.replace('T', ' ') + (s.length === 16 ? ':00' : '');
    };

    const isEdit = editingIncidentId !== null;
    const url = isEdit ? API + '/api/incidents/' + editingIncidentId : API + '/api/incidents';
    const method = isEdit ? 'PUT' : 'POST';
    try {
        const r = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({
                service, status,
                started_at: fmtDT(started),
                eta: fmtDT(eta),
                resolved_at: fmtDT(resolved),
                note
            })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
        closeIncidentDialog();
        await loadIncidents();
    } catch(e) { alert('Lỗi: ' + e.message); }
}

async function deleteIncident(id) {
    if (!confirm('Xóa sự cố #' + id + '?')) return;
    try {
        const r = await fetch(API + '/api/incidents/' + id, {
            method: 'DELETE',
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadIncidents();
    } catch(e) { alert('Lỗi: ' + e.message); }
}
```

index.html
```html
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <title>AirWatch </title>

    <!-- FAVICON: SVG inline (không cần file ảnh ngoài) -->
    <!-- Nền xanh lá #4CAF50 + chữ "A" trắng ở giữa -->
    <!-- Data URI tự chứa → load tức thì, không cần request -->
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%234CAF50'/><text x='50' y='68' font-size='60' font-family='Arial' font-weight='bold' fill='white' text-anchor='middle'>A</text></svg>">

    <!-- CSS chính: theme dark/light, layout toàn site -->
    <link rel="stylesheet" href="style.css">

    <!-- Leaflet CSS: thư viện bản đồ mã nguồn mở (dùng cho section mạng lưới trạm) -->
    <!-- CDN unpkg, version pin 1.9.4 để tránh breaking changes -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
</head>

<!-- body.landing: class đặc biệt để CSS bỏ padding mặc định (trang landing full-width) -->
<body class="landing">

    <!-- ============================================ -->
    <!-- NAV — thanh điều hướng sticky top             -->
    <!-- ============================================ -->
    <nav class="nav">
        <!-- Nút scroll-to-top: ẩn mặc định, hiện khi scroll > 300px (JS bên dưới) -->
        <button id="scrollTopBtn" title="Lên đầu trang">↑</button>

        <!-- Logo → click về trang chủ -->
        <a href="/" class="logo">AirWatch</a>

        <ul class="nav-links">
            <!-- === MENU DASHBOARD với popover === -->
            <!-- Khi click Dashboard lần đầu, hiện popover hỏi "đã xem thông tin ô nhiễm chưa?" -->
            <!-- Nếu chọn "Chưa" → scroll xuống section vấn đề, không vào dashboard -->
            <!-- Nếu chọn "Rồi" → vào dashboard luôn -->
            <!-- Logic: localStorage.has_seen_pollution flag -->
            <li style="position: relative;">
                <a href="/dashboard" id="nav-dashboard-btn">Dashboard</a>

                <!-- POPOVER: tooltip nhỏ hiện dưới nút Dashboard -->
                <!-- .show class được toggle bằng JS (dưới cùng file) -->
                <div id="welcome-popover" class="welcome-popover">
                    <!-- Mũi tên nhọn chỉ lên nút (CSS ::before, xoay 45deg hình vuông) -->
                    <div class="popover-arrow"></div>
                    <p>Chờ đã, bạn đã xem thông tin về ô nhiễm chưa?</p>
                    <div class="popover-actions">
                        <!-- Chưa → scroll xuống #van-de, set flag -->
                        <button onclick="handlePopover('no')" class="btn-pop-outline">Chưa</button>
                        <!-- Rồi → set flag, follow link /dashboard -->
                        <a href="/dashboard" onclick="handlePopover('yes')" class="btn-pop-solid">Rồi</a>
                    </div>
                </div>
            </li>

            <!-- Link đến trang bản đồ (map.html) -->
            <li><a href="/map">Bản đồ</a></li>

            <!-- Link admin: ẩn mặc định (admin-only class), JS hiện khi đã login -->
            <li class="admin-only" style="display:none;"><a href="/admin">Quản lý</a></li>

            <!-- DROPDOWN user menu (theme toggle + login/logout) -->
            <li class="dropdown">
                <button onclick="toggleMenu(event)" class="btn-primary" id="auth-btn"
                        style="padding: 8px 16px; font-size: 13px;">Guest ▾</button>
                <div class="dropdown-menu" id="dropdown-menu">
                    <!-- Toggle dark/light theme -->
                    <button onclick="toggleTheme()">
                        <span id="theme-icon">🌙</span>
                        <span id="theme-label">Chế độ tối</span>
                    </button>
                    <div class="dropdown-divider"></div>
                    <!-- Login/Logout: auth-check.js xử lý logic hiển thị -->
                    <a href="#" id="auth-action" onclick="handleAuthAction(); return false;">🔑 Đăng nhập</a>
                </div>
            </li>
        </ul>
    </nav>

    <!-- ============================================ -->
    <!-- HERO SECTION — banner chính                  -->
    <!-- ============================================ -->
    <header class="hero">
        <!-- Hiệu ứng glow xanh phía sau: pseudo element + animation pulse -->
        <div class="aqi-bg-glow"></div>

        <!-- Tiêu đề chính, chữ "Watch" bọc span.accent để đổi màu -->
        <h1>Air<span class="accent">Watch</span></h1>

        <!-- Subtitle dòng 2 -->
        <h2 style="font-size: 32px; margin-bottom: 20px; color: var(--text);">
            Theo dõi chất lượng không khí <br>
            <span class="accent">mọi lúc, mọi nơi</span>
        </h2>

        <p class="subtitle">
            Hệ thống quan trắc không khí ứng dụng công nghệ LoRa chi phí thấp, tự chủ năng lượng,
            phù hợp triển khai mật độ cao tại Việt Nam.
        </p>

        <div class="hero-actions" style="flex-direction: column; align-items: center;">
            <!-- CARD AQI REALTIME (glassmorphism) -->
            <!-- Nội dung được JS fetch từ /api/data (block script cuối file) -->
            <div class="live-aqi-card">
                <span style="font-size: 14px; color: #8899a6; text-transform: uppercase; letter-spacing: 1px;">
                    Chất lượng không khí hiện tại
                </span>

                <!-- Số AQI lớn, màu thay đổi theo bậc (xanh/vàng/cam/đỏ) -->
                <div style="font-size: 64px; font-weight: 800; color: #4CAF50; line-height: 1.1; margin: 8px 0;"
                     id="hero-aqi">--</div>

                <!-- Badge text: "Tốt" / "Trung bình" / "Kém"... -->
                <span style="background: #4CAF50; color: white; padding: 4px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;"
                      id="hero-aqi-text">Đang tải...</span>
            </div>

            <div style="display: flex; gap: 16px; margin-top: 24px;">
                <!-- "Tìm hiểu thêm" → scroll xuống section vấn đề (không phải link, chỉ trigger popover handler) -->
                <a href="javascript:void(0)" onclick="handlePopover('no')" class="btn-secondary">Tìm hiểu thêm</a>
            </div>
        </div>
    </header>

    <!-- ============================================ -->
    <!-- HOOK SECTION — câu dẫn dắt cuộn               -->
    <!-- ============================================ -->
    <!-- Tạo suspense: "bạn có thực sự biết không khí quanh mình?" -->
    <!-- Có mũi tên nhảy nhảy (animation bounceDown) chỉ xuống -->
    <section class="hook-top">
        <p class="hook-q">Không khí quanh <em>bạn</em>, bạn có thực sự biết nó sạch đến đâu?</p>
        <p class="hook-hint">
            Câu trả lời không ở đây.
            <span class="scroll-indicator">
                Cuộn xuống để khám phá <span class="arrow">↓</span>
            </span>
        </p>
    </section>

    <!-- ============================================ -->
    <!-- SECTION: VẤN ĐỀ — ô nhiễm ảnh hưởng sức khỏe  -->
    <!-- ============================================ -->
    <section id="van-de" class="content-section">

        <!-- Row 1: Ảnh trái + text phải (layout grid 2 cột) -->
        <div class="content-row">
            <div class="content-img">
                <!-- Ảnh ô nhiễm (không cần loading=lazy vì above-the-fold nếu user scroll nhanh) -->
                <img src="o_nhiem.jpg" alt="Ô nhiễm không khí">
            </div>
            <div class="content-text">
                <h3>Ô nhiễm không khí mối nguy thầm lặng</h3>
                <!-- Số liệu với .counter class → JS đếm tăng dần khi scroll tới -->
                <!-- data-target: giá trị đích, data-decimals: số chữ số thập phân -->
                <p>Ô nhiễm không khí gây ra cái chết của
                    <strong><span class="counter" data-target="7">0</span> triệu người</strong>
                    toàn cầu mỗi năm, trong đó có
                    <strong><span class="counter" data-target="1.7" data-decimals="1">0</span> triệu</strong>
                    trẻ em dưới 5 tuổi. Tại Việt Nam, ô nhiễm không khí gây thiệt hại kinh tế lên tới
                    <strong><span class="counter" data-target="12.45" data-decimals="2">0</span> tỉ đô la</strong>
                    (năm 2013). Riêng TP.HCM thất thoát 117 đến 183 triệu đô la.
                </p>
                <p>Nguy hiểm nhất là <strong>bụi siêu mịn PM2.5</strong> (nhỏ hơn sợi tóc 40 đến 100 lần).
                    Chúng chui sâu vào phổi, thậm chí vào máu, gây ung thư phổi, đột quỵ, rối loạn nhịp tim.
                    Khẩu trang thông thường không thể ngăn cản được.
                </p>
                <!-- Nguồn tham khảo: bắt buộc trong báo cáo khoa học -->
                <p style="margin-top: 16px; font-size: 13px; font-style: italic; color: var(--text-muted);">
                    Nguồn:
                    <a href="https://thanhnien.vn/giat-minh-nhung-buc-anh-bat-net-khong-khi-phoi-mau-o-nhiem-tai-viet-nam-185842697.htm"
                       target="_blank" rel="noopener noreferrer"
                       style="color: var(--accent); text-decoration: underline;">
                        Báo Thanh Niên
                    </a>
                </p>
            </div>
        </div>

        <!-- Row 2: đảo ngược (ảnh phải, text trái) — .reverse class dùng CSS direction: rtl -->
        <div class="content-row reverse" style="align-items: center;">
            <div style="flex: 1; display: flex; justify-content: center; align-items: center;">
                <img src="suc_khoe.jpg" alt="Ảnh hưởng sức khỏe"
                     style="width: 80%; max-width: 350px; height: auto; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
            </div>
            <div class="content-text" style="flex: 1;">
                <h3>Ảnh hưởng trực tiếp đến sức khỏe</h3>
                <p>Ô nhiễm không khí không chỉ là vấn đề môi trường mà còn là mối đe dọa trực tiếp đến tính mạng:</p>
                <!-- List dạng bullet với dấu ▸ custom (CSS ::before) -->
                <ul>
                    <li>Ước tính mỗi năm có
                        <strong><span class="counter" data-target="60000">0</span> người tử vong</strong>
                        tại Việt Nam do các bệnh liên quan đến ô nhiễm không khí (theo WHO).
                    </li>
                    <li>Tại TP.HCM, nghiên cứu năm 2017 ghi nhận
                        <strong><span class="counter" data-target="1397">0</span> ca tử vong</strong>
                        do ô nhiễm không khí, chiếm 13,46% tổng số ca tử vong.
                    </li>
                    <li>Bụi mịn PM2.5 là tác nhân nguy hiểm nhất, chiếm tới
                        <strong><span class="counter" data-target="81.32" data-decimals="2">0</span>%</strong>
                        số ca tử vong do ô nhiễm không khí.
                    </li>
                    <li>Tỉ lệ trẻ em mắc bệnh hen suyễn tại TP.HCM lên tới
                        <strong><span class="counter" data-target="29">0</span>%</strong>,
                        cao gấp gần 6 lần so với các tỉnh thành khác (như Cần Thơ, Lâm Đồng chỉ 5%).
                    </li>
                    <li>Số bệnh nhân nhập viện do các bệnh hô hấp và tim mạch tăng khoảng
                        <strong><span class="counter" data-target="20">0</span>%</strong>
                        vào những ngày ô nhiễm không khí ở mức cao.
                    </li>
                </ul>
                <p style="margin-top: 16px; font-size: 13px; font-style: italic; color: var(--text-muted);">
                    Nguồn:
                    <a href="https://tuoitre.vn/khong-khi-o-nhiem-so-dau-cung-ra-benh-2024040517045209.htm"
                       target="_blank" rel="noopener noreferrer"
                       style="color: var(--accent); text-decoration: underline;">
                        Báo Tuổi Trẻ
                    </a>
                </p>
            </div>
        </div>
    </section>

    <!-- ============================================ -->
    <!-- SECTION: MẠNG LƯỚI — trạm quan trắc VN        -->
    <!-- ============================================ -->
    <section id="mang-luoi" class="content-section">
        <div class="content-text" style="text-align: center; max-width: 800px; margin: 0 auto 40px;">
            <h3 style="font-size: 32px;">Trạm quan trắc còn quá thưa</h3>
            <p>Cả nước chỉ có <strong>92 trạm quan trắc không khí tự động</strong>,
                tập trung chủ yếu ở các thành phố lớn.
                Các tỉnh lẻ, vùng nông thôn gần như không có dữ liệu.
            </p>
        </div>

        <!-- 4 feature card dạng lưới -->
        <div class="features" style="margin-bottom: 50px;">
            <div class="feature">
                <div class="icon">📍</div>
                <h3>Độ phủ thấp</h3>
                <p>Người dân không biết chất lượng không khí nơi mình sống.</p>
            </div>
            <div class="feature">
                <div class="icon">⏱️</div>
                <h3>Dữ liệu chậm</h3>
                <p>Không cảnh báo kịp thời khi ô nhiễm tăng đột biến.</p>
            </div>
            <div class="feature">
                <div class="icon">🔌</div>
                <h3>Phụ thuộc điện lưới</h3>
                <p>Khó triển khai ở vùng sâu, vùng xa.</p>
            </div>
            <div class="feature">
                <div class="icon">⚠️</div>
                <h3>Thiếu minh bạch</h3>
                <p>
                    <a href="https://thanhnien.vn/cong-an-tphcm-bat-21-bi-can-lam-sai-lech-ket-qua-quan-trac-moi-truong-185261010191139411.htm"
                       target="_blank" rel="noopener noreferrer"
                       style="color: var(--accent); text-decoration: underline;">
                        Nhiều vụ việc làm sai lệch kết quả quan trắc đã bị phát hiện
                    </a>.
                </p>
            </div>
        </div>

        <div class="content-text" style="text-align: center; margin-bottom: 24px;">
            <h3 style="font-size: 22px;">Bản đồ phân bố các trạm đã xác minh</h3>
            <p style="color: var(--text-muted); font-size: 15px;">
                Các trạm tập trung chủ yếu ở đồng bằng và đô thị lớn, thưa thớt ở vùng núi và nông thôn.
            </p>
        </div>

        <!-- MAP CONTAINER: JS ở cuối file init Leaflet + add 24 markers -->
        <!-- IntersectionObserver trigger bounce animation khi user scroll tới -->
        <div id="stations-map" style="height: 600px; border-radius: 12px; border: 1px solid var(--border);"></div>

        <!-- Legend màu: 4 loại trạm (Trung ương / cảm biến / địa phương / khí tượng) -->
        <div style="display: flex; justify-content: center; gap: 24px; flex-wrap: wrap; margin-top: 20px; font-size: 13px;">
            <div><span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:#4CAF50; margin-right:6px; vertical-align:middle;"></span>Trạm Trung ương</div>
            <div><span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:#FF9800; margin-right:6px; vertical-align:middle;"></span>Trạm cảm biến</div>
            <div><span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:#f44336; margin-right:6px; vertical-align:middle;"></span>Trạm địa phương</div>
            <div><span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:#2196F3; margin-right:6px; vertical-align:middle;"></span>Trạm khí tượng lồng ghép</div>
        </div>

        <div class="content-text" style="text-align: center; margin-top: 24px;">
            <p style="color: var(--text-muted); font-size: 13px; font-style: italic;">
                Nguồn: Trung tâm Quan trắc môi trường — Cục Môi trường
            </p>
        </div>
    </section>

    <!-- ============================================ -->
    <!-- SECTION: GIẢI PHÁP — giới thiệu AirWatch      -->
    <!-- ============================================ -->
    <section id="giai-phap" class="content-section">
        <div class="content-text" style="text-align: center; margin-bottom: 60px;">
            <h3 style="font-size: 36px;">AirWatch — Giải pháp quan trắc chi phí thấp</h3>
            <p>Hệ thống quan trắc không khí ứng dụng công nghệ LoRa, hướng tới mở rộng độ phủ dữ liệu
                môi trường tới các khu vực chưa có trạm đo.
            </p>
        </div>

        <!-- 6 feature card: 6 điểm mạnh của hệ thống -->
        <div class="features">
            <div class="feature">
                <div class="icon">☀️</div>
                <h3>Tự chủ năng lượng</h3>
                <p>Pin mặt trời + pin sạc, hoạt động 24/7 không cần điện lưới.</p>
            </div>
            <div class="feature">
                <div class="icon">📡</div>
                <h3>Truyền xa</h3>
                <p>Công nghệ LoRa 920MHz, khoảng cách 2–5km, xuyên địa hình.</p>
            </div>
            <div class="feature">
                <div class="icon">⚡</div>
                <h3>Triển khai nhanh</h3>
                <p>1 người lắp đặt trong 30 phút, không cần cấu hình phức tạp.</p>
            </div>
            <div class="feature">
                <div class="icon">📊</div>
                <h3>Dữ liệu realtime</h3>
                <p>Cập nhật mỗi 7 phút, cảnh báo tức thời khi vượt ngưỡng.</p>
            </div>
            <div class="feature">
                <div class="icon">🔗</div>
                <h3>Mở rộng dễ dàng</h3>
                <p>1 gateway nhận được nhiều trạm, dễ dàng mở rộng mạng lưới.</p>
            </div>
            <div class="feature">
                <div class="icon">🌐</div>
                <h3>Minh bạch</h3>
                <p>Dữ liệu công khai trên web, ai cũng xem được.</p>
            </div>
        </div>
    </section>

    <!-- ============================================ -->
    <!-- SECTION: THÔNG SỐ — spec cảm biến             -->
    <!-- ============================================ -->
    <section id="thong-so" class="spec-section">
        <div class="spec-header">
            <h2>Thông số quan trắc</h2>
            <p>Trạm đo các thông số chất lượng không khí quan trọng</p>
        </div>

        <div class="spec-grid">
            <!-- Card 1: Bụi mịn (3 chỉ số) -->
            <div class="spec-card">
                <div class="spec-icon">🌫️</div>
                <h4>Bụi mịn</h4>
                <div class="spec-values">
                    <div><span>PM1.0</span><strong>µg/m³</strong></div>
                    <div><span>PM2.5</span><strong>µg/m³</strong></div>
                    <div><span>PM10</span><strong>µg/m³</strong></div>
                </div>
                <div class="spec-warn">Cảnh báo &gt; 50 µg/m³</div>
            </div>

            <!-- Card 2: CO (khí độc) -->
            <div class="spec-card">
                <div class="spec-icon">☠️</div>
                <h4>Khí độc</h4>
                <div class="spec-values">
                    <div><span>CO</span><strong>ppm</strong></div>
                </div>
                <div class="spec-warn">Cảnh báo &gt; 9 ppm</div>
            </div>

            <!-- Card 3: VOC/NOx (khí hữu cơ) -->
            <div class="spec-card">
                <div class="spec-icon">🧪</div>
                <h4>Khí hữu cơ</h4>
                <div class="spec-values">
                    <div><span>VOC </span><strong>0–500</strong></div>
                    <div><span>NOx </span><strong>1–500</strong></div>
                </div>
                <div class="spec-warn">VOC &gt; 200 · NOx &gt; 100</div>
            </div>

            <!-- Card 4: vi khí hậu (T/H) -->
            <div class="spec-card">
                <div class="spec-icon">🌡️</div>
                <h4>Vi khí hậu</h4>
                <div class="spec-values">
                    <div><span>Nhiệt độ</span><strong>°C</strong></div>
                    <div><span>Độ ẩm</span><strong>%</strong></div>
                </div>
                <div class="spec-warn">Nhiệt &gt; 35°C · Ẩm &lt; 30% hoặc &gt; 80%</div>
            </div>
        </div>
    </section>

    <!-- ============================================ -->
    <!-- SECTION: KIẾN THỨC — links đến trang con      -->
    <!-- ============================================ -->
    <section id="kien-thuc" class="knowledge-section">
        <div class="knowledge-header">
            <h2>Hiểu rõ hơn về ô nhiễm không khí</h2>
        </div>
        <div class="knowledge-grid">
            <!-- 4 card, mỗi card là link đến trang chi tiết -->
            <!-- Layout: title + mũi tên ↗ góc phải (absolute) -->
            <a href="/pm25" class="knowledge-card">
                <div class="knowledge-arrow">↗</div>
                <h3>PM2.5 là gì?</h3>
                <p>Bụi PM2.5 là vật chất dạng hạt trôi nổi trong không khí với đường kính bằng 2.5 micromet hoặc nhỏ hơn...</p>
            </a>
            <a href="/pm10" class="knowledge-card">
                <div class="knowledge-arrow">↗</div>
                <h3>PM10 là gì?</h3>
                <p>Bụi PM10 là vật chất dạng hạt lơ lửng trong không khí với đường kính khoảng 10 micromet hoặc nhỏ hơn...</p>
            </a>
            <a href="/ozone" class="knowledge-card">
                <div class="knowledge-arrow">↗</div>
                <h3>Ozone là gì?</h3>
                <p>Ozone (O₃) là khí được hình thành bởi bức xạ cực tím mặt trời (ánh sáng mặt trời) và các phân tử oxi...</p>
            </a>
            <a href="/nguon" class="knowledge-card">
                <div class="knowledge-arrow">↗</div>
                <h3>Nguồn ô nhiễm</h3>
                <p>Công nghiệp, giao thông, nông nghiệp, hộ gia đình và các nguồn tự nhiên gây ô nhiễm không khí...</p>
            </a>
        </div>
    </section>

    <!-- ============================================ -->
    <!-- SECTION: TÁC ĐỘNG — 2 bảng thống kê           -->
    <!-- ============================================ -->
    <section id="tac-dong" class="content-section">
        <div class="content-text" style="text-align: center; margin-bottom: 40px;">
            <h3 style="font-size: 28px;">Nguyên nhân tử vong hàng đầu</h3>
            <p>Trong 62 triệu người tử vong mỗi năm (2021), ô nhiễm không khí là yếu tố nguy cơ đứng thứ 2 toàn cầu.</p>
        </div>

        <!-- 2 bảng side-by-side (grid 2 cột), tự động stack 1 cột trên mobile -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 1100px; margin: 0 auto 20px;">

            <!-- === BẢNG THẾ GIỚI === -->
            <div>
                <h4 style="text-align: center; color: var(--accent); margin-bottom: 16px; font-size: 18px;">Thế giới (2021)</h4>
                <table class="spec-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Yếu tố rủi ro</th>
                            <th style="text-align:right;">Tử vong</th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- Mỗi dòng có .counter để animate số khi scroll tới -->
                        <!-- data-suffix="M" = "triệu", "K" = "nghìn" -->
                        <!-- Dòng highlight (background đỏ nhạt) = các yếu tố liên quan ô nhiễm KK -->
                        <tr><td>1</td><td>Huyết áp cao</td><td style="text-align:right;"><span class="counter" data-target="11.0" data-decimals="1" data-suffix="M">0</span></td></tr>
                        <tr style="background: rgba(244,67,54,0.1);"><td>2</td><td><strong>Ô nhiễm không khí (ngoài trời & trong nhà)</strong></td><td style="text-align:right;"><strong><span class="counter" data-target="7.90" data-decimals="2" data-suffix="M">0</span></strong></td></tr>
                        <tr><td>3</td><td>Hút thuốc</td><td style="text-align:right;"><span class="counter" data-target="5.81" data-decimals="2" data-suffix="M">0</span></td></tr>
                        <tr><td>4</td><td>Đường huyết cao</td><td style="text-align:right;"><span class="counter" data-target="5.34" data-decimals="2" data-suffix="M">0</span></td></tr>
                        <tr style="background: rgba(244,67,54,0.1);"><td>5</td><td><strong>Ô nhiễm hạt vật chất ngoài trời</strong></td><td style="text-align:right;"><strong><span class="counter" data-target="4.92" data-decimals="2" data-suffix="M">0</span></strong></td></tr>
                        <tr><td>6</td><td>Béo phì</td><td style="text-align:right;"><span class="counter" data-target="3.68" data-decimals="2" data-suffix="M">0</span></td></tr>
                        <tr><td>7</td><td>Cholesterol cao</td><td style="text-align:right;"><span class="counter" data-target="3.62" data-decimals="2" data-suffix="M">0</span></td></tr>
                        <tr style="background: rgba(244,67,54,0.1);"><td>8</td><td><strong>Ô nhiễm không khí trong nhà</strong></td><td style="text-align:right;"><strong><span class="counter" data-target="2.76" data-decimals="2" data-suffix="M">0</span></strong></td></tr>
                        <tr><td>9</td><td>Chế độ ăn ít trái cây</td><td style="text-align:right;"><span class="counter" data-target="1.76" data-decimals="2" data-suffix="M">0</span></td></tr>
                        <tr><td>10</td><td>Chế độ ăn nhiều natri</td><td style="text-align:right;"><span class="counter" data-target="1.67" data-decimals="2" data-suffix="M">0</span></td></tr>
                        <tr><td>11</td><td>Khói thuốc lá gián tiếp</td><td style="text-align:right;"><span class="counter" data-target="1.66" data-decimals="2" data-suffix="M">0</span></td></tr>
                        <tr><td>12</td><td>Trẻ sơ sinh nhẹ cân</td><td style="text-align:right;"><span class="counter" data-target="1.38" data-decimals="2" data-suffix="M">0</span></td></tr>
                        <tr><td>13</td><td>Sử dụng rượu</td><td style="text-align:right;"><span class="counter" data-target="1.29" data-decimals="2" data-suffix="M">0</span></td></tr>
                        <tr><td>14</td><td>Chế độ ăn ít ngũ cốc nguyên hạt</td><td style="text-align:right;"><span class="counter" data-target="1.19" data-decimals="2" data-suffix="M">0</span></td></tr>
                        <tr><td>15</td><td>Quan hệ tình dục không an toàn</td><td style="text-align:right;"><span class="counter" data-target="1.07" data-decimals="2" data-suffix="M">0</span></td></tr>
                        <tr><td>16</td><td>Chế độ ăn ít rau</td><td style="text-align:right;"><span class="counter" data-target="933" data-suffix="K">0</span></td></tr>
                        <tr><td>17</td><td>Chế độ ăn ít các loại hạt</td><td style="text-align:right;"><span class="counter" data-target="884" data-suffix="K">0</span></td></tr>
                        <tr><td>18</td><td>Nguồn nước không an toàn</td><td style="text-align:right;"><span class="counter" data-target="755" data-suffix="K">0</span></td></tr>
                        <tr><td>19</td><td>Ít vận động thể chất</td><td style="text-align:right;"><span class="counter" data-target="670" data-suffix="K">0</span></td></tr>
                        <tr><td>20</td><td>Suy dinh dưỡng ở trẻ em</td><td style="text-align:right;"><span class="counter" data-target="585" data-suffix="K">0</span></td></tr>
                        <tr><td>21</td><td>Vệ sinh không an toàn</td><td style="text-align:right;"><span class="counter" data-target="534" data-suffix="K">0</span></td></tr>
                        <tr><td>22</td><td>Sử dụng ma túy</td><td style="text-align:right;"><span class="counter" data-target="492" data-suffix="K">0</span></td></tr>
                        <tr><td>23</td><td>Mật độ khoáng xương thấp</td><td style="text-align:right;"><span class="counter" data-target="483" data-suffix="K">0</span></td></tr>
                        <tr><td>24</td><td>Không có phương tiện rửa tay</td><td style="text-align:right;"><span class="counter" data-target="416" data-suffix="K">0</span></td></tr>
                        <tr><td>25</td><td>Trẻ em thấp còi</td><td style="text-align:right;"><span class="counter" data-target="373" data-suffix="K">0</span></td></tr>
                    </tbody>
                </table>
            </div>

            <!-- === BẢNG VIỆT NAM === -->
            <!-- Tương tự bảng trên, nhưng data-target là số ca tử vong tuyệt đối -->
            <!-- Không dùng data-suffix vì số đã đủ lớn (145000 = 145 nghìn) -->
            <div>
                <h4 style="text-align: center; color: var(--accent); margin-bottom: 16px; font-size: 18px;">Việt Nam (2023)</h4>
                <table class="spec-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Yếu tố rủi ro</th>
                            <th style="text-align:right;">Tử vong</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td>1</td><td>Huyết áp cao</td><td style="text-align:right;"><span class="counter" data-target="145000">0</span></td></tr>
                        <tr style="background: rgba(244,67,54,0.1);"><td>2</td><td><strong>Ô nhiễm không khí (ngoài trời & trong nhà)</strong></td><td style="text-align:right;"><strong><span class="counter" data-target="94800">0</span></strong></td></tr>
                        <tr><td>3</td><td>Hút thuốc</td><td style="text-align:right;"><span class="counter" data-target="84600">0</span></td></tr>
                        <tr style="background: rgba(244,67,54,0.1);"><td>4</td><td><strong>Ô nhiễm hạt vật chất ngoài trời</strong></td><td style="text-align:right;"><strong><span class="counter" data-target="57600">0</span></strong></td></tr>
                        <tr><td>5</td><td>Đường huyết cao</td><td style="text-align:right;"><span class="counter" data-target="48400">0</span></td></tr>
                        <tr style="background: rgba(244,67,54,0.1);"><td>6</td><td><strong>Ô nhiễm không khí trong nhà</strong></td><td style="text-align:right;"><strong><span class="counter" data-target="36100">0</span></strong></td></tr>
                        <tr><td>7</td><td>Cholesterol cao</td><td style="text-align:right;"><span class="counter" data-target="34300">0</span></td></tr>
                        <tr><td>8</td><td>Chế độ ăn nhiều natri</td><td style="text-align:right;"><span class="counter" data-target="27900">0</span></td></tr>
                        <tr><td>9</td><td>Sử dụng rượu</td><td style="text-align:right;"><span class="counter" data-target="26800">0</span></td></tr>
                        <tr><td>10</td><td>Khói thuốc lá gián tiếp</td><td style="text-align:right;"><span class="counter" data-target="25500">0</span></td></tr>
                        <tr><td>11</td><td>Chế độ ăn ít trái cây</td><td style="text-align:right;"><span class="counter" data-target="20300">0</span></td></tr>
                        <tr><td>12</td><td>Béo phì</td><td style="text-align:right;"><span class="counter" data-target="19900">0</span></td></tr>
                        <tr><td>13</td><td>Chế độ ăn ít ngũ cốc nguyên hạt</td><td style="text-align:right;"><span class="counter" data-target="18400">0</span></td></tr>
                        <tr><td>14</td><td>Sử dụng ma túy</td><td style="text-align:right;"><span class="counter" data-target="11200">0</span></td></tr>
                        <tr><td>15</td><td>Chế độ ăn ít rau</td><td style="text-align:right;"><span class="counter" data-target="10100">0</span></td></tr>
                        <tr><td>16</td><td>Quan hệ tình dục không an toàn</td><td style="text-align:right;"><span class="counter" data-target="10100">0</span></td></tr>
                        <tr><td>17</td><td>Mật độ khoáng xương thấp</td><td style="text-align:right;"><span class="counter" data-target="9840">0</span></td></tr>
                        <tr><td>18</td><td>Chế độ ăn ít các loại hạt</td><td style="text-align:right;"><span class="counter" data-target="5610">0</span></td></tr>
                        <tr><td>19</td><td>Ít vận động thể chất</td><td style="text-align:right;"><span class="counter" data-target="4430">0</span></td></tr>
                        <tr><td>20</td><td>Trẻ sơ sinh nhẹ cân</td><td style="text-align:right;"><span class="counter" data-target="4040">0</span></td></tr>
                        <tr><td>21</td><td>Nguồn nước không an toàn</td><td style="text-align:right;"><span class="counter" data-target="1200">0</span></td></tr>
                        <tr><td>22</td><td>Không có phương tiện rửa tay</td><td style="text-align:right;"><span class="counter" data-target="958">0</span></td></tr>
                        <tr><td>23</td><td>Vệ sinh không an toàn</td><td style="text-align:right;"><span class="counter" data-target="705">0</span></td></tr>
                        <tr><td>24</td><td>Suy dinh dưỡng ở trẻ em</td><td style="text-align:right;"><span class="counter" data-target="664">0</span></td></tr>
                        <tr><td>25</td><td>Trẻ em thấp còi</td><td style="text-align:right;"><span class="counter" data-target="514">0</span></td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Nguồn: IHME Global Burden of Disease -->
        <p style="text-align: center; color: var(--text-muted); font-size: 13px; margin-bottom: 60px; font-style: italic;">
            Nguồn: <a href="https://ourworldindata.org/grapher/number-of-deaths-by-risk-factor"
                     target="_blank" rel="noopener"
                     style="color: var(--accent); text-decoration: underline;">IHME, Global Burden of Disease</a>
        </p>

        <!-- Sub-section: Ảnh hưởng đến trẻ em (3 feature card) -->
        <div class="content-text" style="text-align: center; margin-bottom: 40px;">
            <h3 style="font-size: 28px;">Ảnh hưởng đến trẻ em</h3>
        </div>
        <div class="features" style="margin-bottom: 20px;">
            <div class="feature">
                <div class="icon">🫁</div>
                <h3>Vấn đề hô hấp</h3>
                <p>Tăng các trường hợp hen suyễn và viêm phế quản.</p>
            </div>
            <div class="feature">
                <div class="icon">💨</div>
                <h3>Giảm chức năng phổi</h3>
                <p>Tiếp xúc lâu dài có thể làm suy yếu sự phát triển của phổi.</p>
            </div>
            <div class="feature">
                <div class="icon">🧠</div>
                <h3>Phát triển nhận thức</h3>
                <p>Tác động tiềm tàng đến sự phát triển não bộ và thành tích học tập.</p>
            </div>
        </div>
        <p style="text-align: center; color: var(--text-muted); font-size: 13px; margin-bottom: 60px; font-style: italic;">
            Nguồn: <a href="https://www.eea.europa.eu/" target="_blank" rel="noopener"
                     style="color: var(--accent); text-decoration: underline;">EEA (European Environment Agency)</a>
        </p>

        <!-- Sub-section: Tác động theo từng chất ô nhiễm (3 card) -->
        <div class="content-text" style="text-align: center; margin-bottom: 40px;">
            <h3 style="font-size: 28px;">Tác động theo từng chất ô nhiễm</h3>
            <p style="color: var(--text-muted);">Ảnh hưởng cụ thể của từng loại khí độc và bụi mịn đến cơ thể con người.</p>
        </div>

        <div class="pollutant-grid">
            <!-- Card Ozone: ảnh hưởng cấp tính -->
            <div class="pollutant-card">
                <div class="pollutant-header">
                    <div class="pollutant-icon">☀️</div>
                    <h4>Ozone mặt đất (O₃)</h4>
                </div>
                <ul class="pollutant-list">
                    <li>Giảm chức năng phổi</li>
                    <li>Bệnh hen suyễn trầm trọng hơn</li>
                    <li>Kích ứng cổ họng và ho</li>
                    <li>Đau ngực và khó thở</li>
                    <li>Viêm mô phổi</li>
                    <li>Tăng nguy cơ nhiễm trùng đường hô hấp</li>
                </ul>
            </div>

            <!-- Card PM ngắn hạn -->
            <div class="pollutant-card">
                <div class="pollutant-header">
                    <div class="pollutant-icon">⏱️</div>
                    <h4>Bụi mịn (PM) - Ngắn hạn</h4>
                </div>
                <ul class="pollutant-list">
                    <li>Nhịp tim không đều</li>
                    <li>Đau ngực</li>
                    <li>Ho</li>
                    <li>Kích ứng mắt, mũi và họng</li>
                    <li>Bệnh hen suyễn trầm trọng hơn</li>
                    <li>Giảm chức năng phổi</li>
                </ul>
            </div>

            <!-- Card PM dài hạn -->
            <div class="pollutant-card">
                <div class="pollutant-header">
                    <div class="pollutant-icon">⏳</div>
                    <h4>Bụi mịn (PM) - Dài hạn</h4>
                </div>
                <ul class="pollutant-list">
                    <li>Tổn thương mô phổi</li>
                    <li>Bệnh ung thư</li>
                    <li>Phát triển bệnh hen suyễn, viêm phế quản, khí phế thũng</li>
                    <li>Tử vong sớm</li>
                </ul>
            </div>
        </div>
    </section>

    <!-- ============================================ -->
    <!-- CTA SECTION — nút mở Dashboard               -->
    <!-- ============================================ -->
    <section class="section cta-section">
        <h2>Sẵn sàng xem dữ liệu?</h2>
        <!-- Click → set flag + vào dashboard -->
        <a href="/dashboard" onclick="handlePopover('yes')" class="btn-primary btn-large">Mở Dashboard</a>
    </section>

    <!-- ============================================ -->
    <!-- FOOTER                                        -->
    <!-- ============================================ -->
    <footer>
        <p><strong>AirWatch</strong> — Hệ thống quan trắc không khí LoRa</p>
        <p>Dự án Khoa học Kỹ thuật 2026</p>
    </footer>

    <!-- ============================================ -->
    <!-- MODAL: LOGIN                                  -->
    <!-- ============================================ -->
    <!-- Hiện khi user click "Đăng nhập" trong dropdown -->
    <!-- .modal-overlay là backdrop tối (position fixed) -->
    <div class="modal-overlay" id="login-modal" style="display:none;">
        <div class="modal">
            <!-- Nút X đóng modal (gọi closeLogin() ở auth-ui.js) -->
            <button class="modal-close" onclick="closeLogin()">×</button>

            <div class="login-logo">AirWatch</div>
            <h2>Đăng nhập Admin</h2>

            <!-- Form submit → auth-ui.js handle (không có action attribute) -->
            <form id="login-form">
                <label>
                    <span>Tài khoản</span>
                    <!-- autocomplete="username" để password manager auto-fill -->
                    <input type="text" id="login-user" autocomplete="username" required>
                </label>
                <label>
                    <span>Mật khẩu</span>
                    <input type="password" id="login-pass" autocomplete="current-password" required>
                </label>

                <!-- OTP field: ẩn mặc định, chỉ hiện khi user là head_admin -->
                <!-- Sau khi submit username/pass, server trả về need_otp → JS show field này -->
                <label id="login-otp-wrap" style="display:none;">
                    <span>Mã OTP (6 số)</span>
                    <!-- pattern [0-9]{6}: chỉ cho nhập đúng 6 số -->
                    <!-- inputmode="numeric": mobile hiện bàn phím số -->
                    <input type="text" id="login-otp" inputmode="numeric" pattern="[0-9]{6}"
                           maxlength="6" autocomplete="one-time-code" placeholder="123456">
                </label>

                <button type="submit" class="btn-primary btn-full">Đăng nhập</button>
                <!-- Error message render ở đây khi login fail -->
                <div class="login-error" id="login-error"></div>
            </form>
        </div>
    </div>

    <!-- ============================================ -->
    <!-- MODAL: QR SETUP TOTP (2FA)                    -->
    <!-- ============================================ -->
    <!-- Hiện khi head_admin login lần đầu (chưa setup TOTP) -->
    <div class="modal-overlay" id="qr-modal" style="display:none;">
        <div class="modal" style="max-width:480px;">
            <button class="modal-close" onclick="closeQRModal()">×</button>
            <h2>Setup Google Authenticator</h2>
            <p style="color:var(--text-muted); font-size:13px; margin:8px 0 16px;">
                Quét QR bằng Google Authenticator / FreeOTP, sau đó nhập mã 6 số bên dưới.
            </p>

            <!-- QR code image: src set bằng JS (data URL từ server) -->
            <!-- Nền trắng để QR dễ scan (dù theme dark) -->
            <div style="text-align:center; padding:16px; background:#fff; border-radius:10px; margin-bottom:16px;">
                <img id="qr-img" src="" alt="QR Code"
                     style="width:280px; height:280px; display:block; margin:0 auto;">
            </div>

            <!-- Fallback: nếu không quét được QR → nhập secret bằng tay -->
            <details style="margin-bottom:16px;">
                <summary style="cursor:pointer; color:var(--text-muted); font-size:12px;">
                    Hoặc nhập secret bằng tay
                </summary>
                <code id="qr-secret"
                      style="display:block; padding:8px; background:var(--bg); border-radius:6px; margin-top:8px; font-size:11px; word-break:break-all;"></code>
            </details>

            <label>
                <span>Nhập mã 6 số từ app</span>
                <input type="text" id="qr-otp" inputmode="numeric" pattern="[0-9]{6}"
                       maxlength="6" placeholder="123456" autocomplete="one-time-code">
            </label>

            <!-- Submit → verify TOTP, server lưu totp_enabled=1 -->
            <button onclick="verifyQRCode()" class="btn-primary btn-full" id="qr-verify-btn">Xác nhận</button>
            <div class="login-error" id="qr-error"></div>
        </div>
    </div>

    <!-- ============================================ -->
    <!-- SCRIPTS                                       -->
    <!-- ============================================ -->

    <!-- Leaflet JS: phải load trước script init map -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

    <!-- auth-check.js: checkAuth(), isAdmin(), isHeadAdmin(), logout(), getToken() -->
    <script src="auth-check.js"></script>

    <!-- auth-ui.js: login flow, QR modal flow -->
    <script src="auth-ui.js"></script>

        <!-- ============================================ -->
    <!-- SCRIPT 1: REVEAL + COUNTER + 3D TILT          -->
    <!-- ============================================ -->
    <script>
        // ===== 1. REVEAL ANIMATION (fade-up khi scroll) =====
        // IntersectionObserver: theo dõi khi element vào viewport
        // threshold 0.15 = trigger khi 15% element hiện ra
        // rootMargin -80px bottom = trigger sớm hơn 80px (đẹp hơn)
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    // Thêm class .active → CSS transition fade + translateY
                    entry.target.classList.add('active');
                }
            });
        }, {
            threshold: 0.15,
            rootMargin: '0px 0px -80px 0px'
        });

        // Áp dụng reveal cho các element chính
        // Mỗi element được gán delay so le (i % 3) * 0.1s để hiện lần lượt
        document.querySelectorAll('.content-row, .hero h1, .hero .subtitle, .spec-header, .cta-section h2, .knowledge-card, .knowledge-header')
            .forEach((el, i) => {
                el.classList.add('reveal');
                // Chỉ knowledge-card có delay so le (3 cái/hàng)
                if (el.classList.contains('knowledge-card')) {
                    el.style.transitionDelay = (i % 3) * 0.1 + 's';
                }
                observer.observe(el);
            });

        // Áp dụng reveal cho feature + spec card (grid 3 cột → delay theo vị trí)
        document.querySelectorAll('.feature, .spec-card').forEach((el, i) => {
            el.classList.add('reveal');
            el.style.transitionDelay = (i % 3) * 0.1 + 's';
            observer.observe(el);
        });

        // ===== 2. COUNTER ANIMATION (đếm số khi scroll tới) =====
        // Tìm tất cả element có class .counter (VD: data-target="7")
        const counters = document.querySelectorAll('.counter');

        // Observer riêng cho counter — chỉ chạy 1 lần (unobserve sau trigger)
        const observerCounter = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    startCounting(entry.target);
                    observerCounter.unobserve(entry.target); // không chạy lại
                }
            });
        }, { threshold: 0.1 });

        // Hàm animate số từ 0 → target trong 1.2 giây
        const startCounting = (counter) => {
            // Đọc data-* attributes
            const target = parseFloat(counter.getAttribute('data-target'));
            const decimals = parseInt(counter.getAttribute('data-decimals')) || 0;
            const suffix = counter.getAttribute('data-suffix') || ''; // "M" (triệu) hoặc "K" (nghìn)
            const duration = 1200;
            const startTime = performance.now();

            // requestAnimationFrame: animate mượt 60fps
            const updateCount = (currentTime) => {
                const elapsedTime = currentTime - startTime;
                const progress = Math.min(elapsedTime / duration, 1);

                // Ease out cubic: nhanh lúc đầu, chậm lúc cuối
                // Công thức: 1 - (1 - t)³
                const easeOutProgress = 1 - Math.pow(1 - progress, 3);
                const currentCount = target * easeOutProgress;

                // Format: nếu có decimals → toFixed, không → toLocaleString (thêm dấu phẩy)
                if (decimals > 0) {
                    counter.innerText = currentCount.toFixed(decimals) + suffix;
                } else {
                    counter.innerText = Math.floor(currentCount).toLocaleString('vi-VN') + suffix;
                }

                if (progress < 1) {
                    requestAnimationFrame(updateCount);
                } else {
                    // Đảm bảo giá trị cuối cùng chính xác (tránh lỗi float)
                    if (decimals > 0) {
                        counter.innerText = target.toFixed(decimals) + suffix;
                    } else {
                        counter.innerText = target.toLocaleString('vi-VN') + suffix;
                    }
                }
            };
            requestAnimationFrame(updateCount);
        };

        // Trigger counter observer
        counters.forEach(counter => observerCounter.observe(counter));

        // ===== 3. 3D TILT EFFECT (card nghiêng theo chuột) =====
        // Khi hover card → nghiêng theo hướng chuột (max 8deg)
        // Mục đích: tạo cảm giác "sống", card 3D như thẻ thật
        const tiltCards = document.querySelectorAll('.feature, .spec-card, .knowledge-card, .card');
        tiltCards.forEach(card => {
            card.addEventListener('mousemove', e => {
                const rect = card.getBoundingClientRect();
                // Vị trí chuột tương đối với card
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;

                // rotateX âm khi chuột ở dưới center (card nghiêng lên)
                // rotateY dương khi chuột bên phải center (card nghiêng trái)
                const rotateX = ((y - centerY) / centerY) * -8; // max ±8deg
                const rotateY = ((x - centerX) / centerX) * 8;

                // Áp dụng 3D transform với perspective (tạo cảm giác sâu)
                card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
                card.style.transition = 'box-shadow 0.2s ease';
            });

            // Reset khi chuột rời card
            card.addEventListener('mouseleave', () => {
                card.style.transform = `perspective(800px) rotateX(0) rotateY(0) scale3d(1, 1, 1)`;
                card.style.transition = 'transform 0.3s ease, box-shadow 0.3s ease';
            });
        });
    </script>

    <!-- ============================================ -->
    <!-- SCRIPT 2: BẢN ĐỒ 24 TRẠM + BOUNCE ANIMATION  -->
    <!-- ============================================ -->
    <script>
    (function() {  // IIFE: tránh ô nhiễm global scope
        // API key VietMap (tiles bản đồ VN, có địa chỉ chi tiết hơn OpenStreetMap)
        const KEY = '75950d796c1f4a611133660d2ec48258174fc8279da00348';

        // Dữ liệu 24 trạm: lat, lng, tên, type (tw/cb/dp/kt)
        // tw = Trung ương (xanh lá)
        // cb = cảm biến nghiên cứu (cam)
        // dp = địa phương (đỏ)
        // kt = khí tượng lồng ghép (xanh dương)
        const stations = [
            { lat: 17.8642075, lng: 106.3537145, name: 'Hòn La – Quảng Bình', type: 'tw' },
            { lat: 18.020274, lng: 106.454858, name: 'Kỳ Phương – Hà Tĩnh', type: 'tw' },
            { lat: 21.049562, lng: 105.882167, name: '556 Nguyễn Văn Cừ – Hà Nội', type: 'tw' },
            { lat: 21.015306, lng: 105.799889, name: '17 Trung Yên 3 – Hà Nội', type: 'tw' },
            { lat: 21.051194, lng: 105.781833, name: '36A Phạm Văn Đồng – Hà Nội', type: 'tw' },
            { lat: 18.0965823, lng: 106.3220648, name: 'Kỳ Hà – Hà Tĩnh (cảm biến)', type: 'cb' },
            { lat: 18.0181014, lng: 106.3633493, name: 'Kỳ Long – Hà Tĩnh (cảm biến)', type: 'cb' },
            { lat: 18.0397408, lng: 106.2716339, name: 'Kỳ Trinh – Hà Tĩnh (cảm biến)', type: 'cb' },
            { lat: 18.0057243, lng: 106.3762301, name: 'Kỳ Liên – Hà Tĩnh (cảm biến)', type: 'cb' },
            { lat: 10.046444, lng: 105.778639, name: 'Ngã 4 CMT8 – Hùng Vương, Cần Thơ', type: 'dp' },
            { lat: 10.014278, lng: 105.081639, name: 'Ngã ba đi Hà Tiên – Kiên Giang', type: 'dp' },
            { lat: 10.157806, lng: 104.904250, name: 'Bãi khai thác đá Hòn Sóc – Kiên Giang', type: 'dp' },
            { lat: 10.272583, lng: 104.623500, name: 'Xi măng Vicem Hà Tiên – Kiên Giang', type: 'dp' },
            { lat: 11.021999, lng: 106.394917, name: 'KCN Trảng Bàng – Tây Ninh', type: 'dp' },
            { lat: 21.3270, lng: 103.9141, name: 'Trạm Sơn La', type: 'kt' },
            { lat: 21.0194, lng: 105.8036, name: 'Trạm Láng – Hà Nội', type: 'kt' },
            { lat: 20.2539, lng: 105.9745, name: 'Trạm Cúc Phương – Ninh Bình', type: 'kt' },
            { lat: 21.0345, lng: 105.8536, name: 'Trạm Thủy văn môi trường Hà Nội', type: 'kt' },
            { lat: 20.8114, lng: 106.6297, name: 'Trạm Phù Liễn – Hải Phòng', type: 'kt' },
            { lat: 18.6796, lng: 105.6813, name: 'Trạm Vinh – Nghệ An', type: 'kt' },
            { lat: 16.0474, lng: 108.2193, name: 'Trạm Đà Nẵng', type: 'kt' },
            { lat: 13.9833, lng: 108.0000, name: 'Trạm Pleiku – Gia Lai', type: 'kt' },
            { lat: 10.6897, lng: 106.7045, name: 'Trạm Nhà Bè – TP.HCM', type: 'kt' },
            { lat: 10.0300, lng: 105.7700, name: 'Trạm Khí tượng Cần Thơ', type: 'kt' }
        ];

        // Map màu + label theo type
        const colors = { tw: '#4CAF50', cb: '#FF9800', dp: '#f44336', kt: '#2196F3' };
        const labels = {
            tw: 'Trạm Trung ương',
            cb: 'Trạm cảm biến nghiên cứu',
            dp: 'Trạm địa phương',
            kt: 'Trạm khí tượng lồng ghép'
        };

        function initStationsMap() {
            const el = document.getElementById('stations-map');
            // Guard: canvas tồn tại + Leaflet đã load
            if (!el || typeof L === 'undefined') return;

            // Tạo map, center VN (16.0, 106.5), zoom level 5 (nhìn cả nước)
            const map = L.map('stations-map').setView([16.0, 106.5], 5);

            // Tile layer từ VietMap (bản đồ VN chi tiết hơn OSM)
            L.tileLayer('https://maps.vietmap.vn/maps/tiles/st/{z}/{x}/{y}.png?apikey=' + KEY, {
                attribution: '© VietMap',
                maxZoom: 19
            }).addTo(map);

            const markers = []; // Lưu tất cả marker để gọi animation sau

            // Vẽ circleMarker cho mỗi trạm
            stations.forEach(s => {
                const color = colors[s.type];
                const radius = s.type === 'tw' ? 9 : 7;  // Trung ương to hơn

                const marker = L.circleMarker([s.lat, s.lng], {
                    radius: radius,
                    fillColor: color,
                    color: '#fff',      // viền trắng
                    weight: 1.5,
                    opacity: 1,
                    fillOpacity: 0.9
                }).addTo(map);

                markers.push(marker);

                // Popup khi click marker
                marker.bindPopup(
                    '<strong>' + s.name + '</strong><br>' +
                    '<small style="color:' + color + ';">' + labels[s.type] + '</small><br>' +
                    '<small>' + s.lat.toFixed(4) + ', ' + s.lng.toFixed(4) + '</small>'
                );
            });

            // === BOUNCE ANIMATION KHI SCROLL TỚI ===
            // Chỉ chạy 1 lần khi map vào viewport (threshold 0.2 = 20% hiện ra)
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        markers.forEach(marker => {
                            const svgEl = marker.getElement();  // SVG element của Leaflet marker
                            if (svgEl) {
                                // Random delay 0-0.8s → các marker nảy lần lượt
                                svgEl.style.animationDelay = (Math.random() * 0.8) + 's';
                                // Class .bounce-marker trong style.css chứa @keyframes mapBounce
                                svgEl.classList.add('bounce-marker');
                            }
                        });
                        // Unobserve: chỉ chạy 1 lần
                        observer.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.2 });

            observer.observe(el);
        }

        // Init khi DOM ready (có 2 case: DOM đang load hoặc đã load xong)
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initStationsMap);
        } else {
            initStationsMap();  // DOM đã ready
        }
    })();
    </script>

    <!-- ============================================ -->
    <!-- SCRIPT 3: PARALLAX + MAGNETIC BUTTONS        -->
    <!-- ============================================ -->
    <script>
    // ===== 1. PARALLAX IMAGE =====
    // Khi scroll, ảnh content-img di chuyển chậm hơn chữ → tạo depth
    // Công thức: yPos = (rect.top - windowHeight/2) * speed
    // speed = 0.15 → ảnh chạy chậm 15% so với scroll speed
    window.addEventListener('scroll', () => {
        document.querySelectorAll('.content-img img').forEach(img => {
            const rect = img.getBoundingClientRect();
            // Chỉ xử lý khi ảnh trong viewport (tối ưu performance)
            if (rect.top < window.innerHeight && rect.bottom > 0) {
                const speed = 0.15;
                const yPos = (rect.top - window.innerHeight / 2) * speed;
                // Scale 1.1 để khi translate không lộ viền (ảnh gốc nhỏ hơn khung)
                img.style.transform = `translateY(${yPos}px) scale(1.1)`;
            }
        });
    });

    // ===== 2. MAGNETIC BUTTONS =====
    // Button "hút" theo chuột — khi hover gần, button di chuyển nhẹ theo chuột
    // Ứng dụng: CTA button hấp dẫn hơn, user dễ click
    document.querySelectorAll('.btn-primary, .btn-secondary').forEach(btn => {
        btn.addEventListener('mousemove', (e) => {
            const rect = btn.getBoundingClientRect();
            // Offset chuột so với center button
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            // Hút 30% khoảng cách (không hút 100% vì sẽ rời khỏi vị trí)
            // scale(1.05) phóng nhẹ
            btn.style.transform = `translate(${x * 0.3}px, ${y * 0.3}px) scale(1.05)`;
        });
        // Rời chuột → reset về vị trí gốc
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = `translate(0px, 0px) scale(1)`;
        });
    });
    </script>

    <!-- ============================================ -->
    <!-- SCRIPT 4: NAV AUTO-HIDE ON SCROLL             -->
    <!-- ============================================ -->
    <script>
    // Khi scroll xuống > 100px → ẩn nav (translateY -100%)
    // Khi scroll lên → hiện lại
    // Mục đích: tối đa không gian cho content, đặc biệt mobile
    let lastScrollY = window.scrollY;
    const nav = document.querySelector('.nav');

    window.addEventListener('scroll', () => {
        // Scroll xuống (currentY > lastY) + đã scroll đủ xa (>100)
        if (window.scrollY > lastScrollY && window.scrollY > 100) {
            nav.classList.add('nav-hidden');  // CSS: transform translateY(-100%)
        } else {
            nav.classList.remove('nav-hidden');
        }
        lastScrollY = window.scrollY;
    });
    </script>

    <!-- ============================================ -->
    <!-- SCRIPT 5: SCROLL-TO-TOP BUTTON                -->
    <!-- ============================================ -->
    <script>
    // Nút ↑ góc phải dưới: ẩn mặc định, hiện khi scroll > 300px
    const topBtn = document.getElementById("scrollTopBtn");
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            topBtn.classList.add("show");     // CSS: opacity 1 + translateY 0
        } else {
            topBtn.classList.remove("show");
        }
    });
    // Click → scroll về top smooth
    topBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    </script>

    <!-- ============================================ -->
    <!-- SCRIPT 6: AQI REALTIME FETCH + RENDER         -->
    <!-- ============================================ -->
    <script>
    // Fetch /api/data → lấy record mới nhất → tính AQI → update hero card
    // Cùng breakpoints như dashboard (QĐ 1459/TCMT)
    // TODO: nên gom hàm calcSubIndex + breakpoints ra file shared
    fetch('https://airwatch.io.vn/api/data')
        .then(res => res.json())
        .then(data => {
            if (data && data.length > 0) {
                const last = data[data.length - 1];  // Record mới nhất

                // Breakpoints (giống app.js)
                const PM25_BP = [[0,25,0,50],[25,50,51,100],[50,80,101,150],[80,150,151,200],[150,250,201,300],[250,500,301,500]];
                const PM10_BP = [[0,50,0,50],[50,150,51,100],[150,250,101,150],[250,350,151,200],[350,430,201,300],[430,600,301,500]];
                const CO_BP = [[0,8.7,0,50],[8.7,26,51,100],[26,39,101,150],[39,52,151,200],[52,79,201,300],[79,131,301,500]];

                // Interpolate tuyến tính
                function subIdx(c, bp) {
                    if (c <= bp[0][0]) return bp[0][2];
                    for (let i = 0; i < bp.length; i++) {
                        const [cL, cH, iL, iH] = bp[i];
                        if (c >= cL && c <= cH) {
                            if (cH === cL) return iH;
                            return Math.round((iH - iL) / (cH - cL) * (c - cL) + iL);
                        }
                    }
                    return 500;
                }

                // AQI = max của 3 sub-index
                const aqi = Math.max(
                    subIdx(last.pm25 || 0, PM25_BP),
                    subIdx(last.pm10 || 0, PM10_BP),
                    subIdx(last.co || 0, CO_BP)
                );

                const el = document.getElementById('hero-aqi');
                const textEl = document.getElementById('hero-aqi-text');
                el.textContent = Math.round(aqi);

                // Màu + label theo bậc AQI
                let color = '', text = '', textColor = '#fff';
                if (aqi <= 50)        { color = '#4CAF50'; text = 'Tốt'; }
                else if (aqi <= 100)  { color = '#FFEB3B'; text = 'Trung bình'; textColor = '#000'; }
                else if (aqi <= 150)  { color = '#FF9800'; text = 'Kém'; }
                else if (aqi <= 200)  { color = '#F44336'; text = 'Xấu'; }
                else if (aqi <= 300)  { color = '#9C27B0'; text = 'Rất xấu'; }
                else                  { color = '#7B1FA2'; text = 'Nguy hại'; }

                el.style.color = color;
                textEl.style.background = color;
                textEl.style.color = textColor;
                textEl.textContent = text;
            }
        })
        .catch(err => console.error('[AQI]', err));
    </script>

    <!-- ============================================ -->
    <!-- SCRIPT 7: POPOVER WELCOME LOGIC               -->
    <!-- ============================================ -->
    <script>
    document.addEventListener("DOMContentLoaded", () => {
        const navBtn = document.getElementById('nav-dashboard-btn');
        const popover = document.getElementById('welcome-popover');
        const demoBtn = document.getElementById('demo-trigger'); // Nút ẩn reset demo

        // ===== 1. POPOVER KHI CLICK DASHBOARD =====
        if (navBtn && popover) {
            navBtn.addEventListener('click', (e) => {
                // Nếu đã xem thông tin ô nhiễm rồi → cho vào dashboard luôn
                if (localStorage.getItem('has_seen_pollution') === '1') return;
                // Chưa xem → chặn navigation + hiện popover
                e.preventDefault();
                popover.classList.add('show');
            });

            // Click ra ngoài → đóng popover
            document.addEventListener('click', (e) => {
                if (!navBtn.contains(e.target) && !popover.contains(e.target)) {
                    popover.classList.remove('show');
                }
            });
        }

        // ===== 2. NÚT RESET DEMO (ẩn, chỉ để test) =====
        // Click → xóa localStorage + reload → demo lại từ đầu
        if (demoBtn) {
            demoBtn.addEventListener('click', () => {
                localStorage.removeItem('airwatch_welcomed_v1');
                localStorage.removeItem('has_seen_pollution');
                location.reload();
            });
        }
    });

    // Handler khi user click "Chưa" hoặc "Rồi" trong popover
    function handlePopover(action) {
        const popover = document.getElementById('welcome-popover');
        if (popover) popover.classList.remove('show');
        // Set flag → lần sau click dashboard không hiện popover nữa
        localStorage.setItem('has_seen_pollution', '1');

        // Nếu "Chưa" → scroll xuống section vấn đề
        if (action === 'no') {
            const target = document.getElementById('van-de');
            if (target) target.scrollIntoView({ behavior: 'smooth' });
        }
    }
    </script>

    <!-- Nút reset demo: tàng hình (opacity 0.05), chỉ hiện khi hover -->
    <!-- Vị trí: góc trái dưới, kích thước 24x24, không cản trở user -->
    <button id="demo-trigger" title="Reset demo"
            style="position: fixed; bottom: 8px; left: 8px; width: 24px; height: 24px;
                   background: transparent; border: none; cursor: pointer; z-index: 9998;
                   opacity: 0.05; border-radius: 50%;"></button>

</body>
</html>
```

dashboard.html
```html
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <title>Dashboard — Quan trắc không khí</title>

    <!-- Favicon: SVG inline giống index (chữ A xanh lá trên nền vuông bo góc) -->
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%234CAF50'/><text x='50' y='68' font-size='60' font-family='Arial' font-weight='bold' fill='white' text-anchor='middle'>A</text></svg>">

    <!-- CSS chính: theme, layout cards, chart containers -->
    <link rel="stylesheet" href="style.css">
</head>
<body>

    <!-- ============================================ -->
    <!-- NAV — giống index nhưng KHÔNG có popover      -->
    <!-- Lý do: user đã vào dashboard rồi, không cần   -->
    <!-- hỏi "đã xem thông tin ô nhiễm chưa?" nữa    -->
    <!-- ============================================ -->
    <nav class="nav">
        <div class="logo"><a href="/">AirWatch</a></div>
        <ul class="nav-links">
            <li><a href="/">Trang chủ</a></li>
            <!-- Admin link: ẩn mặc định, JS hiện khi đã login (isAdmin()) -->
            <li class="admin-only" style="display:none;"><a href="/admin">Quản lý</a></li>
            <!-- Dropdown user menu -->
            <li class="dropdown">
                <button onclick="toggleMenu(event)" class="btn-primary" id="auth-btn"
                        style="padding: 8px 16px; font-size: 13px;">Guest ▾</button>
                <div class="dropdown-menu" id="dropdown-menu">
                    <button onclick="toggleTheme()">
                        <span id="theme-icon">🌙</span>
                        <span id="theme-label">Chế độ tối</span>
                    </button>
                    <div class="dropdown-divider"></div>
                    <a href="#" id="auth-action" onclick="handleAuthAction(); return false;">🔑 Đăng nhập</a>
                </div>
            </li>
        </ul>
    </nav>

    <!-- ============================================ -->
    <!-- HEADER — H1 + status badge LIVE/OFFLINE       -->
    <!-- ============================================ -->
    <header>
        <!-- .status class: badge xanh (LIVE) hoặc đỏ (OFFLINE) -->
        <!-- Text thay đổi bởi setStatus() trong app.js khi có/không có data -->
        <h1>Dashboard <span class="status" id="status">LIVE</span></h1>
    </header>

    <!-- ============================================ -->
    <!-- DATE SELECTOR — chọn ngày xem data             -->
    <!-- ============================================ -->
    <section class="date-selector">
        <label>Xem dữ liệu ngày:</label>
        <!-- type="date": native browser date picker (mobile/desktop) -->
        <!-- Default value set bởi app.js: getLocalDate() = hôm nay (giờ VN) -->
        <input type="date" id="date-picker">

        <!-- Nút Xem: đọc date-picker.value → fetch API cho ngày đó -->
        <button onclick="loadByDate()" class="btn-primary" style="padding: 8px 16px;">Xem</button>

        <!-- Nút Hôm nay: reset date = hôm nay + reload -->
        <button onclick="loadToday()" class="btn-secondary" style="padding: 8px 16px;">Hôm nay</button>
    </section>

    <!-- ============================================ -->
    <!-- AQI BANNER — vòng tròn progress + số + status -->
    <!-- ============================================ -->
    <section class="aqi-banner">
        <div class="aqi-circle-container">
            <!-- SVG 200x200: 2 vòng tròn chồng nhau -->
            <!-- Vòng ngoài r=90, stroke-width=10, cx=cy=100 (center) -->
            <!-- viewBox mặc định = width/height (không cần set) -->
            <svg class="aqi-circle" width="200" height="200">
                <!-- Vòng nền: xám, luôn full (không có dashoffset) -->
                <circle class="aqi-circle-bg" cx="100" cy="100" r="90" />

                <!-- Vòng progress: stroke màu theo AQI, dashoffset 0-565 -->
                <!-- 565.48 = 2π×90 = chu vi vòng tròn -->
                <!-- dashoffset = 0 → vẽ full, dashoffset = 565 → không vẽ -->
                <!-- app.js update strokeDashoffset = circ - (pct × circ) -->
                <circle class="aqi-circle-progress" id="aqi-progress" cx="100" cy="100" r="90" />
            </svg>
            <!-- Text overlay giữa vòng tròn (absolute position trong CSS) -->
            <div class="aqi-circle-text">
                <!-- Số AQI: font 48px, màu đổi theo bậc (app.js updateAQI) -->
                <div class="aqi-value" id="aqi" style="font-size:48px; font-weight:700; color:#4CAF50; line-height:1;">--</div>
                <!-- Label "AQI" phía dưới -->
                <div class="aqi-label" style="font-size:14px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-top:4px;">AQI</div>
            </div>
        </div>

        <!-- Badge text (Tốt / Trung bình / Kém...), màu nền thay đổi theo AQI -->
        <div class="aqi-status" id="aqi-text"
             style="display:inline-block; margin-top:16px; padding:4px 16px; border-radius:12px; background:#4CAF50; color:#fff; font-weight:600;">--</div>

        <!-- Nguồn công thức AQI (bắt buộc trích dẫn trong báo cáo khoa học) -->
        <div class="aqi-desc" style="font-size:12px; color:var(--text-muted); margin-top:12px;">
            Nguồn công thức: <a href="https://cem.gov.vn/storage/news_file_attach/QD%201459%20TCMT%20ngay%2012.11.2019%20AQI.pdf"
                               target="_blank" rel="noopener"
                               style="color:var(--accent); text-decoration:underline;">QĐ 1459/TCMT (12/11/2019)</a>
        </div>
    </section>

    <!-- ============================================ -->
    <!-- GRID CARDS — 10 card thông số                 -->
    <!-- ============================================ -->
    <!-- Thứ tự ưu tiên: cơ bản (T/H/PM) trước, khí độc sau -->
    <!-- 2 card volt/curr có class .admin-only → ẩn với guest -->
    <section class="grid">

        <!-- Card 1: Nhiệt độ — id="temp" cập nhật bởi app.js -->
        <div class="card temp">
            <div class="label">Nhiệt độ</div>
            <div class="value"><span id="temp">--</span><span class="unit">°C</span></div>
        </div>

        <!-- Card 2: Độ ẩm -->
        <div class="card hum">
            <div class="label">Độ ẩm</div>
            <div class="value"><span id="hum">--</span><span class="unit">%</span></div>
        </div>

        <!-- Card 3: Điện áp — CHỈ ADMIN (class admin-only) -->
        <!-- style="display:none" default, app.js hiện khi isAdmin() -->
        <div class="card volt admin-only" style="display:none;">
            <div class="label">Điện áp</div>
            <div class="value"><span id="volt">--</span><span class="unit">V</span></div>
        </div>

        <!-- Card 4: Dòng điện — CHỈ ADMIN -->
        <div class="card curr admin-only" style="display:none;">
            <div class="label">Dòng điện</div>
            <div class="value"><span id="curr">--</span><span class="unit">mA</span></div>
        </div>

        <!-- Card 5: PM1.0 — màu vàng hổ phách (CSS .card.pm1 .value) -->
        <div class="card pm1">
            <div class="label">PM1.0</div>
            <div class="value"><span id="pm1">--</span><span class="unit">µg/m³</span></div>
        </div>

        <!-- Card 6: PM2.5 — màu cam đỏ -->
        <div class="card pm25">
            <div class="label">PM2.5</div>
            <div class="value"><span id="pm25">--</span><span class="unit">µg/m³</span></div>
        </div>

        <!-- Card 7: PM10 — màu cam -->
        <div class="card pm10">
            <div class="label">PM10</div>
            <div class="value"><span id="pm10">--</span><span class="unit">µg/m³</span></div>
        </div>

        <!-- Card 8: CO — màu cam cháy (app.js đổi màu theo ngưỡng) -->
        <div class="card co">
            <div class="label">CO</div>
            <div class="value"><span id="co">--</span><span class="unit">ppm</span></div>
        </div>

        <!-- Card 9: VOC — hiển thị dạng % so với baseline (không phải raw) -->
        <div class="card voc">
            <div class="label">VOC</div>
            <div class="value"><span id="voc_pct">--</span><span class="unit">%</span></div>
        </div>

        <!-- Card 10: NOx — tương tự VOC -->
        <div class="card nox">
            <div class="label">NOx</div>
            <div class="value"><span id="nox_pct">--</span><span class="unit">%</span></div>
        </div>
    </section>

    <!-- ============================================ -->
    <!-- CHART 1: MÔI TRƯỜNG (Nhiệt độ + Độ ẩm)       -->
    <!-- ============================================ -->
    <!-- canvas id="chart-env" là target cho Chart.js -->
    <!-- app.js renderCharts() check nếu canvas tồn tại mới vẽ -->
    <!-- (cho phép dùng chung app.js cho nhiều page) -->
    <section class="chart-container">
        <h2 class="chart-title">Môi trường</h2>
        <canvas id="chart-env"></canvas>
    </section>

    <!-- ============================================ -->
    <!-- CHART 2: BỤI MỊN (PM1/PM2.5/PM10)             -->
    <!-- ============================================ -->
    <section class="chart-container">
        <h2 class="chart-title">Bụi mịn</h2>
        <canvas id="chart-pm"></canvas>
    </section>

    <!-- ============================================ -->
    <!-- CHART 3: VOC/NOx DẠNG CỘT (%)                  -->
    <!-- ============================================ -->
    <!-- Khác với các chart khác: chỉ hiện giá trị mới nhất, không timeline -->
    <!-- Render bằng renderGasChart() riêng, không phải renderCharts() -->
    <section class="chart-container">
        <h2 class="chart-title">Mức độ ô nhiễm khí (VOC & NOx)</h2>
        <canvas id="chart-gas"></canvas>
    </section>

    <!-- ============================================ -->
    <!-- CHART 4: CO DẠNG LINE                          -->
    <!-- ============================================ -->
    <section class="chart-container">
        <h2 class="chart-title">Nồng độ CO</h2>
        <canvas id="chart-co"></canvas>
    </section>

    <!-- ============================================ -->
    <!-- CHART 5: ĐIỆN ÁP — CHỈ ADMIN                  -->
    <!-- ============================================ -->
    <section class="chart-container admin-only" style="display:none;">
        <h2 class="chart-title">Điện áp</h2>
        <canvas id="chart-volt"></canvas>
    </section>

    <!-- ============================================ -->
    <!-- CHART 6: DÒNG ĐIỆN — CHỈ ADMIN                -->
    <!-- ============================================ -->
    <section class="chart-container admin-only" style="display:none;">
        <h2 class="chart-title">Dòng điện</h2>
        <canvas id="chart-curr"></canvas>
    </section>

    <!-- ============================================ -->
    <!-- SECTION: DỮ LIỆU HỆ THỐNG — CHỈ ADMIN         -->
    <!-- ============================================ -->
    <!-- 3 card: số record DB, lần cập nhật cuối, role -->
    <!-- Load bởi loadSystemData() trong app.js -->
    <section class="chart-container admin-only" style="display:none;">
        <h2 class="chart-title">Dữ liệu hệ thống (Admin)</h2>
        <div class="grid">
            <!-- Số record trong bảng sensor (fetch /api/system) -->
            <div class="card"><div class="label">Record DB</div><div class="value"><span id="db-count">--</span></div></div>
            <!-- Timestamp data cuối cùng (từ server) -->
            <div class="card"><div class="label">Cập nhật cuối</div><div class="value" style="font-size: 16px;"><span id="last-seen">--</span></div></div>
            <!-- Role của user đang login (admin / head_admin) -->
            <div class="card"><div class="label">Role</div><div class="value" style="font-size: 20px;"><span id="role-display">--</span></div></div>
        </div>
    </section>

    <!-- ============================================ -->
    <!-- SECTION: BẢNG NGƯỠNG AQI                       -->
    <!-- ============================================ -->
    <!-- 6 mức: Tốt / Trung bình / Kém / Xấu / Rất xấu / Nguy hại -->
    <!-- Mỗi row có background nhạt màu tương ứng + badge -->
    <section class="aqi-table-section">
        <h2 class="chart-title" style="text-align:center; margin-bottom:20px;">Bảng ngưỡng AQI</h2>
        <table class="aqi-table">
            <thead>
                <tr>
                    <th>Khoảng AQI</th>
                    <th>Mức độ</th>
                    <th>Ảnh hưởng sức khỏe</th>
                </tr>
            </thead>
            <tbody>
                <!-- Mức 1: Tốt — xanh lá -->
                <tr style="background: rgba(76,175,80,0.1);">
                    <td><span class="aqi-badge" style="background:#4CAF50;">0 – 50</span></td>
                    <td><strong>Tốt</strong></td>
                    <td>Chất lượng không khí tốt, không ảnh hưởng sức khỏe.</td>
                </tr>

                <!-- Mức 2: Trung bình — vàng, chữ đen trên nền vàng cho contrast -->
                <tr style="background: rgba(255,235,59,0.1);">
                    <td><span class="aqi-badge" style="background:#FFEB3B; color:#000;">51 – 100</span></td>
                    <td><strong>Trung bình</strong></td>
                    <td>Nhóm nhạy cảm (trẻ em, người già, hen suyễn) nên hạn chế hoạt động ngoài trời lâu.</td>
                </tr>

                <!-- Mức 3: Kém — cam -->
                <tr style="background: rgba(255,152,0,0.1);">
                    <td><span class="aqi-badge" style="background:#FF9800;">101 – 150</span></td>
                    <td><strong>Kém</strong></td>
                    <td>Nhóm nhạy cảm bị ảnh hưởng sức khỏe; người khỏe mạnh có thể bị kích ứng mắt, họng.</td>
                </tr>

                <!-- Mức 4: Xấu — đỏ -->
                <tr style="background: rgba(244,67,54,0.1);">
                    <td><span class="aqi-badge" style="background:#F44336;">151 – 200</span></td>
                    <td><strong>Xấu</strong></td>
                    <td>Mọi người bắt đầu bị ảnh hưởng sức khỏe; nhóm nhạy cảm bị ảnh hưởng nghiêm trọng hơn.</td>
                </tr>

                <!-- Mức 5: Rất xấu — tím -->
                <tr style="background: rgba(156,39,176,0.1);">
                    <td><span class="aqi-badge" style="background:#9C27B0;">201 – 300</span></td>
                    <td><strong>Rất xấu</strong></td>
                    <td>Cảnh báo sức khỏe cho toàn bộ cộng đồng; hạn chế ra ngoài.</td>
                </tr>

                <!-- Mức 6: Nguy hại — tím đậm -->
                <tr style="background: rgba(123,31,162,0.15);">
                    <td><span class="aqi-badge" style="background:#7B1FA2;">301 – 500</span></td>
                    <td><strong>Nguy hại</strong></td>
                    <td>Khẩn cấp: ảnh hưởng nghiêm trọng đến toàn bộ dân số, ở trong nhà.</td>
                </tr>
            </tbody>
        </table>

        <!-- Nguồn: QCVN 05:2023/BTNMT -->
        <div style="text-align:center; margin-top:16px; font-size:12px; color:var(--text-muted);">
            Tham khảo: <a href="https://sonnmt.langson.gov.vn/upload/105376/20250319/01-btnmt-qc05_c7c2a.pdf"
                         target="_blank" rel="noopener"
                         style="color:var(--accent); text-decoration:underline;">QCVN 05:2023/BTNMT</a>
        </div>
    </section>

    <!-- ============================================ -->
    <!-- FOOTER — Node ID + last updated               -->
    <!-- ============================================ -->
    <!-- "Cập nhật:" span được update bởi loadSystemData() và updateFromWS() -->
    <footer>Node ID: 001 | Cập nhật: <span id="updated">--</span></footer>

    <!-- ============================================ -->
    <!-- SCRIPTS                                       -->
    <!-- ============================================ -->

    <!-- Chart.js: thư viện vẽ chart (line/bar) -->
    <!-- Dùng local file (không CDN) để đảm bảo luôn available -->
    <script src="chart.min.js"></script>

    <!-- Adapter date-fns: plugin cho Chart.js để parse/format timestamp -->
    <!-- Cần cho time scale (trục X dạng time thay vì category) -->
    <script src="chartjs-adapter-date-fns.bundle.min.js"></script>

    <!-- auth-check.js: checkAuth, isAdmin, logout, getToken -->
    <!-- PHẢI load trước app.js vì app.js gọi các hàm này lúc init -->
    <script src="auth-check.js"></script>

    <!-- Inline script nhỏ: menu toggle + auth action (giống index) -->
    <script>
        // Toggle dropdown menu (click button → open/close)
        function toggleMenu(e) { e.stopPropagation(); document.getElementById('dropdown-menu').classList.toggle('open'); }

        // Click ra ngoài → đóng menu
        document.addEventListener('click', () => {
            const m = document.getElementById('dropdown-menu');
            if (m) m.classList.remove('open');
        });

        // Handler cho nút auth: nếu đã login → logout, chưa → về trang chủ login
        function handleAuthAction() { if (isAdmin()) logout(); else window.location.href = '/'; }
    </script>

    <!-- app.js: TOÀN BỘ LOGIC (fetch data, update cards, charts, WS, admin) -->
    <!-- Init flow trong app.js: checkAuth → load data → renderCharts -->
    <script src="app.js"></script>

</body>
</html>
```

admin.html
```html
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>Admin — AirWatch</title>

<!-- Favicon SVG inline (giống các trang khác) -->
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%234CAF50'/><text x='50' y='68' font-size='60' font-family='Arial' font-weight='bold' fill='white' text-anchor='middle'>A</text></svg>">

<!-- Leaflet CSS: cho tab "Quản lý node" (bản đồ chọn vị trí) -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">

<!-- CSS chính -->
<link rel="stylesheet" href="style.css">
</head>
<body>

<!-- ============================================ -->
<!-- NAV — giống dashboard + link Status riêng     -->
<!-- ============================================ -->
<nav class="nav">
    <div class="logo"><a href="/">AirWatch</a></div>
    <ul class="nav-links">
        <li><a href="/">Trang chủ</a></li>
        <li><a href="/dashboard">Dashboard</a></li>
        <!-- Link đến subdomain status (uptime monitoring) -->
        <li><a href="https://status.airwatch.io.vn/">Status</a></li>
        <li class="dropdown">
            <button onclick="toggleMenu(event)" class="btn-primary" id="auth-btn" style="padding:8px 16px; font-size:13px;">Admin ▾</button>
            <div class="dropdown-menu" id="dropdown-menu">
                <button onclick="toggleTheme()"><span id="theme-icon">🌙</span><span id="theme-label">Chế độ tối</span></button>
                <div class="dropdown-divider"></div>
                <a href="#" id="auth-action" onclick="handleAuthAction(); return false;">Đăng xuất</a>
            </div>
        </li>
    </ul>
</nav>

<!-- ============================================ -->
<!-- HEADER — Title + subtitle                     -->
<!-- ============================================ -->
<header class="admin-header">
    <h1>Quản trị hệ thống</h1>
    <p class="admin-subtitle">Quản lý node, trạng thái và dữ liệu test</p>
</header>

<!-- ============================================ -->
<!-- TAB BAR — 8 tab                               -->
<!-- ============================================ -->
<!-- data-tab attribute = tên section tương ứng (id="tab-{name}") -->
<!-- Tab "users" có class head-admin-only → chỉ head_admin thấy -->
<!-- Click → switchTab('name') xử lý ẩn/hiện section -->
<div class="admin-tabs">
    <button class="admin-tab active" data-tab="nodes" onclick="switchTab('nodes')">Quản lý node</button>
    <button class="admin-tab" data-tab="status" onclick="switchTab('status')">Trạng thái</button>
    <button class="admin-tab" data-tab="debug" onclick="switchTab('debug')">Debug</button>
    <button class="admin-tab" data-tab="log" onclick="switchTab('log')">Log hoạt động</button>
    <button class="admin-tab" data-tab="notes" onclick="switchTab('notes')">Ghi chú</button>
    <button class="admin-tab head-admin-only" data-tab="users" onclick="switchTab('users')" style="display:none;">Người dùng</button>
    <button class="admin-tab" data-tab="incidents" onclick="switchTab('incidents')">Sự cố</button>
    <button class="admin-tab" data-tab="db" onclick="switchTab('db')">Database</button>
</div>

<!-- ============================================ -->
<!-- TAB 1: NODES — quản lý trạm đo                -->
<!-- ============================================ -->
<!-- Chức năng: add/delete node, xem trên bản đồ -->
<!-- Layout: grid 2 cột (map 60% + form 40%) -->
<section class="admin-panel" id="tab-nodes">
    <div class="panel-head">
        <h2 class="chart-title">Quản lý node</h2>
        <button onclick="loadNodes()" class="btn-primary btn-refresh">Làm mới</button>
    </div>

    <div class="nodes-layout">
        <!-- Map: JS init Leaflet + VietMap tiles, click → điền lat/lng vào form -->
        <div id="nodes-map" class="nodes-map"></div>

        <div class="node-form">
            <h3>Thêm node</h3>
            <label>ID Node</label>
            <input id="node-id" class="status-input" placeholder="VD: 001">
            <label>Tên Node</label>
            <input id="node-name" class="status-input" placeholder="VD: Trạm An Giang">
            <label>Latitude</label>
            <!-- readonly: user KHÔNG gõ tay, phải click bản đồ -->
            <input id="node-lat" class="status-input" placeholder="Click bản đồ" readonly>
            <label>Longitude</label>
            <input id="node-lng" class="status-input" placeholder="Click bản đồ" readonly>
            <button onclick="addNode()" class="btn-primary btn-update" style="width:100%; margin-top:12px;">Thêm</button>
            <p class="node-form-hint">Click lên bản đồ để lấy tọa độ</p>
        </div>
    </div>

    <!-- List nodes: render bởi loadNodes() trong app.js -->
    <!-- Mỗi row có badge status (working/delayed/offline dựa trên data age) -->
    <h3 class="chart-title" style="margin-top:32px; font-size:18px;">Danh sách node</h3>
    <div id="nodes-list" class="nodes-list">Đang tải...</div>
</section>

<!-- ============================================ -->
<!-- TAB 2: STATUS — đánh dấu trạng thái service    -->
<!-- ============================================ -->
<!-- Cho phép admin set thủ công: NODE đang debug/maintenance/offline... -->
<!-- Lưu ở server (api/status), poll 10s/lần -->
<section class="admin-panel" id="tab-status" style="display:none;">

    <h2 class="chart-title">Chỉnh sửa trạng thái</h2>

    <!-- 6 preset button: click → auto-fill form + apply luôn -->
    <!-- Mỗi preset có màu riêng (CSS .preset-btn.{status}) -->
    <div class="status-presets-label">Chọn nhanh:</div>
    <div class="status-presets" id="status-presets">
        <button class="preset-btn working"     onclick="applyPreset('working')">Working</button>
        <button class="preset-btn debug"       onclick="applyPreset('debug')">Debug</button>
        <button class="preset-btn attach"      onclick="applyPreset('attach')">Attach</button>
        <button class="preset-btn testing"     onclick="applyPreset('testing')">Testing</button>
        <button class="preset-btn maintenance" onclick="applyPreset('maintenance')">Maintenance</button>
        <button class="preset-btn offline"     onclick="applyPreset('offline')">Offline</button>
    </div>

    <!-- Form chỉnh tay (nếu preset không đủ) -->
    <div class="status-form">
        <label>Service:</label>
        <select id="sel-service" class="status-select">
            <option value="stm32">NODE (STM32)</option>
            <option value="esp32">GATEWAY (ESP32)</option>
            <option value="api">Web API</option>
            <option value="system">SYSTEM</option>
        </select>
        <label>Trạng thái:</label>
        <select id="sel-status" class="status-select">
            <option value="working">working</option>
            <option value="debug">debug</option>
            <option value="attach">attach</option>
            <option value="testing">testing</option>
            <option value="maintenance">maintenance</option>
            <option value="offline">offline</option>
        </select>
        <label>Ghi chú:</label>
        <input id="inp-note" class="status-input" type="text" placeholder="..." maxlength="120">
        <!-- Apply cho 1 service đang chọn -->
        <button onclick="updateServiceStatus()" class="btn-primary btn-update">Cập nhật</button>
        <!-- Apply cho TẤT CẢ 4 service (khi maintenance toàn hệ thống) -->
        <button onclick="updateAllServices()" class="btn-primary" style="background:#a371f7; margin-left:8px;">Áp dụng tất cả</button>
    </div>

    <!-- 4 card grid: mỗi service 1 card, render bởi loadServiceStatus() -->
    <h3 class="chart-title" style="margin-top:32px; font-size:18px;">Trạng thái hiện tại</h3>
    <div class="status-grid" id="status-grid"></div>
    <div class="status-updated">Cập nhật lúc: <strong id="status-updated">--</strong></div>
</section>

<!-- ============================================ -->
<!-- TAB 3: DEBUG — sandbox test UI                -->
<!-- ============================================ -->
<!-- Chức năng: nhập tay data → test dashboard render → xóa -->
<!-- KHÔNG ảnh hưởng bảng sensor chính (bảng sensor_debug riêng) -->
<section class="admin-panel" id="tab-debug" style="display:none;">

    <div class="panel-head">
        <h2 class="chart-title">Debug Dashboard</h2>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button onclick="loadDebugData()" class="btn-primary btn-refresh">Làm mới</button>
            <!-- Xóa TOÀN BỘ debug records (double confirm) -->
            <button onclick="clearDebugData()" class="btn-secondary btn-danger">Xóa tất cả</button>
        </div>
    </div>

    <div class="debug-notice">
        Sandbox test UI. Không ảnh hưởng DB chính. Nhập data → test dashboard → xóa.
    </div>

    <!-- === TOOLBAR: Preset + Clone + Simulate === -->
    <div class="debug-toolbar">

        <!-- Nhóm 1: Preset (lưu/tải bộ giá trị mẫu) -->
        <div class="toolbar-group">
            <label>Preset:</label>
            <select id="dbg-preset-select" class="status-select" onchange="loadPreset()">
                <option value="">-- Chọn --</option>
            </select>
            <button onclick="savePreset()" class="btn-mini">Lưu mới</button>
            <button onclick="updateCurrentPreset()" class="btn-mini">Cập nhật</button>
            <button onclick="deleteCurrentPreset()" class="btn-mini btn-danger">Xóa</button>
        </div>

        <!-- Nhóm 2: Clone từ sensor thật -->
        <div class="toolbar-group">
            <label>Sensor:</label>
            <button onclick="openCloneDialog()" class="btn-mini">Clone từ sensor</button>
        </div>

        <!-- Nhóm 3: Simulate — sinh N packet ngẫu nhiên -->
        <div class="toolbar-group">
            <label>Simulate:</label>
            <input id="dbg-sim-count" class="status-input mini" type="number" placeholder="10" value="10" min="1" max="200">
            <!-- Random: giá trị bình thường -->
            <button onclick="simulatePackets(false)" class="btn-mini">Random</button>
            <!-- Có edge: include giá trị biên (test validation) -->
            <button onclick="simulatePackets(true)" class="btn-mini btn-warn">Có edge</button>
        </div>
    </div>

    <!-- === TABLE: danh sách records === -->
    <h3 class="chart-title" style="font-size:18px;">Records (Debug DB)</h3>

    <div class="table-toolbar">
        <!-- Search by id/note/type -->
        <input id="dbg-search" class="status-input" placeholder="Tìm theo note hoặc id..." oninput="filterDebugTable()">
        <!-- Filter theo test_type -->
        <select id="dbg-filter-type" class="status-select" onchange="filterDebugTable()">
            <option value="">Tất cả type</option>
            <option value="manual">Manual</option>
            <option value="simulated">Simulated</option>
            <option value="cloned">Cloned</option>
            <option value="restored">Restored</option>
            <option value="edge">Edge</option>
            <option value="custom">Custom</option>
        </select>
        <span class="table-count" id="dbg-count">0 records</span>
        <!-- Bulk delete: disabled khi không có row nào được tick -->
        <button onclick="deleteSelectedDebug()" class="btn-mini btn-danger" id="btn-bulk-del" disabled>Xóa đã chọn</button>
    </div>

    <div class="debug-table-wrap">
        <table class="debug-table" id="debug-table">
            <thead>
                <tr>
                    <!-- Checkbox all: tick → chọn tất cả row trong filter hiện tại -->
                    <th><input type="checkbox" onchange="toggleSelectAll(this.checked)" id="dbg-check-all"></th>
                    <th>ID</th><th>ts</th><th>T</th><th>H</th><th>V</th><th>I</th>
                    <th>PM1</th><th>PM2.5</th><th>PM10</th><th>VOC</th><th>NOx</th><th>SGP</th>
                    <th>Type</th><th>Note</th><th>Actions</th>
                </tr>
            </thead>
            <!-- tbody: render động bởi renderDebugTable() -->
            <tbody id="debug-tbody">
                <tr><td colspan="16" style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải...</td></tr>
            </tbody>
        </table>
    </div>

    <!-- === FORM NHẬP LIỆU === -->
    <!-- Mode hiển thị: INSERT (id trống) hoặc UPDATE #id -->
    <h3 class="chart-title" style="margin-top:32px; font-size:18px;">Nhập liệu</h3>

    <div class="debug-form-vertical">
        <div class="form-header">
            <span class="form-mode" id="dbg-form-mode">Mode: <strong>INSERT</strong></span>
        </div>

        <div class="form-fields">
            <!-- Mỗi field có: label + hint (range) + input + err span -->
            <!-- oninput="validateField('name')": validate real-time khi user gõ -->
            <div class="field"><label>T (°C)<span class="hint">-10 to 60</span></label>
                <input id="dbg-t" type="number" step="0.01" oninput="validateField('t')"><span class="err" id="err-t"></span></div>
            <div class="field"><label>H (%)<span class="hint">0 to 100</span></label>
                <input id="dbg-h" type="number" step="0.01" oninput="validateField('h')"><span class="err" id="err-h"></span></div>
            <div class="field"><label>V (V)<span class="hint">1.5 to 5.0</span></label>
                <input id="dbg-v" type="number" step="0.001" oninput="validateField('v')"><span class="err" id="err-v"></span></div>
            <div class="field"><label>I (A)<span class="hint">-1.0 to 2.0</span></label>
                <input id="dbg-i" type="number" step="0.001" oninput="validateField('i')"><span class="err" id="err-i"></span></div>
            <div class="field"><label>PM1.0<span class="hint">0 to 500</span></label>
                <input id="dbg-pm1" type="number" oninput="validateField('pm1')"><span class="err" id="err-pm1"></span></div>
            <div class="field"><label>PM2.5<span class="hint">0 to 500</span></label>
                <input id="dbg-pm25" type="number" oninput="validateField('pm25')"><span class="err" id="err-pm25"></span></div>
            <div class="field"><label>PM10<span class="hint">0 to 1000</span></label>
                <input id="dbg-pm10" type="number" oninput="validateField('pm10')"><span class="err" id="err-pm10"></span></div>
            <div class="field"><label>VOC<span class="hint">0 to 65535</span></label>
                <input id="dbg-voc" type="number" oninput="validateField('voc')"><span class="err" id="err-voc"></span></div>
            <div class="field"><label>NOx<span class="hint">0 to 65535</span></label>
                <input id="dbg-nox" type="number" oninput="validateField('nox')"><span class="err" id="err-nox"></span></div>
            <div class="field"><label>SGP OK<span class="hint">0 hoặc 1</span></label>
                <select id="dbg-sgp" class="status-input">
                    <option value="0">0 — warm-up</option>
                    <option value="1">1 — ready</option>
                </select>
            </div>
            <div class="field full"><label>Test type</label>
                <select id="dbg-test-type" class="status-input">
                    <option value="manual">manual</option>
                    <option value="edge">edge</option>
                    <option value="custom">custom</option>
                </select>
            </div>
            <div class="field full"><label>Note</label>
                <input id="dbg-note" type="text" placeholder="Ghi chú test case" maxlength="200"><span class="err" id="err-note"></span></div>
        </div>

        <div class="form-actions">
            <button onclick="saveDebugRecord()" class="btn-primary btn-update" id="btn-save-debug">Lưu (Insert)</button>
            <button onclick="resetDebugForm()" class="btn-secondary btn-reset">Reset</button>
            <!-- Nút hủy edit: ẩn mặc định, hiện khi editingId != null -->
            <button onclick="cancelEditMode()" class="btn-secondary" id="btn-cancel-edit" style="display:none;">Hủy edit</button>
        </div>
    </div>

    <!-- === PREVIEW DASHBOARD === -->
    <!-- Render card + AQI + chart preview từ debug data -->
    <h3 class="chart-title" style="margin-top:32px; font-size:18px;">Dashboard Preview</h3>

    <!-- AQI circle preview (giống dashboard chính) -->
    <div class="aqi-banner">
        <div class="aqi-circle-container">
            <svg class="aqi-circle" width="200" height="200">
                <circle class="aqi-circle-bg" cx="100" cy="100" r="90" />
                <circle class="aqi-circle-progress" id="dbg-aqi-progress" cx="100" cy="100" r="90" />
            </svg>
            <div class="aqi-circle-text">
                <div class="aqi-value" id="dbg-aqi" style="font-size:48px; font-weight:700; color:#4CAF50; line-height:1;">--</div>
                <div class="aqi-label" style="font-size:14px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-top:4px;">AQI</div>
            </div>
        </div>
        <div class="aqi-status" id="dbg-aqi-text" style="display:inline-block; margin-top:16px; padding:4px 16px; border-radius:12px; background:#4CAF50; color:#fff; font-weight:600;">--</div>
    </div>

    <!-- Cards preview (7 card không có CO/VOC/NOx vì test đơn giản hơn) -->
    <div class="grid">
        <div class="card temp"><div class="label">Nhiệt độ</div><div class="value"><span id="dbg-card-t">--</span><span class="unit">°C</span></div></div>
        <div class="card hum"><div class="label">Độ ẩm</div><div class="value"><span id="dbg-card-h">--</span><span class="unit">%</span></div></div>
        <div class="card volt"><div class="label">Điện áp</div><div class="value"><span id="dbg-card-v">--</span><span class="unit">V</span></div></div>
        <div class="card curr"><div class="label">Dòng điện</div><div class="value"><span id="dbg-card-i">--</span><span class="unit">mA</span></div></div>
        <div class="card pm1"><div class="label">PM1.0</div><div class="value"><span id="dbg-card-pm1">--</span><span class="unit">µg/m³</span></div></div>
        <div class="card pm25"><div class="label">PM2.5</div><div class="value"><span id="dbg-card-pm25">--</span><span class="unit">µg/m³</span></div></div>
        <div class="card pm10"><div class="label">PM10</div><div class="value"><span id="dbg-card-pm10">--</span><span class="unit">µg/m³</span></div></div>
    </div>

    <!-- 3 chart preview: env, pm, power -->
    <div class="chart-container"><h4 class="chart-title" style="font-size:16px;">Môi trường</h4><canvas id="dbg-chart-env"></canvas></div>
    <div class="chart-container"><h4 class="chart-title" style="font-size:16px;">Bụi mịn</h4><canvas id="dbg-chart-pm"></canvas></div>
    <div class="chart-container"><h4 class="chart-title" style="font-size:16px;">Điện áp & Dòng điện</h4><canvas id="dbg-chart-power"></canvas></div>
</section>

<!-- ============================================ -->
<!-- TAB 4: LOG — audit trail (KHÔNG sửa, chỉ xóa) -->
<!-- ============================================ -->
<section class="admin-panel" id="tab-log" style="display:none;">

    <div class="panel-head">
        <h2 class="chart-title">Log hoạt động</h2>
        <div style="display:flex; gap:8px;">
            <button onclick="loadLogs()" class="btn-primary btn-refresh">Làm mới</button>
            <!-- Tạo log thủ công (VD: ghi chú sự kiện ngoài hệ thống) -->
            <button onclick="openNewLogDialog()" class="btn-primary btn-update">Ghi log</button>
        </div>
    </div>

    <div class="debug-notice" style="background:rgba(210,153,34,0.08); border-left-color:#d29922;">
        Audit log các thao tác admin. Không cho sửa, chỉ xóa được log cũ.
    </div>

    <div class="table-toolbar">
        <!-- Filter action: loadLogs() gọi lại API (filter server-side) -->
        <select id="log-filter-action" class="status-select" onchange="loadLogs()">
            <option value="">Tất cả action</option>
            <option value="debug_created">debug_created</option>
            <option value="debug_updated">debug_updated</option>
            <option value="debug_deleted">debug_deleted</option>
            <option value="debug_cleared">debug_cleared</option>
            <option value="debug_cloned">debug_cloned</option>
            <option value="debug_restored">debug_restored</option>
            <option value="debug_simulated">debug_simulated</option>
            <option value="preset_created">preset_created</option>
            <option value="preset_updated">preset_updated</option>
            <option value="preset_deleted">preset_deleted</option>
            <option value="status_changed">status_changed</option>
            <option value="node_added">node_added</option>
            <option value="node_deleted">node_deleted</option>
            <option value="log_created">log_created</option>
        </select>
        <!-- Filter severity: client-side (logsData.filter) -->
        <select id="log-filter-severity" class="status-select" onchange="loadLogs()">
            <option value="">Tất cả severity</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
        </select>
        <input id="log-search" class="status-input" placeholder="Tìm trong target/details/author..." oninput="filterLogTable()">
        <span class="table-count" id="log-count">0 logs</span>
    </div>

    <!-- Danh sách log: render bởi renderLogs(), mỗi entry có border-left màu theo severity -->
    <div id="log-list" class="log-list">
        <div style="text-align:center; padding:40px; color:var(--text-muted);">Đang tải...</div>
    </div>
</section>

<!-- ============================================ -->
<!-- TAB 5: NOTES — ghi chú admin                  -->
<!-- ============================================ -->
<!-- Hệ thống note đơn giản: title + content + tag + pinned + comment -->
<section class="admin-panel" id="tab-notes" style="display:none;">

    <div class="panel-head">
        <h2 class="chart-title">Ghi chú admin</h2>
        <div style="display:flex; gap:8px;">
            <button onclick="loadNotes()" class="btn-primary btn-refresh">Làm mới</button>
            <button onclick="openNewNoteDialog()" class="btn-primary btn-update">Ghi chú mới</button>
        </div>
    </div>

    <div class="debug-notice" style="background:rgba(163,113,247,0.08); border-left-color:#a371f7;">
        Ghi chú tự do của admin. Tag "fatal" sẽ tự động ghim lên đầu.
    </div>

    <div class="table-toolbar">
        <!-- Filter author (loadNotes gọi API với query) -->
        <select id="note-filter-author" class="status-select" onchange="loadNotes()">
            <option value="">Tất cả admin</option>
            <option value="phuyy">phuyy</option>
        </select>
        <!-- Filter tag -->
        <select id="note-filter-tag" class="status-select" onchange="loadNotes()">
            <option value="">Tất cả tag</option>
            <option value="fatal">💀 Fatal</option>
            <option value="note">Note</option>
            <option value="todo">Todo</option>
            <option value="bug">Bug</option>
            <option value="maint">Maint</option>
            <option value="idea">Idea</option>
        </select>
        <!-- Search local -->
        <input id="note-search" class="status-input" placeholder="Tìm trong tiêu đề/nội dung..." oninput="filterNoteList()">
        <span class="table-count" id="note-count">0 notes</span>
    </div>

    <!-- Note list: render bởi renderNoteList() -->
    <div id="note-list" class="note-list">
        <div style="text-align:center; padding:40px; color:var(--text-muted);">Đang tải...</div>
    </div>
</section>

<!-- ============================================ -->
<!-- TAB 6: USERS — quản lý user (CHỈ head_admin)  -->
<!-- ============================================ -->
<section class="admin-panel" id="tab-users" style="display:none;">

    <div class="panel-head">
        <h2 class="chart-title">Quản lý người dùng</h2>
        <div style="display:flex; gap:8px;">
            <button onclick="loadUsers()" class="btn-primary btn-refresh">Làm mới</button>
            <button onclick="openNewUserDialog()" class="btn-primary btn-update">Thêm user</button>
        </div>
    </div>

    <div class="debug-notice" style="background:rgba(163,113,247,0.08); border-left-color:#a371f7;">
        Admin thường không có quyền tạo/sửa user.
    </div>

    <div class="debug-table-wrap">
        <table class="debug-table" id="users-table">
            <thead>
                <tr>
                    <th>ID</th><th>Username</th><th>Role</th><th>Active</th>
                    <th>TOTP</th><th>Last Login</th><th>Created</th><th>Actions</th>
                </tr>
            </thead>
            <tbody id="users-tbody">
                <tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải...</td></tr>
            </tbody>
        </table>
    </div>
</section>

<!-- ============================================ -->
<!-- TAB 7: INCIDENTS — quản lý sự cố              -->
<!-- ============================================ -->
<section class="admin-panel" id="tab-incidents" style="display:none;">

    <div class="panel-head">
        <h2 class="chart-title">Quản lý sự cố</h2>
        <div style="display:flex; gap:8px;">
            <button onclick="loadIncidents()" class="btn-primary btn-refresh">Làm mới</button>
            <button onclick="openIncidentDialog()" class="btn-primary btn-update">Thêm sự cố</button>
        </div>
    </div>

    <div class="debug-table-wrap">
        <table class="debug-table">
            <thead>
                <tr>
                    <th>ID</th><th>Service</th><th>Status</th><th>Bắt đầu</th>
                    <th>Dự kiến</th><th>Thực tế</th><th>Ghi chú</th><th>Actions</th>
                </tr>
            </thead>
            <tbody id="incidents-tbody">
                <tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải...</td></tr>
            </tbody>
        </table>
    </div>
</section>

<!-- ============================================ -->
<!-- TAB 8: DB — database viewer (readonly)        -->
<!-- ============================================ -->
<section class="admin-panel" id="tab-db" style="display:none;">

    <div class="panel-head">
        <h2 class="chart-title">Database Viewer</h2>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <!-- Dropdown chọn bảng: admin_users ẩn nếu không phải head_admin -->
            <select id="db-table-select" class="status-select" onchange="loadDBTable()">
                <option value="sensor">sensor</option>
                <option value="sensor_debug">sensor_debug</option>
                <option value="nodes">nodes</option>
                <option value="admin_logs">admin_logs</option>
                <option value="admin_notes">admin_notes</option>
                <option value="debug_presets">debug_presets</option>
                <option value="incidents">incidents</option>
                <option value="admin_users" class="head-admin-only" style="display:none;">admin_users</option>
            </select>
            <!-- Search debounce 300ms (debouncedDBSearch) -->
            <input id="db-search" class="status-input" placeholder="Tìm..." oninput="debouncedDBSearch()">
            <button onclick="loadDBTable()" class="btn-primary">Làm mới</button>
        </div>
    </div>

    <div class="debug-notice">
        Readonly. Không sửa/xóa từ đây. Tối đa 100 dòng/trang. admin_users chỉ head_admin xem được.
    </div>

    <div class="debug-table-wrap">
        <table class="debug-table" id="db-table">
            <!-- thead render động: cột lấy từ server response -->
            <thead id="db-thead"></thead>
            <tbody id="db-tbody">
                <tr><td style="text-align:center; padding:20px;">Đang tải...</td></tr>
            </tbody>
        </table>
    </div>

    <!-- Pagination: Prev / page info / Next -->
    <div class="table-toolbar" style="justify-content:space-between;">
        <button onclick="dbPrevPage()" class="btn-mini" id="db-prev">← Trang trước</button>
        <span class="table-count" id="db-pagination">0 / 0</span>
        <button onclick="dbNextPage()" class="btn-mini" id="db-next">Trang sau →</button>
    </div>
</section>

<!-- Footer -->
<footer>Admin Panel · <span id="updated">--</span></footer>

<!-- ============================================ -->
<!-- DIALOG 1: CLONE TỪ SENSOR                     -->
<!-- ============================================ -->
<!-- Mở từ tab debug (openCloneDialog) -->
<div id="clone-dialog" class="modal-overlay" style="display:none;">
    <div class="modal-box" style="max-width:800px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h3 style="margin:0;">Clone từ sensor thật</h3>
            <!-- Nút X đóng modal -->
            <button onclick="closeCloneDialog()" style="background:transparent; border:none; color:var(--text-muted); font-size:22px; cursor:pointer; padding:0 8px;">×</button>
        </div>
        <p style="color:var(--text-muted); font-size:13px; margin:0 0 16px;">Chọn 1 record sensor hoặc tick "Clone tất cả".</p>

        <!-- Checkbox "Clone TẤT CẢ" + input limit số lượng -->
        <div style="display:flex; gap:12px; align-items:center; padding:14px 16px; background:rgba(88,166,255,0.08); border:1px solid rgba(88,166,255,0.2); border-radius:10px; margin-bottom:14px;">
            <input type="checkbox" id="clone-all-check" onchange="toggleCloneAll()" style="width:18px; height:18px; accent-color:var(--accent); cursor:pointer; flex-shrink:0;">
            <label for="clone-all-check" style="cursor:pointer; font-size:13px; margin:0; flex:1;">Clone TẤT CẢ sensor</label>
            <input id="clone-all-limit" type="number" class="status-input" style="width:80px;" value="50" min="1" max="500" placeholder="50">
            <span style="font-size:12px; color:var(--text-muted); white-space:nowrap;">records</span>
        </div>

        <!-- Wrapper list: ẩn khi tick "clone all" -->
        <div id="clone-list-wrapper">
            <!-- Search box lọc sensor trong list -->
            <input id="clone-search" class="status-input" placeholder="Tìm theo ID hoặc timestamp..." oninput="filterSensorList()" style="width:100%; margin-bottom:12px;">
            <div id="clone-sensor-list" class="clone-list">
                <div style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải...</div>
            </div>
        </div>

        <div style="display:flex; gap:8px; margin-top:16px; justify-content:flex-end;">
            <button onclick="closeCloneDialog()" class="btn-secondary" style="padding:10px 20px; border-radius:10px;">Hủy</button>
            <!-- Nút "Clone tất cả": ẩn mặc định, hiện khi tick checkbox ở trên -->
            <button onclick="cloneAllSensors()" class="btn-primary" id="btn-clone-all" style="display:none; padding:10px 20px; border-radius:10px;">Clone tất cả</button>
        </div>
    </div>
</div>

<!-- ============================================ -->
<!-- DIALOG 2: GHI LOG                             -->
<!-- ============================================ -->
<!-- Mở từ tab log (openNewLogDialog) -->
<div id="log-dialog" class="modal-overlay" style="display:none;">
    <div class="modal-box">
        <h3>Ghi log mới</h3>
        <div class="form-fields" style="margin-top:16px;">
            <!-- Action: bắt buộc (submitNewLog check .trim()) -->
            <div class="field full"><label>Action <span class="hint">*</span></label>
                <input id="log-form-action" type="text" placeholder="VD: manual_note" maxlength="50"></div>
            <div class="field full"><label>Target</label>
                <input id="log-form-target" type="text" placeholder="VD: sensor_debug#26" maxlength="100"></div>
            <div class="field full"><label>Details</label>
                <textarea id="log-form-details" rows="3" placeholder="Mô tả chi tiết..." maxlength="500"></textarea></div>
            <div class="field full"><label>Severity</label>
                <select id="log-form-severity" class="status-input">
                    <option value="info">info</option>
                    <option value="warn">warn</option>
                    <option value="error">error</option>
                </select>
            </div>
        </div>
        <div style="display:flex; gap:8px; margin-top:20px; justify-content:flex-end;">
            <button onclick="closeLogDialog()" class="btn-secondary">Hủy</button>
            <button onclick="submitNewLog()" class="btn-primary">Ghi</button>
        </div>
    </div>
</div>

<!-- ============================================ -->
<!-- DIALOG 3: GHI CHÚ (CREATE/EDIT)               -->
<!-- ============================================ -->
<!-- Mở từ tab notes (openNewNoteDialog / openEditNoteDialog) -->
<!-- Title động: "Ghi chú mới" hoặc "Sửa ghi chú #id" -->
<div id="note-dialog" class="modal-overlay" style="display:none;">
    <div class="modal-box">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h3 style="margin:0;" id="note-dialog-title">Ghi chú mới</h3>
            <button onclick="closeNoteDialog()" style="background:transparent; border:none; color:var(--text-muted); font-size:22px; cursor:pointer;">×</button>
        </div>
        <div class="form-fields" style="margin-top:16px;">
            <div class="field full"><label>Tiêu đề <span class="hint">*</span></label>
                <input id="note-form-title" type="text" placeholder="VD: Bug dashboard chart" maxlength="100"></div>
            <div class="field full"><label>Nội dung <span class="hint">*</span></label>
                <textarea id="note-form-content" rows="6" placeholder="Mô tả chi tiết..." maxlength="2000"></textarea></div>
            <div class="field"><label>Tag</label>
                <select id="note-form-tag" class="status-input">
                    <option value="fatal">💀 Fatal (tự ghim)</option>
                    <option value="note">Note</option>
                    <option value="todo">Todo</option>
                    <option value="bug">Bug</option>
                    <option value="maint">Maint</option>
                    <option value="idea">Idea</option>
                </select>
            </div>
            <!-- Author: readonly, tự fill từ localStorage.admin_user -->
            <div class="field"><label>Author</label>
                <input id="note-form-author" type="text" readonly style="background:rgba(88,166,255,0.05);"></div>
        </div>
        <div style="display:flex; gap:8px; margin-top:20px; justify-content:flex-end;">
            <button onclick="closeNoteDialog()" class="btn-secondary">Hủy</button>
            <button onclick="submitNote()" class="btn-primary">Lưu</button>
        </div>
    </div>
</div>

<!-- ============================================ -->
<!-- DIALOG 4: USER (CREATE/EDIT)                  -->
<!-- ============================================ -->
<!-- Mở từ tab users (openNewUserDialog / editUser) -->
<div id="user-dialog" class="modal-overlay" style="display:none;">
    <div class="modal-box" style="max-width:500px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h3 style="margin:0;" id="user-dialog-title">Thêm user mới</h3>
            <button onclick="closeUserDialog()" style="background:transparent; border:none; color:var(--text-muted); font-size:22px; cursor:pointer;">×</button>
        </div>
        <div class="form-fields" style="margin-top:16px;">
            <!-- Username: disabled khi edit (không cho đổi username) -->
            <div class="field full"><label>Username <span class="hint">*</span></label>
                <input id="user-form-username" type="text" placeholder="a-z A-Z 0-9 _" maxlength="30"></div>
            <!-- Password: optional khi edit (trống = giữ nguyên) -->
            <div class="field full"><label>Password <span class="hint">* (≥8 ký tự)</span></label>
                <input id="user-form-password" type="password" placeholder="Nhập password"></div>
            <div class="field full"><label>Role</label>
                <select id="user-form-role" class="status-input">
                    <option value="admin">Admin (không cần OTP)</option>
                    <option value="head_admin">Head Admin (cần OTP)</option>
                </select>
            </div>
        </div>
        <div style="display:flex; gap:8px; margin-top:20px; justify-content:flex-end;">
            <button onclick="closeUserDialog()" class="btn-secondary">Hủy</button>
            <button onclick="submitUser()" class="btn-primary" id="user-dialog-submit">Thêm</button>
        </div>
        <div class="login-error" id="user-dialog-error" style="margin-top:12px;"></div>
    </div>
</div>

<!-- ============================================ -->
<!-- DIALOG 5: SỰ CỐ (CREATE/EDIT)                 -->
<!-- ============================================ -->
<div id="incident-dialog" class="modal-overlay" style="display:none;">
    <div class="modal-box" style="max-width:520px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h3 style="margin:0;" id="inc-dialog-title">Thêm sự cố</h3>
            <button onclick="closeIncidentDialog()" style="background:transparent; border:none; color:var(--text-muted); font-size:22px; cursor:pointer;">×</button>
        </div>
        <div class="form-fields" style="margin-top:16px;">
            <div class="field full"><label>Service</label>
                <select id="inc-service" class="status-input">
                    <option value="stm32">NODE (STM32)</option>
                    <option value="esp32">GATEWAY (ESP32)</option>
                    <option value="api">Web API</option>
                    <option value="system">SYSTEM</option>
                </select>
            </div>
            <div class="field full"><label>Status</label>
                <select id="inc-status" class="status-input">
                    <option value="offline">Offline</option>
                    <option value="debug">Debug</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="testing">Testing</option>
                </select>
            </div>
            <!-- datetime-local: native picker, format "YYYY-MM-DDTHH:mm" -->
            <div class="field full"><label>Bắt đầu lúc</label><input id="inc-started" type="datetime-local" class="status-input"></div>
            <div class="field full"><label>Dự kiến khắc phục</label><input id="inc-eta" type="datetime-local" class="status-input"></div>
            <div class="field full"><label>Khắc phục thực tế (bỏ trống nếu chưa xong)</label><input id="inc-resolved" type="datetime-local" class="status-input"></div>
            <div class="field full"><label>Ghi chú</label><input id="inc-note" type="text" class="status-input" placeholder="VD: Mất kết nối WiFi"></div>
        </div>
        <div style="display:flex; gap:8px; margin-top:20px; justify-content:flex-end;">
            <button onclick="closeIncidentDialog()" class="btn-secondary">Hủy</button>
            <button onclick="submitIncident()" class="btn-primary">Lưu</button>
        </div>
    </div>
</div>

<!-- ============================================ -->
<!-- SCRIPTS                                       -->
<!-- ============================================ -->

<!-- Chart.js: cho tab debug (preview charts) -->
<script src="chart.min.js"></script>

<!-- auth-check.js: checkAuth, isAdmin, isHeadAdmin, logout, getToken -->
<script src="auth-check.js"></script>

<!-- ============================================ -->
<!-- SCRIPT 1: AUTH GUARD — chặn truy cập         -->
<!-- ============================================ -->
<script>
(async function() {
    // Chạy ngay khi parse xong script (IIFE async)
    // Mục đích: nếu user không phải admin → redirect về trang chủ
    // Chạy TRƯỚC các script khác để chặn sớm, tránh lộ data
    if (typeof checkAuth === 'function') {
        await checkAuth();  // Hàm auth-check.js: fetch /api/check?token=... → set currentRole
    }
    // Nếu đã check xong mà vẫn không phải admin → đá về trang chủ
    if (typeof isAdmin === 'function' && !isAdmin()) {
        window.location.replace('https://airwatch.io.vn/');
    }
})();
</script>

<!-- ============================================ -->
<!-- SCRIPT 2: MENU + THEME + TAB LOGIC            -->
<!-- ============================================ -->
<script>
// ===== MENU DROPDOWN =====
function toggleMenu(e) {
    e.stopPropagation();  // Ngăn event bubble lên document (sẽ trigger close)
    document.getElementById('dropdown-menu').classList.toggle('open');
}

// Click ra ngoài → đóng menu
document.addEventListener('click', () => {
    const m = document.getElementById('dropdown-menu');
    if (m) m.classList.remove('open');
});

// Handler auth button: đã login → logout, chưa → về trang chủ
function handleAuthAction() {
    if (isAdmin()) logout();
    else window.location.href = '/';
}

// ===== THEME TOGGLE =====
function toggleTheme() {
    const l = document.body.classList.toggle('light');
    localStorage.setItem('theme', l ? 'light' : 'dark');
    updateThemeLabel();
}

function updateThemeLabel() {
    const i = document.getElementById('theme-icon');
    const lb = document.getElementById('theme-label');
    if (!i || !lb) return;
    i.textContent = document.body.classList.contains('light') ? '☀️' : '🌙';
    lb.textContent = document.body.classList.contains('light') ? 'Chế độ sáng' : 'Chế độ tối';
}

// Apply theme lúc load page (đọc từ localStorage)
if (localStorage.getItem('theme') === 'light') document.body.classList.add('light');
updateThemeLabel();

// ===== TAB SWITCHING =====
// Mảng tên 8 tab — dùng để:
//   1. Validate input từ hash/localStorage
//   2. Loop ẩn/hiện section
const TABS = ['nodes', 'status', 'debug', 'log', 'notes', 'users', 'incidents', 'db'];

// Hàm switch tab — core logic
// name: tên tab cần switch ('nodes', 'debug'...)
// updateHash: có cập nhật URL hash không (default true, false khi load lần đầu)
function switchTab(name, updateHash) {
    // Bước 1: Toggle class active trên tab button
    // querySelectorAll('.admin-tab') → tất cả 8 button
    // t.dataset.tab = value của data-tab attribute
    document.querySelectorAll('.admin-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.tab === name)
    );

    // Bước 2: Ẩn/hiện section
    // Section có id = "tab-" + name
    TABS.forEach(p => {
        const el = document.getElementById('tab-' + p);
        if (el) el.style.display = p === name ? '' : 'none';
    });

    // Bước 3: Lazy load content theo tab
    // Dùng setTimeout 100-150ms để:
    //   - Đảm bảo DOM đã hiện (tránh Leaflet render sai size)
    //   - Không block UI switch tab
    if (name === 'nodes') {
        setTimeout(() => {
            if (typeof initNodesMap === 'function') initNodesMap();
            // Leaflet cần invalidateSize khi container vừa hiện
            // Nếu không gọi → map hiển thị ô xám
            if (window.adminMap) window.adminMap.invalidateSize();
        }, 150);
    }
    if (name === 'debug') {
        setTimeout(() => {
            if (typeof loadDebugData === 'function') loadDebugData();
            if (typeof loadPresets === 'function') loadPresets();
        }, 100);
    }
    if (name === 'log') {
        setTimeout(() => { if (typeof loadLogs === 'function') loadLogs(); }, 100);
    }
    if (name === 'notes') {
        setTimeout(() => { if (typeof loadNotes === 'function') loadNotes(); }, 100);
    }
    if (name === 'users') {
        setTimeout(() => { if (typeof loadUsers === 'function') loadUsers(); }, 100);
    }
    if (name === 'incidents') {
        setTimeout(() => { if (typeof loadIncidents === 'function') loadIncidents(); }, 100);
    }
    if (name === 'db') {
        setTimeout(() => { if (typeof loadDBTable === 'function') loadDBTable(); }, 100);
    }

    // Bước 4: Animation panelEnter — tạo hiệu ứng fade-in khi switch
    // Kỹ thuật: remove class cũ → force reflow (void offsetWidth) → add lại
    // Force reflow cần thiết để animation restart lại từ đầu
    const activeEl = document.getElementById('tab-' + name);
    if (activeEl) {
        activeEl.classList.remove('panel-enter');
        void activeEl.offsetWidth;  // Trigger reflow — magic line
        activeEl.classList.add('panel-enter');
    }

    // Bước 5: Persist tab đang xem
    // - updateHash: cập nhật URL hash (cho phép bookmark/share link)
    // - localStorage: nhớ tab khi user F5 (không cần lưu hash)
    if (updateHash !== false) {
        if (location.hash !== '#' + name) {
            history.replaceState(null, '', '#' + name);
            // replaceState: không tạo history entry mới (tránh back button bị "kẹt")
        }
        try { localStorage.setItem('admin_tab', name); } catch(e) {}
        // try/catch: Safari private mode có thể throw khi set localStorage
    }
}

// ===== KHÔI PHỤC TAB KHI LOAD PAGE =====
// Priority: hash > localStorage > default ('nodes')
window.addEventListener('DOMContentLoaded', () => {
    // Đọc từ hash trước (nếu user bookmark URL #debug)
    let initial = (location.hash || '').replace('#', '');

    // Hash không hợp lệ → fallback localStorage
    if (!TABS.includes(initial)) {
        initial = localStorage.getItem('admin_tab') || 'nodes';
    }

    // localStorage cũng invalid → hard default 'nodes'
    if (!TABS.includes(initial)) initial = 'nodes';

    // Switch không update hash (vì đã có hash sẵn hoặc default)
    switchTab(initial, false);
});

// ===== XỬ LÝ KHI USER ĐỔI HASH =====
// VD: user bấm back button → hash thay đổi → switch tab theo hash mới
window.addEventListener('hashchange', () => {
    const name = (location.hash || '').replace('#', '');
    if (TABS.includes(name)) switchTab(name, false);
});

// ===== INTERSECTION OBSERVER — reveal animation =====
// Áp dụng cho admin-panel + admin-header
// Khi scroll tới → thêm class .revealed → CSS transition fade-in
// Mục đích: trang admin dài (nhất là tab debug) → lazy reveal đỡ "giật"
const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
        if (e.isIntersecting) {
            e.target.classList.add('revealed');
            observer.unobserve(e.target);  // Chỉ chạy 1 lần
        }
    });
}, { threshold: 0.1 });  // 10% element hiện ra là trigger

document.querySelectorAll('.admin-panel, .admin-header').forEach(el => observer.observe(el));
</script>

<!-- ============================================ -->
<!-- SCRIPT 3: APP.JS + LEAFLET                    -->
<!-- ============================================ -->

<!-- app.js: TOÀN BỘ LOGIC admin (fetch, render, event handlers) -->
<!-- Load sau auth-check + tab logic để các hàm đã available -->
<script src="app.js"></script>

<!-- Leaflet JS: load SAU app.js để tránh conflict nếu app.js có define L.* -->
<!-- Thực tế Leaflet load sau cũng OK vì app.js chỉ gọi initNodesMap() khi user click tab nodes -->
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<!-- ============================================ -->
<!-- SCRIPT 4: INIT MAP DELAYED                    -->
<!-- ============================================ -->
<script>
    // Delay 300ms rồi init map
    // Lý do:
    //   - Leaflet cần container có width/height thực tế (page chưa layout xong nếu 0ms)
    //   - Tab "nodes" có thể đang ẩn (nếu user load với hash #debug)
    //   - Gọi initNodesMap() 2 lần OK (function có guard `if (adminMap) return`)
    // Nếu tab nodes đang active sẵn khi load page → map init luôn
    if (typeof initNodesMap === 'function') setTimeout(initNodesMap, 300);
</script>

</body>
</html>
```
map.html
```html
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <title>Bản đồ trạm đo — AirWatch</title>

    <!-- Favicon SVG inline (giống các trang khác) -->
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%234CAF50'/><text x='50' y='68' font-size='60' font-family='Arial' font-weight='bold' fill='white' text-anchor='middle'>A</text></svg>">

    <!-- CSS chính -->
    <link rel="stylesheet" href="style.css">

    <!-- Leaflet CSS (bắt buộc cho map render đúng) -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">

    <!-- Inline CSS riêng cho trang map -->
    <!-- Không đưa vào style.css vì chỉ trang này dùng -->
    <style>
        /* #map: container bản đồ chính */
        /* height: calc(100vh - 200px) = viewport height - (nav 80px + header 120px) */
        /* → map luôn fill khoảng trống, không cần scroll */
        /* min-height: 500px — fallback nếu màn hình thấp (mobile landscape) */
        #map {
            height: calc(100vh - 200px);
            min-height: 500px;
            width: 100%;
            border-radius: 12px;
        }

        /* Wrapper: giới hạn max-width 1200px, center page */
        .map-wrapper {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px 40px 40px;
        }

        /* Header: title + subtitle centered */
        .map-header {
            text-align: center;
            margin-bottom: 24px;
        }
        .map-header h1 {
            font-size: 32px;
            color: var(--accent);  /* xanh lá chủ đạo */
            margin-bottom: 8px;
        }
        .map-header p {
            color: var(--text-muted);
            font-size: 15px;
        }
    </style>
</head>
<body>

    <!-- ============================================ -->
    <!-- NAV — giống dashboard, không có popover       -->
    <!-- ============================================ -->
    <nav class="nav">
        <a href="/" class="logo">AirWatch</a>
        <ul class="nav-links">
            <li><a href="/">Trang chủ</a></li>
            <li><a href="/dashboard">Dashboard</a></li>
            <li class="dropdown">
                <button onclick="toggleMenu(event)" class="btn-primary" id="auth-btn"
                        style="padding: 8px 16px; font-size: 13px;">Guest ▾</button>
                <div class="dropdown-menu" id="dropdown-menu">
                    <button onclick="toggleTheme()">
                        <span id="theme-icon">🌙</span>
                        <span id="theme-label">Chế độ tối</span>
                    </button>
                    <div class="dropdown-divider"></div>
                    <a href="#" id="auth-action" onclick="handleAuthAction(); return false;">🔑 Đăng nhập</a>
                </div>
            </li>
        </ul>
    </nav>

    <!-- ============================================ -->
    <!-- MAIN CONTENT — header + map container        -->
    <!-- ============================================ -->
    <div class="map-wrapper">
        <div class="map-header">
            <h1>Bản đồ trạm đo</h1>
            <p>Vị trí các trạm quan trắc trong mạng lưới AirWatch</p>
        </div>

        <!-- #map: div rỗng, JS sẽ init Leaflet vào đây -->
        <!-- Leaflet tự tạo nhiều layer con (tiles, markers, controls) bên trong -->
        <div id="map"></div>
    </div>

    <!-- Footer -->
    <footer>
        <p><strong>AirWatch</strong> — Hệ thống quan trắc không khí LoRa</p>
        <p>Dự án Khoa học Kỹ thuật 2026</p>
    </footer>

    <!-- ============================================ -->
    <!-- SCRIPTS                                       -->
    <!-- ============================================ -->

    <!-- Leaflet JS — load TRƯỚC script init -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

    <!-- auth-check.js: checkAuth, isAdmin, logout, getToken -->
    <script src="auth-check.js"></script>

    <!-- ============================================ -->
    <!-- SCRIPT: MENU + THEME + MAP INIT              -->
    <!-- ============================================ -->
    <script>
        // ===== UI HELPERS (giống các trang khác) =====
        function toggleMenu(e) {
            e.stopPropagation();  // Ngăn event bubble
            document.getElementById('dropdown-menu').classList.toggle('open');
        }

        // Click ra ngoài → đóng dropdown
        document.addEventListener('click', () => {
            const m = document.getElementById('dropdown-menu');
            if (m) m.classList.remove('open');
        });

        // Handler nút auth: login/logout
        function handleAuthAction() {
            if (isAdmin()) {
                logout();
            } else {
                window.location.href = '/';  // về trang chủ (có modal login)
            }
        }

        // ===== THEME TOGGLE =====
        function toggleTheme() {
            const isLight = document.body.classList.toggle('light');
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
            updateThemeLabel();
        }

        // Đọc theme từ localStorage, apply khi load
        function applyTheme() {
            const saved = localStorage.getItem('theme') || 'dark';
            if (saved === 'light') document.body.classList.add('light');
            else document.body.classList.remove('light');
            updateThemeLabel();
        }

        function updateThemeLabel() {
            const icon = document.getElementById('theme-icon');
            const label = document.getElementById('theme-label');
            if (!icon || !label) return;
            if (document.body.classList.contains('light')) {
                icon.textContent = '☀️';
                label.textContent = 'Chế độ sáng';
            } else {
                icon.textContent = '🌙';
                label.textContent = 'Chế độ tối';
            }
        }

        // ===== CONFIG =====
        const API = 'https://airwatch.io.vn';  // Backend URL

        // ===== INIT FLOW =====
        // Chạy IIFE async ngay khi script parse
        (async () => {
            await checkAuth();  // Set currentRole nếu có token

            const btn = document.getElementById('auth-btn');
            const action = document.getElementById('auth-action');

            // Update nav text theo auth state
            if (isAdmin()) {
                if (btn) btn.textContent = 'Admin ▾';
                if (action) action.textContent = '🚪 Đăng xuất';
            } else {
                if (btn) btn.textContent = 'Guest ▾';
                if (action) action.textContent = '🔑 Đăng nhập';
            }

            applyTheme();  // Apply dark/light trước khi init map (để tile màu phù hợp)
            initMap();     // Init bản đồ + load markers
        })();

        // ===== STATE =====
        let map = null;           // Leaflet map instance
        let markerLayer = null;   // LayerGroup chứa tất cả marker

        // ===== INIT MAP =====
        // Tạo Leaflet map + tile layer + layer group cho markers
        async function initMap() {
            const mapEl = document.getElementById('map');
            if (!mapEl) return;

            // Tạo map, center TP.HCM (10.346854, 105.461074), zoom 13
            // Zoom 13 = mức thành phố, thấy được chi tiết đường phố
            // Nếu có nhiều node → fitBounds sẽ override zoom này
            map = L.map('map').setView([10.346854, 105.461074], 13);

            // Tile layer VietMap (bản đồ VN chi tiết hơn OSM)
            // {z}/{x}/{y} = placeholder cho zoom/x/y (Leaflet tự thay)
            L.tileLayer('https://maps.vietmap.vn/maps/tiles/st/{z}/{x}/{y}.png?apikey=75950d796c1f4a611133660d2ec48258174fc8279da00348', {
                attribution: '© VietMap',
                maxZoom: 19  // Giới hạn zoom max (VietMap hỗ trợ đến 19)
            }).addTo(map);

            // LayerGroup: nhóm markers, dễ clear/add nhiều cái cùng lúc
            // Khi cần refresh → markerLayer.clearLayers() xóa hết marker
            markerLayer = L.layerGroup().addTo(map);

            // Load markers từ API
            await loadNodes();
        }

        // ===== LOAD NODES TỪ API =====
        // Fetch /api/nodes → render marker cho mỗi node
        // Auto fit bounds để hiển thị tất cả node trong view
        async function loadNodes() {
            if (!map || !markerLayer) return;
            try {
                const r = await fetch(API + '/api/nodes');
                const nodes = await r.json();

                // Clear markers cũ (nếu refresh)
                markerLayer.clearLayers();

                if (!nodes.length) return;

                // Mảng lat/lng để fit bounds
                const bounds = [];

                nodes.forEach(n => {
                    // Skip node thiếu tọa độ (data lỗi)
                    if (!n.lat || !n.lng) return;

                    // Tạo marker tại vị trí node
                    // L.marker (không phải circleMarker) → icon pin mặc định
                    // Nếu muốn style riêng: L.circleMarker như index.html
                    const marker = L.marker([n.lat, n.lng]).addTo(markerLayer);

                    // Popup khi click marker
                    // Hiển thị: tên, ID, tọa độ (4 chữ số thập phân)
                    marker.bindPopup(
                        '<strong>' + n.name + '</strong><br>' +
                        'ID: ' + n.id + '<br>' +
                        'Tọa độ: ' + n.lat.toFixed(4) + ', ' + n.lng.toFixed(4)
                    );

                    // Thêm vào mảng bounds để auto-zoom
                    bounds.push([n.lat, n.lng]);
                });

                // === AUTO ZOOM ===
                // 1 node → center tại node, zoom 13 (mức đường phố)
                // Nhiều node → fitBounds (zoom sao cho tất cả hiện trong khung)
                // Padding 40px để marker không sát viền
                if (bounds.length === 1) {
                    map.setView(bounds[0], 13);
                } else if (bounds.length > 1) {
                    map.fitBounds(bounds, { padding: [40, 40] });
                }
                // 0 node → giữ nguyên view mặc định (TP.HCM, zoom 13)
            } catch(e) {
                console.error('Load nodes fail:', e);
                // Fallback: giữ map ở default view, không có marker
            }
        }
    </script>
</body>
</html>
```

style.css
```css
/* ============================================================
   BIẾN MÀU (THEME) — "bảng màu" của toàn website
   ============================================================
   Toàn bộ màu sắc được khai báo 1 lần ở đây, các chỗ khác
   chỉ việc gọi tên biến (VD: color: var(--text)) thay vì
   gõ mã màu.
   
   Lợi ích: đổi 1 chỗ → đổi toàn site. VD muốn đổi màu chữ
   từ trắng sang vàng → chỉ sửa --text ở đây.
   ============================================================ */
:root {
    /* --bg = màu nền chính (background) — xanh đen rất tối */
    --bg: #0f1419;
    
    /* --bg-card = màu nền các "thẻ" (card) nổi trên nền chính
       Sáng hơn --bg 1 chút để tạo cảm giác "nổi lên" */
    --bg-card: #1a1f2e;
    
    /* --border = màu đường viền (viền card, viền input...) */
    --border: #2a3040;
    
    /* --text = màu chữ chính — trắng ngà (không trắng tinh để đỡ chói mắt) */
    --text: #e7e9ea;
    
    /* --text-muted = màu chữ mờ (label, ghi chú phụ) — xám */
    --text-muted: #8899a6;
    
    /* --accent = MÀU NHẤN CHÍNH — xanh lá, dùng cho button, logo, link */
    --accent: #4CAF50;
    
    /* --accent-hover = màu xanh đậm hơn, khi rê chuột vào button sẽ đổi sang màu này */
    --accent-hover: #45a049;
    
    /* --shadow = màu bóng đổ (tạo hiệu ứng "nổi khối") */
    --shadow: rgba(0,0,0,0.4);
}

/* ============================================================
   CHẾ ĐỘ SÁNG (LIGHT MODE)
   ============================================================
   Khi user bấm nút đổi theme → JavaScript thêm class .light
   vào thẻ <body>. Khi có class này, các biến màu bên dưới
   GHI ĐÈ các biến ở :root phía trên.
   
   Nghĩa là: cùng 1 đoạn code dùng var(--bg), nhưng tự động
   đổi màu theo theme đang bật.
   ============================================================ */
body.light {
    --bg: #f5f5f7;           /* nền sáng (trắng xám) */
    --bg-card: #ffffff;      /* card trắng tinh */
    --border: #e0e0e0;       /* viền xám nhạt */
    --text: #1a1f2e;         /* chữ đen */
    --text-muted: #666;      /* chữ xám */
    --shadow: rgba(0,0,0,0.1); /* bóng nhẹ hơn (sáng thì bóng mờ) */
}

/* ============================================================
   RESET — "dọn dẹp" mặc định của trình duyệt
   ============================================================
   Mỗi trình duyệt (Chrome, Firefox, Safari) có CSS mặc định
   khác nhau (VD: khoảng cách mặc định quanh <p>, <h1>...).
   Reset để đồng bộ mọi browser → hiển thị giống nhau.
   ============================================================ */
* {
    /* box-sizing: border-box = khi set width 100px, thì 100px
       là TỔNG chiều rộng gồm cả padding + border. Mặc định của
       browser là "content-only" — khó tính toán hơn.
       Đây là best practice phổ biến nhất. */
    box-sizing: border-box;
    
    /* Xóa margin (khoảng cách ngoài) + padding (khoảng cách trong)
       mặc định của browser */
    margin: 0;
    padding: 0;
}

/* ============================================================
   BODY — style chung cho toàn trang
   ============================================================ */
body {
    /* font-family: danh sách font ưu tiên
       Trình duyệt thử font đầu tiên, không có thì fallback
       -apple-system = font hệ thống Apple
       Arial = phổ biến Windows
       sans-serif = fallback cuối cùng (font không chân) */
    font-family: -apple-system, Arial, sans-serif;
    
    /* Màu nền + màu chữ lấy từ biến theme */
    background: var(--bg);
    color: var(--text);
    
    /* padding 24px = chừa 24px khoảng trống quanh nội dung
       (tránh sát viền màn hình) */
    padding: 24px;
    
    /* transition: khi background/color thay đổi → chuyển mượt
       trong 0.2s thay vì đổi đột ngột.
       Dùng khi user bấm nút đổi theme → màu chuyển mượt đẹp hơn */
    transition: background 0.2s, color 0.2s;
}

/* Trang landing (trang chủ) KHÔNG có padding
   vì muốn hero section tràn viền */
body.landing { padding: 0; }

/* Link: kế thừa màu từ phần tử cha (không tự đổi màu xanh mặc định) */
a { color: inherit; }

/* H1 = tiêu đề cấp 1 */
h1 {
    font-size: 28px;              /* cỡ chữ */
    margin-bottom: 24px;          /* khoảng cách dưới h1 = 24px */
    color: var(--accent);         /* màu xanh lá */
}

/* ============================================================
   NAV — THANH ĐIỀU HƯỚNG TRÊN CÙNG
   ============================================================
   Đặc điểm: dính trên đầu trang, khi scroll không bị trôi mất
   ============================================================ */
.nav {
    /* display: flex = xếp các con bên trong thành 1 hàng ngang
       (mặc định là xếp dọc) */
    display: flex;
    
    /* justify-content: space-between = đẩy phần tử đầu về trái,
       phần tử cuối về phải → có "khoảng trống ở giữa"
       VD: Logo (trái) --- khoảng trống --- Menu (phải) */
    justify-content: space-between;
    
    /* align-items: center = căn giữa theo chiều dọc
       (logo và menu cao bằng nhau, thẳng hàng giữa) */
    align-items: center;
    
    /* padding: 20px 40px = 20px trên/dưới, 40px trái/phải */
    padding: 20px 40px;
    
    background: var(--bg);
    
    /* border-bottom = đường kẻ ngang phía dưới nav */
    border-bottom: 1px solid var(--border);
    
    /* position: sticky = "dính" — khi scroll xuống, nav vẫn
       ở top: 0 (dính trên cùng màn hình), không bị trôi */
    position: sticky;
    top: 0;              /* dính ở mép trên */
    
    /* z-index: 100 = xếp lớp trên các phần tử khác
       Số càng lớn càng "nổi" lên trên. Nav cần nổi để không
       bị content scroll đè lên */
    z-index: 100;
}

/* Logo "AirWatch" ở góc trái nav */
.logo {
    font-size: 22px;
    font-weight: 700;              /* chữ đậm (700 = bold) */
    color: var(--accent);
    text-decoration: none;         /* bỏ gạch chân link */
}

/* Danh sách menu ngang (Dashboard, Bản đồ...) */
.nav-links {
    display: flex;
    gap: 24px;                     /* khoảng cách giữa các item = 24px */
    list-style: none;              /* bỏ dấu chấm đầu dòng (mặc định của <ul>) */
    align-items: center;
}

.nav-links a {
    color: var(--text);
    text-decoration: none;
    font-size: 14px;
}

/* :hover = trạng thái "rê chuột vào" */
.nav-links a:hover { color: var(--accent); }

/* ============================================================
   BUTTONS — CÁC LOẠI NÚT BẤM
   ============================================================ */
.btn-primary {
    /* display: inline-block = giống "viên gạch" — có thể set
       kích thước (width/height/padding) nhưng vẫn nằm cùng dòng
       với text xung quanh */
    display: inline-block;
    
    padding: 10px 20px;
    background: var(--accent);     /* nền xanh lá */
    color: #fff;                   /* chữ trắng */
    text-decoration: none;         /* bỏ gạch chân */
    
    /* border-radius: 8px = bo tròn 4 góc, bán kính 8px
       (càng lớn càng tròn, 50% = hình tròn) */
    border-radius: 8px;
    
    font-weight: 600;
    font-size: 14px;
    
    /* border: none = bỏ viền mặc định của <button> */
    border: none;
    
    /* cursor: pointer = khi hover hiện con trỏ "bàn tay chỉ"
       (giống khi hover link) → user biết có thể click */
    cursor: pointer;
}

.btn-primary:hover { background: var(--accent-hover); }

/* Nút to hơn (dùng cho CTA chính) */
.btn-large { padding: 14px 32px; font-size: 16px; }

/* Nút phụ (outline — chỉ viền, không nền) */
.btn-secondary {
    display: inline-block;
    padding: 10px 20px;
    background: transparent;       /* nền trong suốt */
    color: var(--accent);
    border: 1px solid var(--accent);  /* viền xanh */
    text-decoration: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
}

/* Khi hover → nền xanh nhạt trong suốt (alpha 0.1 = 10% đậm) */
.btn-secondary:hover { background: rgba(76,175,80,0.1); }

/* Nút full width (dùng trong form login) */
.btn-full { width: 100%; padding: 12px; margin-top: 8px; }

/* ============================================================
   HERO — BANNER LỚN Ở ĐẦU TRANG CHỦ
   ============================================================
   Phần "AirWatch / Theo dõi chất lượng không khí..." khi vào web
   ============================================================ */
.hero {
    /* padding: 100px 40px = 100px trên/dưới (khoảng thở rộng),
       40px trái/phải */
    padding: 100px 40px;
    
    /* text-align: center = căn giữa toàn bộ text con */
    text-align: center;
    
    /* max-width + margin auto = giới hạn độ rộng + căn giữa khung */
    max-width: 900px;
    margin: 0 auto;
}

.hero h1 {
    font-size: 48px;
    line-height: 1.2;              /* khoảng cách dòng (1.2 = 120% cỡ chữ) */
    margin-bottom: 20px;
    color: var(--text);            /* override màu xanh mặc định của h1 */
}

/* Class .accent = đoạn text được highlight màu xanh
   VD: <span class="accent">Watch</span> */
.accent { color: var(--accent); }

.subtitle {
    font-size: 18px;
    color: var(--text-muted);
    margin-bottom: 40px;
    line-height: 1.6;              /* dòng thoáng hơn (160%) cho dễ đọc */
}

.hero-actions {
    display: flex;
    gap: 16px;
    justify-content: center;       /* căn giữa các nút */
}

/* ============================================================
   SECTION — KHUNG CHUNG CHO CÁC PHẦN NỘI DUNG
   ============================================================ */
.section {
    padding: 80px 40px;
    max-width: 1200px;
    margin: 0 auto;
}

.section h2 {
    font-size: 32px;
    color: var(--text);
    margin-bottom: 40px;
    text-align: center;
}

/* ============================================================
   CONTENT SECTION — 2 CỘT (ẢNH + TEXT)
   ============================================================
   Dùng ở phần "Vấn đề ô nhiễm không khí" — ảnh 1 bên, chữ 1 bên
   ============================================================ */
.content-section {
    padding: 80px 40px;
    max-width: 1200px;
    margin: 0 auto;
}

/* Grid 2 cột: ảnh (1fr) + text (1fr) — bằng nhau */
.content-row {
    /* display: grid = chia layout thành lưới ô
       grid-template-columns: 1fr 1fr = 2 cột bằng nhau
       (1fr = 1 "fraction" — chia đều không gian) */
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 60px;                     /* khoảng cách giữa 2 cột */
    align-items: center;           /* căn giữa theo chiều dọc */
    margin-bottom: 80px;
}

/* .reverse = đảo ngược thứ tự: ảnh sang phải, text sang trái
   Kỹ thuật: direction: rtl (right-to-left) đảo toàn bộ
   Rồi thêm direction: ltr cho con để text vẫn đọc từ trái */
.content-row.reverse { direction: rtl; }
.content-row.reverse > * { direction: ltr; }

.content-img {
    border-radius: 16px;
    
    /* overflow: hidden = nội dung con "tràn" ra ngoài sẽ bị cắt
       (dùng để bo tròn góc ảnh: ảnh vuông + container bo tròn
       → góc ảnh cũng bo theo) */
    overflow: hidden;
    
    box-shadow: 0 10px 40px var(--shadow);  /* bóng đổ lớn, mềm */
}

.content-img img {
    width: 100%;
    height: 100%;
    object-fit: cover;             /* ảnh "cover" khung — cắt phần thừa
                                      thay vì bóp méo tỉ lệ */
    display: block;                /* tránh khoảng trắng nhỏ dưới ảnh (inline default) */
    min-height: 350px;             /* đảm bảo ảnh không quá thấp */
}

.content-text h3 {
    font-size: 32px;
    color: var(--accent);
    margin-bottom: 20px;
    line-height: 1.3;
}

.content-text p {
    color: var(--text-muted);
    line-height: 1.8;              /* dòng rất thoáng (180%) cho dễ đọc đoạn dài */
    margin-bottom: 16px;
    font-size: 16px;
}

.content-text ul {
    list-style: none;              /* bỏ dấu chấm đầu dòng mặc định */
    padding: 0;
}

.content-text ul li {
    color: var(--text-muted);
    padding: 10px 0 10px 28px;     /* chừa 28px bên trái cho dấu ▸ */
    
    /* position: relative = "mốc" cho ::before (dấu ▸) absolute bên trong */
    position: relative;
    
    line-height: 1.7;
    font-size: 16px;
}

/* ::before = chèn nội dung TRƯỚC mỗi <li> — dùng làm dấu bullet custom */
.content-text ul li::before {
    content: "▸";                  /* dấu mũi tên tam giác */
    color: var(--accent);
    position: absolute;            /* định vị tuyệt đối so với <li> */
    left: 8px;                     /* cách mép trái 8px */
    font-weight: bold;
    font-size: 18px;
}

/* ============================================================
   FEATURES — LƯỚI CARD TÍNH NĂNG (3 hoặc 4 cột)
   ============================================================
   Dùng ở section "Trạm quan trắc còn quá thưa" — 4 card
   Và section "Giải pháp" — 6 card
   ============================================================ */
.features {
    /* repeat(auto-fit, minmax(280px, 1fr)) =
       - auto-fit: tự động tạo bao nhiêu cột vừa đủ
       - minmax(280px, 1fr): mỗi cột rộng TỐI THIỂU 280px,
         tối đa 1fr (chia đều không gian còn lại)
       
       Kết quả: màn hình rộng → nhiều cột, màn hình hẹp → ít cột.
       Tự "responsive" mà không cần media query. */
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 24px;
}

.feature {
    background: var(--bg-card);
    padding: 30px;
    border-radius: 12px;
    border: 1px solid var(--border);
    
    /* transition = khi có thay đổi (VD: hover), chuyển mượt 0.2s */
    transition: transform 0.2s, border-color 0.2s;
}

/* Khi hover card: nhấc lên 4px + đổi màu viền sang xanh */
.feature:hover {
    /* translateY(-4px) = dịch chuyển LÊN 4px (âm = lên trên) */
    transform: translateY(-4px);
    border-color: var(--accent);
}

.feature .icon { font-size: 40px; margin-bottom: 16px; }

.feature h3 {
    font-size: 20px;
    color: var(--accent);
    margin-bottom: 12px;
}

.feature p { color: var(--text-muted); line-height: 1.6; }

/* ============================================================
   SPEC SECTION — THÔNG SỐ CẢM BIẾN
   ============================================================ */
.spec-section {
    padding: 80px 40px;
    max-width: 1200px;
    margin: 0 auto;
}

.spec-header {
    text-align: center;
    margin-bottom: 60px;
}

.spec-header h2 {
    font-size: 36px;
    color: var(--accent);
    margin-bottom: 12px;
}

.spec-header p {
    color: var(--text-muted);
    font-size: 17px;
}

/* Lưới card thông số (4 card: bụi, CO, VOC/NOx, vi khí hậu) */
.spec-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 24px;
}

.spec-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 28px;
    transition: transform 0.2s, border-color 0.2s;
}

.spec-card:hover {
    transform: translateY(-4px);
    border-color: var(--accent);
}

.spec-icon { font-size: 40px; margin-bottom: 16px; }

.spec-card h4 {
    font-size: 20px;
    color: var(--accent);
    margin-bottom: 20px;
}

/* Danh sách thông số bên trong card (VD: PM1.0 / PM2.5 / PM10) */
.spec-values {
    display: flex;
    
    /* flex-direction: column = xếp dọc (mỗi dòng 1 thông số) */
    flex-direction: column;
    
    gap: 10px;
    margin-bottom: 16px;
}

.spec-values > div {
    /* Mỗi dòng: label trái, giá trị phải (space-between) */
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: rgba(76,175,80,0.05);  /* xanh rất nhạt (5% đậm) */
    border-radius: 8px;
}

.spec-values span { color: var(--text-muted); font-size: 14px; }
.spec-values strong { color: var(--text); font-size: 14px; }

/* Cảnh báo ngưỡng (VD: "Cảnh báo > 50 µg/m³") */
.spec-warn {
    font-size: 12px;
    color: var(--text-muted);
    padding-top: 12px;
    
    /* border-top dashed = đường kẻ đứt ở trên, ngăn cách */
    border-top: 1px dashed var(--border);
}

/* ============================================================
   SPEC TABLE — BẢNG (dùng cho bảng AQI, bảng tử vong)
   ============================================================ */
.spec-table {
    width: 100%;
    
    /* border-collapse: collapse = gộp viền các ô lại
       (mặc định mỗi ô có viền riêng, có gap giữa các ô) */
    border-collapse: collapse;
    
    background: var(--bg-card);
    border-radius: 12px;
    overflow: hidden;              /* cắt góc cho bo tròn table */
    border: 1px solid var(--border);
}

/* Chung cho cả header (th) và cell (td) của bảng */
.spec-table th,
.spec-table td {
    padding: 14px 20px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    vertical-align: top;           /* nội dung căn trên (nếu ô cao) */
}

.spec-table th {
    background: rgba(76,175,80,0.1);  /* header nền xanh nhạt */
    color: var(--accent);
    font-weight: 600;
}

.spec-table td {
    color: var(--text);
}

/* Dòng cuối: bỏ border dưới (vì table đã có border bao ngoài) */
.spec-table tr:last-child td {
    border-bottom: none;
}

.spec-table ul li {
    color: var(--text);
    padding: 4px 0;
    font-size: 14px;
}

/* ============================================================
   CTA SECTION — NÚT KÊU GỌI HÀNH ĐỘNG CUỐI TRANG
   ============================================================ */
.cta-section { text-align: center; padding: 60px 40px; }

/* ============================================================
   MODAL — HỘP THOẠI NỔI (login, QR, dialog)
   ============================================================
   Cấu trúc: overlay (nền tối) + modal (hộp trắng ở giữa)
   ============================================================ */
.modal-overlay {
    /* position: fixed = định vị CỐ ĐỊNH so với viewport (không scroll theo trang)
       top/left = 0 → bắt đầu từ góc trên trái
       width/height = 100% → phủ kín toàn màn hình */
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    
    background: rgba(0,0,0,0.7);   /* nền đen mờ 70% */
    
    /* flex + center = căn giữa modal con */
    display: flex;
    align-items: center;
    justify-content: center;
    
    z-index: 1000;                 /* nổi trên mọi thứ */
}

.modal {
    background: var(--bg-card);
    padding: 40px;
    border-radius: 16px;
    border: 1px solid var(--border);
    width: 100%;
    max-width: 400px;              /* không rộng quá 400px */
    
    /* position: relative = mốc cho .modal-close (nút X) absolute */
    position: relative;
}

/* Nút X đóng modal — góc phải trên */
.modal-close {
    position: absolute;            /* định vị theo .modal */
    top: 12px; right: 16px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 28px;
    cursor: pointer;
    line-height: 1;                /* chữ X không bị lệch do line-height */
}

.modal-close:hover { color: var(--text); }

.login-logo {
    font-size: 24px;
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 8px;
}

.modal h2 {
    font-size: 22px;
    color: var(--text);
    margin-bottom: 24px;
}

/* Label của input trong form */
.modal label { display: block; margin-bottom: 16px; }

.modal label span {
    /* display: block = label và input xuống dòng (không nằm ngang) */
    display: block;
    font-size: 13px;
    color: var(--text-muted);
    margin-bottom: 6px;
}

.modal input {
    width: 100%;
    padding: 12px 14px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 15px;
    
    /* outline: none = bỏ viền xanh mặc định của browser khi focus
       (mình sẽ tự style bằng border-color) */
    outline: none;
}

/* :focus = khi user click vào input / đang gõ */
.modal input:focus { border-color: var(--accent); }

.login-error {
    color: #f44336;                /* đỏ */
    font-size: 13px;
    margin-top: 12px;
    
    /* min-height để dù không có text thì vẫn giữ chỗ
       → layout không bị "nhảy" khi error xuất hiện */
    min-height: 18px;
}
/* ============================================================
   DASHBOARD — TRANG XEM DỮ LIỆU CHÍNH
   ============================================================ */

/* Badge trạng thái LIVE/OFFLINE cạnh tiêu đề Dashboard */
.status {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 12px;               /* bo tròn như "viên thuốc" */
    background: var(--accent);         /* xanh lá = LIVE */
    color: #fff;
    font-size: 12px;
    margin-left: 12px;                 /* cách tiêu đề 12px */
    vertical-align: middle;            /* căn giữa theo chiều dọc với text */
}

/* Khi offline → đổi màu đỏ */
.status.offline { background: #f44336; }

/* ============================================================
   GRID — LƯỚI CARD THÔNG SỐ (10 card dashboard)
   ============================================================ */
.grid {
    display: grid;
    
    /* auto-fit + minmax = tự động số cột theo màn hình
       - Màn hình rộng: 5-6 card/hàng
       - Màn hình hẹp: 2-3 card/hàng
       - Mobile: 1 card/hàng */
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
}

/* Card hiển thị 1 thông số (VD: Nhiệt độ 24.5°C) */
.card {
    background: var(--bg-card);
    padding: 20px;
    border-radius: 12px;
    border: 1px solid var(--border);
}

/* Label nhỏ phía trên (VD: "NHIỆT ĐỘ") */
.card .label {
    font-size: 13px;
    color: var(--text-muted);
    
    /* text-transform: uppercase = chuyển hết thành CHỮ HOA */
    text-transform: uppercase;
    
    /* letter-spacing: 0.5px = giãn chữ ra 0.5px giữa các ký tự
       → nhìn "thoáng" hơn, dễ đọc hơn */
    letter-spacing: 0.5px;
    margin-bottom: 8px;
}

/* Số liệu lớn ở giữa card (VD: "24.50") */
.card .value {
    font-size: 36px;                   /* chữ rất to để dễ đọc từ xa */
    font-weight: 600;                  /* hơi đậm */
    color: var(--accent);
    line-height: 1;                    /* không có khoảng cách dòng (chữ to mà) */
}

/* Đơn vị nhỏ bên cạnh số (VD: "°C", "%") */
.card .unit {
    font-size: 16px;                   /* nhỏ hơn số chính */
    color: var(--text-muted);
    margin-left: 4px;
}

/* ===== MÀU RIÊNG CHO TỪNG CARD =====
   Mỗi loại thông số có màu đặc trưng để dễ phân biệt
   Dùng .card.{type} .value để chỉ đổi màu SỐ (không đổi màu label) */
.card.temp .value { color: #f44336; }   /* Nhiệt độ = đỏ */
.card.hum .value  { color: #2196F3; }   /* Độ ẩm = xanh dương */
.card.volt .value { color: #FF9800; }   /* Điện áp = cam */
.card.curr .value { color: #9C27B0; }   /* Dòng điện = tím */
.card.pm1 .value  { color: #FFC107; }   /* PM1.0 = vàng hổ phách */
.card.pm25 .value { color: #FF5722; }   /* PM2.5 = cam đỏ */
.card.pm10 .value { color: #FF9800; }   /* PM10 = cam */

/* ============================================================
   CHART CONTAINER — KHUNG CHỨA BIỂU ĐỒ
   ============================================================ */
.chart-title {
    font-size: 18px;
    color: var(--accent);
    margin-bottom: 16px;
}

.chart-container {
    background: var(--bg-card);
    padding: 20px;
    border-radius: 12px;
    border: 1px solid var(--border);
    margin-bottom: 24px;
    
    /* height: 350px = cố định chiều cao khung
       Chart.js cần container có chiều cao cụ thể mới render đúng
       Nếu để auto → chart cao bằng 0, không hiển thị */
    height: 350px;
    
    /* position: relative = mốc cho canvas con (Chart.js set canvas absolute) */
    position: relative;
}

/* Canvas (vùng vẽ chart) không được vượt quá 300px chiều cao
   (trừ padding + title) */
canvas { max-height: 300px; }

/* ============================================================
   FOOTER — CHÂN TRANG
   ============================================================ */
footer {
    padding: 40px;
    text-align: center;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 13px;
    margin-top: 40px;
}

/* ============================================================
   DROPDOWN — MENU XỔ XUỐNG (user menu)
   ============================================================ */
.dropdown { position: relative; }  /* mốc cho .dropdown-menu absolute */

.dropdown-menu {
    /* position: absolute = định vị so với .dropdown cha
       → menu "nổi" trên nội dung, không đẩy layout */
    position: absolute;
    top: calc(100% + 8px);           /* cách button 8px (100% = chiều cao button) */
    right: 0;                        /* căn phải (menu xổ về bên trái) */
    min-width: 200px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 6px;
    
    /* display: none = ẩn mặc định. JS thêm class .open để hiện */
    display: none;
    flex-direction: column;
    
    /* Bóng đổ để menu "nổi" khỏi nền */
    box-shadow: 0 8px 24px var(--shadow);
    z-index: 200;                    /* nổi trên nav (nav z-index 100) */
}

/* Khi có class .open (JS toggle) → hiện menu */
.dropdown-menu.open { display: flex; }

/* Item trong menu (link + button) */
.dropdown-menu a,
.dropdown-menu button {
    display: flex;                   /* icon + text nằm ngang */
    align-items: center;
    gap: 10px;                       /* cách icon 10px */
    padding: 10px 14px;
    color: var(--text);
    text-decoration: none;
    border-radius: 6px;
    font-size: 14px;
    background: none;                /* bỏ nền mặc định của <button> */
    border: none;
    cursor: pointer;
    text-align: left;                /* button mặc định center, đổi về left */
    width: 100%;                     /* button full width */
    font-family: inherit;            /* button mặc định dùng system font, đổi về font trang */
}

/* Hover item → đổi nền + màu chữ */
.dropdown-menu a:hover,
.dropdown-menu button:hover {
    background: var(--border);
    color: var(--accent);
}

/* Đường kẻ ngăn cách giữa các nhóm item */
.dropdown-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 6px;
}

/* ============================================================
   SCROLL REVEAL — HIỆU ỨNG FADE KHI SCROLL
   ============================================================
   Element ban đầu ẩn + dịch xuống 40px.
   Khi JS thêm class .active → hiện ra + dịch lên vị trí gốc.
   ============================================================ */
.reveal {
    opacity: 0;                              /* vô hình */
    transform: translateY(40px);             /* dịch xuống 40px */
    transition: opacity 0.8s ease, transform 0.8s ease;
}

.reveal.active {
    opacity: 1;
    transform: translateY(0);                /* về vị trí gốc */
}

/* ============================================================
   DATE SELECTOR — THANH CHỌN NGÀY
   ============================================================ */
.date-selector {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;                          /* cho phép xuống dòng trên mobile */
    margin-bottom: 20px;
    padding: 16px 20px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
}

.date-selector label {
    font-size: 14px;
    color: var(--text-muted);
    font-weight: 500;
}

/* Input date của browser (native date picker) */
.date-selector input[type="date"] {
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    cursor: pointer;
}

.date-selector input[type="date"]:focus {
    outline: none;
    border-color: var(--accent);
}

/* ============================================================
   AQI BANNER — VÒNG TRÒN AQI LỚN Ở ĐẦU DASHBOARD
   ============================================================ */
.aqi-banner {
    text-align: center;
    padding: 32px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 16px;
    margin-bottom: 24px;
}

/* Số AQI cực lớn, màu thay đổi theo bậc (JS update) */
.aqi-value {
    line-height: 1;
    margin-bottom: 8px;
    transition: color 0.3s;                  /* đổi màu mượt khi bậc thay đổi */
}

.aqi-label {
    font-size: 14px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 12px;
}

.aqi-status { transition: background 0.3s; }

/* ============================================================
   VÒNG TRÒN AQI (SVG) — DASHBOARD
   ============================================================
   Cấu trúc: 2 hình tròn SVG chồng nhau
   - .aqi-circle-bg: vòng nền xám (luôn full)
   - .aqi-circle-progress: vòng màu xanh chạy theo % AQI
   ============================================================ */
.aqi-circle-container {
    position: relative;                      /* mốc cho .aqi-circle-text absolute */
    width: 200px;
    height: 200px;
    margin: 0 auto;                          /* căn giữa */
}

.aqi-circle {
    /* rotate(-90deg) = xoay SVG 90 độ ngược chiều kim đồng hồ
       → vòng tròn bắt đầu vẽ từ đỉnh 12h thay vì 3h */
    transform: rotate(-90deg);
}

/* Vòng nền (xám, không có progress) */
.aqi-circle-bg {
    fill: none;                              /* không tô nền bên trong */
    stroke: var(--border);                   /* màu viền */
    stroke-width: 10;                        /* độ dày viền */
}

/* Vòng progress (màu thay đổi theo AQI) */
.aqi-circle-progress {
    fill: none;
    stroke: var(--accent);
    stroke-width: 10;
    
    /* stroke-linecap: round = đầu/cuối nét vẽ bo tròn (không vuông) */
    stroke-linecap: round;
    
    /* stroke-dasharray = 565.48 = chu vi vòng tròn (2π × 90 = 565.48)
       → "dash" dài đúng bằng chu vi → vẽ thành 1 nét liền */
    stroke-dasharray: 565.48;
    
    /* stroke-dashoffset = 565.48 = "đẩy" dash ra ngoài hoàn toàn
       → vòng tròn BAN ĐẦU không vẽ gì
       JS update giá trị này từ 565 → 0 để "vẽ dần" vòng tròn */
    stroke-dashoffset: 565.48;
    transition: stroke-dashoffset 1.5s ease-out, stroke 0.5s ease;
}

/* Text overlay chính giữa vòng tròn */
.aqi-circle-text {
    position: absolute;
    /* top 50% + left 50% = góc trên trái của text ở giữa container */
    top: 50%;
    left: 50%;
    /* translate(-50%, -50%) = dịch ngược để TÂM text ở đúng giữa
       (kỹ thuật "centering" kinh điển) */
    transform: translate(-50%, -50%);
    text-align: center;
}

/* ============================================================
   AQI TABLE — BẢNG 6 MỨC AQI
   ============================================================ */
.aqi-table-section {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 24px;
    margin-bottom: 24px;
    max-width: 1000px;
    margin-left: auto;
    margin-right: auto;
}

.aqi-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
}

.aqi-table thead th {
    background: var(--bg);
    color: var(--text);
    padding: 12px 16px;
    text-align: left;
    font-weight: 600;
    border-bottom: 2px solid var(--border);   /* viền dày 2px phân cách header */
}

.aqi-table tbody td {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    vertical-align: middle;
}

.aqi-table tbody tr:last-child td {
    border-bottom: none;
}

/* Badge màu hiển thị "0-50", "51-100"... */
.aqi-badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 8px;
    color: #fff;
    font-weight: 600;
    font-size: 13px;
    min-width: 80px;
    text-align: center;
}

/* ============================================================
   ADMIN PANEL — TRANG QUẢN TRỊ
   ============================================================ */

/* Header trang admin: title gradient + subtitle */
.admin-header {
    text-align: center;
    padding: 60px 20px 20px;
    opacity: 0;                              /* ẩn ban đầu, chờ reveal animation */
    transform: translateY(30px);
    transition: all 0.8s cubic-bezier(0.25, 1, 0.5, 1);
}

.admin-header.revealed {
    opacity: 1;
    transform: translateY(0);
}

.admin-header h1 {
    font-size: 42px;
    margin-bottom: 8px;
    
    /* GRADIENT TEXT — hiệu ứng chữ "chuyển màu"
       1. background: linear-gradient = nền gradient từ xanh lá → xanh dương
       2. -webkit-background-clip: text = "cắt" nền theo hình chữ
       3. -webkit-text-fill-color: transparent = chữ trong suốt
       → Kết quả: chữ có màu gradient thay vì màu đơn sắc
       
       Lưu ý: cần cả 3 dòng mới hoạt động trên mọi browser */
    background: linear-gradient(135deg, var(--accent), #2196F3);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;                   /* fallback cho Firefox */
}

.admin-subtitle {
    font-size: 15px;
    color: var(--text-muted);
    margin-top: 4px;
}

/* ============================================================
   ADMIN TABS — 8 TAB NGANG
   ============================================================ */
.admin-tabs {
    display: flex;
    gap: 8px;
    margin: 32px auto 0;
    max-width: 1100px;
    padding: 0 24px;
    border-bottom: 1px solid var(--border);   /* đường kẻ dưới tab bar */
    position: relative;
}

.admin-tab {
    background: transparent;                  /* nền trong suốt mặc định */
    border: none;
    color: var(--text-muted);                 /* màu xám (chưa active) */
    padding: 14px 24px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    
    /* border-bottom: 3px solid transparent = viền dưới "tàng hình"
       Khi active → đổi thành màu xanh (hiệu ứng underline chạy)
       
       Tại sao không set border-bottom: none? Vì nếu set none rồi
       active thì thêm border → tab sẽ "nhảy" 3px (layout shift).
       Set transparent sẵn để giữ chỗ. */
    border-bottom: 3px solid transparent;
    transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
    font-family: inherit;
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
}

.admin-tab span { transition: transform 0.3s; }

.admin-tab:hover { color: var(--text); }
.admin-tab:hover span { transform: scale(1.2) rotate(-5deg); }  /* icon "nhảy" nhẹ */

/* Tab đang active → đổi màu xanh + viền dưới xanh */
.admin-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
}

/* Hiệu ứng "glow" dưới tab active — dải sáng chạy dưới chữ */
.admin-tab.active::after {
    content: '';
    position: absolute;
    bottom: -3px; left: 0; right: 0;
    height: 3px;
    background: var(--accent);
    border-radius: 3px;
    box-shadow: 0 0 12px var(--accent);      /* phát sáng */
    animation: tabGlow 2s ease-in-out infinite;  /* nhấp nháy nhẹ */
}

/* ============================================================
   ADMIN PANEL — NỘI DUNG TỪNG TAB
   ============================================================ */
.admin-panel {
    max-width: 1100px;
    margin: 0 auto;
    padding: 32px 24px;
    opacity: 0;                              /* ẩn, chờ reveal */
    transform: translateY(20px);
    transition: all 0.6s cubic-bezier(0.25, 1, 0.5, 1);
}

.admin-panel.revealed {
    opacity: 1;
    transform: translateY(0);
}

/* Animation "panel trượt vào" khi switch tab */
.admin-panel.panel-enter {
    animation: panelEnter 0.5s cubic-bezier(0.25, 1, 0.5, 1);
}

/* Header của mỗi panel: title trái + button phải */
.panel-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.panel-head .chart-title { margin: 0; }

/* Nút refresh + update trong panel */
.btn-refresh, .btn-update {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px !important;           /* !important vì có inline style khác */
    font-size: 13px;
    transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
}

.btn-refresh span { transition: transform 0.6s; display: inline-block; }

/* Hover nút refresh → icon xoay 360 độ (icon "đang load") */
.btn-refresh:hover span { transform: rotate(360deg); }

/* ============================================================
   NODES — QUẢN LÝ TRẠM ĐO
   ============================================================ */

/* Layout: map 60% + form 40% */
.nodes-layout {
    display: grid;
    /* 1.5fr 1fr = 2 cột, cột trái 60%, cột phải 40% (tỉ lệ 1.5:1) */
    grid-template-columns: 1.5fr 1fr;
    gap: 20px;
    margin-bottom: 24px;
}

/* Mobile: stack 2 cột thành 1 */
@media (max-width: 900px) {
    .nodes-layout { grid-template-columns: 1fr; }
}

/* Container bản đồ Leaflet */
.nodes-map {
    height: 420px;
    border-radius: 14px;
    border: 1px solid var(--border);
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    z-index: 1;                              /* thấp hơn nav (100) và modal (1000) */
}

/* Form thêm node bên phải */
.node-form {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 20px 22px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    transition: border-color 0.3s ease;
    display: flex;
    flex-direction: column;
    gap: 8px;                                /* khoảng cách giữa các ô */
}

.node-form:hover { border-color: var(--accent); }

.node-form h3 {
    font-size: 16px;
    margin-bottom: 12px;
    color: var(--text);
}

.node-form label {
    font-size: 12px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    font-weight: 600;
    margin-top: 4px;
}

.node-form .status-input { width: 100%; background: var(--bg); }

.node-form-hint {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px dashed var(--border);
    text-align: center;
    line-height: 1.5;
}

/* Danh sách node bên dưới map */
.nodes-list {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 8px;
    min-height: 100px;                       /* tránh "co lại" khi trống */
    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    transition: border-color 0.3s ease;
}

.nodes-list:hover { border-color: var(--accent); }

/* Mỗi dòng node */
.node-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--border);
    border-radius: 10px;
    transition: all 0.3s ease;
}

.node-row:last-child { border-bottom: none; }

/* Hover row → đổi nền + dịch nhẹ sang phải */
.node-row:hover {
    background: rgba(76,175,80,0.05);
    transform: translateX(4px);
}

.node-info { flex: 1; }                      /* chiếm hết khoảng trống còn lại */

.node-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 4px;
}

.node-meta { font-size: 12px; color: var(--text-muted); }

.node-status { display: flex; align-items: center; gap: 8px; }

.node-last {
    font-size: 12px;
    color: var(--text-muted);
    min-width: 120px;
    text-align: right;
}

/* Nút xóa node */
.node-delete {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    width: 36px;
    height: 36px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: 8px;
}

/* Hover nút xóa → đổi đỏ + phóng nhẹ + glow */
.node-delete:hover {
    background: #f85149;
    border-color: #f85149;
    color: #fff;
    transform: scale(1.1);
    box-shadow: 0 0 12px rgba(248, 81, 73, 0.5);
}

/* ============================================================
   STATUS — QUẢN LÝ TRẠNG THÁI SERVICE
   ============================================================ */

/* 6 preset button ngang */
.status-presets-label {
    font-size: 13px;
    color: var(--text-muted);
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    font-weight: 600;
}

.status-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 24px;
}

.preset-btn {
    padding: 12px 20px;
    border-radius: 12px;
    border: 2px solid var(--border);
    background: var(--bg-card);
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
    font-family: inherit;
    position: relative;
    overflow: hidden;                        /* cho hiệu ứng ripple bên dưới */
}

/* Ripple effect khi hover: 1 vòng tròn to dần từ tâm (::before) */
.preset-btn::before {
    content: '';
    position: absolute;
    top: 50%; left: 50%;
    width: 0; height: 0;                     /* bắt đầu = 0 */
    background: rgba(255,255,255,0.15);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    transition: width 0.5s, height 0.5s;     /* phình to 0.5s */
}

/* Hover → phình to 300px (phủ kín button) */
.preset-btn:hover::before { width: 300px; height: 300px; }

.preset-btn:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.2);
}

/* Mỗi trạng thái 1 màu riêng khi hover */
.preset-btn.working:hover     { background:#3fb950; color:#fff; border-color:#3fb950; }
.preset-btn.debug:hover       { background:#d29922; color:#000; border-color:#d29922; }
.preset-btn.attach:hover      { background:#58a6ff; color:#fff; border-color:#58a6ff; }
.preset-btn.testing:hover     { background:#9c27b0; color:#fff; border-color:#9c27b0; }
.preset-btn.maintenance:hover { background:#ff9800; color:#fff; border-color:#ff9800; }
.preset-btn.offline:hover     { background:#f85149; color:#fff; border-color:#f85149; }

/* Form cập nhật status: service + status + note + button */
.status-form {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 18px 22px;
    margin-bottom: 24px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    transition: border-color 0.3s ease;
}

.status-form:hover { border-color: var(--accent); }

.status-form label {
    font-size: 12px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    font-weight: 600;
}

/* Input/select chung trong admin */
.status-select, .status-input {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 14px;
    font-size: 13px;
    font-family: inherit;
    transition: all 0.2s;
}

.status-input { flex: 1; min-width: 220px; }

/* Khi focus → border xanh + "halo" mờ xung quanh */
.status-select:focus, .status-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(76,175,80,0.15);  /* vòng hào quang mờ 3px */
}

/* Lưới 4 card trạng thái service */
.status-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px;
    margin-top: 16px;
}

.status-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 18px 20px;
    position: relative;
    overflow: hidden;
    transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1);
}

/* Dải sáng "quét" qua card khi hover (trang trí) */
.status-card::before {
    content: '';
    position: absolute;
    top: 0; left: -100%;                     /* bắt đầu ngoài mép trái */
    width: 100%; height: 2px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    transition: left 0.6s;
}

.status-card:hover::before { left: 100%; }   /* quét sang mép phải */

.status-card:hover {
    transform: translateY(-5px) rotateX(2deg);  /* nhấc lên + nghiêng nhẹ */
    border-color: var(--accent);
    box-shadow: 0 12px 30px rgba(0,0,0,0.2);
}

.status-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
}

.status-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
}

/* Chấm tròn nhỏ hiển thị trạng thái (như đèn LED) */
.status-dot {
    width: 12px; height: 12px;
    border-radius: 50%;
    background: #555;                        /* xám mặc định */
    transition: all 0.3s;
}

/* Màu chấm theo trạng thái + hiệu ứng phát sáng + pulse animation */
.status-dot.working {
    background:#3fb950;                      /* xanh lá */
    box-shadow:0 0 12px #3fb950;             /* phát sáng */
    animation:statusPulse 2s infinite;       /* nhấp nháy (như "live") */
}
.status-dot.debug {
    background:#d29922;                      /* vàng */
    box-shadow:0 0 12px #d29922;
    animation:statusPulse 2.5s infinite;
}
.status-dot.attach {
    background:#58a6ff;                      /* xanh dương */
    box-shadow:0 0 12px #58a6ff;
    animation:statusPulse 3s infinite;
}
.status-dot.testing {
    background:#9c27b0;                      /* tím */
    box-shadow:0 0 12px #9c27b0;
    animation:statusPulse 2s infinite;
}
.status-dot.maintenance {
    background:#ff9800;                      /* cam */
    box-shadow:0 0 12px #ff9800;
    animation:statusPulse 2.5s infinite;
}
.status-dot.offline {
    background:#f85149;                      /* đỏ */
    box-shadow:0 0 12px #f85149;
    /* Không pulse — offline không cần "sống động" */
}

/* Label text trạng thái (WORKING, OFFLINE...) */
.status-label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    font-weight: 700;
    margin-bottom: 6px;
}
.status-label.working     { color:#3fb950; }
.status-label.debug       { color:#d29922; }
.status-label.attach      { color:#58a6ff; }
.status-label.testing     { color:#9c27b0; }
.status-label.maintenance { color:#ff9800; }
.status-label.offline     { color:#f85149; }

.status-note {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
    min-height: 18px;                        /* giữ chỗ dù chưa có note */
    word-break: break-word;                  /* chữ dài tự xuống dòng */
}

.status-updated {
    text-align: center;
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px dashed var(--border);
}
/* ============================================================
   DEBUG DASHBOARD — SANDBOX TEST UI
   ============================================================ */

/* Hộp thông báo màu xanh nhạt (dùng khắp admin) */
.debug-notice {
    background: rgba(88,166,255,0.08);       /* xanh dương rất nhạt */
    border-left: 3px solid #58a6ff;          /* vạch màu bên trái */
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 20px;
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.6;
}

/* Thanh toolbar debug: preset + clone + simulate nằm ngang */
.debug-toolbar {
    display: flex;
    flex-wrap: wrap;                         /* xuống dòng khi hẹp */
    gap: 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 18px;
    margin-bottom: 20px;
    align-items: center;
    transition: border-color 0.3s;
}

.debug-toolbar:hover { border-color: var(--accent); }

/* Nhóm nhỏ trong toolbar (VD: "Preset: [dropdown] [buttons]") */
.toolbar-group {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
}

.toolbar-group label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
}

/* Nút nhỏ (dùng trong toolbar, table actions) */
.btn-mini {
    padding: 7px 12px;
    font-size: 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    font-family: inherit;
    font-weight: 500;
    transition: all 0.2s cubic-bezier(0.25, 1, 0.5, 1);
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.btn-mini:hover {
    border-color: var(--accent);
    color: var(--accent);
    transform: translateY(-1px);             /* nhấc lên 1px */
}

/* :disabled = khi nút bị vô hiệu hóa (VD: chưa chọn row nào) */
.btn-mini:disabled {
    opacity: 0.4;                            /* mờ đi */
    cursor: not-allowed;                     /* con trỏ "cấm" */
    transform: none;
}

/* Nút nguy hiểm (xóa) — viền đỏ */
.btn-mini.btn-danger {
    border-color: rgba(248,81,73,0.4);
    color: #f85149;
}

.btn-mini.btn-danger:hover {
    background: #f85149;
    color: #fff;
    border-color: #f85149;
}

/* Nút cảnh báo (cam) */
.btn-mini.btn-warn {
    border-color: rgba(255,152,0,0.4);
    color: #ff9800;
}

.btn-mini.btn-warn:hover {
    background: #ff9800;
    color: #fff;
    border-color: #ff9800;
}

/* Nút xóa lớn (dùng ở panel head) */
.btn-secondary.btn-danger {
    background: #f85149;
    color: #fff;
    border: none;
    padding: 10px 20px;
    border-radius: 10px;
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
    transition: all 0.2s;
}

.btn-secondary.btn-danger:hover {
    background: #d63a33;                     /* đỏ đậm hơn */
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(248,81,73,0.3);
}

/* Form nhập liệu dọc (mỗi field 1 hàng) */
.debug-form-vertical {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 22px 24px;
    margin-bottom: 24px;
    transition: border-color 0.3s;
}

.debug-form-vertical:hover { border-color: var(--accent); }

/* Header của form: mode hiển thị (INSERT/UPDATE) */
.form-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 18px;
    padding-bottom: 14px;
    border-bottom: 1px dashed var(--border);
}

.form-header h3 {
    font-size: 16px;
    margin: 0;
    color: var(--text);
}

/* Badge "Mode: INSERT" hoặc "Mode: UPDATE #id" */
.form-mode {
    font-size: 12px;
    color: var(--text-muted);
    padding: 4px 12px;
    background: var(--bg);
    border-radius: 20px;                     /* bo tròn như "viên thuốc" */
    border: 1px solid var(--border);
}

.form-mode strong { color: var(--accent); }

/* Lưới các field: tự động wrap theo width */
.form-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px;
}

/* Mỗi field: label + input + error */
.form-fields .field {
    display: flex;
    flex-direction: column;                  /* xếp dọc */
    gap: 4px;
}

/* Field "full" = chiếm hết chiều ngang (VD: note dài) */
.form-fields .field.full { grid-column: 1 / -1; }  /* từ cột 1 đến cột cuối */

.form-fields label {
    font-size: 12px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
    display: flex;
    justify-content: space-between;          /* label trái, hint phải */
    align-items: center;
}

/* Hint nhỏ hiển thị range (VD: "-10 to 60") */
.form-fields .hint {
    font-size: 10px;
    color: var(--text-muted);
    opacity: 0.7;
    text-transform: none;                    /* không viết hoa */
    letter-spacing: 0;
    font-weight: 400;
}

/* Input/select/textarea trong form */
.form-fields input,
.form-fields select,
.form-fields textarea {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 13px;
    font-family: inherit;
    transition: all 0.2s;
}

.form-fields input:focus,
.form-fields select:focus,
.form-fields textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(76,175,80,0.15);
}

/* Input KHÔNG HỢP LỆ — viền đỏ (JS thêm class .invalid) */
.form-fields input.invalid {
    border-color: #f85149;
    box-shadow: 0 0 0 3px rgba(248,81,73,0.15);
}

/* Span lỗi dưới input (nếu có) */
.form-fields .err {
    font-size: 11px;
    color: #f85149;
    min-height: 14px;                        /* giữ chỗ dù chưa có lỗi */
    display: block;
}

.form-fields textarea {
    resize: vertical;                        /* cho kéo dọc, không kéo ngang */
    min-height: 70px;
}

/* Hàng buttons (Save/Reset) cuối form */
.form-actions {
    display: flex;
    gap: 10px;
    margin-top: 20px;
    padding-top: 18px;
    border-top: 1px dashed var(--border);
    flex-wrap: wrap;
}

/* ============================================================
   TABLE TOOLBAR — THANH CÔNG CỤ TRÊN BẢNG
   ============================================================ */
.table-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    margin-bottom: 14px;
    padding: 12px 16px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
}

.table-toolbar .status-input { flex: 1; min-width: 200px; }
.table-toolbar .status-select { min-width: 140px; }

/* Text nhỏ hiển thị "X records" bên phải toolbar */
.table-count {
    font-size: 12px;
    color: var(--text-muted);
    font-family: 'SF Mono', Menlo, monospace;  /* font monospace (giống code) */
    white-space: nowrap;                     /* không xuống dòng */
}

/* ============================================================
   DEBUG TABLE — BẢNG RECORD DATA
   ============================================================ */
.debug-table-wrap {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 14px;
    
    /* overflow: auto = nếu nội dung tràn → hiện thanh cuộn */
    overflow: auto;
    
    max-height: 600px;                       /* chiều cao tối đa, quá thì scroll */
    transition: border-color 0.3s;
}

.debug-table-wrap:hover { border-color: var(--accent); }

.debug-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    
    /* Font monospace để số liệu thẳng hàng (giống cột Excel) */
    font-family: 'SF Mono', Menlo, Consolas, monospace;
}

/* THEAD "dính" trên đầu bảng khi scroll */
.debug-table thead {
    position: sticky;                        /* dính khi scroll */
    top: 0;
    background: var(--bg);
    z-index: 2;                              /* nổi trên row data */
}

.debug-table th {
    padding: 12px 10px;
    text-align: left;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 1px;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;                     /* header không xuống dòng */
}

.debug-table td {
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    white-space: nowrap;
}

.debug-table tbody tr {
    transition: background 0.15s;
}

.debug-table tbody tr:hover {
    background: rgba(76,175,80,0.06);        /* hover nhẹ */
}

/* Row được tick checkbox → nền xanh dương nhạt */
.debug-table tbody tr.selected {
    background: rgba(88,166,255,0.12);
}

/* Row đang edit → nền vàng nhạt + viền trái vàng */
.debug-table tbody tr.edit-mode {
    background: rgba(210,153,34,0.12);
    border-left: 3px solid #d29922;
}

.debug-table td input[type="checkbox"] {
    cursor: pointer;
    width: 15px;
    height: 15px;
    accent-color: var(--accent);             /* màu checkbox khi tick = xanh lá */
}

/* Badge "type" trong bảng (manual/simulated/cloned...) */
.debug-table .type-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.type-badge.manual    { background: rgba(88,166,255,0.15); color: #58a6ff; }
.type-badge.simulated { background: rgba(255,152,0,0.15);  color: #ff9800; }
.type-badge.cloned    { background: rgba(163,113,247,0.15); color: #a371f7; }
.type-badge.restored  { background: rgba(63,185,80,0.15);  color: #3fb950; }
.type-badge.edge      { background: rgba(248,81,73,0.15);  color: #f85149; }
.type-badge.custom    { background: rgba(210,153,34,0.15); color: #d29922; }

/* Nút action trong table (edit/restore/delete) */
.debug-table .action-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    width: 26px;
    height: 26px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    margin-right: 3px;
}

.debug-table .action-btn:hover { transform: scale(1.15); }

/* Mỗi loại nút đổi màu khi hover */
.action-btn.edit:hover  { background: #d29922; border-color: #d29922; color: #fff; }
.action-btn.clone:hover { background: #a371f7; border-color: #a371f7; color: #fff; }
.action-btn.restore:hover { background: #3fb950; border-color: #3fb950; color: #fff; }
.action-btn.del:hover   { background: #f85149; border-color: #f85149; color: #fff; }

/* ============================================================
   CLONE LIST — DANH SÁCH SENSOR ĐỂ CLONE
   ============================================================ */
.clone-list {
    max-height: 400px;
    overflow-y: auto;                        /* scroll dọc */
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 8px;
}

/* Mỗi item sensor trong list */
.clone-item {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    cursor: pointer;
    transition: all 0.2s;
    
    /* Grid 3 cột: ID | info | timestamp */
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    align-items: center;
}

.clone-item:hover {
    border-color: var(--accent);
    background: rgba(76,175,80,0.05);
    transform: translateX(2px);
}

.clone-item-id {
    font-family: monospace;
    font-weight: 700;
    color: var(--accent);
    font-size: 13px;
}

.clone-item-info {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.5;
}

.clone-item-ts {
    font-size: 11px;
    color: var(--text-muted);
    font-family: monospace;
}

/* ============================================================
   LOG TAB — DANH SÁCH AUDIT LOG
   ============================================================ */
.log-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.log-entry {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-left: 4px solid var(--accent);    /* vạch trái màu xanh */
    border-radius: 10px;
    padding: 14px 18px;
    transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
    animation: logFadeIn 0.4s ease-out;      /* fade-in khi mới xuất hiện */
}

.log-entry:hover {
    transform: translateX(4px);
    border-color: var(--accent);
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}

/* Màu vạch trái theo mức độ nghiêm trọng */
.log-entry.severity-info  { border-left-color: #58a6ff; }  /* info = xanh dương */
.log-entry.severity-warn  { border-left-color: #d29922; }  /* warn = vàng */
.log-entry.severity-error { border-left-color: #f85149; }  /* error = đỏ */
.log-entry.severity-fatal {                                  /* fatal = tím đậm + nền tím nhạt */
    border-left-color: #7B1FA2;
    background: rgba(123,31,162,0.08);
}

.log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    flex-wrap: wrap;
    gap: 8px;
}

.log-action {
    font-weight: 700;
    font-size: 13px;
    color: var(--text);
    letter-spacing: 0.5px;
}

/* Badge severity (INFO/WARN/ERROR) */
.log-severity-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-left: 8px;
}
.log-severity-badge.info  { background: rgba(88,166,255,0.15); color: #58a6ff; }
.log-severity-badge.warn  { background: rgba(210,153,34,0.15); color: #d29922; }
.log-severity-badge.error { background: rgba(248,81,73,0.15);  color: #f85149; }
.log-severity-badge.fatal { background: rgba(123,31,162,0.15); color: #a371f7; }

/* Metadata (thời gian, user, target, IP) */
.log-meta {
    display: flex;
    gap: 14px;
    font-size: 11px;
    color: var(--text-muted);
    flex-wrap: wrap;
}

.log-meta span { display: inline-flex; align-items: center; gap: 4px; }

/* Chi tiết log (nếu có) */
.log-details {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--border);
    font-size: 12px;
    color: var(--text);
    line-height: 1.6;
    word-break: break-word;
}

/* Nút xóa log (icon thùng rác nhỏ) */
.log-delete-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    width: 28px;
    height: 28px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s;
}

.log-delete-btn:hover {
    background: #f85149;
    border-color: #f85149;
    color: #fff;
}

/* ============================================================
   NOTES TAB — GHI CHÚ ADMIN
   ============================================================ */
.note-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.note-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-left: 4px solid #a371f7;          /* vạch tím bên trái = đặc trưng note */
    border-radius: 12px;
    padding: 18px 20px;
    transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
    animation: logFadeIn 0.4s ease-out;      /* dùng chung animation với log */
}

.note-card:hover {
    transform: translateY(-2px);
    border-color: #a371f7;
    box-shadow: 0 8px 24px rgba(163,113,247,0.15);
}

/* Note được ghim (pinned) → viền vàng + nền gradient */
.note-card.pinned {
    border-left-color: #d29922;
    background: linear-gradient(90deg, rgba(210,153,34,0.05), transparent 50%);
}

.note-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 10px;
}

.note-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    flex: 1;
}

.note-pin { font-size: 16px; }

/* Tag (note/todo/bug/maint/idea/fatal) với màu riêng */
.note-tag {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.note-tag.tag-note  { background: rgba(88,166,255,0.15); color: #58a6ff; }
.note-tag.tag-todo  { background: rgba(63,185,80,0.15);  color: #3fb950; }
.note-tag.tag-bug   { background: rgba(248,81,73,0.15);  color: #f85149; }
.note-tag.tag-maint { background: rgba(255,152,0,0.15);  color: #ff9800; }
.note-tag.tag-idea  { background: rgba(163,113,247,0.15); color: #a371f7; }

/* Tag "fatal" — tự động ghim, đỏ nổi bật */
.note-tag.tag-fatal {
    background: #f85149;
    color: #fff;
    font-weight: 600;
}

/* Note có tag fatal → viền đỏ (override viền vàng mặc định của .pinned) */
.note-card.pinned {
    border-left: 4px solid #f85149;
}

.note-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text);
    margin: 0;
}

.note-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;                          /* không co lại khi title dài */
}

.note-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    width: 30px;
    height: 30px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.note-btn:hover {
    background: rgba(163,113,247,0.1);
    border-color: #a371f7;
    color: #a371f7;
    transform: scale(1.1);
}

.note-btn-del:hover {
    background: #f85149;
    border-color: #f85149;
    color: #fff;
}

.note-content {
    font-size: 14px;
    color: var(--text);
    line-height: 1.7;
    
    /* white-space: pre-wrap = giữ nguyên xuống dòng trong text user nhập
       (như <pre> nhưng vẫn wrap khi quá dài) */
    white-space: pre-wrap;
    word-break: break-word;                  /* từ dài tự ngắt */
    margin-bottom: 12px;
}

.note-footer {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    font-size: 11px;
    color: var(--text-muted);
    padding-top: 10px;
    border-top: 1px dashed var(--border);
}

/* ============================================================
   NOTE COMMENTS — BÌNH LUẬN KIỂU GITHUB
   ============================================================ */
.note-comments {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px dashed var(--border);
}

.note-comments-toggle {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
}

.note-comments-toggle:hover { color: var(--accent); }

.note-comments-list {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

/* Mỗi comment */
.comment-item {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    background: rgba(88,166,255,0.04);       /* xanh nhạt */
    border: 1px solid var(--border);
    border-radius: 8px;
}

/* Avatar tròn với chữ cái đầu (VD: "P" cho "phuyy") */
.comment-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    flex-shrink: 0;                          /* không co lại */
    background: linear-gradient(135deg, var(--accent), var(--accent-blue));
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
}

.comment-body { flex: 1; min-width: 0; }    /* min-width 0 để text wrap đúng */

.comment-header {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    margin-bottom: 4px;
}

.comment-user { font-weight: 600; color: var(--text); }
.comment-time { color: var(--text-muted); font-size: 11px; }

.comment-content {
    font-size: 13px;
    color: var(--text);
    line-height: 1.5;
    word-wrap: break-word;
}

.comment-del {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 4px;
    margin-left: auto;                       /* đẩy sang phải */
}

.comment-del:hover {
    color: var(--red);
    background: rgba(248,81,73,0.1);
}

.comment-input-row {
    display: flex;
    gap: 8px;
    margin-top: 12px;
}

.comment-input {
    flex: 1;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
    min-height: 36px;
}

.comment-input:focus {
    outline: none;
    border-color: var(--accent);
}

/* ============================================================
   MODAL BOX — HỘP THOẠI LỚN (khác .modal nhỏ ở phần 1)
   ============================================================ */
/* Dùng cho các dialog phức tạp (clone, log, note, user, incident) */
.modal-overlay {
    position: fixed;
    /* inset: 0 = viết tắt của top/left/right/bottom = 0
       (phủ kín toàn màn hình) */
    inset: 0;
    background: rgba(0,0,0,0.6);             /* nền tối 60% */
    
    /* backdrop-filter: blur = làm MỜ nội dung phía sau overlay
       → tạo "kính mờ" (glassmorphism effect) */
    backdrop-filter: blur(4px);
    
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;                           /* chừa mép khi modal to */
    animation: modalFadeIn 0.2s ease-out;    /* fade khi mở */
}

/* Hộp nội dung chính của modal */
.modal-box {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 24px 28px;
    max-width: 500px;
    width: 100%;                             /* mobile: full width */
    max-height: 85vh;                        /* không cao quá 85% màn hình */
    overflow-y: auto;                        /* nếu nội dung dài → scroll bên trong */
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    animation: modalScaleIn 0.3s cubic-bezier(0.25, 1, 0.5, 1);  /* "nở" ra khi mở */
}

.modal-box h3 {
    font-size: 18px;
    margin-bottom: 12px;
    color: var(--text);
}

/* ============================================================
   KEYFRAMES — CÁC HIỆU ỨNG ANIMATION
   ============================================================ */
/* @keyframes = định nghĩa "bộ phim" animation
   - from/to: từ trạng thái nào → trạng thái nào
   - hoặc 0%/50%/100%: nhiều điểm trung gian */

/* Fade từ mờ → rõ (dùng cho reveal scroll) */
@keyframes fadeUp {
    from { opacity: 0; transform: translateY(30px); }
    to   { opacity: 1; transform: translateY(0); }
}

/* "Vén màn" chữ từ dưới lên (dùng cho hero h1/h2) */
@keyframes textReveal {
    0%   { clip-path: polygon(0 100%, 100% 100%, 100% 100%, 0% 100%); }
    100% { clip-path: polygon(0 0, 100% 0, 100% 100%, 0% 100%); }
}
/* clip-path polygon = "mặt nạ" hình đa giác
   - 0%: chỉ hiện dải 0px ở dưới (như chữ bị che)
   - 100%: hiện toàn bộ (mặt nạ full)
   → Hiệu ứng "chữ trồi lên từ dưới" */

/* Xoay nền 360 độ (dùng cho hero background) */
@keyframes rotateBg {
    0%   { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

/* Icon "bay lơ lửng" (dùng cho feature icons) */
@keyframes floatIcon {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-10px); }
}

/* "Nhịp tim" cho status dot (working/debug...) */
@keyframes statusPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.4; transform: scale(1.2); }
}

/* Tab glow: sáng-tối luân phiên cho underline tab active */
@keyframes tabGlow {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
}

/* Panel trượt vào khi switch tab */
@keyframes panelEnter {
    from { opacity: 0; transform: translateY(15px); }
    to   { opacity: 1; transform: translateY(0); }
}

/* Log fade-in (khi log mới xuất hiện) */
@keyframes logFadeIn {
    from { opacity: 0; transform: translateX(-10px); }
    to   { opacity: 1; transform: translateX(0); }
}

/* Modal fade in (nền tối hiện ra) */
@keyframes modalFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
}

/* Modal scale in (hộp chính "nở" ra từ 90% → 100%) */
@keyframes modalScaleIn {
    from { opacity: 0; transform: scale(0.9) translateY(10px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
}

/* Số "pop" lên khi update (dùng cho counter) */
@keyframes numberPop {
    0%   { opacity: 0; transform: translateY(10px) scale(0.9); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
}

/* Mũi tên nhảy nhảy (dùng cho scroll indicator) */
@keyframes bounceDown {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(6px); }
}

/* Vòng sáng "pulse" cho glow background */
@keyframes pulseGlow {
    0%   { transform: translateX(-50%) scale(1); opacity: 0.5; }
    100% { transform: translateX(-50%) scale(1.2); opacity: 1; }
}

/* Marker bản đồ "nảy" (dùng cho trạm trên map) */
@keyframes mapBounce {
    0%   { transform: translateY(-50px); opacity: 0; }
    60%  { transform: translateY(10px); opacity: 1; }
    80%  { transform: translateY(-5px); }
    100% { transform: translateY(0); }
}

/* Nút "sáng" dần (dùng cho CTA) */
@keyframes underlinePulse {
    0%, 100% { opacity: 0.4; }
    50%      { opacity: 1; }
}

/* Icon "vẫy tay" (dùng cho welcome toast) */
@keyframes waveHand {
    0%, 60%, 100% { transform: rotate(0); }
    10%, 30%, 50% { transform: rotate(14deg); }
    20%, 40% { transform: rotate(-8deg); }
}

/* "Border chạy" — gradient di chuyển quanh viền card */
@keyframes borderGlow {
    0%   { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
}

/* ============================================================
   HIỆU ỨNG ĐẶC BIỆT
   ============================================================ */

/* Viền "phát sáng gradient" quanh card (dùng cho feature/spec/knowledge) */
.feature, .spec-card, .knowledge-card, .card {
    position: relative;                      /* mốc cho ::after absolute */
}

.feature::after, .spec-card::after, .knowledge-card::after, .card::after {
    content: "";
    position: absolute;
    inset: 0;
    padding: 2px;                            /* độ dày viền */
    border-radius: inherit;                  /* kế thừa border-radius từ cha */
    
    /* Gradient chạy từ trong suốt → xanh → trong suốt */
    background: linear-gradient(45deg, transparent 30%, var(--accent) 50%, transparent 70%);
    background-size: 200% 200%;              /* gradient rộng gấp đôi để "chạy" */
    
    /* MASKING — kỹ thuật "cắt" viền:
       1. Tạo mask full (nền trắng)
       2. Trừ đi phần content-box (padding ở trên đã tạo viền)
       3. Chỉ còn lại viền mỏng 2px
       → Hiệu ứng "chỉ có viền được tô gradient, bên trong trong suốt" */
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;             /* phép XOR (loại trừ) */
    mask-composite: exclude;                 /* chuẩn mới cho Firefox */
    
    animation: borderGlow 3s linear infinite;
    pointer-events: none;                    /* không cản click */
    opacity: 0.6;
    transition: opacity 0.3s;
}

/* Hover card → viền sáng lên full */
.feature:hover::after, .spec-card:hover::after,
.knowledge-card:hover::after, .card:hover::after {
    opacity: 1;
}

/* Marker bản đồ có class .bounce-marker → áp dụng animation nảy */
.leaflet-interactive.bounce-marker {
    animation: mapBounce 0.8s cubic-bezier(0.28, 0.84, 0.42, 1) both;
    
    /* transform-box + transform-origin = đảm bảo animation xoay/nảy
       đúng tâm SVG (không bị lệch góc) */
    transform-box: fill-box;
    transform-origin: center bottom;
}

/* ============================================================
   LEAFLET FIX — OVERRIDE CSS MẶC ĐỊNH CỦA LEAFLET
   ============================================================ */
.leaflet-container {
    background: #ddd !important;             /* nền xám khi tile chưa load */
    font-family: inherit;                    /* dùng font site, không phải font mặc định Leaflet */
    z-index: 1;
}

/* Fix bug Leaflet: đôi khi tile hiển thị sai kích thước */
.leaflet-tile {
    width: 256px !important;
    height: 256px !important;
}

/* Fix pane stacking — Leaflet tự tạo nhiều "pane" (layer), cần position */
.leaflet-pane,
.leaflet-tile-pane,
.leaflet-overlay-pane,
.leaflet-shadow-pane,
.leaflet-marker-pane,
.leaflet-popup-pane {
    position: absolute;
    left: 0;
    top: 0;
}

/* Fallback height cho map nếu inline style không set */
#map { height: 400px; width: 100%; }

/* Ẩn "cờ Ukraine" — Leaflet mặc định hiển thị attribution với icon cờ,
   nhưng đôi khi làm rối giao diện. Ẩn hết flag + icon mặc định */
.leaflet-attribution-flag,
.leaflet-control-attribution svg,
.leaflet-control-attribution::before {
    display: none !important;
    background: none !important;
    content: none !important;
}

/* ============================================================
   RESPONSIVE — CHO MÀN HÌNH NHỎ (MOBILE)
   ============================================================ */
/* @media = "nếu màn hình thỏa điều kiện → áp dụng CSS này"
   max-width: 768px = màn hình ≤ 768px (tablet/mobile)
   max-width: 640px = màn hình ≤ 640px (mobile nhỏ)
   max-width: 900px = màn hình ≤ 900px (tablet) */

@media (max-width: 768px) {
    /* Hero nhỏ lại */
    .hero h1 { font-size: 32px; }
    .hero .subtitle { font-size: 16px; }
    /* Nút xếp dọc thay vì ngang */
    .hero-actions { flex-direction: column; align-items: center; }

    /* Content 2 cột → 1 cột */
    .content-row {
        grid-template-columns: 1fr;
        gap: 30px;
        margin-bottom: 50px;
    }
    /* Bỏ reverse (vì đã 1 cột, không cần đảo) */
    .content-row.reverse { direction: ltr; }

    .content-text h3 { font-size: 24px; }

    /* Giảm padding section */
    .content-section,
    .spec-section,
    .section {
        padding: 50px 20px;
    }

    .spec-header h2 { font-size: 28px; }
    .section h2 { font-size: 26px; }

    /* Nav gọn hơn */
    .nav { padding: 16px 20px; }
    .nav-links { gap: 14px; }
    .nav-links a { font-size: 13px; }

    /* Chart thấp hơn */
    .chart-container { height: 280px; }
    .card .value { font-size: 28px; }

    /* === Admin responsive === */
    .debug-toolbar { flex-direction: column; align-items: stretch; }
    .toolbar-group { width: 100%; }
    .form-fields { grid-template-columns: 1fr; }  /* 1 cột */
    .debug-table-wrap { max-height: 400px; }
    .modal-box { padding: 20px; }

    /* AQI table mobile: chữ nhỏ hơn */
    .aqi-table { font-size: 12px; }
    .aqi-table thead th,
    .aqi-table tbody td { padding: 8px 10px; }
    .aqi-badge { min-width: 60px; padding: 3px 8px; font-size: 11px; }
    .aqi-table-section { padding: 16px; }

    /* Knowledge section padding */
    .knowledge-section { padding: 40px 20px; }

    /* Bảng tác động 2 cột → 1 cột */
    .content-section > div[style*="grid-template-columns: 1fr 1fr"] {
        grid-template-columns: 1fr !important;   /* !important override inline style */
    }

    /* Pollution grid 4 → 2 cột */
    .pollution-grid { grid-template-columns: repeat(2, 1fr); }
    .pollution-item { padding: 24px 12px; }
    .pollution-icon { width: 36px; height: 36px; }
    .pollution-item span { font-size: 13px; }
}

@media (max-width: 640px) {
    /* Hook section (câu dẫn dắt) nhỏ hơn */
    .hook-top { padding: 40px 20px 60px; }
    .hook-q { font-size: 18px; }
    .hook-hint { font-size: 13px; }

    /* CTA cuối trang */
    .reveal-bottom { padding: 60px 20px 50px; }
    .reveal-bottom h2 { font-size: 26px; }
    .btn-cta-huge { padding: 16px 40px; font-size: 16px; }

    /* Welcome toast full-width */
    .welcome-toast {
        bottom: 16px; right: 16px; left: 16px;   /* tràn 2 bên */
        max-width: none;
        padding: 20px;
    }
    .welcome-actions { flex-direction: column; }
    .welcome-btn-primary,
    .welcome-btn-secondary {
        flex: none;
        width: 100%;
    }
}

@media (max-width: 900px) {
    /* Nodes layout: map + form xếp dọc */
    .nodes-layout { grid-template-columns: 1fr; }
}

@media (max-width: 1100px) {
    /* Debug form sticky → static trên tablet */
    .debug-main-layout { grid-template-columns: 1fr; }
    .debug-main-layout > .debug-form-vertical {
        position: static;
        max-height: none;
    }
}

/* ============================================================
   HOOK TOP — CÂU DẪN DẮT SCROLL
   ============================================================ */
.hook-top {
    text-align: center;
    padding: 60px 24px 80px;
    border-bottom: 1px solid var(--border);
    position: relative;
    max-width: 900px;
    margin: 0 auto;
}

.hook-q {
    font-size: 24px;
    font-weight: 600;
    margin-bottom: 16px;
    line-height: 1.5;
    color: var(--text);
}

/* Chữ <em> được highlight — underline pulse nhẹ */
.hook-q em {
    color: var(--accent);
    font-style: normal;                      /* không in nghiêng */
    font-weight: 700;
    position: relative;
    display: inline-block;
}

/* Underline "pulse" dưới chữ được highlight */
.hook-q em::after {
    content: '';
    position: absolute;
    left: 0; right: 0;
    bottom: -2px;
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: underlinePulse 2.5s ease-in-out infinite;
}

.hook-hint {
    font-size: 14px;
    color: var(--text-muted);
    letter-spacing: 0.3px;
    margin: 0;
}

.scroll-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
    font-weight: 600;
    margin-left: 4px;
}

/* Mũi tên ↓ nhảy nhảy */
.arrow {
    display: inline-block;
    animation: bounceDown 1.5s ease-in-out infinite;
}

/* ============================================================
   SCROLL-TO-TOP BUTTON — NÚT ↑ GÓC PHẢI DƯỚI
   ============================================================ */
#scrollTopBtn {
    display: none;                           /* ẩn mặc định (JS toggle) */
    position: fixed;                         /* cố định góc màn hình */
    bottom: 30px;
    right: 30px;
    z-index: 99;
    border: none;
    background-color: var(--accent);
    color: white;
    cursor: pointer;
    padding: 15px;
    border-radius: 50%;                      /* tròn */
    font-size: 20px;
    font-weight: bold;
    opacity: 0;                              /* trong suốt (chưa hiện) */
    transition: opacity 0.3s ease, transform 0.3s ease;
    transform: translateY(20px);             /* dịch xuống 20px (chưa hiện) */
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}

/* Khi có class .show (JS thêm) → hiện lên */
#scrollTopBtn.show {
    display: block;
    opacity: 1;
    transform: translateY(0);                /* về vị trí gốc */
}

#scrollTopBtn:hover {
    background-color: #45a049;
    transform: translateY(-3px);             /* nổi lên khi hover */
}

/* ============================================================
   WELCOME TOAST — THÔNG BÁO CHÀO MỪNG
   ============================================================ */
.welcome-toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    max-width: 380px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 24px 24px 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(63,185,80,0.15);
    z-index: 9999;
    display: none;
    transform: translateY(30px);             /* bắt đầu dưới màn hình */
    opacity: 0;
    
    /* Transition với easing "nảy" (cubic-bezier đặc biệt) */
    transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1),
                opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.welcome-toast.show {
    display: block;
    transform: translateY(0);                /* trượt lên */
    opacity: 1;
}

.welcome-toast.hide {
    transform: translateY(30px);             /* trượt xuống */
    opacity: 0;
}

/* Nút X đóng toast */
.welcome-close {
    position: absolute;
    top: 12px; right: 12px;
    width: 28px; height: 28px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
}

.welcome-close:hover {
    background: rgba(248,81,73,0.1);
    color: var(--red);
}

.welcome-icon {
    font-size: 32px;
    margin-bottom: 8px;
    animation: waveHand 1.8s ease-in-out infinite;  /* icon vẫy tay */
    display: inline-block;
    transform-origin: 70% 70%;               /* xoay từ góc cổ tay */
}

.welcome-title {
    font-size: 17px;
    font-weight: 700;
    margin: 0 0 10px;
    color: var(--text);
    letter-spacing: -0.3px;
}

.welcome-text {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-muted);
    margin: 0 0 20px;
}

.welcome-text strong { color: var(--accent); }

.welcome-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.welcome-btn-primary {
    flex: 1;
    min-width: 140px;
    padding: 11px 16px;
    background: var(--accent);
    color: #0d1117;
    font-size: 13px;
    font-weight: 700;
    border-radius: 8px;
    text-decoration: none;
    text-align: center;
    transition: transform 0.15s, box-shadow 0.15s;
    box-shadow: 0 4px 12px rgba(63,185,80,0.3);
}

.welcome-btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(63,185,80,0.45);
}

.welcome-btn-secondary {
    flex: 0 0 auto;
    padding: 11px 16px;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
}

.welcome-btn-secondary:hover {
    border-color: var(--text-muted);
    color: var(--text);
}

/* Nút reset demo ẩn — chỉ hiện khi hover */
#demo-trigger {
    position: fixed;
    bottom: 8px;
    left: 8px;
    width: 24px;
    height: 24px;
    background: transparent;
    border: none;
    cursor: pointer;
    z-index: 9998;
    opacity: 0.05;                           /* gần như tàng hình */
    transition: opacity 0.2s;
    border-radius: 50%;
}

#demo-trigger:hover {
    opacity: 0.6;
    background: rgba(63,185,80,0.2);
}

/* ============================================================
   WELCOME POPOVER — TOOLTIP KHI CLICK DASHBOARD
   ============================================================ */
.welcome-popover {
    position: absolute;
    top: calc(100% + 10px);
    right: -20px;
    width: 250px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    z-index: 1000;
    opacity: 0;
    visibility: hidden;                      /* vừa ẩn vừa không nhận click */
    transform: translateY(-10px);
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.welcome-popover.show {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
}

/* Mũi tên nhọn chỉ lên nút — kỹ thuật "hình vuông xoay 45°" */
.popover-arrow {
    position: absolute;
    top: -6px;
    right: 35px;
    width: 12px;
    height: 12px;
    background: var(--bg-card);
    border-left: 1px solid var(--border);
    border-top: 1px solid var(--border);
    transform: rotate(45deg);                /* xoay 45 độ → thành hình thoi */
}

.welcome-popover p {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--text);
    line-height: 1.5;
    font-weight: 500;
}

.popover-actions {
    display: flex;
    gap: 8px;
}

.popover-actions a,
.popover-actions button {
    flex: 1;
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 600;
    border-radius: 6px;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
}

.btn-pop-outline {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border);
}

.btn-pop-outline:hover {
    background: rgba(255,255,255,0.05);
    color: var(--text);
}

.btn-pop-solid {
    background: var(--accent);
    color: #0d1117;
    border: 1px solid var(--accent);
}

.btn-pop-solid:hover {
    background: var(--accent-hover);
}

/* ============================================================
   REVEAL BOTTOM — CTA CUỐI TRANG
   ============================================================ */
.reveal-bottom {
    text-align: center;
    padding: 100px 24px 80px;
    background: linear-gradient(180deg, transparent 0%, rgba(63,185,80,0.06) 100%);
    border-top: 1px solid var(--border);
}

.reveal-bottom h2 {
    font-size: 40px;
    font-weight: 700;
    letter-spacing: -1px;                    /* chữ hơi sát lại (modern look) */
    margin-bottom: 24px;
    line-height: 1.2;
    color: var(--text);
}

.btn-cta-huge {
    display: inline-block;
    padding: 20px 56px;
    background: var(--accent);
    color: #0d1117;
    font-size: 18px;
    font-weight: 700;
    border-radius: 12px;
    text-decoration: none;
    box-shadow: 0 12px 40px rgba(63,185,80,0.4);
    transition: transform 0.2s, box-shadow 0.2s;
    animation: pulseGlow 2.5s ease-in-out infinite;  /* glow nhấp nháy */
}

.btn-cta-huge:hover {
    transform: translateY(-3px) scale(1.03);
    box-shadow: 0 16px 48px rgba(63,185,80,0.55);
}

.cta-micro {
    margin-top: 16px;
    font-size: 13px;
    color: var(--text-muted);
}

/* ============================================================
   QR MODAL — SETUP 2FA (GOOGLE AUTHENTICATOR)
   ============================================================ */
#qr-modal .modal { padding: 28px; }

#qr-modal label span {
    display: block;
    font-size: 13px;
    margin-bottom: 6px;
    color: var(--text-muted);
}

/* Input OTP: chữ to, giãn cách rộng cho dễ đọc/đếm */
#qr-modal label input {
    width: 100%;
    padding: 12px;
    font-size: 20px;
    letter-spacing: 8px;                     /* giãn chữ 8px (mỗi số cách nhau) */
    text-align: center;
    font-family: monospace;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    margin-bottom: 12px;
}

/* ============================================================
   POLLUTANT GRID — LƯỚI 3 CARD "TÁC ĐỘNG Ô NHIỄM"
   ============================================================ */
.pollutant-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 24px;
    max-width: 1100px;
    margin: 0 auto;
}

.pollutant-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 30px;
    transition: transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
    position: relative;
    overflow: hidden;
}

.pollutant-card:hover {
    transform: translateY(-5px);
    border-color: var(--accent);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
}

.pollutant-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px dashed var(--border);
}

.pollutant-icon {
    font-size: 28px;
    background: rgba(76, 175, 80, 0.1);      /* nền xanh nhạt */
    padding: 10px;
    border-radius: 12px;
    line-height: 1;
}

.pollutant-header h4 {
    font-size: 18px;
    color: var(--accent);
    margin: 0;
    font-weight: 600;
}

.pollutant-list {
    list-style: none;                        /* bỏ dấu chấm */
    padding: 0;
    margin: 0;
}

.pollutant-list li {
    position: relative;
    padding: 10px 0 10px 24px;               /* chừa 24px trái cho dấu chấm custom */
    color: var(--text);
    font-size: 15px;
    line-height: 1.5;
    border-bottom: 1px solid var(--border);
}

.pollutant-list li:last-child {
    border-bottom: none;
    padding-bottom: 0;
}

/* Dấu chấm xanh có glow — custom bullet */
.pollutant-list li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 18px;
    width: 8px;
    height: 8px;
    background: var(--accent);
    border-radius: 50%;
    box-shadow: 0 0 8px var(--accent);       /* phát sáng nhẹ */
}

/* ============================================================
   KNOWLEDGE CARDS — LƯỚI BÀI VIẾT "HIỂU RÕ HƠN"
   ============================================================ */
.knowledge-section {
    padding: 60px 40px;
    max-width: 1200px;
    margin: 0 auto;
}

.knowledge-header { margin-bottom: 24px; }

.knowledge-header h2 {
    font-size: 22px;
    color: var(--text);
    font-weight: 600;
}

.knowledge-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
}

.knowledge-card {
    position: relative;
    display: block;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px 48px 24px 24px;            /* padding phải 48px để chừa chỗ mũi tên */
    text-decoration: none;
    color: var(--text);
    transition: transform 0.2s, border-color 0.2s;
    cursor: pointer;
}

.knowledge-card:hover {
    transform: translateY(-4px);
    border-color: var(--accent);
}

/* Mũi tên ↗ góc phải trên */
.knowledge-arrow {
    position: absolute;
    top: 20px;
    right: 20px;
    font-size: 20px;
    color: var(--accent);
    opacity: 0.7;
    transition: opacity 0.2s;
}

.knowledge-card:hover .knowledge-arrow { opacity: 1; }

.knowledge-card h3 {
    font-size: 18px;
    color: var(--text);
    margin-bottom: 10px;
    font-weight: 600;
}

.knowledge-card p {
    font-size: 14px;
    color: var(--text-muted);
    line-height: 1.5;
}

/* ============================================================
   IMPACT CARD — CARD LỚN "TÁC ĐỘNG" (gradient background)
   ============================================================ */
.impact-section {
    padding: 40px 40px 80px;
    max-width: 1200px;
    margin: 0 auto;
}

.impact-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 40px;
    background: linear-gradient(135deg, #1a2a4d 0%, #4CAF50 100%);
    color: white;
    padding: 50px 60px;
    border-radius: 20px;
    text-decoration: none;
    transition: transform 0.2s, box-shadow 0.2s;
    box-shadow: 0 10px 40px rgba(76,175,80,0.2);
}

.impact-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 20px 50px rgba(76,175,80,0.35);
}

.impact-text h2 {
    font-size: 32px;
    margin-bottom: 12px;
    color: white;
}

.impact-text p {
    font-size: 16px;
    line-height: 1.6;
    color: rgba(255,255,255,0.9);
    max-width: 700px;
}

.impact-arrow {
    font-size: 48px;
    color: white;
    flex-shrink: 0;
    transition: transform 0.2s;
}

/* Hover card → mũi tên trượt sang phải */
.impact-card:hover .impact-arrow {
    transform: translateX(8px);
}

/* ============================================================
   POLLUTION GRID — LƯỚI 4 ICON Ô NHIỄM
   ============================================================ */
.pollution-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);    /* 4 cột bằng nhau */
    gap: 1px;                                /* gap 1px → "vạch kẻ" giữa các ô */
    background: var(--border);               /* nền grid = viền → tạo vạch kẻ */
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    max-width: 800px;
    margin: 0 auto;
}

.pollution-item {
    background: var(--bg-card);              /* che nền viền → chỉ lộ 1px */
    padding: 32px 16px;
    text-align: center;
    transition: background 0.2s;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
}

.pollution-item:hover {
    background: rgba(76,175,80,0.05);
}

.pollution-icon {
    font-size: 42px;
    margin-bottom: 12px;
    display: block;
    line-height: 1;
}

.pollution-item span {
    font-size: 14px;
    color: var(--text);
    display: block;
    line-height: 1.4;
}

/* ============================================================
   MAP PAGE — LEAFLET OVERRIDE
   ============================================================ */
#map {
    height: 400px;
    width: 100%;
}
```

more

Các kỹ thuật CSS "đặc biệt" cần hiểu:

Kỹ thuật	Chỗ dùng	Hiểu đơn giản
CSS Variables	:root, body.light	"Bảng màu" đổi 1 chỗ áp dụng toàn site

Grid auto-fit + minmax	.features, .grid, .spec-grid	Tự động số cột theo màn hình, không cần media query

Position sticky	.nav	Nav dính trên đầu khi scroll

Position absolute + translate(-50%, -50%)	.aqi-circle-text	Căn giữa tuyệt đối (kỹ thuật kinh điển)

clip-path polygon	@keyframes textReveal	"Vén màn" chữ từ dưới lên

-webkit-background-clip: text	.admin-header h1	Chữ có màu gradient

stroke-dashoffset	.aqi-circle-progress	Vẽ vòng tròn SVG theo %

mask-composite: xor	.feature::after	Viền gradient chạy quanh card

backdrop-filter: blur	.modal-overlay	Kính mờ (glassmorphism)

cubic-bezier()	Many transitions	Easing tùy chỉnh ("nảy", "mượt")

::before/::after pseudo	Ripple button, bullet, gradient border	Phần tử "trang trí" không cần HTML

Kỹ thuật ít người biết:

inset: 0 = viết tắt top:0; right:0; bottom:0; left:0

gap: 1px + background: var(--border) = kẻ vạch giữa grid items (không cần border)

void offsetWidth (JS) = force reflow để restart animation

transform-box: fill-box = fix SVG animation lệch tâm

!important trong responsive = override inline style

# END