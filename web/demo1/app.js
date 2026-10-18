const API = 'https://airwatch.io.vn';
let chartEnv = null;
let chartVolt = null;
let chartCurr = null;
let chartPm = null;

// ================= HELPERS =================
function getLocalDate() {
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 3600 * 1000));
    return vnTime.getUTCFullYear() + '-' +
           String(vnTime.getUTCMonth() + 1).padStart(2, '0') + '-' +
           String(vnTime.getUTCDate()).padStart(2, '0');
}

function tsToMs(ts) {
    return new Date(ts.replace(' ', 'T')).getTime();
}

// ================= INIT =================
(async () => {
    await checkAuth();
    const btn = document.getElementById('auth-btn');
    const action = document.getElementById('auth-action');

    if (isAdmin()) {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
        if (btn) btn.textContent = 'Admin ▾';
        if (action) action.textContent = '🚪 Đăng xuất';
        loadSystemData();
    } else {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
        if (btn) btn.textContent = 'Guest ▾';
        if (action) action.textContent = '🔑 Đăng nhập';
    }

    applyTheme();

    const today = getLocalDate();
    const dateInput = document.getElementById('date-picker');
    if (dateInput) dateInput.value = today;

    const data = await fetchDataByDate(today);
    updateCards(data);
    renderCharts(data);
})();

// ================= MENU & THEME =================
function toggleMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('dropdown-menu');
    if (menu) menu.classList.toggle('open');
}

document.addEventListener('click', () => {
    const m = document.getElementById('dropdown-menu');
    if (m) m.classList.remove('open');
});

function handleAuthAction() {
    if (isAdmin()) logout();
    else window.location.href = 'index.html';
}

function toggleTheme() {
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    updateThemeLabel();
    const dateInput = document.getElementById('date-picker');
    if (dateInput && dateInput.value) loadByDate();
}

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

// ================= SYSTEM =================
async function loadSystemData() {
    try {
        const r = await fetch(API + '/api/system?token=' + getToken());
        const data = await r.json();
        const dbCount = document.getElementById('db-count');
        const lastSeen = document.getElementById('last-seen');
        const roleDisplay = document.getElementById('role-display');
        if (dbCount) dbCount.textContent = data.count || '--';
        if (lastSeen) lastSeen.textContent = data.last_seen || '--';
        if (roleDisplay) roleDisplay.textContent = currentRole;
    } catch(e) { console.error('System data fail:', e); }
}

async function fetchDataByDate(dateStr) {
    try {
        const r = await fetch(API + '/api/data-by-date?date=' + dateStr);
        return await r.json();
    } catch(e) {
        console.error('API-by-date fail:', e);
        return [];
    }
}

function setStatus(online) {
    const s = document.getElementById('status');
    if (!s) return;
    s.className = online ? 'status' : 'status offline';
    s.textContent = online ? 'LIVE' : 'OFFLINE';
}

// ================= AQI =================
function calcSubIndex(c, breakpoints) {
    if (c <= breakpoints[0][0]) return breakpoints[0][2];
    for (let i = 0; i < breakpoints.length; i++) {
        const [cLo, cHi, iLo, iHi] = breakpoints[i];
        if (c >= cLo && c <= cHi) {
            if (cHi === cLo) return iHi;
            return Math.round((iHi - iLo) / (cHi - cLo) * (c - cLo) + iLo);
        }
    }
    return 500;
}

const PM25_BP = [
    [0, 25, 0, 50], [25, 50, 51, 100], [50, 80, 101, 150],
    [80, 150, 151, 200], [150, 250, 201, 300], [250, 500, 301, 500]
];
const PM10_BP = [
    [0, 50, 0, 50], [50, 150, 51, 100], [150, 250, 101, 150],
    [250, 350, 151, 200], [350, 430, 201, 300], [430, 600, 301, 500]
];

function calcAQI(pm25, pm10) {
    const aqi25 = calcSubIndex(pm25 || 0, PM25_BP);
    const aqi10 = calcSubIndex(pm10 || 0, PM10_BP);
    return Math.max(aqi25, aqi10);
}

function updateAQI(pm25, pm10) {
    if (pm25 === undefined || pm10 === undefined) return;
    const aqi = calcAQI(pm25, pm10);
    const aqiEl = document.getElementById('aqi');
    const aqiText = document.getElementById('aqi-text');
    const progress = document.getElementById('aqi-progress');
    
    let text = '', color = '';
    if (aqi <= 50) { text = 'Tốt'; color = '#4CAF50'; }
    else if (aqi <= 100) { text = 'Trung bình'; color = '#FFEB3B'; }
    else if (aqi <= 150) { text = 'Kém'; color = '#FF9800'; }
    else if (aqi <= 200) { text = 'Xấu'; color = '#F44336'; }
    else if (aqi <= 300) { text = 'Rất xấu'; color = '#9C27B0'; }
    else { text = 'Nguy hại'; color = '#7B1FA2'; }

    if (aqiEl) { aqiEl.textContent = aqi; aqiEl.style.color = color; }
    if (aqiText) {
        aqiText.textContent = text;
        aqiText.style.backgroundColor = color;
        aqiText.style.color = (color === '#FFEB3B') ? '#000' : '#fff';
    }
    
    // Vẽ vòng tròn SVG
    if (progress) {
        const circumference = 2 * Math.PI * 90; // Chu vi vòng tròn (bán kính 90)
        const maxAQI = 300; // Đặt mốc max là 300 để vòng tròn dễ nhìn
        const percent = Math.min(aqi / maxAQI, 1);
        const offset = circumference - (percent * circumference);
        
        progress.style.strokeDashoffset = offset;
        progress.style.stroke = color;
    }
}

function updateCards(data) {
    if (!data.length) {
        setStatus(false);
        ['temp','hum','volt','curr','pm1','pm25','pm10','aqi'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '--';
        });
        return;
    }

    const last = data[data.length - 1];

    // Hàm đếm số từ giá trị cũ lên giá trị mới
    const animateNumber = (id, newVal, decimals = 0, scale = 1) => {
        const el = document.getElementById(id);
        if (!el) return;
        
        if (newVal === undefined || newVal === null) {
            el.textContent = '--';
            return;
        }

        const target = newVal * scale;
        
        // Lấy số cũ (nếu đang là '--' thì bắt đầu từ 0)
        const currentText = el.textContent.replace(/[^0-9.-]+/g, '');
        const start = currentText && !isNaN(parseFloat(currentText)) ? parseFloat(currentText) : 0;
        
        // Không cần chạy animation nếu số không đổi
        if (Math.abs(start - target) < 0.01) {
            el.textContent = target.toFixed(decimals);
            return;
        }

        const duration = 800; // 0.8 giây
        const startTime = performance.now();

        // Hiệu ứng phóng to màu xanh
        el.style.transition = 'color 0.3s, transform 0.3s';
        el.style.color = '#4CAF50';
        el.style.transform = 'scale(1.15)';
        el.style.display = 'inline-block';

        const update = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Công thức easeOutQuart cho mượt
            const easeOut = 1 - Math.pow(1 - progress, 4);
            const current = start + (target - start) * easeOut;
            
            el.textContent = current.toFixed(decimals);

            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                el.textContent = target.toFixed(decimals);
                // Trả lại trạng thái bình thường
                el.style.color = '';
                el.style.transform = 'scale(1)';
            }
        };
        requestAnimationFrame(update);
    };

    animateNumber('temp', last.t, 2);
    animateNumber('hum', last.h, 2);
    animateNumber('volt', last.v, 3);
    animateNumber('curr', last.i, 2, 1000);
    animateNumber('pm1', last.pm1, 0);
    animateNumber('pm25', last.pm25, 0);
    animateNumber('pm10', last.pm10, 0);

    const updated = document.getElementById('updated');
    if (updated) updated.textContent = last.ts;

    updateAQI(last.pm25, last.pm10);
    setStatus(true);
}

// ================= CHARTS =================
function getTextColor()   { return document.body.classList.contains('light') ? '#666' : '#8899a6'; }
function getGridColor()   { return document.body.classList.contains('light') ? '#e0e0e0' : '#2a3040'; }
function getLegendColor() { return document.body.classList.contains('light') ? '#1a1f2e' : '#e7e9ea'; }

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

function baseOptions(yTitle, color) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            duration: 1500,
            easing: 'easeOutQuart'
        },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: getLegendColor() } } },
        scales: {
            x: timeScaleX(),
            y: {
                position: 'left',
                ticks: { color: color },
                grid: { color: getGridColor() },
                title: { display: true, text: yTitle, color: color }
            }
        }
    };
}

function downsample(data, maxPoints) {
    if (data.length <= maxPoints) return data;
    const step = (data.length - 1) / (maxPoints - 1);
    const out = [];
    for (let i = 0; i < maxPoints; i++) {
        out.push(data[Math.round(i * step)]);
    }
    return out;
}

function toPoints(arr, key, scale) {
    scale = scale || 1;
    return arr.map(d => {
        const val = d[key] !== undefined && d[key] !== null ? Number(d[key]) : null;
        return {
            x: tsToMs(d.ts),
            y: val !== null ? val * scale : null
        };
    });
}

function renderCharts(data) {
    if (!data.length) {
        if (chartEnv)  { chartEnv.destroy();  chartEnv = null; }
        if (chartPm)   { chartPm.destroy();   chartPm = null; }
        if (chartVolt) { chartVolt.destroy(); chartVolt = null; }
        if (chartCurr) { chartCurr.destroy(); chartCurr = null; }
        return;
    }

    const sampled = downsample(data, 80);

    // Chart môi trường
    if (chartEnv) chartEnv.destroy();
    chartEnv = new Chart(document.getElementById('chart-env'), {
        type: 'line',
        data: {
            datasets: [
                { label: 'Nhiệt độ (°C)', data: toPoints(sampled, 't'),
                  borderColor: '#f44336', backgroundColor: 'rgba(244,67,54,0.1)',
                  tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, yAxisID: 'y_temp' },
                { label: 'Độ ẩm (%)', data: toPoints(sampled, 'h'),
                  borderColor: '#2196F3', backgroundColor: 'rgba(33,150,243,0.1)',
                  tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, yAxisID: 'y_hum' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 1500, easing: 'easeOutQuart' },
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: getLegendColor() } } },
            scales: {
                x: timeScaleX(),
                y_temp: { position: 'left', ticks: { color: '#f44336' }, grid: { color: getGridColor() },
                          title: { display: true, text: 'Nhiệt độ (°C)', color: '#f44336' } },
                y_hum: { position: 'right', ticks: { color: '#2196F3' }, grid: { drawOnChartArea: false },
                         title: { display: true, text: 'Độ ẩm (%)', color: '#2196F3' } }
            }
        }
    });

    // Chart bụi mịn
    if (chartPm) chartPm.destroy();
    chartPm = new Chart(document.getElementById('chart-pm'), {
        type: 'line',
        data: {
            datasets: [
                { label: 'PM1.0 (µg/m³)', data: toPoints(sampled, 'pm1'),
                  borderColor: '#FFC107', backgroundColor: 'rgba(255,193,7,0.1)',
                  tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, yAxisID: 'y_pm' },
                { label: 'PM2.5 (µg/m³)', data: toPoints(sampled, 'pm25'),
                  borderColor: '#FF5722', backgroundColor: 'rgba(255,87,34,0.1)',
                  tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, yAxisID: 'y_pm' },
                { label: 'PM10 (µg/m³)', data: toPoints(sampled, 'pm10'),
                  borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.1)',
                  tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, yAxisID: 'y_pm' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 1500, easing: 'easeOutQuart' },
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: getLegendColor() } } },
            scales: {
                x: timeScaleX(),
                y_pm: { position: 'left', ticks: { color: '#FF5722' }, grid: { color: getGridColor() },
                        title: { display: true, text: 'Bụi mịn (µg/m³)', color: '#FF5722' } }
            }
        }
    });

    if (!isAdmin()) return;

    // Chart điện áp
    if (chartVolt) chartVolt.destroy();
    chartVolt = new Chart(document.getElementById('chart-volt'), {
        type: 'line',
        data: {
            datasets: [{ label: 'Điện áp (V)', data: toPoints(sampled, 'v'),
                         borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.1)',
                         tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, fill: true }]
        },
        options: (() => {
            const o = baseOptions('Điện áp (V)', '#FF9800');
            o.scales.y.min = 2.0;
            o.scales.y.max = 3.6;
            return o;
        })()
    });

    // Chart dòng điện
    if (chartCurr) chartCurr.destroy();
    chartCurr = new Chart(document.getElementById('chart-curr'), {
        type: 'line',
        data: {
            datasets: [{ label: 'Dòng điện (mA)', data: toPoints(sampled, 'i', 1000),
                         borderColor: '#9C27B0', backgroundColor: 'rgba(156,39,176,0.1)',
                         tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, fill: true }]
        },
        options: (() => {
            const o = baseOptions('Dòng điện (mA)', '#9C27B0');
            o.scales.y.min = 0;
            o.scales.y.max = 100;
            return o;
        })()
    });
}

// ================= LOAD =================
async function loadToday() {
    const today = getLocalDate();
    const dateInput = document.getElementById('date-picker');
    if (dateInput) dateInput.value = today;

    const data = await fetchDataByDate(today);
    updateCards(data);
    renderCharts(data);
}

async function loadByDate() {
    const dateInput = document.getElementById('date-picker');
    if (!dateInput.value) {
        alert('Vui lòng chọn ngày');
        return;
    }

    const data = await fetchDataByDate(dateInput.value);

    if (!data.length) {
        alert('Không có dữ liệu ngày ' + dateInput.value);
        updateCards([]);
        renderCharts([]);
        return;
    }

    updateCards(data);
    renderCharts(data);

    const updated = document.getElementById('updated');
    if (updated) {
        updated.textContent = 'Xem ngày ' + dateInput.value + ' (' + data.length + ' điểm)';
    }
}

// ================= WEBSOCKET =================
let ws = null;
let wsPingInterval = null;

function connectWebSocket() {
    ws = new WebSocket('wss://airwatch.io.vn/ws/data');

    ws.onopen = () => {
        console.log('[WS] connected');
        wsPingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, 30000);
    };

    ws.onmessage = (e) => {
        if (e.data === 'pong') return;
        try {
            const d = JSON.parse(e.data);
            if (d.t !== undefined) updateFromWS(d);
        } catch(err) {}
    };

    ws.onclose = () => {
        console.log('[WS] disconnected, retry in 3s');
        clearInterval(wsPingInterval);
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => console.error('[WS] error');
}

function updateFromWS(d) {
    if (d.t === undefined) return;

    const dateInput = document.getElementById('date-picker');
    const today = getLocalDate();
    if (dateInput && dateInput.value !== today) return;

    const temp = document.getElementById('temp');
    const hum = document.getElementById('hum');
    const volt = document.getElementById('volt');
    const curr = document.getElementById('curr');
    const updated = document.getElementById('updated');
    const pm1 = document.getElementById('pm1');
    const pm25 = document.getElementById('pm25');
    const pm10 = document.getElementById('pm10');

    if (temp) temp.textContent = d.t.toFixed(2);
    if (hum) hum.textContent = d.h.toFixed(2);
    if (volt) volt.textContent = d.v.toFixed(3);
    if (curr) curr.textContent = (d.i * 1000).toFixed(2);
    if (pm1 && d.pm1 !== undefined)  pm1.textContent  = d.pm1;
    if (pm25 && d.pm25 !== undefined) pm25.textContent = d.pm25;
    if (pm10 && d.pm10 !== undefined) pm10.textContent = d.pm10;
    if (updated) updated.textContent = new Date().toLocaleString('vi-VN');
    
    updateAQI(d.pm25, d.pm10);
    setStatus(true);
    
    addPointToCharts(d);
}

function addPointToCharts(d) {
    const now = Date.now();

    if (chartEnv) {
        chartEnv.data.datasets[0].data.push({ x: now, y: d.t });
        chartEnv.data.datasets[1].data.push({ x: now, y: d.h });
        if (chartEnv.data.datasets[0].data.length > 200) {
            chartEnv.data.datasets.forEach(ds => ds.data.shift());
        }
        chartEnv.update(); 
    }

    if (chartPm) {
        chartPm.data.datasets[0].data.push({ x: now, y: d.pm1 || 0 });
        chartPm.data.datasets[1].data.push({ x: now, y: d.pm25 || 0 });
        chartPm.data.datasets[2].data.push({ x: now, y: d.pm10 || 0 });
        if (chartPm.data.datasets[0].data.length > 200) {
            chartPm.data.datasets.forEach(ds => ds.data.shift());
        }
        chartPm.update();
    }

    if (!isAdmin()) return;

    if (chartVolt) {
        chartVolt.data.datasets[0].data.push({ x: now, y: d.v });
        if (chartVolt.data.datasets[0].data.length > 200) {
            chartVolt.data.datasets[0].data.shift();
        }
        chartVolt.update();
    }

    if (chartCurr) {
        chartCurr.data.datasets[0].data.push({ x: now, y: d.i * 1000 });
        if (chartCurr.data.datasets[0].data.length > 200) {
            chartCurr.data.datasets[0].data.shift();
        }
        chartCurr.update();
    }
}

// ================= AUTO REFRESH =================
setInterval(async () => {
    const dateInput = document.getElementById('date-picker');
    const today = getLocalDate();
    if (!dateInput || dateInput.value === today) {
        const data = await fetchDataByDate(today);
        updateCards(data);
    }
}, 60000);

connectWebSocket();