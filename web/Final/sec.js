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
        const r = await authFetch(API + '/api/trusted-ips', { headers: { 'X-Auth-Token': getToken() } });
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
        const r = await authFetch(API + '/api/sessions', { headers: { 'X-Auth-Token': getToken() } });
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
        const r = await authFetch(API + '/api/sensitive-actions?limit=50', { headers: { 'X-Auth-Token': getToken() } });
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
        const r = await fetchWithTOTP(API + '/api/revoke', {
    method: 'POST',
    headers: { 
        'Content-Type': 'application/json',
        'X-Auth-Token': getToken()
    },
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
        const r = await fetchWithTOTP(API + '/api/revoke', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Auth-Token': getToken()
            },
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

    } catch(e) {
        customNotify('Lỗi: ' + e.message, 'error');
    }
}