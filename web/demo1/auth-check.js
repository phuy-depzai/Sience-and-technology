const API_AUTH = 'https://airwatch.io.vn';
let currentRole = 'guest';
let currentUsername = '';

function getToken() {
    return localStorage.getItem('auth_token') || '';
}

async function checkAuth() {
    try {
        const r = await fetch(API_AUTH + '/api/check?token=' + getToken());
        const data = await r.json();
        currentRole = data.role || 'guest';
        currentUsername = data.username || '';
        return currentRole;
    } catch(e) {
        currentRole = 'guest';
        return 'guest';
    }
}

function isAdmin() {
    return currentRole === 'admin' || currentRole === 'head_admin';
}

function isHeadAdmin() {
    return currentRole === 'head_admin';
}

async function login(user, pass, otp) {
    try {
        const body = { user, pass };
        if (otp) body.otp = otp;
        const r = await fetch(API_AUTH + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await r.json();
        if (data.ok && data.token) {
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('admin_user', data.user || user);
            currentRole = data.role || 'admin';
            return { ok: true, data };
        }
        return { ok: false, data };
    } catch(e) {
        return { ok: false, data: { error: e.message } };
    }
}

async function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('admin_user');
    window.location.href = '/';
}