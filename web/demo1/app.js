const API = 'https://airwatch.io.vn';

const TERMS_VERSION = '1';

function checkTermsAgreement() {
    const agreed = localStorage.getItem('terms_agreed_version');
    if (agreed !== TERMS_VERSION) {
        showTermsModal();
        return false;
    }
    return true;
}
const dashCharts  = { env: null, volt: null, curr: null, pm: null, gas: null, co: null, minmax: null };
const debugCharts = { env: null, volt: null, curr: null, pm: null, gas: null, co: null, minmax: null };
function showTermsModal() {
    let overlay = document.getElementById('terms-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'terms-overlay';
        overlay.className = 'terms-overlay';
        overlay.innerHTML = `
            <div class="terms-modal">
                <h2>Điều khoản sử dụng</h2>
                <div class="terms-subtitle">Vui lòng đọc và đồng ý để tiếp tục sử dụng AirWatch</div>
                <div class="terms-content">
                    <p><strong>1. Mục đích:</strong> AirWatch cung cấp dữ liệu chất lượng không khí cho mục đích tham khảo và nghiên cứu. Dữ liệu được cung cấp "nguyên trạng", không đảm bảo chính xác tuyệt đối.</p>
                    <p><strong>2. Giới hạn trách nhiệm:</strong> Không sử dụng dữ liệu cho mục đích y tế, pháp lý, hoặc quyết định quan trọng ảnh hưởng đến tính mạng/tài sản.</p>
                    <p><strong>3. Tính khả dụng:</strong> Hệ thống có thể tạm ngưng để bảo trì, nâng cấp mà không báo trước.</p>
                    <p><strong>4. Quyền riêng tư:</strong> Chúng tôi ghi nhận IP, session, thời gian truy cập để vận hành hệ thống. Dữ liệu lưu cục bộ, không chia sẻ bên thứ 3.</p>
                    <p><strong>5. Quyền của bạn:</strong> Yêu cầu xóa dữ liệu cá nhân, ngừng sử dụng dịch vụ bất kỳ lúc nào.</p>
                    <p>Xem đầy đủ tại <a href="/terms" target="_blank">/terms</a>.</p>
                </div>
                <label class="terms-checkbox">
                    <input type="checkbox" id="terms-check">
                    <span>Tôi đã đọc và đồng ý với <strong>Điều khoản sử dụng</strong> của AirWatch</span>
                </label>
                <button id="terms-accept" class="terms-accept-btn" disabled>Tiếp tục</button>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('terms-check').onchange = (e) => {
            document.getElementById('terms-accept').disabled = !e.target.checked;
        };
        document.getElementById('terms-accept').onclick = acceptTerms;
    }
    overlay.style.display = 'flex';
}

function acceptTerms() {
    localStorage.setItem('terms_agreed_version', TERMS_VERSION);
    const overlay = document.getElementById('terms-overlay');
    if (overlay) overlay.style.display = 'none';
}

// ===== HELPERS (bị mất khi replace updateCards) =====
function getTextColor()   { return document.body.classList.contains('light') ? '#666'    : '#8899a6'; }
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

function baseOptions(t, c) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 1500, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
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

function downsample(d, m) {
    if (d.length <= m) return d;
    const s = (d.length - 1) / (m - 1);
    const o = [];
    for (let i = 0; i < m; i++) o.push(d[Math.round(i * s)]);
    return o;
}

function toPoints(a, k, sc) {
    sc = sc || 1;
    return a.map(d => {
        const v = d[k] !== undefined && d[k] !== null ? Number(d[k]) : null;
        return { x: tsToMs(d.ts), y: v !== null ? v * sc : null };
    });
}
// ============================================================
// INTENSITY THRESHOLDS — QCVN 05:2023/BTNMT
// ============================================================
const THRESHOLDS = {
    pm25: [
        { max: 25,  color: '#4CAF50', opacity: 0.35 },
        { max: 50,  color: '#8BC34A', opacity: 0.55 },
        { max: 80,  color: '#FF9800', opacity: 0.75 },
        { max: 150, color: '#F44336', opacity: 0.9 },
        { max: 250, color: '#9C27B0', opacity: 1.0, glow: true },
        { max: 500, color: '#7B1FA2', opacity: 1.0, glow: true, pulse: true }
    ],
    pm10: [
        { max: 50,  color: '#4CAF50', opacity: 0.35 },
        { max: 100, color: '#8BC34A', opacity: 0.55 },
        { max: 150, color: '#FF9800', opacity: 0.75 },
        { max: 250, color: '#F44336', opacity: 0.9 },
        { max: 350, color: '#9C27B0', opacity: 1.0, glow: true },
        { max: 500, color: '#7B1FA2', opacity: 1.0, glow: true, pulse: true }
    ],
    co: [
        { max: 4,   color: '#FF5722', opacity: 0.35 },
        { max: 8.7, color: '#FF7043', opacity: 0.55 },
        { max: 26,  color: '#FF9800', opacity: 0.75 },
        { max: 39,  color: '#F44336', opacity: 0.9 },
        { max: 52,  color: '#9C27B0', opacity: 1.0, glow: true },
        { max: 131, color: '#7B1FA2', opacity: 1.0, glow: true, pulse: true }
    ],
    voc_pct: [
        { max: 100, color: '#9C27B0', opacity: 0.35 },
        { max: 110, color: '#AB47BC', opacity: 0.55 },
        { max: 120, color: '#FF9800', opacity: 0.75 },
        { max: 150, color: '#F44336', opacity: 0.9, glow: true },
        { max: 999, color: '#7B1FA2', opacity: 1.0, glow: true, pulse: true }
    ],
    nox_pct: [
        { max: 100, color: '#00BCD4', opacity: 0.35 },
        { max: 110, color: '#26C6DA', opacity: 0.55 },
        { max: 120, color: '#FF9800', opacity: 0.75 },
        { max: 150, color: '#F44336', opacity: 0.9, glow: true },
        { max: 999, color: '#7B1FA2', opacity: 1.0, glow: true, pulse: true }
    ]
};

function getIntensity(value, param) {
    const list = THRESHOLDS[param];
    if (!list || value === null || value === undefined || isNaN(value)) {
        return { color: '#8899a6', opacity: 0.4, glow: false, pulse: false };
    }
    for (const t of list) {
        if (value <= t.max) return t;
    }
    return list[list.length - 1];
}

function hexToRgba(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${opacity})`;
}

function applyCardIntensity(id, value, param) {
    const el = document.getElementById(id);
    if (!el) return;
    const t = getIntensity(value, param);
    el.style.color = t.color;
    el.style.textShadow = t.glow ? `0 0 12px ${t.color}` : 'none';
    el.style.transition = 'color 0.3s, text-shadow 0.3s';
    const card = el.closest('.card');
    if (card) {
        card.style.borderColor = hexToRgba(t.color, t.opacity * 0.6);
        card.style.background = `linear-gradient(135deg, ${hexToRgba(t.color, 0.08)}, var(--bg-card))`;
        card.style.transition = 'border-color 0.3s, background 0.3s';
        if (t.pulse) card.style.animation = 'statusPulse 2s ease-in-out infinite';
        else card.style.animation = '';
    }
}

function makeValueGradient(ctx, param, yAxisId) {
    const chart = ctx.chart;
    const chartArea = chart.chartArea;
    if (!chartArea) return 'rgba(136,153,166,0.3)';
    const c = chart.ctx;
    const gradient = c.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    const list = THRESHOLDS[param];
    let yScale = yAxisId ? chart.scales[yAxisId] : null;
    if (!yScale) {
        const key = Object.keys(chart.scales).find(k => chart.scales[k].position);
        yScale = key ? chart.scales[key] : null;
    }
    const maxVal = (yScale && yScale.max) ? yScale.max : list[list.length - 1].max;
    list.forEach(t => {
        const ratio = Math.min(t.max / maxVal, 1);
        gradient.addColorStop(ratio, t.color);
    });
    return gradient;
}

// ============================================================
// HELPERS
// ============================================================
function fmtAgo(min) {
    if (min < 1) return 'vừa xong';
    if (min < 60) return min + ' phút trước';
    if (min < 1440) return Math.floor(min / 60) + ' giờ trước';
    const d = Math.floor(min / 1440);
    const h = Math.floor((min % 1440) / 60);
    return h > 0 ? d + 'd ' + h + 'h trước' : d + ' ngày trước';
}

const dashCharts  = { env: null, volt: null, curr: null, pm: null, gas: null, co: null };
const debugCharts = { env: null, volt: null, curr: null, pm: null, gas: null, co: null };
function getLocalDate() {
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 3600 * 1000));
    return vnTime.getUTCFullYear() + '-' +
           String(vnTime.getUTCMonth() + 1).padStart(2, '0') + '-' +
           String(vnTime.getUTCDate()).padStart(2, '0');
}

function tsToMs(ts) {
    if (!ts) return 0;
    return new Date(String(ts).replace(' ', 'T')).getTime();
}

// ============================================================
// INIT
// ============================================================
(async () => {
    await checkAuth();
    checkTermsAgreement();
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

    updateAQIFromServer();
    setInterval(updateAQIFromServer, 5 * 60 * 1000);
    if (document.getElementById('chart-env')) connectWebSocket();
})();

function toggleMenu(e) { e.stopPropagation(); const m = document.getElementById('dropdown-menu'); if (m) m.classList.toggle('open'); }
document.addEventListener('click', () => { const m = document.getElementById('dropdown-menu'); if (m) m.classList.remove('open'); });
function handleAuthAction() { if (isAdmin()) logout(); else window.location.href = '/'; }
function toggleTheme() { const isLight = document.body.classList.toggle('light'); localStorage.setItem('theme', isLight ? 'light' : 'dark'); updateThemeLabel(); const di = document.getElementById('date-picker'); if (di && di.value) loadByDate(); }
function applyTheme() { const s = localStorage.getItem('theme') || 'dark'; if (s === 'light') document.body.classList.add('light'); else document.body.classList.remove('light'); updateThemeLabel(); }
function updateThemeLabel() { const i = document.getElementById('theme-icon'), l = document.getElementById('theme-label'); if (!i || !l) return; if (document.body.classList.contains('light')) { i.textContent = '☀️'; l.textContent = 'Chế độ sáng'; } else { i.textContent = '🌙'; l.textContent = 'Chế độ tối'; } }

async function loadSystemData() {
    try {
        const r = await fetch(API + '/api/system', { headers: { 'X-Auth-Token': getToken() } });
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

// ============================================================
// AQI HELPERS
// ============================================================
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
const CO_BP = [[0,8.7,0,50],[8.7,26,51,100],[26,39,101,150],[39,52,151,200],[52,79,201,300],[79,131,301,500]];
function calcAQI(pm25, pm10, co) {
    return Math.max(
        calcSubIndex(pm25||0, PM25_BP),
        calcSubIndex(pm10||0, PM10_BP),
        calcSubIndex(co||0, CO_BP)
    );
}

// ============================================================
// AQI TỪ SERVER — Rolling 24h theo QĐ 1459
// ============================================================
async function updateAQIFromServer() {
    const aqiEl = document.getElementById('aqi');
    if (!aqiEl) return;
    try {
        const r = await fetch(API + '/api/aqi/current');
        const d = await r.json();
        const textEl = document.getElementById('aqi-text');
        const progress = document.getElementById('aqi-progress');
        const meta = document.getElementById('aqi-meta');

        if (!d.aqi) {
    aqiEl.textContent = '--';
    aqiEl.style.color = '#8899a6';
    
    if (textEl) {
        textEl.textContent = d.status === 'stale' ? 'Mất kết nối' : 'Đang thu thập';
        textEl.style.background = d.status === 'stale' ? '#f85149' : '#8899a6';
        textEl.style.color = '#fff';
    }
    
    if (progress) { 
        progress.style.strokeDashoffset = 565.48; 
        progress.style.stroke = d.status === 'stale' ? '#f85149' : '#8899a6'; 
    }
    
    if (meta) {
        if (d.status === 'stale') {
            meta.textContent = `⚠ ${d.message || 'Dữ liệu cũ'}`;
            meta.style.color = '#f85149';
        } else {
            meta.textContent = 'Chưa đủ dữ liệu 24h';
            meta.style.color = '';
        }
    }
    return;
}

        let color = d.aqi <= 50 ? '#4CAF50' : d.aqi <= 100 ? '#FFEB3B' :
                    d.aqi <= 150 ? '#FF9800' : d.aqi <= 200 ? '#F44336' :
                    d.aqi <= 300 ? '#9C27B0' : '#7B1FA2';

        aqiEl.textContent = d.aqi;
        aqiEl.style.color = color;
        if (textEl) {
            textEl.textContent = d.level;
            textEl.style.background = color;
            textEl.style.color = (color === '#FFEB3B') ? '#000' : '#fff';
        }
        if (progress) {
            const circ = 2 * Math.PI * 90;
            progress.style.strokeDashoffset = circ - (Math.min(d.aqi / 300, 1) * circ);
            progress.style.stroke = color;
        }
        if (meta && d.components) {
            const parts = [];
            if (d.components.pm25_avg != null) parts.push(`PM2.5 TB24h: ${d.components.pm25_avg.toFixed(1)} µg/m³`);
            if (d.components.pm10_avg != null) parts.push(`PM10 TB24h: ${d.components.pm10_avg.toFixed(1)} µg/m³`);
            if (d.components.co_avg != null) parts.push(`CO TB8h: ${d.components.co_avg.toFixed(2)} ppm`);
            let txt = parts.join(' · ');
            if (d.status === 'partial') txt += ` (${d.hours_count}/24h ⚠ đang cập nhật)`;
            meta.textContent = txt;
        }
    } catch(e) { console.error('[AQI]', e); }
}
function renderAQIBanner(aqi, level, metaText, idPrefix = '') {
    const $ = (id) => document.getElementById(idPrefix + id);
    const aqiEl = $('aqi');
    const textEl = $('aqi-text');
    const progress = $('aqi-progress');
    const meta = $('aqi-meta');
    if (!aqiEl) return;

    if (!aqi) {
        aqiEl.textContent = '--'; aqiEl.style.color = '#8899a6';
        if (textEl) { textEl.textContent = 'Đang thu thập'; textEl.style.background = '#8899a6'; }
        if (progress) { progress.style.strokeDashoffset = 565.48; progress.style.stroke = '#8899a6'; }
        if (meta) meta.textContent = metaText || 'Chưa đủ dữ liệu';
        return;
    }

    let color = aqi <= 50 ? '#4CAF50' : aqi <= 100 ? '#FFEB3B' :
                aqi <= 150 ? '#FF9800' : aqi <= 200 ? '#F44336' :
                aqi <= 300 ? '#9C27B0' : '#7B1FA2';

    aqiEl.textContent = aqi;
    aqiEl.style.color = color;
    if (textEl) {
        textEl.textContent = level;
        textEl.style.background = color;
        textEl.style.color = (color === '#FFEB3B') ? '#000' : '#fff';
    }
    if (progress) {
        const circ = 2 * Math.PI * 90;
        progress.style.strokeDashoffset = circ - (Math.min(aqi / 300, 1) * circ);
        progress.style.stroke = color;
    }
    if (meta) meta.textContent = metaText || '';
}

function updateAQIForDate(data, dateStr) {
    if (!data || !data.length) {
        renderAQIBanner(null, null, 'Không có dữ liệu ngày ' + dateStr);
        return;
    }
    const avg = (arr, k) => {
        const v = arr.map(r => r[k]).filter(x => x != null && x > 0 && !isNaN(x));
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    };
    const pm25 = avg(data, 'pm25');
    const pm10 = avg(data, 'pm10');
    const co = avg(data, 'co');
    const aqi = Math.max(calcSubIndex(pm25, PM25_BP), calcSubIndex(pm10, PM10_BP), calcSubIndex(co, CO_BP));
    const level = aqi <= 50 ? 'Tốt' : aqi <= 100 ? 'Trung bình' :
                  aqi <= 150 ? 'Kém' : aqi <= 200 ? 'Xấu' :
                  aqi <= 300 ? 'Rất xấu' : 'Nguy hại';
    const parts = [
        `PM2.5 TB: ${pm25.toFixed(1)} µg/m³`,
        `PM10 TB: ${pm10.toFixed(1)} µg/m³`,
        `CO TB: ${co.toFixed(2)} ppm`
    ];
    renderAQIBanner(aqi, level, parts.join(' · ') + ` (ngày ${dateStr}, ${data.length} điểm)`);
}

// ============================================================
// UPDATE CARDS
// ============================================================
function updateCards(data, idPrefix = '', chartCtx = dashCharts, cardPrefix = null) {
    const cp = cardPrefix !== null ? cardPrefix : idPrefix;
    const $ = (id) => document.getElementById(cp + id);

    if (!data.length) {
        if (!idPrefix) setStatus(false);
        ['temp','hum','volt','curr','pm1','pm25','pm10','co','voc_pct','nox_pct'].forEach(id => {
            const el = $(id);
            if (el) el.textContent = '--';
        });
        return;
    }
    const last = data[data.length - 1];

    const animateNumber = (id, nv, dec = 0, scale = 1) => {
        const el = $(id); if (!el) return;
        if (nv === undefined || nv === null) { el.textContent = '--'; return; }
        const target = nv * scale;
        const cur = el.textContent.replace(/[^0-9.-]+/g, '');
        const start = cur && !isNaN(parseFloat(cur)) ? parseFloat(cur) : 0;
        if (Math.abs(start - target) < 0.01) { el.textContent = target.toFixed(dec); return; }
        const st = performance.now(), dur = 800;
        el.style.transition = 'transform 0.3s';
        el.style.transform = 'scale(1.15)';
        el.style.display = 'inline-block';
        const upd = (ct) => {
            const prog = Math.min((ct - st) / dur, 1);
            const ease = 1 - Math.pow(1 - prog, 4);
            el.textContent = (start + (target - start) * ease).toFixed(dec);
            if (prog < 1) requestAnimationFrame(upd);
            else { el.textContent = target.toFixed(dec); el.style.transform = 'scale(1)'; }
        };
        requestAnimationFrame(upd);
    };

    animateNumber('temp', last.t, 2);
    animateNumber('hum', last.h, 2);
    animateNumber('volt', last.v, 3);
    animateNumber('curr', last.i, 2, 1000);
    animateNumber('pm1', last.pm1, 0);
    animateNumber('pm25', last.pm25, 0);
    animateNumber('pm10', last.pm10, 0);
    animateNumber('co', last.co, 2);
    animateNumber('voc_pct', last.voc_pct, 1);
    animateNumber('nox_pct', last.nox_pct, 1);
applyCardIntensity(cp + 'pm25', last.pm25, 'pm25');
applyCardIntensity(cp + 'pm10', last.pm10, 'pm10');
applyCardIntensity(cp + 'co', last.co, 'co');
applyCardIntensity(cp + 'voc_pct', last.voc_pct, 'voc_pct');
applyCardIntensity(cp + 'nox_pct', last.nox_pct, 'nox_pct');
    if (!idPrefix) {
        const u = document.getElementById('updated');
        if (u) u.textContent = last.ts;
    }
    renderGasChart(last.voc_pct, last.nox_pct, idPrefix, chartCtx);
    if (!idPrefix) setStatus(true);
}
// ============================================================
// CHART GAS
// ============================================================
function renderGasChart(vocPct, noxPct, idPrefix = '', chartCtx = dashCharts) {
    const canvas = document.getElementById(idPrefix + 'chart-gas');
    if (!canvas || typeof Chart === 'undefined') return;

    const vocI = getIntensity(vocPct || 100, 'voc_pct');
    const noxI = getIntensity(noxPct || 100, 'nox_pct');
    const v = (vocPct && vocPct > 0) ? vocPct : 100;
    const n = (noxPct && noxPct > 0) ? noxPct : 100;

    const bgColors = [hexToRgba(vocI.color, vocI.opacity), hexToRgba(noxI.color, noxI.opacity)];
    const borderColors = [vocI.color, noxI.color];

    if (chartCtx.gas) {
        chartCtx.gas.data.datasets[0].data = [parseFloat(v.toFixed(1)), parseFloat(n.toFixed(1))];
        chartCtx.gas.data.datasets[0].backgroundColor = bgColors;
        chartCtx.gas.data.datasets[0].borderColor = borderColors;
        chartCtx.gas.update();
    } else {
        chartCtx.gas = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: ['VOC (%)', 'NOx (%)'],
                datasets: [{
                    label: 'So với không khí sạch',
                    data: [parseFloat(v.toFixed(1)), parseFloat(n.toFixed(1))],
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: 2, borderRadius: 6, maxBarThickness: 60
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: { duration: 800 },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => ctx.parsed.y + '% so với nền' } }
                },
                scales: {
                    y: { beginAtZero: true, suggestedMax: 130, ticks: { color: getTextColor(), callback: (v) => v + '%' }, grid: { color: getGridColor() } },
                    x: { barPercentage: 0.5, categoryPercentage: 0.5, ticks: { color: getTextColor() }, grid: { display: false } }
                }
            }
        });
    }
}
// ============================================================
// CHART MIN/MAX (Voltage & Current)
// ============================================================
function renderMinMaxChart(d, idPrefix = '', chartCtx = dashCharts) {
    const canvas = document.getElementById(idPrefix + 'chart-minmax');
    if (!canvas || typeof Chart === 'undefined') return;

    const maxv = parseFloat(d.maxv) || 0;
    const minv = parseFloat(d.minv) || 0;
    const maxi = (parseFloat(d.maxi) || 0) * 1000;
    const mini = (parseFloat(d.mini) || 0) * 1000;

    if (chartCtx.minmax) chartCtx.minmax.destroy();

    chartCtx.minmax = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: ['Max V', 'Min V', 'Max I', 'Min I'],
            datasets: [
                {
                    label: 'Điện áp (V)',
                    data: [maxv, minv, null, null],
                    backgroundColor: ['rgba(255,152,0,0.6)', 'rgba(255,193,7,0.6)', null, null],
                    borderColor: ['#FF9800', '#FFC107', null, null],
                    borderWidth: 2, borderRadius: 6, maxBarThickness: 50,
                    yAxisID: 'yV'
                },
                {
                    label: 'Dòng điện (mA)',
                    data: [null, null, maxi, mini],
                    backgroundColor: [null, null, 'rgba(156,39,176,0.6)', 'rgba(33,150,243,0.6)'],
                    borderColor: [null, null, '#9C27B0', '#2196F3'],
                    borderWidth: 2, borderRadius: 6, maxBarThickness: 50,
                    yAxisID: 'yI'
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 800 },
            plugins: {
                legend: { labels: { color: getLegendColor() } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            if (ctx.parsed.y === null) return '';
                            const unit = ctx.dataset.yAxisID === 'yV' ? ' V' : ' mA';
                            return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(3) + unit;
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { color: getTextColor() }, grid: { display: false } },
                yV: {
                    position: 'left',
                    beginAtZero: true, min: 0, max: 6,
                    ticks: { color: '#FF9800', stepSize: 1, precision: 1 },
                    grid: { color: getGridColor() },
                    title: { display: true, text: 'Điện áp (V)', color: '#FF9800' }
                },
                yI: {
                    position: 'right',
                    beginAtZero: true, min: 0, max: 300,
                    ticks: { color: '#9C27B0', stepSize: 50, precision: 0 },
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'Dòng (mA)', color: '#9C27B0' }
                }
            }
        }
    });
}
// ============================================================
// CHART CO
// ============================================================
function renderCoChart(data, idPrefix = '', chartCtx = dashCharts) {
    const canvas = document.getElementById(idPrefix + 'chart-co');
    if (!canvas || typeof Chart === 'undefined') return;
    if (!data || !data.length) {
        if (chartCtx.co) { chartCtx.co.destroy(); chartCtx.co = null; }
        return;
    }
    const s = downsample(data, 80);
    if (chartCtx.co) chartCtx.co.destroy();
    chartCtx.co = new Chart(canvas, {
        type: 'line',
        data: { datasets: [{
            label: 'CO (ppm)',
            data: toPoints(s, 'co'),
            borderColor: (ctx) => makeValueGradient(ctx, 'co', 'y'),
            backgroundColor: (ctx) => makeValueGradient(ctx, 'co', 'y'),
            tension: 0, cubicInterpolationMode: 'monotone',
            pointRadius: 0, borderWidth: 2, fill: true
        }] },
        options: (() => { const o = baseOptions('CO (ppm)', '#FF5722'); o.scales.y.suggestedMax = 20; return o; })()
    });
}
// ============================================================
// RENDER ALL CHARTS
// ============================================================
function renderCharts(data, idPrefix = '', chartCtx = dashCharts) {
    const $ = (id) => document.getElementById(idPrefix + id);
    const envCanvas = $('chart-env');
    if (!envCanvas) return;

    if (!data.length) {
        ['env','pm','volt','curr','co'].forEach(k => {
            if (chartCtx[k]) { chartCtx[k].destroy(); chartCtx[k] = null; }
        });
        return;
    }

    const s = downsample(data, 80);

    // ==========================================
    // 1. CHART MÔI TRƯỜNG (NHIỆT ĐỘ & ĐỘ ẨM)
    // ==========================================
    if (chartCtx.env) chartCtx.env.destroy();
    chartCtx.env = new Chart(envCanvas, { 
        type: 'line', 
        data: { datasets: [
            { label: 'Nhiệt độ (°C)', data: toPoints(s, 't'), borderColor: '#f44336', backgroundColor: 'rgba(244,67,54,0.1)', tension: 0, pointRadius: 0, borderWidth: 2, yAxisID: 'y_temp' },
            { label: 'Độ ẩm (%)', data: toPoints(s, 'h'), borderColor: '#2196F3', backgroundColor: 'rgba(33,150,243,0.1)', tension: 0, pointRadius: 0, borderWidth: 2, yAxisID: 'y_hum' }
        ] }, 
        options: { 
            responsive: true, maintainAspectRatio: false, 
            interaction: { mode: 'index', intersect: false }, 
            plugins: { legend: { labels: { color: getLegendColor() } } }, 
            scales: { 
                x: timeScaleX(), 
                y_temp: { 
                    position: 'left', 
                    min: 15, max: 50,               // Fix cứng 15-50 độ
                    ticks: { color: '#f44336', stepSize: 5, precision: 0 }, // Bước nhảy 5 độ, số nguyên
                    grid: { color: getGridColor() }, 
                    title: { display: true, text: 'Nhiệt độ (°C)', color: '#f44336' } 
                }, 
                y_hum: { 
                    position: 'right', 
                    min: 0, max: 100,               // Fix cứng 0-100%
                    ticks: { color: '#2196F3', stepSize: 10, precision: 0 }, // Bước nhảy 10%, số nguyên
                    grid: { drawOnChartArea: false }, 
                    title: { display: true, text: 'Độ ẩm (%)', color: '#2196F3' } 
                } 
            } 
        } 
    });

    // ==========================================
    // 2. CHART BỤI MỊN (PM1, PM2.5, PM10)
    // ==========================================
    const pmCanvas = $('chart-pm');
    if (pmCanvas) {
        if (chartCtx.pm) chartCtx.pm.destroy();
        chartCtx.pm = new Chart(pmCanvas, { 
            type: 'line', 
            data: { datasets: [
                { label: 'PM1.0 (µg/m³)', data: toPoints(s, 'pm1'), borderColor: '#FFC107', backgroundColor: 'rgba(255,193,7,0.1)', tension: 0, pointRadius: 0, borderWidth: 2, yAxisID: 'y_pm' },
                { label: 'PM2.5 (µg/m³)', data: toPoints(s, 'pm25'), borderColor: '#FF5722', backgroundColor: 'rgba(255,87,34,0.1)', tension: 0, pointRadius: 0, borderWidth: 2, yAxisID: 'y_pm' },
                { label: 'PM10 (µg/m³)', data: toPoints(s, 'pm10'), borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.1)', tension: 0, pointRadius: 0, borderWidth: 2, yAxisID: 'y_pm' }
            ] }, 
            options: { 
                responsive: true, maintainAspectRatio: false, 
                interaction: { mode: 'index', intersect: false }, 
                plugins: { legend: { labels: { color: getLegendColor() } } }, 
                scales: { 
                    x: timeScaleX(), 
                    y_pm: { 
                        position: 'left', 
                        beginAtZero: true, min: 0,       // Bắt đầu từ 0
                        ticks: { color: '#FF5722', stepSize: 20, precision: 0 }, // Bước nhảy 20, số nguyên
                        grid: { color: getGridColor() }, 
                        title: { display: true, text: 'Bụi mịn (µg/m³)', color: '#FF5722' } 
                    } 
                } 
            } 
        });
    }

    // ==========================================
    // 3. CHART CO (NẾU CÓ)
    // ==========================================
    renderCoChart(data, idPrefix, chartCtx);

    // ==========================================
    // 4. CHART ĐIỆN ÁP & DÒNG ĐIỆN (CHỈ ADMIN)
    // ==========================================
    if (!isAdmin() && !idPrefix) return; // Debug tab thì luôn hiện

    const voltCanvas = $('chart-volt');
    if (voltCanvas) {
        if (chartCtx.volt) chartCtx.volt.destroy();
        chartCtx.volt = new Chart(voltCanvas, { 
            type: 'line', 
            data: { datasets: [{ label: 'Điện áp (V)', data: toPoints(s, 'v'), borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.1)', tension: 0, pointRadius: 0, borderWidth: 2, fill: true }] }, 
            options: (() => { 
                const o = baseOptions('Điện áp (V)', '#FF9800'); 
                o.scales.y.min = 0; 
                o.scales.y.max = 6;              // Nâng lên 6V cho dư dả (thay vì 3.6)
                o.scales.y.ticks.stepSize = 1; 
                o.scales.y.ticks.precision = 0;  // Số nguyên
                return o; 
            })() 
        });
    }

    const currCanvas = $('chart-curr');
    if (currCanvas) {
        if (chartCtx.curr) chartCtx.curr.destroy();
        chartCtx.curr = new Chart(currCanvas, { 
            type: 'line', 
            data: { datasets: [{ label: 'Dòng điện (mA)', data: toPoints(s, 'i', 1000), borderColor: '#9C27B0', backgroundColor: 'rgba(156,39,176,0.1)', tension: 0, pointRadius: 0, borderWidth: 2, fill: true }] }, 
            options: (() => { 
                const o = baseOptions('Dòng điện (mA)', '#9C27B0'); 
                o.scales.y.min = 0; 
                o.scales.y.max = 300;            // Peak tầm 200mA, set max 300mA cho đẹp
                o.scales.y.ticks.stepSize = 50; 
                o.scales.y.ticks.precision = 0;  // Số nguyên
                return o; 
            })() 
        });
    }
    renderMinMaxChart(data[data.length - 1] || {}, idPrefix, chartCtx);
}
// ============================================================
// LOAD DATA
// ============================================================
async function loadToday() {
    const t = getLocalDate();
    const di = document.getElementById('date-picker');
    if (di) di.value = t;
    const d = await fetchDataByDate(t);
    updateCards(d);
    renderCharts(d);
    updateAQIFromServer();
}

async function loadByDate() {
    const di = document.getElementById('date-picker');
    if (!di.value) { customNotify('Vui lòng chọn ngày', 'warn'); return; }
    const d = await fetchDataByDate(di.value);
    if (!d.length) {
        customNotify('Không có dữ liệu ngày ' + di.value, 'error');
        updateCards([]); renderCharts([]);
        renderAQIBanner(null, null, 'Không có dữ liệu ngày ' + di.value);
        return;
    }
    updateCards(d); renderCharts(d);

    const today = getLocalDate();
    if (di.value === today) {
        updateAQIFromServer();
    } else {
        updateAQIForDate(d, di.value);
    }

    const u = document.getElementById('updated');
    if (u) u.textContent = 'Xem ngày ' + di.value + ' (' + d.length + ' điểm)';
}
// ============================================================
// WEBSOCKET
// ============================================================
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

    if (d.t !== undefined) document.getElementById('temp') && (document.getElementById('temp').textContent = d.t.toFixed(2));
    if (d.h !== undefined) document.getElementById('hum') && (document.getElementById('hum').textContent = d.h.toFixed(2));
    if (d.v !== undefined) document.getElementById('volt') && (document.getElementById('volt').textContent = d.v.toFixed(3));
    if (d.i !== undefined) document.getElementById('curr') && (document.getElementById('curr').textContent = (d.i * 1000).toFixed(2));
    if (d.pm1 !== undefined) document.getElementById('pm1') && (document.getElementById('pm1').textContent = d.pm1);
    if (d.pm25 !== undefined) document.getElementById('pm25') && (document.getElementById('pm25').textContent = d.pm25);
    if (d.pm10 !== undefined) document.getElementById('pm10') && (document.getElementById('pm10').textContent = d.pm10);

    if (d.voc_pct !== undefined) {
        const el = document.getElementById('voc_pct');
        if (el) {
            el.textContent = Number(d.voc_pct).toFixed(1);
            const t = getIntensity(d.voc_pct, 'voc_pct');
            el.style.color = t.color;
            el.style.textShadow = t.glow ? `0 0 12px ${t.color}` : 'none';
        }
    }
    if (d.nox_pct !== undefined) {
        const el = document.getElementById('nox_pct');
        if (el) {
            el.textContent = Number(d.nox_pct).toFixed(1);
            const t = getIntensity(d.nox_pct, 'nox_pct');
            el.style.color = t.color;
            el.style.textShadow = t.glow ? `0 0 12px ${t.color}` : 'none';
        }
    }

    const u = document.getElementById('updated'); if (u) u.textContent = new Date().toLocaleString('vi-VN');
    renderGasChart(d.voc_pct, d.nox_pct);
    setStatus(true);
    addPointToCharts(d);
}

function addPointToCharts(d) {
    const now = Date.now();
    if (dashCharts.env) { dashCharts.env.data.datasets[0].data.push({ x: now, y: d.t }); dashCharts.env.data.datasets[1].data.push({ x: now, y: d.h }); if (dashCharts.env.data.datasets[0].data.length > 200) dashCharts.env.data.datasets.forEach(ds => ds.data.shift()); dashCharts.env.update(); }
    if (dashCharts.pm) { dashCharts.pm.data.datasets[0].data.push({ x: now, y: d.pm1 || 0 }); dashCharts.pm.data.datasets[1].data.push({ x: now, y: d.pm25 || 0 }); dashCharts.pm.data.datasets[2].data.push({ x: now, y: d.pm10 || 0 }); if (dashCharts.pm.data.datasets[0].data.length > 200) dashCharts.pm.data.datasets.forEach(ds => ds.data.shift()); dashCharts.pm.update(); }
    if (dashCharts.co && d.co !== undefined) { dashCharts.co.data.datasets[0].data.push({ x: now, y: d.co }); if (dashCharts.co.data.datasets[0].data.length > 200) dashCharts.co.data.datasets[0].data.shift(); dashCharts.co.update(); }
    if (!isAdmin()) return;
    if (dashCharts.volt) { dashCharts.volt.data.datasets[0].data.push({ x: now, y: d.v }); if (dashCharts.volt.data.datasets[0].data.length > 200) dashCharts.volt.data.datasets[0].data.shift(); dashCharts.volt.update(); }
    if (dashCharts.curr) { dashCharts.curr.data.datasets[0].data.push({ x: now, y: d.i * 1000 }); if (dashCharts.curr.data.datasets[0].data.length > 200) dashCharts.curr.data.datasets[0].data.shift(); dashCharts.curr.update(); }
}
setInterval(async () => {
    const di = document.getElementById('date-picker');
    const t = getLocalDate();
    if (!di || di.value === t) {
        const d = await fetchDataByDate(t);
        updateCards(d);
        if (document.getElementById('chart-env')) renderCharts(d);
    }
}, 60000);

// ============================================================
// MANUAL STATUS
// ============================================================
const STATUS_ICONS = { node: '🔌 NODE', gate: '📡 GATEWAY', server: '🖥️ SERVER' };
const PRESET_NOTES = { working: 'Hoạt động bình thường', debug: 'Đang debug', attach: 'Đang gắn module/sensor', testing: 'Đang chạy test', maintenance: 'Đang bảo trì', offline: 'Tạm tắt' };

function applyPreset(status) {
    document.getElementById('sel-status').value = status;
    const n = document.getElementById('inp-note'); if (!n.value.trim()) n.value = PRESET_NOTES[status] || '';
    document.querySelectorAll('.preset-btn').forEach(b => b.style.opacity = '0.5');
    const btn = document.querySelector(`.preset-btn.${status}`); if (btn) btn.style.opacity = '1';
    updateServiceStatus();
}

// ============================================================
// MAP + NODES
// ============================================================
let adminMap = null, adminMarkers = [];
const VIETMAP_KEY = '75950d796c1f4a611133660d2ec48258174fc8279da00348';

function initNodesMap() {
    const el = document.getElementById('nodes-map');
    if (!el || typeof L === 'undefined') return;
    if (adminMap) { setTimeout(() => adminMap.invalidateSize(), 100); return; }
    adminMap = L.map('nodes-map').setView([16.0, 106.5], 5);
    window.adminMap = adminMap;
    L.tileLayer('https://maps.vietmap.vn/maps/tiles/st/{z}/{x}/{y}.png?apikey=' + VIETMAP_KEY, { attribution: '© VietMap', maxZoom: 19 }).addTo(adminMap);
    adminMap.on('click', (e) => {
        const lat = e.latlng.lat.toFixed(6), lng = e.latlng.lng.toFixed(6);
        document.getElementById('node-lat').value = lat;
        document.getElementById('node-lng').value = lng;
        if (window._tempMarker) adminMap.removeLayer(window._tempMarker);
        window._tempMarker = L.circleMarker([lat, lng], { radius: 8, fillColor: '#58a6ff', color: '#fff', weight: 2, fillOpacity: 0.9 }).addTo(adminMap).bindPopup('📍 ' + lat + ', ' + lng).openPopup();
    });
    setTimeout(() => adminMap.invalidateSize(), 200);
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
            const m = L.circleMarker([n.lat, n.lng], { radius: 9, fillColor: '#4CAF50', color: '#fff', weight: 2, fillOpacity: 0.9 }).addTo(adminMap).bindPopup('<strong>' + escapeHtml(n.name || n.id) + '</strong><br><small>' + n.lat.toFixed(4) + ', ' + n.lng.toFixed(4) + '</small>');
            adminMarkers.push(m);
        });
    } catch(e) { console.error('[MAP]', e); }
}

async function addNode() {
    const id = document.getElementById('node-id').value.trim();
    const name = document.getElementById('node-name').value.trim();
    const lat = document.getElementById('node-lat').value.trim();
    const lng = document.getElementById('node-lng').value.trim();
    if (!id || !name || !lat || !lng) { customNotify('Vui lòng điền đầy đủ + click bản đồ', 'warn'); return; }
    try {
        const r = await fetch(API + '/api/nodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ id, name, lat: parseFloat(lat), lng: parseFloat(lng) })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        customNotify('Đã thêm node ' + name, 'success');
        document.getElementById('node-id').value = '';
        document.getElementById('node-name').value = '';
        document.getElementById('node-lat').value = '';
        document.getElementById('node-lng').value = '';
        if (window._tempMarker) { adminMap.removeLayer(window._tempMarker); window._tempMarker = null; }
        loadNodesOnMap();
        loadNodes();
    } catch(e) { customNotify('Thêm node thất bại: ' + e.message, 'error'); }
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
        box.innerHTML = nodes.map(n => `<div class="node-row"><div class="node-info"><div class="node-name">${escapeHtml(n.name || n.id || 'Node')}</div><div class="node-meta">${(n.lat||0).toFixed(4)}, ${(n.lng||0).toFixed(4)}</div></div><div class="node-status"><span class="status-dot ${status}"></span><span class="status-label ${status}">${status}</span></div><div class="node-last">${diffMin < 99999 ? fmtAgo(diffMin) : 'chưa có data'}</div><button class="node-delete" onclick="deleteNode('${n.id}', '${(n.name || n.id).replace(/'/g, "\\'")}')" title="Xóa node">🗑️</button></div>`).join('');
        const u = document.getElementById('updated'); if (u) u.textContent = new Date().toLocaleTimeString('vi-VN');
    } catch(e) { box.innerHTML = '<div style="color:#f85149; padding:20px;">Lỗi load node: ' + e.message + '</div>'; }
}

async function deleteNode(id, name) {
    if (!await customConfirm(`Xóa node "${name}" (ID: ${id})?\n\nHành động này không thể hoàn tác.`)) return;
    try {
        const r = await fetch(API + '/api/nodes/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        loadNodes();
        loadNodesOnMap();
    } catch(e) { customNotify('Xóa thất bại: ' + e.message, 'error'); }
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
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ service, status, note })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        document.getElementById('inp-note').value = '';
        await loadServiceStatus();
    } catch(e) { customNotify('Cập nhật thất bại: ' + e.message, 'error'); }
}

async function updateAllServices() {
    const status = document.getElementById('sel-status').value;
    const note = document.getElementById('inp-note').value.trim();
    const services = ['node', 'gate', 'server'];
    if (!(await customConfirm('Áp dụng trạng thái "' + status + '" cho TẤT CẢ service?\n\n' + services.join(', ')))) return;
    try {
        for (const svc of services) {
            await fetch(API + '/api/set-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
                body: JSON.stringify({ service: svc, status, note })
            });
        }
        document.getElementById('inp-note').value = '';
        await loadServiceStatus();
    } catch(e) { customNotify('Lỗi: ' + e.message, 'error'); }
}

if (document.getElementById('tab-status')) {
    loadNodes();
    loadServiceStatus();
    setInterval(loadServiceStatus, 10000);
    setInterval(loadNodes, 30000);
}

async function logAction(action, target, details, severity) {
    try {
        await fetch(API + '/api/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ action, target: target || '', details: details || '', severity: severity || 'info', author: 'phuyy' })
        });
    } catch(e) { console.warn('[LOG]', e); }
}

// ============================================================
// DEBUG DASHBOARD
// ============================================================
const DEBUG_FIELDS = ['t','h','v','i','pm1','pm25','pm10','co','voc','nox','voc_pct','nox_pct','sgp_ok'];
const FIELD_RULES = {
    t:     { min: -10, max: 60,   label: 'Nhiệt độ' },
    h:     { min: 0,   max: 100,  label: 'Độ ẩm' },
    v:     { min: 1.5, max: 5.0,  label: 'Điện áp' },
    i:     { min: -1,  max: 2.0,  label: 'Dòng điện' },
    pm1:   { min: 0,   max: 500,  label: 'PM1.0' },
    pm25:  { min: 0,   max: 500,  label: 'PM2.5' },
    pm10:  { min: 0,   max: 1000, label: 'PM10' },
    co:    { min: 0,   max: 200,  label: 'CO' },
    voc:   { min: 0,   max: 65535,label: 'VOC' },
    nox:   { min: 0,   max: 65535,label: 'NOx' },
    voc_pct: { min: 0, max: 999,  label: 'VOC %' },
    nox_pct: { min: 0, max: 999,  label: 'NOx %' }
};

let debugData = [];
let debugPage = 1;
let debugTotal = 0;
let debugTotalPages = 1;
const DEBUG_LIMIT = 1000;

let debugFiltered = [];
let editingId = null;
let selectedRows = new Set();
let dbgChartEnv = null, dbgChartPm = null, dbgChartGas = null, dbgChartCo = null, dbgChartPower = null;
let presetsList = [];

function validateField(name) {
    const rule = FIELD_RULES[name];
    if (!rule) return true;
    const el = document.getElementById('dbg-' + name);
    const err = document.getElementById('err-' + name);
    if (!el || !err) return true;
    const raw = el.value.trim();
    if (raw === '') { el.classList.remove('invalid'); err.textContent = ''; return true; }
    const val = parseFloat(raw);
    if (isNaN(val)) { el.classList.add('invalid'); err.textContent = 'Không phải số'; return false; }
    if (val < rule.min || val > rule.max) { el.classList.add('invalid'); err.textContent = `Phải từ ${rule.min} đến ${rule.max}`; return false; }
    el.classList.remove('invalid');
    err.textContent = '';
    return true;
}

function validateAllFields() {
    let ok = true;
    Object.keys(FIELD_RULES).forEach(f => { if (!validateField(f)) ok = false; });
    return ok;
}

function resetDebugForm() {
    editingId = null;
    DEBUG_FIELDS.forEach(f => { const el = document.getElementById('dbg-' + f); if (el) el.value = ''; });
    const sgp = document.getElementById('dbg-sgp'); if (sgp) sgp.value = '0';
    const tt = document.getElementById('dbg-test-type'); if (tt) tt.value = 'manual';
    const note = document.getElementById('dbg-note'); if (note) note.value = '';
    Object.keys(FIELD_RULES).forEach(f => {
        const err = document.getElementById('err-' + f); if (err) err.textContent = '';
        const el = document.getElementById('dbg-' + f); if (el) el.classList.remove('invalid');
    });
    document.getElementById('dbg-form-mode').innerHTML = 'Mode: <strong>INSERT</strong> (id trống)';
    document.getElementById('btn-save-debug').textContent = '💾 Save (Insert)';
    document.getElementById('btn-cancel-edit').style.display = 'none';
    document.querySelectorAll('.debug-table tbody tr').forEach(tr => tr.classList.remove('edit-mode'));
}

function cancelEditMode() { resetDebugForm(); }

async function loadDebugData(page) {
    if (page !== undefined) debugPage = page;
    if (debugPage < 1) debugPage = 1;
    const tbody = document.getElementById('debug-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="20" style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải...</td></tr>';
    try {
        const r = await fetch(API + '/api/debug/data?page=' + debugPage + '&limit=' + DEBUG_LIMIT, { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const resp = await r.json();
        if (Array.isArray(resp)) {
            debugData = resp;
            debugTotal = resp.length;
            debugTotalPages = 1;
        } else {
            debugData = resp.rows || [];
            debugTotal = resp.total || 0;
            debugTotalPages = resp.totalPages || 1;
            debugPage = resp.page || 1;
        }
        if (!debugData.length && debugPage > 1) { debugPage = debugTotalPages; return loadDebugData(debugPage); }
        applyDebugFilter();
        renderDebugDashboard(debugData);
        renderDebugPagination();
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="20" style="text-align:center; padding:20px; color:#f85149;">Lỗi: ' + e.message + '</td></tr>';
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
    if (countEl) {
        const shown = debugFiltered.length;
        countEl.textContent = `Hiển thị ${shown.toLocaleString('vi-VN')} / ${debugTotal.toLocaleString('vi-VN')} records (trang ${debugPage}/${debugTotalPages})`;
    }
    if (!debugFiltered.length) {
        tbody.innerHTML = '<tr><td colspan="20" style="text-align:center; padding:20px; color:var(--text-muted);">Chưa có record. Dùng form trên hoặc Simulate để tạo.</td></tr>';
        return;
    }
    tbody.innerHTML = debugFiltered.map((d, idx) => {
        const stt = debugTotal - ((debugPage - 1) * DEBUG_LIMIT + idx);
        const checked = selectedRows.has(d.id) ? 'checked' : '';
        const selClass = selectedRows.has(d.id) ? 'selected' : '';
        const editClass = editingId === d.id ? 'edit-mode' : '';
        const type = d.test_type || 'manual';
        return `<tr class="${selClass} ${editClass}" data-id="${d.id}">
            <td><input type="checkbox" ${checked} onchange="toggleSelectRow(${d.id}, this.checked)"></td>
            <td>${stt}</td>
            <td>${d.ts || '--'}</td>
            <td>${(d.t||0).toFixed(2)}</td>
            <td>${(d.h||0).toFixed(1)}</td>
            <td>${(d.v||0).toFixed(3)}</td>
            <td>${(d.i||0).toFixed(3)}</td>
            <td>${d.pm1||0}</td>
            <td>${d.pm25||0}</td>
            <td>${d.pm10||0}</td>
            <td>${(d.co||0).toFixed(2)}</td>
            <td>${d.voc||0}</td>
            <td>${d.nox||0}</td>
            <td>${(d.voc_pct||0).toFixed(1)}</td>
            <td>${(d.nox_pct||0).toFixed(1)}</td>
            <td>${d.sgp_ok||0}</td>
            <td><span class="type-badge ${type}">${type}</span></td>
            <td title="${(d.note||'').replace(/"/g,'&quot;')}" style="max-width:180px; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(d.note||'—')}</td>
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
}

// ============================================================
// PRESETS
// ============================================================
async function loadPresets() {
    try {
        const r = await fetch(API + '/api/debug/presets', { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        presetsList = await r.json();
        const sel = document.getElementById('dbg-preset-select');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">-- Chọn preset --</option>' + presetsList.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
        if (current) sel.value = current;
    } catch(e) { console.error('[PRESETS]', e); }
}

function loadPreset() {
    const sel = document.getElementById('dbg-preset-select');
    if (!sel || !sel.value) return;
    const preset = presetsList.find(p => String(p.id) === sel.value);
    if (!preset) return;
    try {
        const vals = JSON.parse(preset.values_json);
        DEBUG_FIELDS.forEach(f => { const el = document.getElementById('dbg-' + f); if (el && vals[f] !== undefined) el.value = vals[f]; });
        const sgp = document.getElementById('dbg-sgp'); if (sgp && vals.sgp_ok !== undefined) sgp.value = vals.sgp_ok;
        const note = document.getElementById('dbg-note');
        if (note) note.value = 'Preset: ' + preset.name + (preset.description ? ' — ' + preset.description : '');
        const tt = document.getElementById('dbg-test-type');
        if (tt) tt.value = preset.name.toLowerCase().includes('edge') ? 'edge' : 'custom';
    } catch(e) { customNotify('Preset bị lỗi JSON: ' + e.message, 'error'); }
}

async function savePreset() {
    const name = prompt('Tên preset mới:');
    if (!name || !name.trim()) return;
    const desc = prompt('Mô tả (tùy chọn):') || '';
    const vals = {};
    DEBUG_FIELDS.forEach(f => { const el = document.getElementById('dbg-' + f); if (el && el.value.trim() !== '') vals[f] = parseFloat(el.value); });
    const sgp = document.getElementById('dbg-sgp'); if (sgp) vals.sgp_ok = parseInt(sgp.value) || 0;
    try {
        const r = await fetch(API + '/api/debug/presets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ name: name.trim(), description: desc.trim(), values_json: JSON.stringify(vals) })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('preset_created', 'preset:' + name.trim(), desc, 'info');
        await loadPresets();
    } catch(e) { customNotify('Tạo preset thất bại: ' + e.message, 'error'); }
}

async function updateCurrentPreset() {
    const sel = document.getElementById('dbg-preset-select');
    if (!sel || !sel.value) { customNotify('Chọn 1 preset trước', 'warn'); return; }
    const preset = presetsList.find(p => String(p.id) === sel.value);
    if (!preset) return;
    if (!(await customConfirm('Cập nhật preset "' + preset.name + '" bằng giá trị form hiện tại?'))) return;
    const vals = {};
    DEBUG_FIELDS.forEach(f => { const el = document.getElementById('dbg-' + f); if (el && el.value.trim() !== '') vals[f] = parseFloat(el.value); });
    const sgp = document.getElementById('dbg-sgp'); if (sgp) vals.sgp_ok = parseInt(sgp.value) || 0;
    try {
        const r = await fetch(API + '/api/debug/presets/' + preset.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ values_json: JSON.stringify(vals) })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('preset_updated', 'preset:' + preset.name, 'Update từ form', 'info');
        await loadPresets();
    } catch(e) { customNotify('Cập nhật thất bại: ' + e.message, 'error'); }
}

async function deleteCurrentPreset() {
    const sel = document.getElementById('dbg-preset-select');
    if (!sel || !sel.value) { customNotify('Chọn 1 preset trước', 'warn'); return; }
    const preset = presetsList.find(p => String(p.id) === sel.value);
    if (!preset) return;
    if (!(await customConfirm('Xóa preset "' + preset.name + '"?'))) return;
    try {
        const r = await fetch(API + '/api/debug/presets/' + preset.id, { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('preset_deleted', 'preset:' + preset.name, '', 'warn');
        await loadPresets();
    } catch(e) { customNotify('Xóa thất bại: ' + e.message, 'error'); }
}

// ============================================================
// CLONE FROM SENSOR
// ============================================================
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
        sensorCache = sensorCache.slice().reverse();
        renderSensorList(sensorCache);
    } catch(e) { list.innerHTML = '<div style="text-align:center; padding:20px; color:#f85149;">Lỗi: ' + e.message + '</div>'; }
}

function closeCloneDialog() { const dlg = document.getElementById('clone-dialog'); if (dlg) dlg.style.display = 'none'; }

function renderSensorList(list) {
    const box = document.getElementById('clone-sensor-list');
    if (!box) return;
    if (!list.length) { box.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Không có sensor nào.</div>'; return; }
    box.innerHTML = list.map(s => `
        <div class="clone-item" onclick="cloneSensor(${s.id})">
            <div class="clone-item-id">#${s.id}</div>
            <div class="clone-item-info">T=${(s.t||0).toFixed(2)}°C · H=${(s.h||0).toFixed(1)}% · PM2.5=${s.pm25||0} · V=${(s.v||0).toFixed(3)}V</div>
            <div class="clone-item-ts">${escapeHtml(s.ts || '--')}</div>
        </div>
    `).join('');
}

function filterSensorList() {
    const q = (document.getElementById('clone-search')?.value || '').trim().toLowerCase();
    if (!q) { renderSensorList(sensorCache); return; }
    renderSensorList(sensorCache.filter(s => String(s.id).includes(q) || (s.ts || '').toLowerCase().includes(q)));
}

async function cloneSensor(sensorId) {
    if (!(await customConfirm('Clone sensor #' + sensorId + ' sang Debug DB?'))) return;
    try {
        const r = await fetch(API + '/api/debug/clone/' + sensorId, { method: 'POST', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('debug_cloned', 'sensor#' + sensorId, 'Clone từ sensor thật', 'info');
        closeCloneDialog();
        await loadDebugData();
    } catch(e) { customNotify('Clone thất bại: ' + e.message, 'error'); }
}

// ============================================================
// SIMULATE
// ============================================================
async function simulatePackets(edge) {
    const countEl = document.getElementById('dbg-sim-count');
    const count = parseInt(countEl?.value) || 10;
    if (count < 1 || count > 50000) { customNotify('Số lượng phải từ 1 đến 50,000', 'warn'); return; }
    if (!(await customConfirm('Simulate ' + count.toLocaleString('vi-VN') + ' packets' + (edge ? ' (có edge cases)' : '') + '?'))) return;
    try {
        const r = await fetch(API + '/api/debug/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ count, edge })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('debug_simulated', 'sensor_debug', 'Simulate ' + count + ' packets' + (edge ? ' (edge)' : ''), 'info');
        await loadDebugData();
    } catch(e) { if (e.message !== 'Đã hủy') customNotify('Simulate thất bại: ' + e.message, 'error'); }
}

if (document.getElementById('tab-debug')) {
    setTimeout(() => { if (typeof loadPresets === 'function') loadPresets(); }, 300);
}

function filterDebugTable() { applyDebugFilter(); }

function toggleSelectRow(id, checked) { if (checked) selectedRows.add(id); else selectedRows.delete(id); renderDebugTable(); }
function toggleSelectAll(checked) { selectedRows.clear(); if (checked) debugFiltered.forEach(d => selectedRows.add(d.id)); renderDebugTable(); }

async function saveDebugRecord() {
    if (!validateAllFields()) { customNotify('Có field không hợp lệ. Sửa trước khi lưu.', 'warn'); return; }
    const payload = {};
    DEBUG_FIELDS.forEach(f => { const el = document.getElementById('dbg-' + f); if (el && el.value.trim() !== '') payload[f] = parseFloat(el.value); });
    const sgp = document.getElementById('dbg-sgp'); if (sgp) payload.sgp_ok = parseInt(sgp.value) || 0;
    const note = document.getElementById('dbg-note'); if (note) payload.note = note.value.trim();
    const tt = document.getElementById('dbg-test-type'); if (tt) payload.test_type = tt.value;
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
        logAction(isEdit ? 'debug_updated' : 'debug_created', 'sensor_debug#' + (editingId || 'new'), (isEdit ? 'Sửa' : 'Tạo') + ' record: ' + (note?.value || ''), 'info');
        resetDebugForm();
        await loadDebugData();
    } catch(e) { customNotify('Lưu thất bại: ' + e.message, 'error'); }
}

function editDebugRecord(id) {
    const d = debugData.find(x => x.id === id);
    if (!d) return;
    editingId = id;
    DEBUG_FIELDS.forEach(f => { const el = document.getElementById('dbg-' + f); if (el) el.value = d[f] !== undefined && d[f] !== null ? d[f] : ''; });
    const sgp = document.getElementById('dbg-sgp'); if (sgp) sgp.value = d.sgp_ok || 0;
    const tt = document.getElementById('dbg-test-type'); if (tt) tt.value = d.test_type || 'manual';
    const note = document.getElementById('dbg-note'); if (note) note.value = d.note || '';
    document.getElementById('dbg-form-mode').innerHTML = 'Mode: <strong>UPDATE</strong> #' + id;
    document.getElementById('btn-save-debug').textContent = '💾 Update #' + id;
    document.getElementById('btn-cancel-edit').style.display = '';
    renderDebugTable();
    document.getElementById('dbg-t').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function deleteDebugRecord(id) {
    if (!(await customConfirm('Xóa record #' + id + '?'))) return;
    try {
        const r = await fetch(API + '/api/debug/data/' + id, { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('debug_deleted', 'sensor_debug#' + id, 'Xóa record', 'warn');
        selectedRows.delete(id);
        if (editingId === id) resetDebugForm();
        await loadDebugData();
    } catch(e) { customNotify('Xóa thất bại: ' + e.message, 'error'); }
}

async function deleteSelectedDebug() {
    if (selectedRows.size === 0) return;
    
    const isAll = selectedRows.size >= debugTotal * 0.99;
    const ids = Array.from(selectedRows);
    
    let confirmMsg;
    if (isAll) {
        confirmMsg = `Đã chọn TẤT CẢ ${ids.length.toLocaleString('vi-VN')} records.\n\nXóa hết và reset ID về 1?`;
    } else {
        confirmMsg = `Xóa ${ids.length.toLocaleString('vi-VN')} records đã chọn?\n\nID các records PHÍA SAU sẽ được đánh lại liên tục.`;
    }
    
    if (!(await customConfirm(confirmMsg))) return;
    
    try {
        let r;
        if (isAll) {
            r = await fetch(API + '/api/debug/data', {
                method: 'DELETE',
                headers: { 'X-Auth-Token': getToken() }
            });
        } else {
            r = await fetch(API + '/api/debug/bulk-delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
                body: JSON.stringify({ ids })
            });
        }
        
        let d = {};
        try { d = await r.json(); } catch(_) {}
        
        if (!r.ok) {
            throw new Error(d.error || ('HTTP ' + r.status));
        }
        
        const deleted = (typeof d.deleted === 'number') ? d.deleted : ids.length;
        const remaining = (typeof d.remaining === 'number') ? d.remaining : 0;
        const maxId = (typeof d.max_id === 'number') ? d.max_id : 0;
        
        logAction('debug_deleted', 'bulk', 'Xóa ' + ids.length + ' records', 'warn');
        selectedRows.clear();
        await loadDebugData(1);
        
        let msg;
        if (isAll) {
            msg = `Đã xóa hết ${deleted.toLocaleString('vi-VN')} records. ID reset về 1.`;
        } else {
            msg = `Đã xóa ${deleted.toLocaleString('vi-VN')} records. Còn ${remaining.toLocaleString('vi-VN')} records (ID 1-${maxId}).`;
        }
        customNotify(msg, 'success');
    } catch(e) {
        customNotify('Xóa thất bại: ' + (e.message || 'Lỗi không xác định'), 'error');
        try { await loadDebugData(1); } catch(_) {}
    }
}

async function clearDebugData() {
    if (!(await customConfirm('XÓA TOÀN BỘ record trong Debug DB?\n\nHành động không thể hoàn tác.'))) return;
    if (!(await customConfirm('Xác nhận lần 2: XÓA HẾT?'))) return;
    try {
        const r = await fetchWithTOTP(API + '/api/debug/data', { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('debug_cleared', 'sensor_debug', 'Clear toàn bộ debug DB', 'warn');
        selectedRows.clear();
        resetDebugForm();
        await loadDebugData();
    } catch(e) { if (e.message !== 'Đã hủy') customNotify('Clear thất bại: ' + e.message, 'error'); }
}

async function restoreDebugRecord(id) {
    if (!(await customConfirm('Restore record #' + id + ' về original_data?'))) return;
    try {
        const r = await fetch(API + '/api/debug/restore/' + id, { method: 'POST', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('debug_restored', 'sensor_debug#' + id, 'Restore về original_data', 'warn');
        await loadDebugData();
    } catch(e) { customNotify('Restore thất bại: ' + e.message, 'error'); }
}

function renderDebugDashboard(data) {
    if (!data || !data.length) {
        updateCards([], 'dbg-', debugCharts);
        renderCharts([], 'dbg-', debugCharts);
        renderAQIBanner(null, null, 'Chưa có record', 'dbg-');
        return;
    }
    // debugData là DESC → reverse để dashboard hiểu (ASC)
    const ascData = data.slice().reverse();
    updateCards(ascData, 'dbg-', debugCharts, 'dbg-card-');
    renderCharts(ascData, 'dbg-', debugCharts);

    // AQI preview tính từ record mới nhất
    const last = data[0];
    const aqi = calcAQI(last.pm25 || 0, last.pm10 || 0, last.co || 0);
    const level = aqi <= 50 ? 'Tốt' : aqi <= 100 ? 'Trung bình' :
                  aqi <= 150 ? 'Kém' : aqi <= 200 ? 'Xấu' :
                  aqi <= 300 ? 'Rất xấu' : 'Nguy hại';
    renderAQIBanner(aqi, level, `Tính từ record #${last.id} (1 điểm)`, 'dbg-');
}

// ============================================================
// LOG TAB
// ============================================================
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
    } catch(e) { box.innerHTML = '<div style="text-align:center; padding:40px; color:#f85149;">Lỗi: ' + e.message + '</div>'; }
}

function renderLogs() {
    const box = document.getElementById('log-list');
    const count = document.getElementById('log-count');
    if (!box) return;
    if (count) count.textContent = logsFiltered.length + ' logs';
    if (!logsFiltered.length) { box.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Chưa có log nào.</div>'; return; }
    const sevIcon = { info: 'ℹ️', warn: '⚠️', error: '🔴' };
    box.innerHTML = logsFiltered.map(l => `
        <div class="log-entry severity-${l.severity || 'info'}">
            <div class="log-header">
                <div>
                    <span class="log-action">${escapeHtml(l.action)}</span>
                    <span class="log-severity-badge ${l.severity || 'info'}">${sevIcon[l.severity] || ''} ${l.severity || 'info'}</span>
                </div>
                <button class="log-delete-btn" onclick="deleteLog(${l.id})" title="Xóa log">🗑️</button>
            </div>
            <div class="log-meta">
                <span>🕐 ${l.ts || '--'}</span>
                <span>👤 ${l.author || 'admin'}</span>
                ${l.target ? '<span>🎯 ' + escapeHtml(l.target) + '</span>' : ''}
                ${l.ip && l.ip !== 'unknown' ? '<span>🌐 ' + l.ip + '</span>' : ''}
            </div>
            ${l.details ? '<div class="log-details">' + escapeHtml(l.details) + '</div>' : ''}
        </div>
    `).join('');
}

function filterLogTable() {
    const q = (document.getElementById('log-search')?.value || '').toLowerCase().trim();
    if (!q) { logsFiltered = logsData; }
    else { logsFiltered = logsData.filter(l => (l.action + ' ' + (l.target || '') + ' ' + (l.details || '') + ' ' + (l.author || '')).toLowerCase().includes(q)); }
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

function closeLogDialog() { const dlg = document.getElementById('log-dialog'); if (dlg) dlg.style.display = 'none'; }

async function submitNewLog() {
    const action = document.getElementById('log-form-action').value.trim();
    if (!action) { customNotify('Vui lòng nhập action', 'warn'); return; }
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
    } catch(e) { customNotify('Ghi log thất bại: ' + e.message, 'error'); }
}

async function deleteLog(id) {
    if (!(await customConfirm('Xóa log #' + id + '?'))) return;
    try {
        const r = await fetch(API + '/api/logs/' + id, { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadLogs();
    } catch(e) { customNotify('Xóa thất bại: ' + e.message, 'error'); }
}

// ============================================================
// CLONE ALL
// ============================================================
function toggleCloneAll() {
    const check = document.getElementById('clone-all-check');
    const wrapper = document.getElementById('clone-list-wrapper');
    const btn = document.getElementById('btn-clone-all');
    if (!check) return;
    if (check.checked) { if (wrapper) wrapper.style.display = 'none'; if (btn) btn.style.display = ''; }
    else { if (wrapper) wrapper.style.display = ''; if (btn) btn.style.display = 'none'; }
}

async function cloneAllSensors() {
    const limitEl = document.getElementById('clone-all-limit');
    const limit = parseInt(limitEl?.value) || 50;
    if (limit < 1 || limit > 50000) { customNotify('Số lượng phải từ 1 đến 50,000', 'warn'); return; }
    if (!(await customConfirm('Clone ' + limit + ' sensor mới nhất sang Debug DB?\n\nHành động này có thể tạo nhiều records.'))) return;
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
    } catch(e) { customNotify('Clone thất bại: ' + e.message, 'error'); }
}

// ============================================================
// ADMIN NOTES
// ============================================================
let notesData = [];
let notesFiltered = [];
let editingNoteId = null;

function getCurrentAuthor() { return localStorage.getItem('admin_user') || 'phuyy'; }

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
    } catch(e) { box.innerHTML = '<div style="text-align:center; padding:40px; color:#f85149;">Lỗi: ' + e.message + '</div>'; }
}

function renderNoteList() {
    const box = document.getElementById('note-list');
    const count = document.getElementById('note-count');
    if (!box) return;
    if (count) count.textContent = notesFiltered.length + ' notes';
    if (!notesFiltered.length) { box.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Chưa có ghi chú. Bấm "Ghi chú mới" để tạo.</div>'; return; }
    const tagIcon = { note: '📝', todo: '✅', bug: '🐛', maint: '🔧', idea: '💡', fatal: '💀' };
    box.innerHTML = notesFiltered.map(n => `
        <div class="note-card ${n.pinned ? 'pinned' : ''}" data-id="${n.id}">
            <div class="note-header">
                <div class="note-title-wrap">
                    ${n.pinned ? '<span class="note-pin">📌</span>' : ''}
                    <span class="note-tag tag-${n.tag}">${tagIcon[n.tag] || '📝'} ${n.tag}</span>
                    <h3 class="note-title">${escapeHtml(n.title)}</h3>
                </div>
                <div class="note-actions">
                    <button class="note-btn" onclick="togglePinNote(${n.id}, ${n.pinned ? 0 : 1})" title="${n.pinned ? 'Bỏ pin' : 'Pin'}">${n.pinned ? '📌' : '📍'}</button>
                    <button class="note-btn" onclick="openEditNoteDialog(${n.id})" title="Sửa">✏️</button>
                    <button class="note-btn note-btn-del" onclick="deleteNote(${n.id})" title="Xóa">🗑️</button>
                </div>
            </div>
            <div class="note-content">${escapeHtml(n.content)}</div>
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
    else { notesFiltered = notesData.filter(n => (n.title + ' ' + n.content + ' ' + n.author + ' ' + n.tag).toLowerCase().includes(q)); }
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

function closeNoteDialog() { const dlg = document.getElementById('note-dialog'); if (dlg) dlg.style.display = 'none'; }

async function submitNote() {
    const title = document.getElementById('note-form-title').value.trim();
    const content = document.getElementById('note-form-content').value.trim();
    const tag = document.getElementById('note-form-tag').value;
    const author = document.getElementById('note-form-author').value || getCurrentAuthor();
    if (!title || !content) { customNotify('Vui lòng nhập tiêu đề và nội dung', 'warn'); return; }
    try {
        const isEdit = editingNoteId !== null;
        const url = isEdit ? API + '/api/notes/' + editingNoteId : API + '/api/notes';
        const method = isEdit ? 'PUT' : 'POST';
        const body = isEdit ? { title, content, tag } : { title, content, tag, author };
        if (tag === 'fatal') body.pinned = 1;
        const r = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify(body)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction(isEdit ? 'note_updated' : 'note_created', 'note#' + (editingNoteId || 'new'), title, 'info');
        closeNoteDialog();
        await loadNotes();
    } catch(e) { customNotify('Lưu thất bại: ' + e.message, 'error'); }
}

async function deleteNote(id) {
    if (!(await customConfirm('Xóa ghi chú #' + id + '?'))) return;
    try {
        const r = await fetch(API + '/api/notes/' + id, { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('note_deleted', 'note#' + id, '', 'warn');
        await loadNotes();
    } catch(e) { customNotify('Xóa thất bại: ' + e.message, 'error'); }
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
    } catch(e) { customNotify('Đổi pin thất bại: ' + e.message, 'error'); }
}

// ============================================================
// USERS MANAGEMENT
// ============================================================
let usersData = [];
let editingUserId = null;

async function loadUsers() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải...</td></tr>';
    try {
        const r = await fetch(API + '/api/users', { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        usersData = await r.json();
        renderUsersTable();
    } catch(e) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#f85149;">Lỗi: ' + e.message + '</td></tr>'; }
}

function renderUsersTable() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    if (!usersData.length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:var(--text-muted);">Chưa có user</td></tr>'; return; }
    tbody.innerHTML = usersData.map(u => `
        <tr>
            <td>${u.id}</td>
            <td><strong>${escapeHtml(u.username)}</strong></td>
            <td>${escapeHtml(u.displayname || u.username)}</td>
            <td><span class="type-badge ${u.role === 'head_admin' ? 'edge' : 'manual'}">${escapeHtml(u.role)}</span></td>
            <td>${u.active ? '<span style="color:#3fb950;">✓ Active</span>' : '<span style="color:#f85149;">✗ Disabled</span>'}</td>
            <td>${u.totp_enabled ? '✓' : '—'}</td>
            <td style="font-size:11px;">${u.last_login || '—'}</td>
            <td style="font-size:11px;">${u.created_at || '—'}</td>
            <td>
                <button class="action-btn edit" onclick="editUser(${u.id})" title="Sửa pass/role">✏️</button>
                <button class="action-btn ${u.active ? 'del' : 'restore'}" onclick="toggleUserActive(${u.id}, ${u.active ? 0 : 1})" title="${u.active ? 'Disable' : 'Enable'}">${u.active ? '🔒' : '🔓'}</button>
                <button class="action-btn del" onclick="deleteUser(${u.id}, '${escapeHtml(u.username).replace(/'/g, "\\'")}')" title="Xóa">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function openNewUserDialog() {
    editingUserId = null;
    document.getElementById('user-dialog-title').textContent = 'Thêm user mới';
    document.getElementById('user-form-username').value = '';
    document.getElementById('user-form-username').disabled = false;
    const dnEl = document.getElementById('user-form-displayname');
    if (dnEl) dnEl.value = '';
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
    const dnEl = document.getElementById('user-form-displayname');
    if (dnEl) dnEl.value = u.displayname || u.username;
    document.getElementById('user-form-password').value = '';
    document.getElementById('user-form-role').value = u.role;
    document.getElementById('user-dialog-submit').textContent = 'Lưu';
    document.getElementById('user-dialog-error').textContent = '';
    document.getElementById('user-dialog').style.display = 'flex';
}

function closeUserDialog() { document.getElementById('user-dialog').style.display = 'none'; document.getElementById('user-dialog-error').textContent = ''; }

async function submitUser() {
    const username = document.getElementById('user-form-username').value.trim();
    const displayname = (document.getElementById('user-form-displayname')?.value || '').trim() || username;
    const password = document.getElementById('user-form-password').value;
    const role = document.getElementById('user-form-role').value;
    const errEl = document.getElementById('user-dialog-error');
    errEl.textContent = '';
    if (editingUserId) {
        const body = { displayname, role };
        if (password) body.password = password;
        try {
            const r = await fetchWithTOTP(API + '/api/users/' + editingUserId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
                body: JSON.stringify(body)
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
            closeUserDialog();
            await loadUsers();
        } catch(e) { if (e.message !== 'Đã hủy') { errEl.textContent = e.message; errEl.style.color = '#f85149'; } }
    } else {
        if (!username || !password) { errEl.textContent = 'Nhập đủ username và password'; errEl.style.color = '#f85149'; return; }
        try {
            const r = await fetchWithTOTP(API + '/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
                body: JSON.stringify({ username, displayname, password, role })
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
            closeUserDialog();
            await loadUsers();
        } catch(e) { if (e.message !== 'Đã hủy') { errEl.textContent = e.message; errEl.style.color = '#f85149'; } }
    }
}

async function toggleUserActive(id, active) {
    const u = usersData.find(x => x.id === id);
    if (!u) return;
    if (!(await customConfirm((active ? 'Kích hoạt' : 'Vô hiệu hóa') + ' user "' + u.username + '"?'))) return;
    try {
        const r = await fetchWithTOTP(API + '/api/users/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ active: active })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadUsers();
    } catch(e) { if (e.message !== 'Đã hủy') customNotify('Thất bại: ' + e.message, 'error'); }
}

async function deleteUser(id, name) {
    if (!(await customConfirm('Xóa user "' + name + '"?\n\nHành động này không thể hoàn tác.'))) return;
    try {
        const r = await fetchWithTOTP(API + '/api/users/' + id, { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadUsers();
    } catch(e) { if (e.message !== 'Đã hủy') customNotify('Xóa thất bại: ' + e.message, 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
    const pwd = document.getElementById('user-form-password');
    if (pwd) pwd.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitUser(); } });
});

// ============================================================
// DB VIEWER
// ============================================================
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
        const params = new URLSearchParams({ limit: dbState.limit, offset: dbState.offset, q: dbState.q });
        const r = await fetch(API + '/api/db/' + dbState.table + '?' + params.toString(), { headers: { 'X-Auth-Token': getToken() } });
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
    } catch(e) { tbody.innerHTML = '<tr><td style="text-align:center; padding:20px; color:#f85149;">Lỗi: ' + e.message + '</td></tr>'; }
}

function dbPrevPage() { if (dbState.offset === 0) return; dbState.offset = Math.max(0, dbState.offset - dbState.limit); loadDBTable(); }
function dbNextPage() { if (dbState.offset + dbState.limit >= dbState.total) return; dbState.offset += dbState.limit; loadDBTable(); }

// ============================================================
// NOTE COMMENTS
// ============================================================
async function loadNoteComments(noteId, container) {
    container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Đang tải...</div>';
    try {
        const r = await fetch(API + '/api/notes/' + noteId + '/comments');
        const list = await r.json();
        renderNoteComments(noteId, container, list);
    } catch(e) { container.innerHTML = '<div style="font-size:12px; color:var(--red);">Lỗi: ' + e.message + '</div>'; }
}

function renderNoteComments(noteId, container, list) {
    const currentUser = localStorage.getItem('admin_user') || '';
    const commentsHtml = list.length ? list.map(c => {
        const initial = (c.username || '?').charAt(0).toUpperCase();
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
        await loadNoteComments(noteId, document.getElementById('nc-wrap-' + noteId));
    } catch(e) { customNotify('Lỗi: ' + e.message, 'error'); }
}

async function delNoteComment(id, noteId) {
    if (!(await customConfirm('Xóa comment này?'))) return;
    try {
        const r = await fetch(API + '/api/comments/' + id, { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadNoteComments(noteId, document.getElementById('nc-wrap-' + noteId));
    } catch(e) { customNotify('Lỗi: ' + e.message, 'error'); }
}

function toggleNoteComments(noteId) {
    const wrap = document.getElementById('nc-wrap-' + noteId);
    if (!wrap) return;
    if (wrap.style.display === 'none' || !wrap.style.display) { wrap.style.display = 'block'; loadNoteComments(noteId, wrap); }
    else { wrap.style.display = 'none'; }
}

// ============================================================
// INCIDENTS MANAGEMENT
// ============================================================
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
                <td>${escapeHtml(i.service)}</td>
                <td><span class="type-badge ${i.status === 'offline' ? 'edge' : 'manual'}">${escapeHtml(i.status)}</span></td>
                <td style="font-size:11px;">${i.started_at || '—'}</td>
                <td style="font-size:11px; color:#d29922;">${i.eta || '—'}</td>
                <td style="font-size:11px; color:#3fb950;">${i.resolved_at || '—'}</td>
                <td>${escapeHtml(i.note || '—')}</td>
                <td>
                    <button class="action-btn edit" onclick="editIncident(${i.id})" title="Sửa">✏️</button>
                    <button class="action-btn del" onclick="deleteIncident(${i.id})" title="Xóa">🗑️</button>
                </td>
            </tr>
        `).join('');
    } catch(e) { tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:#f85149;">Lỗi: ${e.message}</td></tr>`; }
}

function openIncidentDialog() {
    editingIncidentId = null;
    const ttl = document.getElementById('inc-dialog-title');
    if (ttl) ttl.textContent = 'Thêm sự cố';
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const localStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    const startedEl = document.getElementById('inc-started');
    if (startedEl) startedEl.value = localStr;
    ['inc-eta', 'inc-resolved', 'inc-note'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const dlg = document.getElementById('incident-dialog');
    if (dlg) dlg.style.display = 'flex';
}

function editIncident(id) {
    const inc = incidentsData.find(x => x.id === id);
    if (!inc) return;
    editingIncidentId = id;
    const ttl = document.getElementById('inc-dialog-title');
    if (ttl) ttl.textContent = 'Sửa sự cố #' + id;
    document.getElementById('inc-service').value = inc.service || 'node';
    document.getElementById('inc-status').value = inc.status || 'offline';
    document.getElementById('inc-started').value = (inc.started_at || '').replace(' ', 'T').slice(0, 16);
    document.getElementById('inc-eta').value = inc.eta ? inc.eta.replace(' ', 'T').slice(0, 16) : '';
    document.getElementById('inc-resolved').value = inc.resolved_at ? inc.resolved_at.replace(' ', 'T').slice(0, 16) : '';
    document.getElementById('inc-note').value = inc.note || '';
    document.getElementById('incident-dialog').style.display = 'flex';
}

function closeIncidentDialog() { document.getElementById('incident-dialog').style.display = 'none'; }

async function submitIncident() {
    const service = document.getElementById('inc-service').value;
    const status = document.getElementById('inc-status').value;
    const started = document.getElementById('inc-started').value;
    const eta = document.getElementById('inc-eta').value;
    const resolved = document.getElementById('inc-resolved').value;
    const note = document.getElementById('inc-note').value.trim();
    if (!started) { customNotify('Vui lòng nhập thời gian bắt đầu', 'warn'); return; }
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
    } catch(e) { customNotify('Lỗi: ' + e.message, 'error'); }
}

async function deleteIncident(id) {
    if (!(await customConfirm('Xóa sự cố #' + id + '?'))) return;
    try {
        const r = await fetch(API + '/api/incidents/' + id, { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadIncidents();
    } catch(e) { customNotify('Lỗi: ' + e.message, 'error'); }
}

// ============================================================
// NOTIFICATION: auto-notify khi có log warn/error mới
// ============================================================
let lastSeenLogId = parseInt(localStorage.getItem('last_seen_log_id') || '0');

async function checkNewNotifications() {
    if (!isAdmin()) return;
    try {
        const r = await fetch(API + '/api/logs?limit=10', { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) return;
        const logs = await r.json();
        if (!Array.isArray(logs) || !logs.length) return;

        const newWarns = logs.filter(l => l.id > lastSeenLogId && (l.severity === 'warn' || l.severity === 'error'));
        const maxId = Math.max(...logs.map(l => l.id), lastSeenLogId);

        if (newWarns.length > 0) {
            newWarns.forEach(l => showToast(l));
            const badge = document.getElementById('log-badge');
            if (badge) {
                const current = parseInt(badge.textContent) || 0;
                badge.textContent = current + newWarns.length;
                badge.style.display = 'inline-block';
            }
        }

        if (maxId > lastSeenLogId) {
            lastSeenLogId = maxId;
            localStorage.setItem('last_seen_log_id', String(maxId));
        }
    } catch(e) { /* silent */ }
}
function showToast(log) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const color = log.severity === 'error' ? '#f85149' : '#d29922';
    const icon = log.severity === 'error' ? '🔴' : '⚠️';

    const toast = document.createElement('div');
    toast.setAttribute('data-toast', '1');
    toast.style.cssText = `
        background: var(--bg-card);
        border: 1px solid ${color};
        border-left: 4px solid ${color};
        border-radius: 10px;
        padding: 14px 44px 14px 18px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        animation: toastSlideIn 0.3s ease-out;
        font-size: 13px;
        position: relative;
    `;
    toast.innerHTML = `
        <button style="position:absolute; top:8px; right:8px; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:20px; padding:0; line-height:1; width:28px; height:28px; display:flex; align-items:center; justify-content:center; border-radius:6px; transition:all 0.15s;" 
                onmouseover="this.style.background='rgba(248,81,73,0.15)';this.style.color='#f85149';"
                onmouseout="this.style.background='none';this.style.color='var(--text-muted)';"
                onclick="this.closest('[data-toast]').remove(); updateToastClearBtn();">×</button>
        <div style="font-weight:700; color:${color}; margin-bottom:6px;">${icon} ${log.action}</div>
        <div style="font-size:12px; color:var(--text); margin-bottom:4px;">${log.details || ''}</div>
        <div style="font-size:11px; color:var(--text-muted);">
            🕐 ${log.ts || ''} ${log.target ? '· 🎯 ' + log.target : ''}
        </div>
    `;

    container.appendChild(toast);
    updateToastClearBtn();
}

function updateToastClearBtn() {
    const container = document.getElementById('toast-container');
    if (!container) return;
    let btn = document.getElementById('toast-clear-all');
    const count = container.querySelectorAll('[data-toast]').length;
    
    if (count > 1) {
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'toast-clear-all';
            btn.style.cssText = `
                align-self: flex-end;
                background: rgba(248,81,73,0.15);
                color: #f85149;
                border: 1px solid rgba(248,81,73,0.3);
                padding: 6px 12px;
                border-radius: 6px;
                font-size: 12px;
                cursor: pointer;
                font-weight: 600;
                font-family: inherit;
            `;
            btn.onclick = () => {
                container.querySelectorAll('[data-toast]').forEach(t => t.remove());
                updateToastClearBtn();
            };
            container.prepend(btn);
        }
        btn.textContent = `✕ Đóng tất cả (${count})`;
    } else if (btn) {
        btn.remove();
    }
}

// ============================================================
// STEP-UP AUTH — Yêu cầu TOTP khi backend trả 403
// ============================================================
async function fetchWithTOTP(url, options = {}) {
    let response = await fetch(url, options);

    if (response.status === 403) {
        const data = await response.clone().json();
        if (data.require_totp) {
            const otp = await promptTOTP(data.reason, data.hint);
            if (!otp) throw new Error('Đã hủy');

            let body = {};
            if (options.body) {
                try { body = JSON.parse(options.body); } catch(e) {}
            }
            body.otp = otp;

            response = await fetch(url, { ...options, body: JSON.stringify(body) });
        }
    }

    return response;
}

function promptTOTP(reason, hint) {
    return new Promise((resolve) => {
        const labels = {
            'create_user': 'Tạo user mới',
            'update_user': 'Sửa thông tin user',
            'delete_user': 'Xóa user',
            'add_trusted_ip': 'Thêm IP tin cậy',
            'toggle_trusted_ip': 'Đổi trạng thái IP tin cậy',
            'delete_trusted_ip': 'Xóa IP tin cậy',
            'clear_debug': 'Clear toàn bộ debug DB',
            'delete_debug': 'Xóa record debug'
        };

        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
                <h3 style="color:var(--text);margin:0 0 8px;font-size:20px;">🔐 Xác thực 2 lớp</h3>
                <p style="color:var(--text-muted);font-size:13px;margin:0 0 6px;">${labels[reason] || reason}</p>
                <p style="color:#d29922;font-size:12px;margin:0 0 20px;">${hint || ''}</p>
                <label style="display:block;margin-bottom:16px;">
                    <span style="display:block;font-size:13px;color:var(--text-muted);margin-bottom:8px;">Nhập mã OTP 6 số</span>
                    <input type="text" id="totp-input" inputmode="numeric" pattern="[0-9]{6}" maxlength="6"
                        placeholder="123456" autocomplete="one-time-code"
                        style="width:100%;padding:14px;font-size:24px;letter-spacing:8px;text-align:center;font-family:monospace;background:var(--bg);border:2px solid var(--border);border-radius:10px;color:var(--text);">
                </label>
                <div style="display:flex;gap:10px;">
                    <button id="totp-cancel" style="flex:1;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;font-size:14px;">Hủy</button>
                    <button id="totp-confirm" style="flex:1;padding:12px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-weight:600;cursor:pointer;font-size:14px;">Xác nhận</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const input = document.getElementById('totp-input');
        input.focus();

        const cleanup = (val) => { modal.remove(); resolve(val); };
        document.getElementById('totp-cancel').onclick = () => cleanup(null);
        document.getElementById('totp-confirm').onclick = () => {
            const v = input.value.trim();
            if (!/^\d{6}$/.test(v)) { input.style.borderColor = '#f85149'; return; }
            cleanup(v);
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('totp-confirm').click();
        });
    });
}

// ============================================================
// SECURITY TAB — Trusted IPs + Sessions + Sensitive Actions
// ============================================================
async function loadSecurity() {
    await Promise.all([loadTrustedIPs(), loadSessions(), loadSensitiveActions()]);
}

async function loadTrustedIPs() {
    const tbody = document.getElementById('trusted-tbody');
    if (!tbody) return;
    try {
        const r = await fetch(API + '/api/trusted-ips', { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        const rows = d.rows || [];
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">Chưa có IP tin cậy</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(x => `
            <tr>
                <td><code>${x.ip}</code>${x.ip === d.current_ip ? ' <span style="color:#3fb950;">(bạn)</span>' : ''}</td>
                <td>${escapeHtml(x.name)}</td>
                <td>${x.session_days || 365}</td>
                <td>${x.active ? '✅' : '❌'}</td>
                <td style="font-size:11px;">${x.added_at || '—'}</td>
                <td>
                    <button class="action-btn" onclick="toggleTrustedIP('${x.ip_full}', ${x.active ? 0 : 1})">${x.active ? '🔒' : '🔓'}</button>
                    <button class="action-btn del" onclick="deleteTrustedIP('${x.ip_full}')">🗑️</button>
                </td>
            </tr>
        `).join('');
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:#f85149;padding:20px;">Lỗi: ' + e.message + '</td></tr>';
    }
}
async function loadSessions() {
    const tbody = document.getElementById('sessions-tbody');
    if (!tbody) return;
    try {
        const r = await fetch(API + '/api/sessions', { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        const rows = d.rows || [];
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">Không có session</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(s => {
            const isMe = s.token === getToken();
            return `<tr>
                <td style="font-family:monospace;font-size:11px;">${s.token_preview}</td>
                <td><strong>${s.username}</strong></td>
                <td>${s.role}</td>
                <td style="font-size:11px;">${s.ip || '—'}</td>
                <td>${s.hours_left}h</td>
                <td>${isMe ? '<span style="color:#3fb950;font-size:11px;">Session này</span>' : `<button class="action-btn del" onclick="revokeToken('${s.token}')">🚫</button>`}</td>
            </tr>`;
        }).join('');
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:#f85149;padding:20px;">Lỗi: ' + e.message + '</td></tr>';
    }
}

async function loadSensitiveActions() {
    const tbody = document.getElementById('sensitive-tbody');
    if (!tbody) return;
    try {
        const r = await fetch(API + '/api/sensitive-actions?limit=50', { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        const rows = d.rows || [];
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">Chưa có thao tác nhạy cảm</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(x => `
            <tr>
                <td style="font-size:11px;">${x.ts}</td>
                <td><strong>${x.username}</strong></td>
                <td><span class="type-badge edge">${x.action_type}</span></td>
                <td style="font-size:11px;">${x.target || '—'}</td>
                <td style="font-size:11px;">${x.ip || '—'}</td>
            </tr>
        `).join('');
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="5" style="color:#f85149;padding:20px;">Lỗi: ' + e.message + '</td></tr>';
    }
}

async function addTrustedIP() {
    const ip = document.getElementById('trusted-ip-input').value.trim();
    const name = document.getElementById('trusted-name-input').value.trim();
    const days = parseInt(document.getElementById('trusted-days-input').value) || 365;
    if (!ip || !name) { customNotify('Nhập đủ IP và tên', 'warn'); return; }
    try {
        const r = await fetchWithTOTP(API + '/api/trusted-ips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ ip, name, session_days: days })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        document.getElementById('trusted-ip-input').value = '';
        document.getElementById('trusted-name-input').value = '';
        await loadTrustedIPs();
    } catch(e) { if (e.message !== 'Đã hủy') customNotify('Lỗi: ' + e.message, 'error'); }
}

async function toggleTrustedIP(ip, active) {
    try {
        const r = await fetchWithTOTP(API + '/api/trusted-ips/' + encodeURIComponent(ip), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ active })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadTrustedIPs();
    } catch(e) { if (e.message !== 'Đã hủy') customNotify('Lỗi: ' + e.message, 'error'); }
}

async function deleteTrustedIP(ip) {
    if (!(await customConfirm('Xóa IP ' + ip + ' và REVOKE tất cả session từ IP này?'))) return;
    try {
        const r = await fetchWithTOTP(API + '/api/trusted-ips/' + encodeURIComponent(ip), {
            method: 'DELETE',
            headers: { 'X-Auth-Token': getToken() }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        customNotify('Đã xóa. Revoked ' + (d.revoked_sessions || 0) + ' sessions', 'success');
        await loadSecurity();
    } catch(e) { if (e.message !== 'Đã hủy') customNotify('Lỗi: ' + e.message, 'error'); }
}

async function revokeToken(token) {
    if (!(await customConfirm('Revoke session này?'))) return;
    try {
        const r = await fetch(API + '/api/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ by: 'token', value: token })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadSessions();
    } catch(e) { customNotify('Lỗi: ' + e.message, 'error'); }
}

async function revokeAllSessions() {
    if (!await customConfirm('⚠️ Revoke TẤT CẢ session (BAO GỒM session hiện tại)?')) return;
    if (!(await customConfirm('Xác nhận lần 2: BẠN SẼ BỊ ĐĂNG XUẤT NGAY LẬP TỨC sau khi bấm OK.'))) return;
    try {
        const r = await fetch(API + '/api/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ by: 'all' })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        customNotify('Đã revoke ' + d.revoked + ' sessions. Bạn sẽ được chuyển về trang chủ.', 'success');
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_user');
        localStorage.removeItem('admin_role');
        localStorage.removeItem('admin_tab');
        window.location.href = '/';
    } catch(e) { customNotify('Lỗi: ' + e.message, 'error'); }
}

// === DEBUG PAGINATION ===
function renderDebugPagination() {
    const container = document.getElementById('debug-pagination');
    if (!container) return;
    if (debugTotalPages <= 1) { container.innerHTML = ''; return; }
    const prevDisabled = debugPage <= 1 ? 'disabled' : '';
    const nextDisabled = debugPage >= debugTotalPages ? 'disabled' : '';
    let pageButtons = '';
    let start = Math.max(1, debugPage - 2);
    let end = Math.min(debugTotalPages, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    if (start > 1) {
        pageButtons += '<button class="page-btn" onclick="loadDebugData(1)">1</button>';
        if (start > 2) pageButtons += '<span class="page-dots">...</span>';
    }
    for (let i = start; i <= end; i++) {
        const active = i === debugPage ? 'active' : '';
        pageButtons += '<button class="page-btn ' + active + '" onclick="loadDebugData(' + i + ')">' + i + '</button>';
    }
    if (end < debugTotalPages) {
        if (end < debugTotalPages - 1) pageButtons += '<span class="page-dots">...</span>';
        pageButtons += '<button class="page-btn" onclick="loadDebugData(' + debugTotalPages + ')">' + debugTotalPages + '</button>';
    }
    container.innerHTML = '<button class="page-btn page-nav" ' + prevDisabled + ' onclick="loadDebugData(' + (debugPage - 1) + ')">‹ Trước</button>' + pageButtons + '<button class="page-btn page-nav" ' + nextDisabled + ' onclick="loadDebugData(' + (debugPage + 1) + ')">Sau ›</button>';
}

// ============================================================
// CUSTOM CONFIRM MODAL
// ============================================================
function customConfirm(message, options = {}) {
    return new Promise((resolve) => {
        const title = options.title || 'Xác nhận';
        const okText = options.okText || 'Đồng ý';
        const cancelText = options.cancelText || 'Hủy';
        const danger = options.danger !== false;

        const overlay = document.createElement('div');
        overlay.className = 'custom-confirm-overlay';
        overlay.innerHTML = `
            <div class="custom-confirm-modal">
                <h3 class="custom-confirm-title">${title}</h3>
                <p class="custom-confirm-message">${escapeHtml(message)}</p>
                <div class="custom-confirm-actions">
                    <button class="cc-btn cc-cancel">${cancelText}</button>
                    <button class="cc-btn cc-ok ${danger ? 'cc-danger' : ''}">${okText}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('cc-visible'));

        const cleanup = (result) => {
            overlay.classList.remove('cc-visible');
            setTimeout(() => overlay.remove(), 150);
            resolve(result);
        };

        overlay.querySelector('.cc-ok').onclick = () => cleanup(true);
        overlay.querySelector('.cc-cancel').onclick = () => cleanup(false);
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
        const escHandler = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); cleanup(false); } };
        document.addEventListener('keydown', escHandler);
    });
}

// ============================================================
// CUSTOM NOTIFY
// ============================================================
function customNotify(message, type = 'info', duration = 3500) {
    const icons = { success: '✅', error: '❌', warn: '⚠️', info: 'ℹ️' };
    const colors = { success: '#4CAF50', error: '#f85149', warn: '#ff9800', info: '#2196F3' };

    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.style.setProperty('--toast-color', colors[type] || colors.info);
    toast.innerHTML = `
        <span class="custom-toast-icon">${icons[type] || icons.info}</span>
        <span class="custom-toast-msg">${escapeHtml(message)}</span>
        <button class="custom-toast-close" aria-label="Đóng">×</button>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    const remove = () => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 200);
    };
    toast.querySelector('.custom-toast-close').onclick = remove;
    if (duration > 0) setTimeout(remove, duration);
}