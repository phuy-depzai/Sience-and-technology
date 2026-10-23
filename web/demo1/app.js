const API = 'https://airwatch.io.vn';
function fmtAgo(min) {
    if (min < 1) return 'vừa xong';
    if (min < 60) return min + ' phút trước';
    if (min < 1440) return Math.floor(min / 60) + ' giờ trước';
    const d = Math.floor(min / 1440);
    const h = Math.floor((min % 1440) / 60);
    return h > 0 ? d + 'd ' + h + 'h trước' : d + ' ngày trước';
}

// Helper: format timestamp từ UTC sang giờ VN
function formatVN(ts, withDate) {
    if (!ts) return '--';
    let s = String(ts);
    // SQLite trả "YYYY-MM-DD HH:MM:SS" (UTC) → thêm Z để JS parse đúng
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
        s = s.replace(' ', 'T') + 'Z';
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return ts;
    const opt = withDate
        ? { timeZone: 'Asia/Ho_Chi_Minh', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
        : { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false };
    return d.toLocaleString('vi-VN', opt);
}
let chartEnv = null, chartVolt = null, chartCurr = null, chartPm = null;

function getLocalDate() {
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 3600 * 1000));
    return vnTime.getUTCFullYear() + '-' +
           String(vnTime.getUTCMonth() + 1).padStart(2, '0') + '-' +
           String(vnTime.getUTCDate()).padStart(2, '0');
}

function tsToMs(ts) { return new Date(ts.replace(' ', 'T')).getTime(); }

(async () => {
    await checkAuth();
    const btn = document.getElementById('auth-btn');
    const action = document.getElementById('auth-action');
    if (typeof isHeadAdmin === 'function' && isHeadAdmin()) {
    document.querySelectorAll('.head-admin-only').forEach(el => el.style.display = '');
} else {
    document.querySelectorAll('.head-admin-only').forEach(el => el.style.display = 'none');
}
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
    if (typeof Chart !== 'undefined' && document.getElementById('chart-env')) renderCharts(data);
})();

function toggleMenu(e) { e.stopPropagation(); const m = document.getElementById('dropdown-menu'); if (m) m.classList.toggle('open'); }
document.addEventListener('click', () => { const m = document.getElementById('dropdown-menu'); if (m) m.classList.remove('open'); });
function handleAuthAction() { if (isAdmin()) logout(); else window.location.href = '/'; }
function toggleTheme() { const isLight = document.body.classList.toggle('light'); localStorage.setItem('theme', isLight ? 'light' : 'dark'); updateThemeLabel(); const di = document.getElementById('date-picker'); if (di && di.value) loadByDate(); }
function applyTheme() { const s = localStorage.getItem('theme') || 'dark'; if (s === 'light') document.body.classList.add('light'); else document.body.classList.remove('light'); updateThemeLabel(); }
function updateThemeLabel() { const i = document.getElementById('theme-icon'), l = document.getElementById('theme-label'); if (!i || !l) return; if (document.body.classList.contains('light')) { i.textContent = '☀️'; l.textContent = 'Chế độ sáng'; } else { i.textContent = '🌙'; l.textContent = 'Chế độ tối'; } }

async function loadSystemData() {
    try {
        const r = await fetch(API + '/api/system?token=' + getToken());
        const d = await r.json();
        const c = document.getElementById('db-count'), s = document.getElementById('last-seen'), ro = document.getElementById('role-display');
        if (c) c.textContent = d.count || '--';
        if (s) s.textContent = d.last_seen || '--';
        if (ro) ro.textContent = currentRole;
    } catch(e) { console.error('System data fail:', e); }
}

async function fetchDataByDate(dateStr) {
    try { const r = await fetch(API + '/api/data-by-date?date=' + dateStr); return await r.json(); }
    catch(e) { console.error('API-by-date fail:', e); return []; }
}

function setStatus(online) { const s = document.getElementById('status'); if (!s) return; s.className = online ? 'status' : 'status offline'; s.textContent = online ? 'LIVE' : 'OFFLINE'; }

// AQI
function calcSubIndex(c, bp) {
    if (c <= bp[0][0]) return bp[0][2];
    for (let i = 0; i < bp.length; i++) {
        const [cL, cH, iL, iH] = bp[i];
        if (c >= cL && c <= cH) { if (cH === cL) return iH; return Math.round((iH - iL) / (cH - cL) * (c - cL) + iL); }
    }
    return 500;
}
const PM25_BP = [[0,25,0,50],[25,50,51,100],[50,80,101,150],[80,150,151,200],[150,250,201,300],[250,500,301,500]];
const PM10_BP = [[0,50,0,50],[50,150,51,100],[150,250,101,150],[250,350,151,200],[350,430,201,300],[430,600,301,500]];
function calcAQI(pm25, pm10) { return Math.max(calcSubIndex(pm25||0, PM25_BP), calcSubIndex(pm10||0, PM10_BP)); }

function updateAQI(pm25, pm10) {
    if (pm25 === undefined || pm10 === undefined) return;
    const aqi = calcAQI(pm25, pm10);
    const aqiEl = document.getElementById('aqi'), aqiText = document.getElementById('aqi-text'), progress = document.getElementById('aqi-progress');
    let text = '', color = '';
    if (aqi <= 50) { text = 'Tốt'; color = '#4CAF50'; }
    else if (aqi <= 100) { text = 'Trung bình'; color = '#FFEB3B'; }
    else if (aqi <= 150) { text = 'Kém'; color = '#FF9800'; }
    else if (aqi <= 200) { text = 'Xấu'; color = '#F44336'; }
    else if (aqi <= 300) { text = 'Rất xấu'; color = '#9C27B0'; }
    else { text = 'Nguy hại'; color = '#7B1FA2'; }
    if (aqiEl) { aqiEl.textContent = aqi; aqiEl.style.color = color; }
    if (aqiText) { aqiText.textContent = text; aqiText.style.backgroundColor = color; aqiText.style.color = (color === '#FFEB3B') ? '#000' : '#fff'; }
    if (progress) { const circ = 2 * Math.PI * 90, pct = Math.min(aqi / 300, 1); progress.style.strokeDashoffset = circ - (pct * circ); progress.style.stroke = color; }
}

function updateCards(data) {
    if (!data.length) {
        setStatus(false);
        ['temp','hum','volt','curr','pm1','pm25','pm10','aqi'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '--'; });
        return;
    }
    const last = data[data.length - 1];
    const animateNumber = (id, nv, dec = 0, scale = 1) => {
        const el = document.getElementById(id); if (!el) return;
        if (nv === undefined || nv === null) { el.textContent = '--'; return; }
        const target = nv * scale;
        const cur = el.textContent.replace(/[^0-9.-]+/g, '');
        const start = cur && !isNaN(parseFloat(cur)) ? parseFloat(cur) : 0;
        if (Math.abs(start - target) < 0.01) { el.textContent = target.toFixed(dec); return; }
        const st = performance.now(), dur = 800;
        el.style.transition = 'color 0.3s, transform 0.3s';
        el.style.color = '#4CAF50'; el.style.transform = 'scale(1.15)'; el.style.display = 'inline-block';
        const upd = (ct) => {
            const prog = Math.min((ct - st) / dur, 1);
            const ease = 1 - Math.pow(1 - prog, 4);
            el.textContent = (start + (target - start) * ease).toFixed(dec);
            if (prog < 1) requestAnimationFrame(upd);
            else { el.textContent = target.toFixed(dec); el.style.color = ''; el.style.transform = 'scale(1)'; }
        };
        requestAnimationFrame(upd);
    };
    animateNumber('temp', last.t, 2); animateNumber('hum', last.h, 2); animateNumber('volt', last.v, 3);
    animateNumber('curr', last.i, 2, 1000); animateNumber('pm1', last.pm1, 0); animateNumber('pm25', last.pm25, 0); animateNumber('pm10', last.pm10, 0);
    const u = document.getElementById('updated'); if (u) u.textContent = last.ts;
    updateAQI(last.pm25, last.pm10);
    setStatus(true);
}

function getTextColor() { return document.body.classList.contains('light') ? '#666' : '#8899a6'; }
function getGridColor() { return document.body.classList.contains('light') ? '#e0e0e0' : '#2a3040'; }
function getLegendColor() { return document.body.classList.contains('light') ? '#1a1f2e' : '#e7e9ea'; }

function timeScaleX() { return { type: 'time', time: { unit: 'hour', displayFormats: { hour: 'HH:mm', minute: 'HH:mm' }, tooltipFormat: 'HH:mm:ss dd/MM' }, ticks: { color: getTextColor(), maxTicksLimit: 10, autoSkip: true }, grid: { color: getGridColor() } }; }
function baseOptions(t, c) { return { responsive: true, maintainAspectRatio: false, animation: { duration: 1500, easing: 'easeOutQuart' }, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: getLegendColor() } } }, scales: { x: timeScaleX(), y: { position: 'left', ticks: { color: c }, grid: { color: getGridColor() }, title: { display: true, text: t, color: c } } } }; }
function downsample(d, m) { if (d.length <= m) return d; const s = (d.length - 1) / (m - 1); const o = []; for (let i = 0; i < m; i++) o.push(d[Math.round(i * s)]); return o; }
function toPoints(a, k, sc) { sc = sc || 1; return a.map(d => { const v = d[k] !== undefined && d[k] !== null ? Number(d[k]) : null; return { x: tsToMs(d.ts), y: v !== null ? v * sc : null }; }); }

function renderCharts(data) {
    if (!data.length) {
        if (chartEnv) { chartEnv.destroy(); chartEnv = null; }
        if (chartPm) { chartPm.destroy(); chartPm = null; }
        if (chartVolt) { chartVolt.destroy(); chartVolt = null; }
        if (chartCurr) { chartCurr.destroy(); chartCurr = null; }
        return;
    }
    const s = downsample(data, 80);
    if (chartEnv) chartEnv.destroy();
    chartEnv = new Chart(document.getElementById('chart-env'), { type: 'line', data: { datasets: [
        { label: 'Nhiệt độ (°C)', data: toPoints(s, 't'), borderColor: '#f44336', backgroundColor: 'rgba(244,67,54,0.1)', tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, yAxisID: 'y_temp' },
        { label: 'Độ ẩm (%)', data: toPoints(s, 'h'), borderColor: '#2196F3', backgroundColor: 'rgba(33,150,243,0.1)', tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, yAxisID: 'y_hum' }
    ] }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 1500, easing: 'easeOutQuart' }, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: getLegendColor() } } }, scales: { x: timeScaleX(), y_temp: { position: 'left', ticks: { color: '#f44336' }, grid: { color: getGridColor() }, title: { display: true, text: 'Nhiệt độ (°C)', color: '#f44336' } }, y_hum: { position: 'right', ticks: { color: '#2196F3' }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Độ ẩm (%)', color: '#2196F3' } } } } });

    if (chartPm) chartPm.destroy();
    chartPm = new Chart(document.getElementById('chart-pm'), { type: 'line', data: { datasets: [
        { label: 'PM1.0 (µg/m³)', data: toPoints(s, 'pm1'), borderColor: '#FFC107', backgroundColor: 'rgba(255,193,7,0.1)', tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, yAxisID: 'y_pm' },
        { label: 'PM2.5 (µg/m³)', data: toPoints(s, 'pm25'), borderColor: '#FF5722', backgroundColor: 'rgba(255,87,34,0.1)', tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, yAxisID: 'y_pm' },
        { label: 'PM10 (µg/m³)', data: toPoints(s, 'pm10'), borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.1)', tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, yAxisID: 'y_pm' }
    ] }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 1500, easing: 'easeOutQuart' }, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: getLegendColor() } } }, scales: { x: timeScaleX(), y_pm: { position: 'left', ticks: { color: '#FF5722' }, grid: { color: getGridColor() }, title: { display: true, text: 'Bụi mịn (µg/m³)', color: '#FF5722' } } } } });

    if (!isAdmin()) return;

    if (chartVolt) chartVolt.destroy();
    chartVolt = new Chart(document.getElementById('chart-volt'), { type: 'line', data: { datasets: [{ label: 'Điện áp (V)', data: toPoints(s, 'v'), borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.1)', tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, fill: true }] }, options: (() => { const o = baseOptions('Điện áp (V)', '#FF9800'); o.scales.y.min = 2.0; o.scales.y.max = 3.6; return o; })() });

    if (chartCurr) chartCurr.destroy();
    chartCurr = new Chart(document.getElementById('chart-curr'), { type: 'line', data: { datasets: [{ label: 'Dòng điện (mA)', data: toPoints(s, 'i', 1000), borderColor: '#9C27B0', backgroundColor: 'rgba(156,39,176,0.1)', tension: 0, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, fill: true }] }, options: (() => { const o = baseOptions('Dòng điện (mA)', '#9C27B0'); o.scales.y.min = 0; o.scales.y.max = 100; return o; })() });
}

async function loadToday() { const t = getLocalDate(); const di = document.getElementById('date-picker'); if (di) di.value = t; const d = await fetchDataByDate(t); updateCards(d); renderCharts(d); }
async function loadByDate() {
    const di = document.getElementById('date-picker');
    if (!di.value) { alert('Vui lòng chọn ngày'); return; }
    const d = await fetchDataByDate(di.value);
    if (!d.length) { alert('Không có dữ liệu ngày ' + di.value); updateCards([]); renderCharts([]); return; }
    updateCards(d); renderCharts(d);
    const u = document.getElementById('updated'); if (u) u.textContent = 'Xem ngày ' + di.value + ' (' + d.length + ' điểm)';
}

// WebSocket
let ws = null, wsPingInterval = null;
function connectWebSocket() {
    ws = new WebSocket('wss://airwatch.io.vn/ws/data');
    ws.onopen = () => { console.log('[WS] connected'); wsPingInterval = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 30000); };
    ws.onmessage = (e) => { if (e.data === 'pong') return; try { const d = JSON.parse(e.data); if (d.t !== undefined) updateFromWS(d); } catch(err) {} };
    ws.onclose = () => { console.log('[WS] disconnected, retry 3s'); clearInterval(wsPingInterval); setTimeout(connectWebSocket, 3000); };
    ws.onerror = () => console.error('[WS] error');
}

function updateFromWS(d) {
    if (d.t === undefined) return;
    const di = document.getElementById('date-picker'); const t = getLocalDate();
    if (di && di.value !== t) return;
    const ids = ['temp','hum','volt','curr','pm1','pm25','pm10','updated'];
    if (d.t !== undefined) document.getElementById('temp') && (document.getElementById('temp').textContent = d.t.toFixed(2));
    if (d.h !== undefined) document.getElementById('hum') && (document.getElementById('hum').textContent = d.h.toFixed(2));
    if (d.v !== undefined) document.getElementById('volt') && (document.getElementById('volt').textContent = d.v.toFixed(3));
    if (d.i !== undefined) document.getElementById('curr') && (document.getElementById('curr').textContent = (d.i * 1000).toFixed(2));
    if (d.pm1 !== undefined) document.getElementById('pm1') && (document.getElementById('pm1').textContent = d.pm1);
    if (d.pm25 !== undefined) document.getElementById('pm25') && (document.getElementById('pm25').textContent = d.pm25);
    if (d.pm10 !== undefined) document.getElementById('pm10') && (document.getElementById('pm10').textContent = d.pm10);
    const u = document.getElementById('updated'); if (u) u.textContent = new Date().toLocaleString('vi-VN');
    updateAQI(d.pm25, d.pm10);
    setStatus(true);
    addPointToCharts(d);
}

function addPointToCharts(d) {
    const now = Date.now();
    if (chartEnv) { chartEnv.data.datasets[0].data.push({ x: now, y: d.t }); chartEnv.data.datasets[1].data.push({ x: now, y: d.h }); if (chartEnv.data.datasets[0].data.length > 200) chartEnv.data.datasets.forEach(ds => ds.data.shift()); chartEnv.update(); }
    if (chartPm) { chartPm.data.datasets[0].data.push({ x: now, y: d.pm1 || 0 }); chartPm.data.datasets[1].data.push({ x: now, y: d.pm25 || 0 }); chartPm.data.datasets[2].data.push({ x: now, y: d.pm10 || 0 }); if (chartPm.data.datasets[0].data.length > 200) chartPm.data.datasets.forEach(ds => ds.data.shift()); chartPm.update(); }
    if (!isAdmin()) return;
    if (chartVolt) { chartVolt.data.datasets[0].data.push({ x: now, y: d.v }); if (chartVolt.data.datasets[0].data.length > 200) chartVolt.data.datasets[0].data.shift(); chartVolt.update(); }
    if (chartCurr) { chartCurr.data.datasets[0].data.push({ x: now, y: d.i * 1000 }); if (chartCurr.data.datasets[0].data.length > 200) chartCurr.data.datasets[0].data.shift(); chartCurr.update(); }
}

setInterval(async () => {
    const di = document.getElementById('date-picker'); const t = getLocalDate();
    if (!di || di.value === t) { const d = await fetchDataByDate(t); updateCards(d); }
}, 60000);

// ============ MANUAL STATUS ============
const STATUS_ICONS = { stm32: '🔌 NODE', esp32: '📡 GATEWAY', api: '🌐 Web API', system: '🖥️ SYSTEM' };
const PRESET_NOTES = { working: 'Hoạt động bình thường', debug: 'Đang debug', attach: 'Đang gắn module/sensor', testing: 'Đang chạy test', maintenance: 'Đang bảo trì', offline: 'Tạm tắt' };

function applyPreset(status) {
    document.getElementById('sel-status').value = status;
    const n = document.getElementById('inp-note'); if (!n.value.trim()) n.value = PRESET_NOTES[status] || '';
    document.querySelectorAll('.preset-btn').forEach(b => b.style.opacity = '0.5');
    const btn = document.querySelector(`.preset-btn.${status}`); if (btn) btn.style.opacity = '1';
    updateServiceStatus();
}

// ============ MAP + NODES ============
let adminMap = null, adminMarkers = [];
const VIETMAP_KEY = '75950d796c1f4a611133660d2ec48258174fc8279da00348';

function initNodesMap() {
    const el = document.getElementById('nodes-map');
    if (!el || typeof L === 'undefined' || adminMap) return;
    adminMap = L.map('nodes-map').setView([16.0, 106.5], 5);
    L.tileLayer('https://maps.vietmap.vn/maps/tiles/st/{z}/{x}/{y}.png?apikey=' + VIETMAP_KEY, { attribution: '© VietMap', maxZoom: 19 }).addTo(adminMap);
    adminMap.on('click', (e) => {
        const lat = e.latlng.lat.toFixed(6), lng = e.latlng.lng.toFixed(6);
        document.getElementById('node-lat').value = lat;
        document.getElementById('node-lng').value = lng;
        if (window._tempMarker) adminMap.removeLayer(window._tempMarker);
        window._tempMarker = L.circleMarker([lat, lng], { radius: 8, fillColor: '#58a6ff', color: '#fff', weight: 2, fillOpacity: 0.9 }).addTo(adminMap).bindPopup('📍 ' + lat + ', ' + lng).openPopup();
    });
    loadNodesOnMap();
}

async function loadNodesOnMap() {
    if (!adminMap) return;
    adminMarkers.forEach(m => adminMap.removeLayer(m));
    adminMarkers = [];
    try {
        const r = await fetch(API + '/api/nodes');
        const nodes = await r.json();
        if (!nodes || !nodes.length) return;
        nodes.forEach(n => {
            const m = L.circleMarker([n.lat, n.lng], { radius: 9, fillColor: '#4CAF50', color: '#fff', weight: 2, fillOpacity: 0.9 }).addTo(adminMap).bindPopup('<strong>' + (n.name || n.id) + '</strong><br><small>' + n.lat.toFixed(4) + ', ' + n.lng.toFixed(4) + '</small>');
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
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
            body: JSON.stringify({ id, name, lat: parseFloat(lat), lng: parseFloat(lng) })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        alert('Đã thêm node ' + name);
        document.getElementById('node-id').value = '';
        document.getElementById('node-name').value = '';
        document.getElementById('node-lat').value = '';
        document.getElementById('node-lng').value = '';
        if (window._tempMarker) { adminMap.removeLayer(window._tempMarker); window._tempMarker = null; }
        loadNodesOnMap();
        loadNodes();
    } catch(e) { alert('Thêm node thất bại: ' + e.message); }
}

async function loadNodes() {
    const box = document.getElementById('nodes-list');
    if (!box) return;
    box.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">Đang tải...</div>';
    try {
        const [nr, dr] = await Promise.all([fetch(API + '/api/nodes'), fetch(API + '/api/data')]);
        const nodes = await nr.json();
        const data = await dr.json();
        if (!nodes || !nodes.length) { box.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">Chưa có node nào.</div>'; return; }
        const lastData = (data && data.length) ? data[data.length - 1] : null;
        const lastMs = lastData ? tsToMs(lastData.ts) : 0;
        const diffMin = lastMs ? Math.floor((Date.now() - lastMs) / 60000) : 99999;
        const status = diffMin < 15 ? 'working' : diffMin < 60 ? 'delayed' : 'offline';
        box.innerHTML = nodes.map(n => `<div class="node-row"><div class="node-info"><div class="node-name">${n.name || n.id || 'Node'}</div><div class="node-meta">${(n.lat||0).toFixed(4)}, ${(n.lng||0).toFixed(4)}</div></div><div class="node-status"><span class="status-dot ${status}"></span><span class="status-label ${status}">${status}</span></div><div class="node-last">${diffMin < 99999 ? fmtAgo(diffMin) : 'chưa có data'}</div><button class="node-delete" onclick="deleteNode('${n.id}', '${(n.name || n.id).replace(/'/g, "\\'")}')" title="Xóa node">🗑️</button></div>`).join('');
        const u = document.getElementById('updated'); if (u) u.textContent = new Date().toLocaleTimeString('vi-VN');
    } catch(e) { box.innerHTML = '<div style="color:#f85149; padding:20px;">Lỗi load node: ' + e.message + '</div>'; }
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
    } catch(e) {
        alert('Xóa thất bại: ' + e.message);
    }
}

async function loadServiceStatus() {
    try {
        const r = await fetch(API + '/api/status');
        const d = await r.json();
        const grid = document.getElementById('status-grid');
        if (!grid) return;
        grid.innerHTML = Object.keys(STATUS_ICONS).map(k => {
            const svc = (d.services && d.services[k]) || { status: 'offline', note: '' };
            return `<div class="status-card"><div class="status-head"><span class="status-name">${STATUS_ICONS[k]}</span><span class="status-dot ${svc.status}"></span></div><div class="status-label ${svc.status}">${svc.status}</div><div class="status-note">${svc.note || '—'}</div></div>`;
        }).join('');
        const u = document.getElementById('status-updated'); if (u) u.textContent = new Date().toLocaleTimeString('vi-VN');
    } catch(e) { console.error('[STATUS]', e); }
}

async function updateServiceStatus() {
    const service = document.getElementById('sel-service').value;
    const status  = document.getElementById('sel-status').value;
    const note    = document.getElementById('inp-note').value.trim();

    try {
        const r = await fetch(API + '/api/set-status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
            body: JSON.stringify({ service, status, note })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        document.getElementById('inp-note').value = '';
        await loadServiceStatus();
    } catch(e) {
        alert('Cập nhật thất bại: ' + e.message);
    }
}

if (document.getElementById('tab-status')) {
    loadNodes();
    loadServiceStatus();
    setInterval(loadServiceStatus, 10000);
    setInterval(loadNodes, 30000);
}
// ============ LOG HELPER ============
async function logAction(action, target, details, severity) {
    try {
        await fetch(API + '/api/logs', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
            body: JSON.stringify({
                action: action,
                target: target || '',
                details: details || '',
                severity: severity || 'info',
                author: 'phuyy'
            })
        });
    } catch(e) {
        console.warn('[LOG]', e);
    }
}
// ============ DEBUG DASHBOARD — CORE ============
const DEBUG_FIELDS = ['t','h','v','i','pm1','pm25','pm10','voc','nox','sgp_ok'];
const FIELD_RULES = {
    t:     { min: -10, max: 60,   label: 'Nhiệt độ' },
    h:     { min: 0,   max: 100,  label: 'Độ ẩm' },
    v:     { min: 1.5, max: 5.0,  label: 'Điện áp' },
    i:     { min: -1,  max: 2.0,  label: 'Dòng điện' },
    pm1:   { min: 0,   max: 500,  label: 'PM1.0' },
    pm25:  { min: 0,   max: 500,  label: 'PM2.5' },
    pm10:  { min: 0,   max: 1000, label: 'PM10' },
    voc:   { min: 0,   max: 65535,label: 'VOC' },
    nox:   { min: 0,   max: 65535,label: 'NOx' }
};

let debugData = [];
let debugFiltered = [];
let editingId = null;
let selectedRows = new Set();
let dbgChartEnv = null, dbgChartPm = null, dbgChartPower = null;
let presetsList = [];

function validateField(name) {
    const rule = FIELD_RULES[name];
    if (!rule) return true;
    const el = document.getElementById('dbg-' + name);
    const err = document.getElementById('err-' + name);
    if (!el || !err) return true;
    const raw = el.value.trim();
    if (raw === '') {
        el.classList.remove('invalid');
        err.textContent = '';
        return true;
    }
    const val = parseFloat(raw);
    if (isNaN(val)) {
        el.classList.add('invalid');
        err.textContent = 'Không phải số';
        return false;
    }
    if (val < rule.min || val > rule.max) {
        el.classList.add('invalid');
        err.textContent = `Phải từ ${rule.min} đến ${rule.max}`;
        return false;
    }
    el.classList.remove('invalid');
    err.textContent = '';
    return true;
}

function validateAllFields() {
    let ok = true;
    Object.keys(FIELD_RULES).forEach(f => {
        if (!validateField(f)) ok = false;
    });
    return ok;
}

function resetDebugForm() {
    editingId = null;
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

    Object.keys(FIELD_RULES).forEach(f => {
        const err = document.getElementById('err-' + f);
        if (err) err.textContent = '';
        const el = document.getElementById('dbg-' + f);
        if (el) el.classList.remove('invalid');
    });

    document.getElementById('dbg-form-mode').innerHTML = 'Mode: <strong>INSERT</strong> (id trống)';
    document.getElementById('btn-save-debug').textContent = '💾 Save (Insert)';
    document.getElementById('btn-cancel-edit').style.display = 'none';

    document.querySelectorAll('.debug-table tbody tr').forEach(tr => tr.classList.remove('edit-mode'));
}

function cancelEditMode() {
    resetDebugForm();
}

async function loadDebugData() {
    const tbody = document.getElementById('debug-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="16" style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải...</td></tr>';
    try {
        const r = await fetch(API + '/api/debug/data', {
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        debugData = await r.json();
        applyDebugFilter();
        renderDebugDashboard(debugData);
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="16" style="text-align:center; padding:20px; color:#f85149;">Lỗi: ' + e.message + '</td></tr>';
        console.error('[DEBUG]', e);
    }
}

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
        return `<tr class="${selClass} ${editClass}" data-id="${d.id}">
            <td><input type="checkbox" ${checked} onchange="toggleSelectRow(${d.id}, this.checked)"></td>
            <td>${d.id}</td>
            <td>${(d.ts||'').slice(5,16)}</td>
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

    document.getElementById('btn-bulk-del').disabled = selectedRows.size === 0;
    const checkAll = document.getElementById('dbg-check-all');
    if (checkAll) checkAll.checked = debugFiltered.length > 0 && selectedRows.size === debugFiltered.length;
}// ============ PRESETS ============
async function loadPresets() {
    try {
        const r = await fetch(API + '/api/debug/presets', {
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        presetsList = await r.json();
        const sel = document.getElementById('dbg-preset-select');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">-- Chọn preset --</option>' +
            presetsList.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        if (current) sel.value = current;
    } catch(e) {
        console.error('[PRESETS]', e);
    }
}

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
    } catch(e) {
        alert('Preset bị lỗi JSON: ' + e.message);
    }
}

async function savePreset() {
    const name = prompt('Tên preset mới:');
    if (!name || !name.trim()) return;
    const desc = prompt('Mô tả (tùy chọn):') || '';
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
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
            body: JSON.stringify({
                name: name.trim(),
                description: desc.trim(),
                values_json: JSON.stringify(vals)
            })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('preset_created', 'preset:' + name.trim(), desc, 'info');
        await loadPresets();
    } catch(e) {
        alert('Tạo preset thất bại: ' + e.message);
    }
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
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
            body: JSON.stringify({ values_json: JSON.stringify(vals) })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('preset_updated', 'preset:' + preset.name, 'Update từ form', 'info');
        await loadPresets();
    } catch(e) {
        alert('Cập nhật thất bại: ' + e.message);
    }
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
    } catch(e) {
        alert('Xóa thất bại: ' + e.message);
    }
}

// ============ CLONE FROM SENSOR ============
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
        sensorCache = sensorCache.slice().reverse(); // mới nhất trước
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
    box.innerHTML = list.map(s => `
        <div class="clone-item" onclick="cloneSensor(${s.id})">
            <div class="clone-item-id">#${s.id}</div>
            <div class="clone-item-info">
                T=${(s.t||0).toFixed(2)}°C · H=${(s.h||0).toFixed(1)}% · PM2.5=${s.pm25||0} · V=${(s.v||0).toFixed(3)}V
            </div>
            <div class="clone-item-ts">${s.ts || '--'}</div>
        </div>
    `).join('');
}

function filterSensorList() {
    const q = (document.getElementById('clone-search')?.value || '').trim().toLowerCase();
    if (!q) { renderSensorList(sensorCache); return; }
    const filtered = sensorCache.filter(s =>
        String(s.id).includes(q) || (s.ts || '').toLowerCase().includes(q)
    );
    renderSensorList(filtered);
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
    } catch(e) {
        alert('Clone thất bại: ' + e.message);
    }
}

// ============ SIMULATE ============
async function simulatePackets(edge) {
    const countEl = document.getElementById('dbg-sim-count');
    const count = parseInt(countEl?.value) || 10;
    if (count < 1 || count > 200) {
        alert('Số lượng phải từ 1 đến 200');
        return;
    }
    if (!confirm('Simulate ' + count + ' packets' + (edge ? ' (có edge cases)' : '') + '?')) return;
    try {
        const r = await fetch(API + '/api/debug/simulate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
            body: JSON.stringify({ count, edge })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('debug_simulated', 'sensor_debug',
                  'Simulate ' + count + ' packets' + (edge ? ' (edge)' : ''), 'info');
        await loadDebugData();
    } catch(e) {
        alert('Simulate thất bại: ' + e.message);
    }
}

// ============ DEBUG INIT ============
if (document.getElementById('tab-debug')) {
    setTimeout(() => { if (typeof loadPresets === 'function') loadPresets(); }, 300);
}

function filterDebugTable() {
    applyDebugFilter();
}

function toggleSelectRow(id, checked) {
    if (checked) selectedRows.add(id); else selectedRows.delete(id);
    renderDebugTable();
}

function toggleSelectAll(checked) {
    selectedRows.clear();
    if (checked) debugFiltered.forEach(d => selectedRows.add(d.id));
    renderDebugTable();
}

async function saveDebugRecord() {
    if (!validateAllFields()) {
        alert('Có field không hợp lệ. Sửa trước khi lưu.');
        return;
    }
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
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
            body: JSON.stringify(payload)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);

        logAction(isEdit ? 'debug_updated' : 'debug_created',
                  'sensor_debug#' + (editingId || 'new'),
                  (isEdit ? 'Sửa' : 'Tạo') + ' record: ' + (note?.value || ''), 'info');

        resetDebugForm();
        await loadDebugData();
    } catch(e) {
        alert('Lưu thất bại: ' + e.message);
    }
}

function editDebugRecord(id) {
    const d = debugData.find(x => x.id === id);
    if (!d) return;
    editingId = id;
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

    document.getElementById('dbg-form-mode').innerHTML = 'Mode: <strong>UPDATE</strong> #' + id;
    document.getElementById('btn-save-debug').textContent = '💾 Update #' + id;
    document.getElementById('btn-cancel-edit').style.display = '';

    renderDebugTable();
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
    } catch(e) {
        alert('Xóa thất bại: ' + e.message);
    }
}

async function deleteSelectedDebug() {
    if (selectedRows.size === 0) return;
    if (!confirm('Xóa ' + selectedRows.size + ' record đã chọn?')) return;
    const ids = Array.from(selectedRows);
    try {
        for (const id of ids) {
            await fetch(API + '/api/debug/data/' + id, {
                method: 'DELETE',
                headers: { 'X-Auth-Token': getToken() }
            });
        }
        logAction('debug_deleted', 'bulk', 'Xóa ' + ids.length + ' records: ' + ids.join(','), 'warn');
        selectedRows.clear();
        await loadDebugData();
    } catch(e) {
        alert('Xóa thất bại: ' + e.message);
    }
}

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
    } catch(e) {
        alert('Clear thất bại: ' + e.message);
    }
}

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
    } catch(e) {
        alert('Restore thất bại: ' + e.message);
    }
}

function renderDebugDashboard(data) {
    if (!data || !data.length) {
        ['dbg-card-t','dbg-card-h','dbg-card-v','dbg-card-i','dbg-card-pm1','dbg-card-pm25','dbg-card-pm10'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '--';
        });
        const aqiEl = document.getElementById('dbg-aqi');
        if (aqiEl) aqiEl.textContent = '--';
        return;
    }
    const last = data[0]; // mới nhất (ORDER BY id DESC)

    const set = (id, val, dec) => {
        const el = document.getElementById(id);
        if (el) el.textContent = (val !== undefined && val !== null) ? Number(val).toFixed(dec) : '--';
    };
    set('dbg-card-t', last.t, 2);
    set('dbg-card-h', last.h, 2);
    set('dbg-card-v', last.v, 3);
    set('dbg-card-i', (last.i||0) * 1000, 2);
    set('dbg-card-pm1', last.pm1, 0);
    set('dbg-card-pm25', last.pm25, 0);
    set('dbg-card-pm10', last.pm10, 0);

    const aqi = calcAQI(last.pm25 || 0, last.pm10 || 0);
    const aqiEl = document.getElementById('dbg-aqi');
    const aqiText = document.getElementById('dbg-aqi-text');
    const progress = document.getElementById('dbg-aqi-progress');
    let text = '', color = '';
    if (aqi <= 50) { text = 'Tốt'; color = '#4CAF50'; }
    else if (aqi <= 100) { text = 'Trung bình'; color = '#FFEB3B'; }
    else if (aqi <= 150) { text = 'Kém'; color = '#FF9800'; }
    else if (aqi <= 200) { text = 'Xấu'; color = '#F44336'; }
    else if (aqi <= 300) { text = 'Rất xấu'; color = '#9C27B0'; }
    else { text = 'Nguy hại'; color = '#7B1FA2'; }
    if (aqiEl) { aqiEl.textContent = aqi; aqiEl.style.color = color; }
    if (aqiText) { aqiText.textContent = text; aqiText.style.backgroundColor = color; aqiText.style.color = (color === '#FFEB3B') ? '#000' : '#fff'; }
    if (progress) {
        const circ = 2 * Math.PI * 90;
        const pct = Math.min(aqi / 300, 1);
        progress.style.strokeDashoffset = circ - (pct * circ);
        progress.style.stroke = color;
    }

    renderDebugCharts(data);
}

function renderDebugCharts(data) {
    if (typeof Chart === 'undefined') return;
    const sorted = data.slice().sort((a,b) => (a.ts||'').localeCompare(b.ts||''));
    const labels = sorted.map(d => (d.ts||'').slice(5,16));
    const maxPts = 80;
    const step = Math.max(1, Math.ceil(sorted.length / maxPts));
    const s = sorted.filter((_, i) => i % step === 0);

    if (dbgChartEnv) dbgChartEnv.destroy();
    const envEl = document.getElementById('dbg-chart-env');
    if (envEl) {
        dbgChartEnv = new Chart(envEl, {
            type: 'line',
            data: {
                labels: s.map(d => (d.ts||'').slice(5,16)),
                datasets: [
                    { label: 'Nhiệt độ (°C)', data: s.map(d => d.t), borderColor: '#f44336', backgroundColor: 'rgba(244,67,54,0.1)', tension: 0.2, pointRadius: 0, yAxisID: 'y1' },
                    { label: 'Độ ẩm (%)', data: s.map(d => d.h), borderColor: '#2196F3', backgroundColor: 'rgba(33,150,243,0.1)', tension: 0.2, pointRadius: 0, yAxisID: 'y2' }
                ]
            },
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

    if (dbgChartPm) dbgChartPm.destroy();
    const pmEl = document.getElementById('dbg-chart-pm');
    if (pmEl) {
        dbgChartPm = new Chart(pmEl, {
            type: 'line',
            data: {
                labels: s.map(d => (d.ts||'').slice(5,16)),
                datasets: [
                    { label: 'PM1.0', data: s.map(d => d.pm1), borderColor: '#FFC107', backgroundColor: 'rgba(255,193,7,0.1)', tension: 0.2, pointRadius: 0 },
                    { label: 'PM2.5', data: s.map(d => d.pm25), borderColor: '#FF5722', backgroundColor: 'rgba(255,87,34,0.1)', tension: 0.2, pointRadius: 0 },
                    { label: 'PM10', data: s.map(d => d.pm10), borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.1)', tension: 0.2, pointRadius: 0 }
                ]
            },
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

    if (dbgChartPower) dbgChartPower.destroy();
    const pwEl = document.getElementById('dbg-chart-power');
    if (pwEl) {
        dbgChartPower = new Chart(pwEl, {
            type: 'line',
            data: {
                labels: s.map(d => (d.ts||'').slice(5,16)),
                datasets: [
                    { label: 'Điện áp (V)', data: s.map(d => d.v), borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.1)', tension: 0.2, pointRadius: 0, yAxisID: 'yv' },
                    { label: 'Dòng (mA)', data: s.map(d => (d.i||0)*1000), borderColor: '#9C27B0', backgroundColor: 'rgba(156,39,176,0.1)', tension: 0.2, pointRadius: 0, yAxisID: 'yi' }
                ]
            },
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
// ============ LOG TAB ============
let logsData = [];
let logsFiltered = [];

async function loadLogs() {
    const box = document.getElementById('log-list');
    if (!box) return;
    box.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Đang tải...</div>';
    try {
        const action = document.getElementById('log-filter-action')?.value || '';
        const severity = document.getElementById('log-filter-severity')?.value || '';
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
    const sevIcon = { info: 'ℹ️', warn: '⚠️', error: '🔴', fatal: '💀' };
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
        logsFiltered = logsData.filter(l => {
            const s = (l.action + ' ' + (l.target || '') + ' ' + (l.details || '') + ' ' + (l.author || '')).toLowerCase();
            return s.includes(q);
        });
    }
    renderLogs();
}

function openNewLogDialog() {
    const dlg = document.getElementById('log-dialog');
    if (!dlg) return;
    dlg.style.display = 'flex';
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
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
            body: JSON.stringify({ action, target, details, severity, author: 'phuyy' })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        closeLogDialog();
        await loadLogs();
    } catch(e) {
        alert('Ghi log thất bại: ' + e.message);
    }
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
    } catch(e) {
        alert('Xóa thất bại: ' + e.message);
    }
}
// ============ CLONE ALL ============
function toggleCloneAll() {
    const check = document.getElementById('clone-all-check');
    const wrapper = document.getElementById('clone-list-wrapper');
    const btn = document.getElementById('btn-clone-all');
    if (!check) return;
    if (check.checked) {
        if (wrapper) wrapper.style.display = 'none';
        if (btn) btn.style.display = '';
    } else {
        if (wrapper) wrapper.style.display = '';
        if (btn) btn.style.display = 'none';
    }
}

async function cloneAllSensors() {
    const limitEl = document.getElementById('clone-all-limit');
    const limit = parseInt(limitEl?.value) || 50;
    if (limit < 1 || limit > 500) {
        alert('Số lượng phải từ 1 đến 500');
        return;
    }
    if (!confirm('Clone ' + limit + ' sensor mới nhất sang Debug DB?\n\nHành động này có thể tạo nhiều records.')) return;
    try {
        const r = await fetch(API + '/api/debug/clone-all', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
            body: JSON.stringify({ limit })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        logAction('debug_cloned', 'bulk', 'Clone ' + (d.cloned || limit) + ' sensors', 'info');
        closeCloneDialog();
        await loadDebugData();
    } catch(e) {
        alert('Clone thất bại: ' + e.message);
    }
}
// ============ ADMIN NOTES ============
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
    
    const tagIcon = { note: '📝', todo: '✅', bug: '🐛', maint: '🔧', idea: '💡' };
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
                <span>🕐 ${formatVN(n.ts, true)}</span>
                ${n.updated_at ? '<span>✏️ sửa: ' + formatVN(n.updated_at, true) + '</span>' : ''}
            </div>
            <div class="note-comments">
                <button class="note-comments-toggle" onclick="toggleNoteComments(${n.id})">
                    💬 Bình luận
                </button>
                <div id="nc-wrap-${n.id}" style="display:none;"></div>
            </div>
        </div>
    `).join('');
}

function filterNoteList() {
    const q = (document.getElementById('note-search')?.value || '').toLowerCase().trim();
    if (!q) { notesFiltered = notesData; }
    else {
        notesFiltered = notesData.filter(n => {
            const s = (n.title + ' ' + n.content + ' ' + n.author + ' ' + n.tag).toLowerCase();
            return s.includes(q);
        });
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

        const r = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
            body: JSON.stringify(body)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);

        logAction(isEdit ? 'note_updated' : 'note_created',
                  'note#' + (editingNoteId || 'new'),
                  title, 'info');

        closeNoteDialog();
        await loadNotes();
    } catch(e) {
        alert('Lưu thất bại: ' + e.message);
    }
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
    } catch(e) {
        alert('Xóa thất bại: ' + e.message);
    }
}

async function togglePinNote(id, pinned) {
    try {
        const r = await fetch(API + '/api/notes/' + id, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
            body: JSON.stringify({ pinned: pinned })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadNotes();
    } catch(e) {
        alert('Đổi pin thất bại: ' + e.message);
    }
}
// ============ USERS MANAGEMENT ============
let usersData = [];
let editingUserId = null;

async function loadUsers() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải...</td></tr>';
    try {
        const r = await fetch(API + '/api/users', {
            headers: { 'X-Auth-Token': getToken() }
        });
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
    document.getElementById('user-form-username').disabled = true;
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
        // UPDATE
        const body = { role };
        if (password) body.password = password;
        try {
            const r = await fetch(API + '/api/users/' + editingUserId, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Auth-Token': getToken()
                },
                body: JSON.stringify(body)
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
            closeUserDialog();
            await loadUsers();
        } catch(e) {
            errEl.textContent = e.message;
            errEl.style.color = '#f85149';
        }
    } else {
        // CREATE
        if (!username || !password) {
            errEl.textContent = 'Nhập đủ username và password';
            errEl.style.color = '#f85149';
            return;
        }
        try {
            const r = await fetch(API + '/api/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Auth-Token': getToken()
                },
                body: JSON.stringify({ username, password, role })
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
            closeUserDialog();
            await loadUsers();
        } catch(e) {
            errEl.textContent = e.message;
            errEl.style.color = '#f85149';
        }
    }
}

async function toggleUserActive(id, active) {
    const u = usersData.find(x => x.id === id);
    if (!u) return;
    if (!confirm((active ? 'Kích hoạt' : 'Vô hiệu hóa') + ' user "' + u.username + '"?')) return;
    try {
        const r = await fetch(API + '/api/users/' + id, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
            body: JSON.stringify({ active: active })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadUsers();
    } catch(e) {
        alert('Thất bại: ' + e.message);
    }
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
    } catch(e) {
        alert('Xóa thất bại: ' + e.message);
    }
}

// Enter trong dialog → submit
document.addEventListener('DOMContentLoaded', () => {
    const pwd = document.getElementById('user-form-password');
    if (pwd) {
        pwd.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submitUser(); }
        });
    }
});
// ============ DB VIEWER ============
let dbState = { table: 'sensor', offset: 0, limit: 100, total: 0, q: '' };
let dbSearchTimer = null;

function debouncedDBSearch() {
    clearTimeout(dbSearchTimer);
    dbSearchTimer = setTimeout(() => {
        dbState.q = document.getElementById('db-search').value.trim();
        dbState.offset = 0;
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

        thead.innerHTML = '<tr>' + d.columns.map(c => '<th>' + c + '</th>').join('') + '</tr>';

        if (!d.rows || !d.rows.length) {
            tbody.innerHTML = '<tr><td colspan="' + d.columns.length + '" style="text-align:center; padding:20px; color:var(--text-muted);">Không có data</td></tr>';
        } else {
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
// ============ NOTE COMMENTS ============
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
        const canDel = c.username === currentUser || (typeof isHeadAdmin === 'function' && isHeadAdmin());
        const time = (c.created_at || '').slice(0, 16);
        return `
            <div class="comment-item">
                <div class="comment-avatar">${initial}</div>
                <div class="comment-body">
                    <div class="comment-header">
                        <span class="comment-user">${c.username}</span>
                        <span class="comment-time">${time}</span>
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

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
        const container = document.getElementById('nc-wrap-' + noteId);
        await loadNoteComments(noteId, container);
    } catch(e) { alert('Lỗi: ' + e.message); }
}

async function delNoteComment(id, noteId, btn) {
    if (!confirm('Xóa comment này?')) return;
    try {
        const r = await fetch(API + '/api/comments/' + id, {
            method: 'DELETE',
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const container = document.getElementById('nc-wrap-' + noteId);
        await loadNoteComments(noteId, container);
    } catch(e) { alert('Lỗi: ' + e.message); }
}

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
// ============ INCIDENTS MANAGEMENT ============
let incidentsData = [];

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
                <td><button class="action-btn del" onclick="deleteIncident(${i.id})" title="Xóa">🗑️</button></td>
            </tr>
        `).join('');
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:#f85149;">Lỗi: ${e.message}</td></tr>`;
    }
}

function openIncidentDialog() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('inc-started').value = now.toISOString().slice(0,16);
    document.getElementById('inc-eta').value = '';
    document.getElementById('inc-resolved').value = '';
    document.getElementById('inc-note').value = '';
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
    
    try {
        const r = await fetch(API + '/api/incidents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({
                service, status,
                started_at: started.replace('T', ' ') + ':00',
                eta: eta ? eta.replace('T', ' ') + ':00' : null,
                resolved_at: resolved ? resolved.replace('T', ' ') + ':00' : null,
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