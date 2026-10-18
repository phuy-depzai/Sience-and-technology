const API_AUTH = 'https://airwatch.io.vn';
let currentRole = 'guest';

function getToken() {
    return localStorage.getItem('auth_token') || '';
}

async function checkAuth() {
    try {
        const r = await fetch(API_AUTH + '/api/check?token=' + getToken());
        const data = await r.json();
        currentRole = data.role;
        return currentRole;
    } catch(e) {
        return 'guest';
    }
}

function isAdmin() {
    return currentRole === 'admin';
}

async function login(user, pass) {
    try {
        const r = await fetch(API_AUTH + '/api/login', {
            method: 'POST',
            body: JSON.stringify({ user, pass })
        });
        const data = await r.json();
        if (data.ok && data.token) {
            localStorage.setItem('auth_token', data.token);
            return true;
        }
        return false;
    } catch(e) {
        return false;
    }
}

async function logout() {
    localStorage.removeItem('auth_token');
    window.location.href = 'index.html';
}