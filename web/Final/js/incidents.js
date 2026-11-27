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
        const r = await authFetch(API + '/api/incidents?days=90');
        incidentsData = await r.json();
        if (!incidentsData.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">Chưa có sự cố nào</td></tr>';
            return;
        }
        tbody.innerHTML = incidentsData.map(i => `
            <tr>
                <td>${i.id}</td>
                <td>${escapeHTML(i.service)}</td>
                <td><span class="type-badge ${i.status === 'offline' ? 'edge' : 'manual'}">${escapeHTML(i.status)}</span></td>
                <td style="font-size:11px;">${i.started_at || '—'}</td>
                <td style="font-size:11px; color:#d29922;">${i.eta || '—'}</td>
                <td style="font-size:11px; color:#3fb950;">${i.resolved_at || '—'}</td>
                <td>${escapeHTML(i.note || '—')}</td>
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
        const r = await authFetch(url, {
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
        logAction(
    isEdit ? 'incident_updated' : 'incident_created',
    'incident#' + (editingIncidentId || 'new'),
    (isEdit ? 'Cập nhật' : 'Tạo') + ' sự cố: ' + service + ', trạng thái=' + status,
    isEdit ? 'info' : 'warn'
);
        closeIncidentDialog();
        await loadIncidents();
    } catch(e) { customNotify('Lỗi: ' + e.message, 'error'); }
}

async function deleteIncident(id) {
    if (!(await customConfirm('Xóa sự cố #' + id + '?'))) return;
    try {
        const r = await authFetch(API + '/api/incidents/' + id, { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction(
    'incident_deleted',
    'incident#' + id,
    'Xóa sự cố #' + id,
    'warn'
);
        await loadIncidents();
    } catch(e) { customNotify('Lỗi: ' + e.message, 'error'); }
}