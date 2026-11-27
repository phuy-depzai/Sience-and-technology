async function logAction(action, target, details, severity) {
    try {
        await authFetch(API + '/api/logs', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
            body: JSON.stringify({
                action,
                target: target || '',
                details: details || '',
                severity: severity || 'info',
                author: localStorage.getItem('username') || 'unknown'
            })
        });
    } catch(e) {
        console.warn('[LOG]', e);
    }
}
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
        const r = await authFetch(url, { headers: { 'X-Auth-Token': getToken() } });
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
        const r = await authFetch(API + '/api/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ action, target, details, severity, author: localStorage.getItem('username') || 'unknown'})
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        closeLogDialog();
        await loadLogs();
    } catch(e) { customNotify('Ghi log thất bại: ' + e.message, 'error'); }
}

async function deleteLog(id) {
    if (!(await customConfirm('Xóa log #' + id + '?'))) return;
    try {
        const r = await authFetch(API + '/api/logs/' + id, { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadLogs();
    } catch(e) { customNotify('Xóa thất bại: ' + e.message, 'error'); }
}
