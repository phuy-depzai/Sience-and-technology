(async () => {
    await checkAuth();
    updateAuthUI();
    applyTheme();
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
            window.location.href = 'index.html';
        }
    }
}

function closeLogin() {
    const m = document.getElementById('login-modal');
    if (m) m.style.display = 'none';
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

// Login form (chỉ index.html có)
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = document.getElementById('login-user').value.trim();
        const pass = document.getElementById('login-pass').value;
        const errEl = document.getElementById('login-error');
        errEl.textContent = '';
        const ok = await login(user, pass);
        if (ok) {
            closeLogin();
            await checkAuth();
            updateAuthUI();
            document.getElementById('login-user').value = '';
            document.getElementById('login-pass').value = '';
        } else {
            errEl.textContent = 'Sai tài khoản hoặc mật khẩu';
        }
    });
}