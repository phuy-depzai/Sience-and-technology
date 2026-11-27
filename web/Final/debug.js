const DEBUG_FIELDS = ['t','h','v','i','pm1','pm25','pm10','co','voc','nox','voc_pct','nox_pct'];
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
        const r = await authFetch(API + '/api/debug/data?page=' + debugPage + '&limit=' + DEBUG_LIMIT, { headers: { 'X-Auth-Token': getToken() } });
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
        const r = await authFetch(API + '/api/debug/presets', { headers: { 'X-Auth-Token': getToken() } });
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
        const r = await authFetch(API + '/api/debug/presets', {
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
        const r = await authFetch(API + '/api/debug/presets/' + preset.id, {
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
        const r = await authFetch(API + '/api/debug/presets/' + preset.id, { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
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
        const r = await authFetch(API + '/api/data');
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
        const r = await authFetch(API + '/api/debug/clone/' + sensorId, { method: 'POST', headers: { 'X-Auth-Token': getToken() } });
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
        const r = await authFetch(API + '/api/debug/simulate', {
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
        const r = await authFetch(url, {
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
        const r = await authFetch(API + '/api/debug/data/' + id, { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
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
            r = await authFetch(API + '/api/debug/data', {
                method: 'DELETE',
                headers: { 'X-Auth-Token': getToken() }
            });
        } else {
            r = await authFetch(API + '/api/debug/bulk-delete', {
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
        const r = await authFetch(API + '/api/debug/restore/' + id, { method: 'POST', headers: { 'X-Auth-Token': getToken() } });
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
        const r = await authFetch(API + '/api/debug/clone-all', {
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