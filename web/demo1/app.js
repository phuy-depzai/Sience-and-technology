const API = 'http://192.168.1.54:1880';
let chartEnv = null;
let chartVolt = null;
let chartCurr = null;

(async () => {
    await checkAuth();
    console.log('Role:', currentRole);

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
})();

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
    if (isAdmin()) {
        logout();
    } else {
        window.location.href = 'index.html';
    }
}

function toggleTheme() {
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    updateThemeLabel();
    updateCharts();
}

function applyTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    if (saved === 'light') {
        document.body.classList.add('light');
    } else {
        document.body.classList.remove('light');
    }
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
    } catch(e) {
        console.error('System data fail:', e);
    }
}

async function fetchData() {
    try {
        const r = await fetch(API + '/api/data');
        return await r.json();
    } catch(e) {
        console.error('API fail:', e);
        return [];
    }
}

function setStatus(online) {
    const s = document.getElementById('status');
    if (!s) return;
    if (online) {
        s.className = 'status';
        s.textContent = 'LIVE';
    } else {
        s.className = 'status offline';
        s.textContent = 'OFFLINE';
    }
}

async function updateLatest() {
    const data = await fetchData();
    if (!data.length) {
        setStatus(false);
        return;
    }
    const last = data[data.length - 1];
    const temp = document.getElementById('temp');
    const hum = document.getElementById('hum');
    const volt = document.getElementById('volt');
    const curr = document.getElementById('curr');
    const updated = document.getElementById('updated');

    if (temp) temp.textContent = last.t.toFixed(2);
    if (hum) hum.textContent = last.h.toFixed(2);
    if (volt) volt.textContent = last.v.toFixed(3);
    if (curr) curr.textContent = (last.i * 1000).toFixed(2);
    if (updated) updated.textContent = last.ts;
    setStatus(true);
}

function getTextColor() {
    return document.body.classList.contains('light') ? '#666' : '#8899a6';
}

function getGridColor() {
    return document.body.classList.contains('light') ? '#e0e0e0' : '#2a3040';
}

function getLegendColor() {
    return document.body.classList.contains('light') ? '#1a1f2e' : '#e7e9ea';
}

function baseOptions(yTitle, color) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { labels: { color: getLegendColor() } }
        },
        scales: {
            x: {
                ticks: { color: getTextColor(), maxTicksLimit: 10 },
                grid: { color: getGridColor() }
            },
            y: {
                position: 'left',
                ticks: { color: color },
                grid: { color: getGridColor() },
                title: { display: true, text: yTitle, color: color }
            }
        }
    };
}

async function updateCharts() {
    const data = await fetchData();
    if (!data.length) return;

    const labels = data.map(x => x.ts.split(' ')[1] || x.ts);

    if (chartEnv) chartEnv.destroy();
    chartEnv = new Chart(document.getElementById('chart-env'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Nhiệt độ (°C)',
                    data: data.map(x => x.t),
                    borderColor: '#f44336',
                    backgroundColor: 'rgba(244,67,54,0.1)',
                    tension: 0.3,
                    yAxisID: 'y_temp'
                },
                {
                    label: 'Độ ẩm (%)',
                    data: data.map(x => x.h),
                    borderColor: '#2196F3',
                    backgroundColor: 'rgba(33,150,243,0.1)',
                    tension: 0.3,
                    yAxisID: 'y_hum'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: getLegendColor() } } },
            scales: {
                x: {
                    ticks: { color: getTextColor(), maxTicksLimit: 10 },
                    grid: { color: getGridColor() }
                },
                y_temp: {
                    position: 'left',
                    ticks: { color: '#f44336' },
                    grid: { color: getGridColor() },
                    title: { display: true, text: 'Nhiệt độ (°C)', color: '#f44336' }
                },
                y_hum: {
                    position: 'right',
                    ticks: { color: '#2196F3' },
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'Độ ẩm (%)', color: '#2196F3' }
                }
            }
        }
    });

    if (!isAdmin()) return;

    if (chartVolt) chartVolt.destroy();
    chartVolt = new Chart(document.getElementById('chart-volt'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Điện áp (V)',
                data: data.map(x => x.v),
                borderColor: '#FF9800',
                backgroundColor: 'rgba(255,152,0,0.1)',
                tension: 0.3,
                fill: true
            }]
        },
        options: (() => {
            const o = baseOptions('Điện áp (V)', '#FF9800');
            o.scales.y.min = 2.0;
            o.scales.y.max = 3.6;
            return o;
        })()
    });

    if (chartCurr) chartCurr.destroy();
    chartCurr = new Chart(document.getElementById('chart-curr'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Dòng điện (mA)',
                data: data.map(x => x.i * 1000),
                borderColor: '#9C27B0',
                backgroundColor: 'rgba(156,39,176,0.1)',
                tension: 0.3,
                fill: true
            }]
        },
        options: (() => {
            const o = baseOptions('Dòng điện (mA)', '#9C27B0');
            o.scales.y.min = 0;
            o.scales.y.max = 100;
            return o;
        })()
    });
}

// ===== WEBSOCKET =====
let ws = null;
let wsPingInterval = null;

function connectWebSocket() {
    ws = new WebSocket('ws://192.168.1.54:1880/ws/data');

    ws.onopen = () => {
        console.log('[WS] connected');
        wsPingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send('ping');
            }
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

    ws.onerror = () => {
        console.error('[WS] error');
    };
}

function updateFromWS(d) {
    if (d.t === undefined) return;

    const temp = document.getElementById('temp');
    const hum = document.getElementById('hum');
    const volt = document.getElementById('volt');
    const curr = document.getElementById('curr');
    const updated = document.getElementById('updated');

    if (temp) temp.textContent = d.t.toFixed(2);
    if (hum) hum.textContent = d.h.toFixed(2);
    if (volt) volt.textContent = d.v.toFixed(3);
    if (curr) curr.textContent = (d.i * 1000).toFixed(2);
    if (updated) updated.textContent = new Date().toLocaleString('vi-VN');
    setStatus(true);

    addPointToCharts(d);
}

function addPointToCharts(d) {
    const label = new Date().toLocaleTimeString('vi-VN');

    if (chartEnv) {
        chartEnv.data.labels.push(label);
        chartEnv.data.datasets[0].data.push(d.t);
        chartEnv.data.datasets[1].data.push(d.h);
        if (chartEnv.data.labels.length > 100) {
            chartEnv.data.labels.shift();
            chartEnv.data.datasets.forEach(ds => ds.data.shift());
        }
        chartEnv.update('none');
    }

    if (!isAdmin()) return;

    if (chartVolt) {
        chartVolt.data.labels.push(label);
        chartVolt.data.datasets[0].data.push(d.v);
        if (chartVolt.data.labels.length > 100) {
            chartVolt.data.labels.shift();
            chartVolt.data.datasets.forEach(ds => ds.data.shift());
        }
        chartVolt.update('none');
    }

    if (chartCurr) {
        chartCurr.data.labels.push(label);
        chartCurr.data.datasets[0].data.push(d.i * 1000);
        if (chartCurr.data.labels.length > 100) {
            chartCurr.data.labels.shift();
            chartCurr.data.datasets.forEach(ds => ds.data.shift());
        }
        chartCurr.update('none');
    }
}

// ===== INIT =====
updateLatest();
updateCharts();

setInterval(updateLatest, 60000);

connectWebSocket();