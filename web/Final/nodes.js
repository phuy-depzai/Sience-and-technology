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
        const r = await authFetch(API + '/api/nodes');
        const nodes = await r.json();
        if (!nodes || !nodes.length) return;
        nodes.forEach(n => {
            const m = L.circleMarker([n.lat, n.lng], { radius: 9, fillColor: '#4CAF50', color: '#fff', weight: 2, fillOpacity: 0.9 }).addTo(adminMap).bindPopup('<strong>' + escapeHtml(n.name || n.id) + '</strong><br><small>' + n.lat.toFixed(4) + ', ' + n.lng.toFixed(4) + '</small>');
            adminMarkers.push(m);
        });
    } catch(e) { console.error('[MAP]', e); }
}

async function addNode() {
    let id = document.getElementById('node-id').value.trim();
    const name = document.getElementById('node-name').value.trim();
    const lat = document.getElementById('node-lat').value.trim();
    const lng = document.getElementById('node-lng').value.trim();

    if (!id || !name || !lat || !lng) {
        customNotify('Vui lòng điền đầy đủ + click bản đồ', 'warn');
        return;
    }

    // validate: chỉ cho nhập số, tối đa 3 chữ số
    if (!/^\d{1,3}$/.test(id)) {
        customNotify('ID Node phải là số, tối đa 3 chữ số (vd: 1, 01, 001)', 'warn');
        return;
    }

    // chuẩn hóa về đúng 3 chữ số, khớp format bên sensor.node_id
    id = id.padStart(3, '0');

    try {
        const r = await authFetch(API + '/api/nodes', {
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
    } catch(e) {
        customNotify('Thêm node thất bại: ' + e.message, 'error');
    }
}

async function loadNodes() {
    const box = document.getElementById('nodes-list');
    if (!box) return;
    box.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">Đang tải...</div>';
    try {
        const [nr, dr] = await Promise.all([authFetch(API + '/api/nodes'), authFetch(API + '/api/data')]);
        const nodes = await nr.json();
        const data = await dr.json();
        if (!nodes || !nodes.length) { box.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">Chưa có node nào.</div>'; return; }
        
        const lastData = (data && data.length) ? data[data.length - 1] : null;
        const lastMs = lastData ? tsToMs(lastData.ts) : 0;
        const diffMin = lastMs ? Math.floor((Date.now() - lastMs) / 60000) : 99999;
        const status = diffMin < 15 ? 'working' : diffMin < 60 ? 'delayed' : 'offline';
        
        // ĐÃ XÓA THẺ <div class="node-last">...</div> Ở ĐÂY
        box.innerHTML = nodes.map(n => `<div class="node-row"><div class="node-info"><div class="node-name">${escapeHtml(n.name || n.id || 'Node')}</div><div class="node-meta">${(n.lat||0).toFixed(4)}, ${(n.lng||0).toFixed(4)}</div></div><div class="node-status"><span class="status-dot ${status}"></span><span class="status-label ${status}">${status}</span></div><button class="node-delete" onclick="deleteNode('${n.id}', '${(n.name || n.id).replace(/'/g, "\\'")}')" title="Xóa node">🗑️</button></div>`).join('');
       
    } catch(e) { box.innerHTML = '<div style="color:#f85149; padding:20px;">Lỗi load node: ' + e.message + '</div>'; }
}

async function deleteNode(id, name) {
    if (!await customConfirm(`Xóa node "${name}" (ID: ${id})?\n\nHành động này không thể hoàn tác.`)) return;
    try {
        const r = await authFetch(API + '/api/nodes/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        loadNodes();
        loadNodesOnMap();
    } catch(e) { customNotify('Xóa thất bại: ' + e.message, 'error'); }
}