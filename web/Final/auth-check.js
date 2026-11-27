const API_AUTH = 'https://airwatch.io.vn';

let currentRole = 'guest';
let currentUsername = '';

function isLocalHost() {
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

function isDevMode() {
    return isLocalHost() && (
        localStorage.getItem('dev_mode') === '1' ||
        new URLSearchParams(location.search).has('dev')
    );
}

function setDevMode(enabled) {
    if (!isLocalHost()) return false; // chỉ cho local
    localStorage.setItem('dev_mode', enabled ? '1' : '0');
    return true;
}

function getToken() {
    return localStorage.getItem('auth_token') || '';
}

function authFetch(url, options = {}) {
    const token = getToken();
    const headers = new Headers(options.headers || {});

    if (!headers.has('X-Auth-Token') && token) {
        headers.set('X-Auth-Token', token);
    }

    const isForm = options.body instanceof FormData
                || options.body instanceof Blob
                || options.body instanceof URLSearchParams;
    if (options.body && !isForm && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    return fetch(url, { ...options, headers, credentials: 'same-origin' })
        .then(res => {
            if (res.status === 401) {
                console.warn('[authFetch] 401 →', url, '| token?', !!token);
            }
            return res;
        });
}
async function checkAuth() {
    try {
        if (isDevMode()) {
            currentRole = localStorage.getItem('dev_role') || 'admin';
            currentUsername = localStorage.getItem('dev_username') || 'dev';
            return currentRole;
        }

        const r = await fetch(API_AUTH + '/api/check', {
            headers: { 'X-Auth-Token': getToken() }
        });

        const data = await r.json();
        currentRole = data.role || 'guest';
        currentUsername = data.username || '';
        return currentRole;
    } catch (e) {
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
        if (isDevMode()) {
            localStorage.setItem('auth_token', 'dev_token');
            localStorage.setItem('admin_user', user || 'dev');
            localStorage.setItem('admin_displayname', user || 'dev');
            localStorage.setItem('admin_role', 'admin');
            currentRole = 'admin';
            currentUsername = user || 'dev';
            return {
                ok: true,
                data: {
                    ok: true,
                    token: 'dev_token',
                    user: user || 'dev',
                    displayname: user || 'dev',
                    role: 'admin'
                }
            };
        }

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
            localStorage.setItem('admin_displayname', data.displayname || data.user);
            currentRole = data.role || 'admin';
            currentUsername = data.user || user || '';
            return { ok: true, data };
        }

        return { ok: false, data };
    } catch (e) {
        return { ok: false, data: { error: e.message } };
    }
}

async function logout() {
    const token = localStorage.getItem('auth_token');

    try {
        if (token && !isDevMode()) {
            await fetch(API_AUTH + '/api/logout', {
                method: 'POST',
                headers: { 'X-Auth-Token': token }
            });
        }
    } catch (e) {
        console.error('Lỗi gọi API logout:', e);
    }

    localStorage.removeItem('auth_token');
    localStorage.removeItem('admin_user');
    localStorage.removeItem('admin_displayname');
    localStorage.removeItem('admin_role');
    localStorage.removeItem('admin_tab');
    localStorage.removeItem('terms_agreed_version');

    currentRole = 'guest';
    currentUsername = '';

    window.location.href = '/';
}