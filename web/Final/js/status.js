async function loadServiceStatus() {
    try {
        const r = await authFetch(API + '/api/status');
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
        const r = await authFetch(API + '/api/set-status', {
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
            await authFetch(API + '/api/set-status', {
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
