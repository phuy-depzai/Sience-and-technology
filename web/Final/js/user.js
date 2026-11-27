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
        const r = await authFetch(API + '/api/users', { headers: { 'X-Auth-Token': getToken() } });
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
            <td><strong>${escapeHTML(u.username)}</strong></td>
            <td>${escapeHTML(u.displayname || u.username)}</td>
            <td><span class="type-badge ${u.role === 'head_admin' ? 'edge' : 'manual'}">${escapeHTML(u.role)}</span></td>
            <td>${u.active ? '<span style="color:#3fb950;">✓ Active</span>' : '<span style="color:#f85149;">✗ Disabled</span>'}</td>
            <td>${u.totp_enabled ? '✓' : '—'}</td>
            <td style="font-size:11px;">${u.last_login || '—'}</td>
            <td style="font-size:11px;">${u.created_at || '—'}</td>
            <td>
                <button class="action-btn edit" onclick="editUser(${u.id})" title="Sửa pass/role">✏️</button>
                <button class="action-btn ${u.active ? 'del' : 'restore'}" onclick="toggleUserActive(${u.id}, ${u.active ? 0 : 1})" title="${u.active ? 'Disable' : 'Enable'}">${u.active ? '🔒' : '🔓'}</button>
                <button class="action-btn del" onclick="deleteUser(${u.id}, '${escapeHTML(u.username).replace(/'/g, "\\'")}')" title="Xóa">🗑️</button>
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
        const r = await fetchWithTOTP(API + '/api/users/' + id, {
            method: 'DELETE',
            headers: {
                'X-Auth-Token': getToken()
            }
        });

        const d = await r.json().catch(() => ({}));

        if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);

        await loadUsers();
    } catch(e) {
        if (e.message !== 'Đã hủy') {
            customNotify('Xóa thất bại: ' + e.message, 'error');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const pwd = document.getElementById('user-form-password');
    if (pwd) pwd.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitUser(); } });
});