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
        const r = await authFetch(API + '/api/aqi/current');
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

    // Nếu không có data -> reset tất cả về '--'
    if (!data.length) {
        ['temp','hum','volt','curr','pm1','pm25','pm10','co','voc_pct','nox_pct','maxv','minv','maxi','mini'].forEach(id => {
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
    animateNumber('maxv', last.maxv, 3);
    animateNumber('minv', last.minv, 3);
    animateNumber('maxi', last.maxi, 3, 1000);
    animateNumber('mini', last.mini, 3, 1000);

    applyCardIntensity(cp + 'pm25', last.pm25, 'pm25');
    applyCardIntensity(cp + 'pm10', last.pm10, 'pm10');
    applyCardIntensity(cp + 'co', last.co, 'co');
    applyCardIntensity(cp + 'voc_pct', last.voc_pct, 'voc_pct');
    applyCardIntensity(cp + 'nox_pct', last.nox_pct, 'nox_pct');
    
    if (!idPrefix) {
        const u = document.getElementById('updated');
        if (u) u.textContent = last.ts;
    }
    
    renderCharts(data, idPrefix, chartCtx);
    if (!idPrefix) setStatus(true);
}
// ============================================================
// RENDER ALL CHARTS
// ============================================================
// ===== HELPER: chèn null vào gap > maxGapMs =====
function insertGapNulls(points, maxGapMs = 5 * 60 * 1000) {
    if (!points || points.length < 2) return points || [];
    const result = [];
    for (let i = 0; i < points.length; i++) {
        result.push(points[i]);
        if (i < points.length - 1) {
            const gap = points[i + 1].x - points[i].x;
            if (gap > maxGapMs) {
                result.push({ x: points[i].x + maxGapMs, y: null });
            }
        }
    }
    return result;
}

function renderCharts(data, idPrefix = '', chartCtx = dashCharts) {
    const $ = (id) => document.getElementById(idPrefix + id);
    const envCanvas = $('chart-env');
    if (!envCanvas) return;

    // Xóa chart cũ nếu không có data
    if (!data.length) {
        ['env','pm','volt','curr','co','gas','minmax'].forEach(k => {
            if (chartCtx[k]) { chartCtx[k].destroy(); chartCtx[k] = null; }
        });
        return;
    }

    // ===== 1. LỌC TRÙNG RECORD =====
    const seen = new Set();
    const clean = [];
    for (const d of data) {
        const key = d.id || d.recorded_at || (d.node_id + '_' + d.ts);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        clean.push(d);
    }

    // ===== 2. SORT THEO THỜI GIAN =====
    clean.sort((a, b) => {
        const ax = new Date(a.recorded_at || a.ts).getTime();
        const bx = new Date(b.recorded_at || b.ts).getTime();
        return ax - bx;
    });

    const s = downsample(clean, 150);

    // ===== 3. TẠO POINTS (nối liền, không gap-null) =====
    const tPoints   = toPointsSafe(s, 't');
    const hPoints   = toPointsSafe(s, 'h');
    const pm1Points = toPointsSafe(s, 'pm1');
    const pm25Points= toPointsSafe(s, 'pm25');
    const pm10Points= toPointsSafe(s, 'pm10');
    const vPoints   = toPointsSafe(s, 'v');
    const iPoints   = toPointsSafe(s, 'i', 1000);
    const coPoints  = toPointsSafe(s, 'co');

    // ===== 4. CHART MÔI TRƯỜNG =====
    if (chartCtx.env) chartCtx.env.destroy();
    chartCtx.env = new Chart(envCanvas, {
        type: 'line',
        data: { datasets: [
            { label: 'Nhiệt độ (°C)', data: tPoints, borderColor: '#f44336',
              backgroundColor: 'rgba(244,67,54,0.1)', tension: 0.2, pointRadius: 0,
              borderWidth: 2, yAxisID: 'y_temp', spanGaps: true },
            { label: 'Độ ẩm (%)', data: hPoints, borderColor: '#2196F3',
              backgroundColor: 'rgba(33,150,243,0.1)', tension: 0.2, pointRadius: 0,
              borderWidth: 2, yAxisID: 'y_hum', spanGaps: true }
        ]},
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            spanGaps: true,
            plugins: { legend: { labels: { color: getLegendColor() } } },
            scales: {
                x: timeScaleX(),
                y_temp: {
                    position: 'left', min: 15, max: 50,
                    ticks: { color: '#f44336', stepSize: 5, precision: 0 },
                    grid: { color: getGridColor() },
                    title: { display: true, text: 'Nhiệt độ (°C)', color: '#f44336' }
                },
                y_hum: {
                    position: 'right', min: 0, max: 100,
                    ticks: { color: '#2196F3', stepSize: 10, precision: 0 },
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'Độ ẩm (%)', color: '#2196F3' }
                }
            }
        }
    });

    // ===== 5. CHART BỤI MỊN =====
    const pmCanvas = $('chart-pm');
    if (pmCanvas) {
        if (chartCtx.pm) chartCtx.pm.destroy();
        chartCtx.pm = new Chart(pmCanvas, {
            type: 'line',
            data: { datasets: [
                { label: 'PM1.0 (µg/m³)', data: pm1Points, borderColor: '#FFC107',
                  backgroundColor: 'rgba(255,193,7,0.1)', tension: 0.2, pointRadius: 0,
                  borderWidth: 2, yAxisID: 'y_pm', spanGaps: true },
                { label: 'PM2.5 (µg/m³)', data: pm25Points, borderColor: '#FF5722',
                  backgroundColor: 'rgba(255,87,34,0.1)', tension: 0.2, pointRadius: 0,
                  borderWidth: 2, yAxisID: 'y_pm', spanGaps: true },
                { label: 'PM10 (µg/m³)', data: pm10Points, borderColor: '#FF9800',
                  backgroundColor: 'rgba(255,152,0,0.1)', tension: 0.2, pointRadius: 0,
                  borderWidth: 2, yAxisID: 'y_pm', spanGaps: true }
            ]},
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                spanGaps: true,
                plugins: { legend: { labels: { color: getLegendColor() } } },
                scales: {
                    x: timeScaleX(),
                    y_pm: {
                        position: 'left', beginAtZero: true, min: 0,
                        ticks: { color: '#FF5722', stepSize: 20, precision: 0 },
                        grid: { color: getGridColor() },
                        title: { display: true, text: 'Bụi mịn (µg/m³)', color: '#FF5722' }
                    }
                }
            }
        });
    }

    // ===== 6. CHART CO (inline từ renderCoChart) =====
    const coCanvas = $('chart-co');
    if (coCanvas && coPoints.length) {
        if (chartCtx.co) chartCtx.co.destroy();
        chartCtx.co = new Chart(coCanvas, {
            type: 'line',
            data: { datasets: [{
                label: 'CO (ppm)',
                data: coPoints,
                borderColor: (ctx) => makeValueGradient(ctx, 'co', 'y'),
                backgroundColor: (ctx) => makeValueGradient(ctx, 'co', 'y'),
                tension: 0.2, pointRadius: 0, borderWidth: 2,
                fill: true, spanGaps: true
            }]},
            options: (() => {
                const o = baseOptions('CO (ppm)', '#FF5722');
                o.spanGaps = true;
                o.scales.y.suggestedMax = 20;
                return o;
            })()
        });
    } else if (coCanvas && chartCtx.co) {
        chartCtx.co.destroy();
        chartCtx.co = null;
    }

    // ===== 7. CHART GAS (VOC/NOx — bar, inline từ renderGasChart) =====
    const last = clean[clean.length - 1] || {};
    const gasCanvas = $('chart-gas');
    if (gasCanvas && typeof Chart !== 'undefined') {
        const vocPct = parseFloat(last.voc_pct) || 100;
        const noxPct = parseFloat(last.nox_pct) || 100;
        const vocI = getIntensity(vocPct || 100, 'voc_pct');
        const noxI = getIntensity(noxPct || 100, 'nox_pct');
        const v = (vocPct && vocPct > 0) ? vocPct : 100;
        const n = (noxPct && noxPct > 0) ? noxPct : 100;
        const bgColors = [hexToRgba(vocI.color, vocI.opacity), hexToRgba(noxI.color, noxI.opacity)];
        const borderColors = [vocI.color, noxI.color];

        if (chartCtx.gas) chartCtx.gas.destroy();
        chartCtx.gas = new Chart(gasCanvas, {
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
                    y: { beginAtZero: true, suggestedMax: 130,
                         ticks: { color: getTextColor(), callback: (v) => v + '%' },
                         grid: { color: getGridColor() } },
                    x: { barPercentage: 0.5, categoryPercentage: 0.5,
                         ticks: { color: getTextColor() }, grid: { display: false } }
                }
            }
        });
    }

    // ===== 8. CHART ĐIỆN ÁP & DÒNG (admin) =====
    if (!isAdmin() && !idPrefix) return;

    const voltCanvas = $('chart-volt');
    if (voltCanvas) {
        if (chartCtx.volt) chartCtx.volt.destroy();
        chartCtx.volt = new Chart(voltCanvas, {
            type: 'line',
            data: { datasets: [{ label: 'Điện áp (V)', data: vPoints,
                borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.1)',
                tension: 0.2, pointRadius: 0, borderWidth: 2,
                fill: false, spanGaps: true }]},
            options: (() => {
                const o = baseOptions('Điện áp (V)', '#FF9800');
                o.spanGaps = true;
                o.scales.y.min = 0;
                o.scales.y.max = 6;
                o.scales.y.ticks.stepSize = 1;
                o.scales.y.ticks.precision = 0;
                return o;
            })()
        });
    }

    const currCanvas = $('chart-curr');
    if (currCanvas) {
        if (chartCtx.curr) chartCtx.curr.destroy();
        chartCtx.curr = new Chart(currCanvas, {
            type: 'line',
            data: { datasets: [{ label: 'Dòng điện (mA)', data: iPoints,
                borderColor: '#9C27B0', backgroundColor: 'rgba(156,39,176,0.1)',
                tension: 0.2, pointRadius: 0, borderWidth: 2,
                fill: false, spanGaps: true }]},
            options: (() => {
                const o = baseOptions('Dòng điện (mA)', '#9C27B0');
                o.spanGaps = true;
                o.scales.y.min = 0;
                o.scales.y.max = 300;
                o.scales.y.ticks.stepSize = 50;
                o.scales.y.ticks.precision = 0;
                return o;
            })()
        });
    }

    // ===== 9. CHART MIN/MAX (inline từ renderMinMaxChart) =====
    const minmaxCanvas = $('chart-minmax');
    if (minmaxCanvas && typeof Chart !== 'undefined') {
        const maxv = parseFloat(last.maxv) || 0;
        const minv = parseFloat(last.minv) || 0;
        const maxi = (parseFloat(last.maxi) || 0) * 1000;
        const mini = (parseFloat(last.mini) || 0) * 1000;

        if (chartCtx.minmax) chartCtx.minmax.destroy();
        chartCtx.minmax = new Chart(minmaxCanvas, {
            type: 'bar',
            data: {
                labels: ['Max V', 'Min V', 'Max I', 'Min I'],
                datasets: [
                    { label: 'Điện áp (V)', data: [maxv, minv, null, null],
                      backgroundColor: ['rgba(255,152,0,0.6)','rgba(255,193,7,0.6)', null, null],
                      borderColor: ['#FF9800','#FFC107', null, null],
                      borderWidth: 2, borderRadius: 6, maxBarThickness: 50, yAxisID: 'yV' },
                    { label: 'Dòng điện (mA)', data: [null, null, maxi, mini],
                      backgroundColor: [null, null, 'rgba(156,39,176,0.6)','rgba(33,150,243,0.6)'],
                      borderColor: [null, null, '#9C27B0','#2196F3'],
                      borderWidth: 2, borderRadius: 6, maxBarThickness: 50, yAxisID: 'yI' }
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
                        position: 'left', beginAtZero: true, min: 0, max: 6,
                        ticks: { color: '#FF9800', stepSize: 1, precision: 1 },
                        grid: { color: getGridColor() },
                        title: { display: true, text: 'Điện áp (V)', color: '#FF9800' }
                    },
                    yI: {
                        position: 'right', beginAtZero: true, min: 0, max: 300,
                        ticks: { color: '#9C27B0', stepSize: 50, precision: 0 },
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: 'Dòng (mA)', color: '#9C27B0' }
                    }
                }
            }
        });
    }
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
ws.onmessage = (e) => {
    if (e.data === 'pong') return;
    try {
        const d = JSON.parse(e.data);
        console.log('[WS RECV]', d.node_id, 'currentNodeId:', currentNodeId, d);
        if (d.t === undefined) return;
        if (d.node_id !== undefined && d.node_id !== currentNodeId) return;
        updateFromWS(d);
    } catch(err) {}
};
    ws.onclose = () => { console.log('[WS] disconnected, retry 3s'); clearInterval(wsPingInterval); setTimeout(connectWebSocket, 3000); };
    ws.onerror = () => console.error('[WS] error');
}

function updateFromWS(d) {
    if (d.t === undefined) return;
    if (d.node_id !== undefined && d.node_id !== currentNodeId) return; // bỏ qua nếu không phải node đang xem

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
    setStatus(true);
    addPointToCharts(d);
}

function addPointToCharts(d) {
    const now = Date.now();
    const MAX_GAP = 5 * 60 * 1000; // 5 phút

    // Helper push data có check gap
    function pushData(chart, dsIndex, yVal) {
        if (!chart || !chart.data || !chart.data.datasets[dsIndex]) return;
        const ds = chart.data.datasets[dsIndex];
        const last = ds.data[ds.data.length - 1];
        
        // Nếu gap > 5 phút, chèn 1 điểm null để ngắt đường
        if (last && now - last.x > MAX_GAP) {
            ds.data.push({ x: last.x + MAX_GAP, y: null });
        }
        ds.data.push({ x: now, y: yVal });
        
        if (ds.data.length > 200) ds.data.shift();
    }

    if (dashCharts.env) {
        pushData(dashCharts.env, 0, d.t);
        pushData(dashCharts.env, 1, d.h);
        dashCharts.env.update('none'); // 'none' để update mượt, không giật
    }
    
    if (dashCharts.pm) {
        pushData(dashCharts.pm, 0, d.pm1 || 0);
        pushData(dashCharts.pm, 1, d.pm25 || 0);
        pushData(dashCharts.pm, 2, d.pm10 || 0);
        dashCharts.pm.update('none');
    }
    
    if (dashCharts.co && d.co !== undefined) {
        pushData(dashCharts.co, 0, d.co);
        dashCharts.co.update('none');
    }
    
    if (!isAdmin()) return;
    
    if (dashCharts.volt) {
        pushData(dashCharts.volt, 0, d.v);
        dashCharts.volt.update('none');
    }
    if (dashCharts.curr) {
        pushData(dashCharts.curr, 0, d.i * 1000);
        dashCharts.curr.update('none');
    }
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
let currentNodeId = pad3(
    new URLSearchParams(location.search).get('node') ||
    localStorage.getItem('selected_node') ||
    '001'
);

function pad3(v) {
    return String(v ?? '').padStart(3, '0');
}


// ===== (KHÔNG khai báo lại currentNodeId — dùng biến đã có sẵn ở trên) =====

// ===== Load danh sách node vào dropdown =====
async function loadNodeMenu() {
    const select = document.getElementById('node-select');
    if (!select) return;

    select.disabled = true;

    try {
        const res = await authFetch('/api/nodes');
        const nodes = await res.json();

        if (!Array.isArray(nodes) || nodes.length === 0) {
            select.innerHTML = '<option value="">Không có node</option>';
            return;
        }

        select.innerHTML = '';
        nodes.forEach(n => {
            const opt = document.createElement('option');
            opt.value = n.id;
            opt.textContent = n.name;
            if (n.id === currentNodeId) opt.selected = true;
            select.appendChild(opt);
        });

        if (!nodes.some(n => n.id === currentNodeId)) {
            currentNodeId = nodes[0].id;
            select.value = currentNodeId;
        }
    } catch (err) {
        console.error('Lỗi load danh sách node:', err);
        select.innerHTML = '<option value="">Lỗi tải node</option>';
    } finally {
        select.disabled = false;
    }
}
// ===== Khi người dùng đổi node =====
function onNodeChange(newNodeId) {
    currentNodeId = pad3(newNodeId);
    localStorage.setItem('selected_node', currentNodeId); // dùng đúng key cũ

    const url = new URL(window.location);
    url.searchParams.set('node', currentNodeId);
    window.history.replaceState({}, '', url);

    loadDashboardData();
}

// ===== Load data của node hiện tại =====
async function loadDashboardData() {
    try {
        const res = await authFetch(`/api/data?node_id=${currentNodeId}&limit=100`);
        const data = await res.json();

        updateCards(data);
        renderCharts(data);
    } catch (err) {
        console.error('Lỗi load dữ liệu dashboard:', err);
        updateCards([]);
        renderCharts([]);
    }
}

function clearDashboard() {
    updateCards([]);
    renderCharts([]);
}
