const API = 'https://airwatch.io.vn';
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
function handleAuthAction() { if (isAdmin()) logout(); else window.location.href = 'index.html'; }
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
        box.innerHTML = nodes.map(n => `<div class="node-row"><div class="node-info"><div class="node-name">${n.name || n.id || 'Node'}</div><div class="node-meta">${(n.lat||0).toFixed(4)}, ${(n.lng||0).toFixed(4)}</div></div><div class="node-status"><span class="status-dot ${status}"></span><span class="status-label ${status}">${status}</span></div><div class="node-last">${diffMin < 99999 ? diffMin + ' phút trước' : 'chưa có data'}</div><button class="node-delete" onclick="deleteNode('${n.id}', '${(n.name || n.id).replace(/'/g, "\\'")}')" title="Xóa node">🗑️</button></div>`).join('');
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

if (document.getElementById('chart-env')) connectWebSocket();