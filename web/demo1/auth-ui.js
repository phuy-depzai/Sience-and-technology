(async () => {
    await checkAuth();
    updateAuthUI();
    applyTheme();
    updateAdminOnly();
})();

function updateAuthUI() {
    const btn = document.getElementById('auth-btn');
    const action = document.getElementById('auth-action');
    if (!btn || !action) return;

    if (isAdmin()) {
        btn.textContent = 'Admin ▾';
        action.textContent = '🚪 Đăng xuất';
    } else {
        btn.textContent = 'Guest ▾';
        action.textContent = '🔑 Đăng nhập';
    }
}

function updateAdminOnly() {
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = isAdmin() ? '' : 'none';
    });
}

function toggleMenu(e) {
    e.stopPropagation();
    const m = document.getElementById('dropdown-menu');
    if (m) m.classList.toggle('open');
}

document.addEventListener('click', () => {
    const m = document.getElementById('dropdown-menu');
    if (m) m.classList.remove('open');
});

function handleAuthAction() {
    if (isAdmin()) {
        logout();
    } else {
        const modal = document.getElementById('login-modal');
        if (modal) {
            modal.style.display = 'flex';
        } else {
            window.location.href = '/';
        }
    }
}

function closeLogin() {
    const m = document.getElementById('login-modal');
    if (m) m.style.display = 'none';
    const otpEl = document.getElementById('login-otp');
    const otpWrap = document.getElementById('login-otp-wrap');
    if (otpEl) otpEl.value = '';
    if (otpWrap) otpWrap.style.display = 'none';
    const errEl = document.getElementById('login-error');
    if (errEl) { errEl.textContent = ''; errEl.style.color = ''; }
}

function toggleTheme() {
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    updateThemeLabel();
}

function applyTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    if (saved === 'light') {
        document.body.classList.add('light');
    } else {
        document.body.classList.remove('light');
    }
    updateThemeLabel();
}

function updateThemeLabel() {
    const icon = document.getElementById('theme-icon');
    const label = document.getElementById('theme-label');
    if (!icon || !label) return;

    if (document.body.classList.contains('light')) {
        icon.textContent = '☀️';
        label.textContent = 'Chế độ sáng';
    } else {
        icon.textContent = '🌙';
        label.textContent = 'Chế độ tối';
    }
}

// Login form (chỉ index.html)
const loginForm = document.getElementById('login-form');
if (loginForm) {
    const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = document.getElementById('login-user').value.trim();
        const pass = document.getElementById('login-pass').value;
        const otpEl = document.getElementById('login-otp');
        const otpWrap = document.getElementById('login-otp-wrap');
        const otp = otpEl ? otpEl.value.trim() : '';
        const errEl = document.getElementById('login-error');

        if (!user || !pass) {
            errEl.textContent = 'Nhập đủ tài khoản và mật khẩu';
            errEl.style.color = '#f85149';
            return;
        }

        errEl.textContent = 'Đang đăng nhập...';
        errEl.style.color = 'var(--text-muted)';

        const result = await login(user, pass, otp);

        if (result.ok) {
            if (otpEl) otpEl.value = '';
            if (otpWrap) otpWrap.style.display = 'none';
            document.getElementById('login-user').value = '';
            document.getElementById('login-pass').value = '';
            errEl.textContent = '';
            closeLogin();
            location.reload();
            return;
        }

        if (result.data && result.data.need_otp) {
            if (otpWrap) {
                otpWrap.style.display = 'block';
                if (otpEl) otpEl.focus();
            }
            errEl.textContent = 'Nhập mã 6 số từ Google Authenticator';
            errEl.style.color = '#d29922';
            return;
        }

       if (result.data && result.data.need_setup_totp) {
    closeLogin();
    openQRSetup(user, pass);
    return;
}   

        errEl.textContent = (result.data && result.data.error) || 'Đăng nhập thất bại';
        errEl.style.color = '#f85149';
    });
};
}
// ===== QR SETUP =====
let _qrUser = '', _qrPass = '';

async function openQRSetup(user, pass) {
    _qrUser = user;
    _qrPass = pass;
    const modal = document.getElementById('qr-modal');
    const img = document.getElementById('qr-img');
    const secretEl = document.getElementById('qr-secret');
    const errEl = document.getElementById('qr-error');

    errEl.textContent = 'Đang tạo QR...';
    errEl.style.color = 'var(--text-muted)';
    modal.style.display = 'flex';

    try {
        const r = await fetch(API_AUTH + '/api/totp/qr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: user, pass: pass })
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'QR gen fail');

        img.src = d.qr_base64;
        secretEl.textContent = d.secret;
        errEl.textContent = '';
        setTimeout(() => document.getElementById('qr-otp').focus(), 300);
    } catch(e) {
        errEl.textContent = 'Lỗi: ' + e.message;
        errEl.style.color = '#f85149';
    }
}

function closeQRModal() {
    const m = document.getElementById('qr-modal');
    if (m) m.style.display = 'none';
    document.getElementById('qr-otp').value = '';
    document.getElementById('qr-error').textContent = '';
}

async function verifyQRCode() {
    const otp = document.getElementById('qr-otp').value.trim();
    const errEl = document.getElementById('qr-error');
    const btn = document.getElementById('qr-verify-btn');

    if (!/^\d{6}$/.test(otp)) {
        errEl.textContent = 'Mã phải 6 chữ số';
        errEl.style.color = '#f85149';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Đang xác nhận...';
    errEl.textContent = '';

    try {
        const r = await fetch(API_AUTH + '/api/totp/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: _qrUser, pass: _qrPass, otp: otp })
        });
        const d = await r.json();

        if (d.ok && d.token) {
            localStorage.setItem('auth_token', d.token);
            localStorage.setItem('admin_user', d.user || _qrUser);
            if (typeof currentRole !== 'undefined') currentRole = d.role || 'head_admin';
            closeQRModal();
            errEl.textContent = '';
            location.reload();
            return;
        }

        errEl.textContent = d.error || 'Mã OTP không đúng';
        errEl.style.color = '#f85149';
        document.getElementById('qr-otp').value = '';
        document.getElementById('qr-otp').focus();
    } catch(e) {
        errEl.textContent = 'Lỗi: ' + e.message;
        errEl.style.color = '#f85149';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Xác nhận';
    }
}

// Enter trong ô OTP → verify
document.addEventListener('DOMContentLoaded', () => {
    const otpInput = document.getElementById('qr-otp');
    if (otpInput) {
        otpInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); verifyQRCode(); }
        });
    }
});