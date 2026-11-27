const API = 'https://airwatch.io.vn';

const TERMS_VERSION = '1';

function checkTermsAgreement() {
    const agreed = localStorage.getItem('terms_agreed_version');
    if (agreed !== TERMS_VERSION) {
        showTermsModal();
        return false;
    }
    return true;
}


function showTermsModal() {
    let overlay = document.getElementById('terms-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'terms-overlay';
        overlay.className = 'terms-overlay';
        overlay.innerHTML = `
            <div class="terms-modal">
                <h2>Điều khoản sử dụng</h2>
                <div class="terms-subtitle">Vui lòng đọc và đồng ý để tiếp tục sử dụng AirWatch</div>
                <div class="terms-content">
                    <p><strong>1. Mục đích:</strong> AirWatch cung cấp dữ liệu chất lượng không khí cho mục đích tham khảo và nghiên cứu. Dữ liệu được cung cấp "nguyên trạng", không đảm bảo chính xác tuyệt đối.</p>
                    <p><strong>2. Giới hạn trách nhiệm:</strong> Không sử dụng dữ liệu cho mục đích y tế, pháp lý, hoặc quyết định quan trọng ảnh hưởng đến tính mạng/tài sản.</p>
                    <p><strong>3. Tính khả dụng:</strong> Hệ thống có thể tạm ngưng để bảo trì, nâng cấp mà không báo trước.</p>
                    <p><strong>4. Quyền riêng tư:</strong> Chúng tôi ghi nhận IP, session, thời gian truy cập để vận hành hệ thống. Dữ liệu lưu cục bộ, không chia sẻ bên thứ 3.</p>
                    <p><strong>5. Quyền của bạn:</strong> Yêu cầu xóa dữ liệu cá nhân, ngừng sử dụng dịch vụ bất kỳ lúc nào.</p>
                    <p>Xem đầy đủ tại <a href="/terms" target="_blank">Điều khoản sử dụng</a>.</p>
                </div>
                <label class="terms-checkbox">
                    <input type="checkbox" id="terms-check">
                    <span>Tôi đã đọc và đồng ý với <strong>Điều khoản sử dụng</strong> của AirWatch</span>
                </label>
                <button id="terms-accept" class="terms-accept-btn" disabled>Tiếp tục</button>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('terms-check').onchange = (e) => {
            document.getElementById('terms-accept').disabled = !e.target.checked;
        };
        document.getElementById('terms-accept').onclick = acceptTerms;
    }
    overlay.style.display = 'flex';
}

function acceptTerms() {
    localStorage.setItem('terms_agreed_version', TERMS_VERSION);
    const overlay = document.getElementById('terms-overlay');
    if (overlay) overlay.style.display = 'none';
}

// ===== HELPERS (bị mất khi replace updateCards) =====
function getTextColor()   { return document.body.classList.contains('light') ? '#666'    : '#8899a6'; }
function getGridColor()   { return document.body.classList.contains('light') ? '#e0e0e0' : '#2a3040'; }
function getLegendColor() { return document.body.classList.contains('light') ? '#1a1f2e' : '#e7e9ea'; }

function timeScaleX() {
    return {
        type: 'time',
        time: {
            unit: 'hour',
            displayFormats: { hour: 'HH:mm', minute: 'HH:mm' },
            tooltipFormat: 'HH:mm:ss dd/MM'
        },
        ticks: { color: getTextColor(), maxTicksLimit: 10, autoSkip: true },
        grid: { color: getGridColor() }
    };
}

function baseOptions(t, c) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 1500, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: getLegendColor() } } },
        scales: {
            x: timeScaleX(),
            y: {
                position: 'left',
                ticks: { color: c },
                grid: { color: getGridColor() },
                title: { display: true, text: t, color: c }
            }
        }
    };
}

function downsample(d, m) {
    if (d.length <= m) return d;
    const s = (d.length - 1) / (m - 1);
    const o = [];
    for (let i = 0; i < m; i++) o.push(d[Math.round(i * s)]);
    return o;
}

function toPointsSafe(data, field, scale = 1) {
    if (!data || !data.length) return [];

    // 1. Map ra {x, y} với x = timestamp (ms)
    const raw = [];
    for (const d of data) {
        const rawX = d.recorded_at || d.ts;
        if (!rawX) continue;
        const x = new Date(rawX).getTime();
        if (isNaN(x)) continue;
        const yVal = d[field];
        if (yVal == null || isNaN(yVal)) continue;
        raw.push({ x, y: yVal * scale });
    }

    // 2. Sort theo x
    raw.sort((a, b) => a.x - b.x);

    // 3. Dedup theo x — giữ giá trị CUỐI (mới nhất)
    const map = new Map();
    for (const p of raw) {
        map.set(p.x, p.y);
    }

    // 4. Trả về mảng sorted, unique x
    return Array.from(map.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([x, y]) => ({ x, y }));
}
// ============================================================
// INTENSITY THRESHOLDS — QCVN 05:2023/BTNMT
// ============================================================
const THRESHOLDS = {
    pm25: [
        { max: 25,  color: '#4CAF50', opacity: 0.35 },
        { max: 50,  color: '#8BC34A', opacity: 0.55 },
        { max: 80,  color: '#FF9800', opacity: 0.75 },
        { max: 150, color: '#F44336', opacity: 0.9 },
        { max: 250, color: '#9C27B0', opacity: 1.0, glow: true },
        { max: 500, color: '#7B1FA2', opacity: 1.0, glow: true, pulse: true }
    ],
    pm10: [
        { max: 50,  color: '#4CAF50', opacity: 0.35 },
        { max: 100, color: '#8BC34A', opacity: 0.55 },
        { max: 150, color: '#FF9800', opacity: 0.75 },
        { max: 250, color: '#F44336', opacity: 0.9 },
        { max: 350, color: '#9C27B0', opacity: 1.0, glow: true },
        { max: 500, color: '#7B1FA2', opacity: 1.0, glow: true, pulse: true }
    ],
    co: [
        { max: 4,   color: '#FF5722', opacity: 0.35 },
        { max: 8.7, color: '#FF7043', opacity: 0.55 },
        { max: 26,  color: '#FF9800', opacity: 0.75 },
        { max: 39,  color: '#F44336', opacity: 0.9 },
        { max: 52,  color: '#9C27B0', opacity: 1.0, glow: true },
        { max: 131, color: '#7B1FA2', opacity: 1.0, glow: true, pulse: true }
    ],
    voc_pct: [
        { max: 100, color: '#9C27B0', opacity: 0.35 },
        { max: 110, color: '#AB47BC', opacity: 0.55 },
        { max: 120, color: '#FF9800', opacity: 0.75 },
        { max: 150, color: '#F44336', opacity: 0.9, glow: true },
        { max: 999, color: '#7B1FA2', opacity: 1.0, glow: true, pulse: true }
    ],
    nox_pct: [
        { max: 100, color: '#00BCD4', opacity: 0.35 },
        { max: 110, color: '#26C6DA', opacity: 0.55 },
        { max: 120, color: '#FF9800', opacity: 0.75 },
        { max: 150, color: '#F44336', opacity: 0.9, glow: true },
        { max: 999, color: '#7B1FA2', opacity: 1.0, glow: true, pulse: true }
    ]
};

function getIntensity(value, param) {
    const list = THRESHOLDS[param];
    if (!list || value === null || value === undefined || isNaN(value)) {
        return { color: '#8899a6', opacity: 0.4, glow: false, pulse: false };
    }
    for (const t of list) {
        if (value <= t.max) return t;
    }
    return list[list.length - 1];
}

function hexToRgba(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${opacity})`;
}

function applyCardIntensity(id, value, param) {
    const el = document.getElementById(id);
    if (!el) return;
    const t = getIntensity(value, param);
    el.style.color = t.color;
    el.style.textShadow = t.glow ? `0 0 12px ${t.color}` : 'none';
    el.style.transition = 'color 0.3s, text-shadow 0.3s';
    const card = el.closest('.card');
    if (card) {
        card.style.borderColor = hexToRgba(t.color, t.opacity * 0.6);
        card.style.background = `linear-gradient(135deg, ${hexToRgba(t.color, 0.08)}, var(--bg-card))`;
        card.style.transition = 'border-color 0.3s, background 0.3s';
        if (t.pulse) card.style.animation = 'statusPulse 2s ease-in-out infinite';
        else card.style.animation = '';
    }
}

function makeValueGradient(ctx, param, yAxisId) {
    const chart = ctx.chart;
    const chartArea = chart.chartArea;
    if (!chartArea) return 'rgba(136,153,166,0.3)';
    const c = chart.ctx;
    const gradient = c.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    const list = THRESHOLDS[param];
    let yScale = yAxisId ? chart.scales[yAxisId] : null;
    if (!yScale) {
        const key = Object.keys(chart.scales).find(k => chart.scales[k].position);
        yScale = key ? chart.scales[key] : null;
    }
    const maxVal = (yScale && yScale.max) ? yScale.max : list[list.length - 1].max;
    list.forEach(t => {
        const ratio = Math.min(t.max / maxVal, 1);
        gradient.addColorStop(ratio, t.color);
    });
    return gradient;
}

// ============================================================
// HELPERS
// ============================================================
function fmtAgo(min) {
    if (min < 1) return 'vừa xong';
    if (min < 60) return min + ' phút trước';
    if (min < 1440) return Math.floor(min / 60) + ' giờ trước';
    const d = Math.floor(min / 1440);
    const h = Math.floor((min % 1440) / 60);
    return h > 0 ? d + 'd ' + h + 'h trước' : d + ' ngày trước';
}

const dashCharts  = { env: null, volt: null, curr: null, pm: null, gas: null, co: null, minmax: null };
const debugCharts = { env: null, volt: null, curr: null, pm: null, gas: null, co: null, minmax: null };
function getLocalDate() {
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 3600 * 1000));
    return vnTime.getUTCFullYear() + '-' +
           String(vnTime.getUTCMonth() + 1).padStart(2, '0') + '-' +
           String(vnTime.getUTCDate()).padStart(2, '0');
}

function tsToMs(ts) {
    if (!ts) return 0;
    return new Date(String(ts).replace(' ', 'T')).getTime();
}
function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// ============================================================
// STEP-UP AUTH — Yêu cầu TOTP khi backend trả 403
// ============================================================
async function fetchWithTOTP(url, options = {}) {
    let response = await fetch(url, options);

    if (response.status === 403) {
        const data = await response.clone().json();
        if (data.require_totp) {
            const otp = await promptTOTP(data.reason, data.hint);
            if (!otp) throw new Error('Đã hủy');

            let body = {};
            if (options.body) {
                try { body = JSON.parse(options.body); } catch(e) {}
            }
            body.otp = otp;

            response = await fetch(url, { ...options, body: JSON.stringify(body) });
        }
    }

    return response;
}

function promptTOTP(reason, hint) {
    return new Promise((resolve) => {
        const labels = {
            'create_user': 'Tạo user mới',
            'update_user': 'Sửa thông tin user',
            'delete_user': 'Xóa user',
            'add_trusted_ip': 'Thêm IP tin cậy',
            'toggle_trusted_ip': 'Đổi trạng thái IP tin cậy',
            'delete_trusted_ip': 'Xóa IP tin cậy',
            'clear_debug': 'Clear toàn bộ debug DB',
            'delete_debug': 'Xóa record debug'
        };

        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
                <h3 style="color:var(--text);margin:0 0 8px;font-size:20px;">🔐 Xác thực 2 lớp</h3>
                <p style="color:var(--text-muted);font-size:13px;margin:0 0 6px;">${labels[reason] || reason}</p>
                <p style="color:#d29922;font-size:12px;margin:0 0 20px;">${hint || ''}</p>
                <label style="display:block;margin-bottom:16px;">
                    <span style="display:block;font-size:13px;color:var(--text-muted);margin-bottom:8px;">Nhập mã OTP 6 số</span>
                    <input type="text" id="totp-input" inputmode="numeric" pattern="[0-9]{6}" maxlength="6"
                        placeholder="123456" autocomplete="one-time-code"
                        style="width:100%;padding:14px;font-size:24px;letter-spacing:8px;text-align:center;font-family:monospace;background:var(--bg);border:2px solid var(--border);border-radius:10px;color:var(--text);">
                </label>
                <div style="display:flex;gap:10px;">
                    <button id="totp-cancel" style="flex:1;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;font-size:14px;">Hủy</button>
                    <button id="totp-confirm" style="flex:1;padding:12px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-weight:600;cursor:pointer;font-size:14px;">Xác nhận</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const input = document.getElementById('totp-input');
        input.focus();

        const cleanup = (val) => { modal.remove(); resolve(val); };
        document.getElementById('totp-cancel').onclick = () => cleanup(null);
        document.getElementById('totp-confirm').onclick = () => {
            const v = input.value.trim();
            if (!/^\d{6}$/.test(v)) { input.style.borderColor = '#f85149'; return; }
            cleanup(v);
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('totp-confirm').click();
        });
    });
}
// ============================================================
// CUSTOM CONFIRM MODAL
// ============================================================
function customConfirm(message, options = {}) {
    return new Promise((resolve) => {
        const title = options.title || 'Xác nhận';
        const okText = options.okText || 'Đồng ý';
        const cancelText = options.cancelText || 'Hủy';
        const danger = options.danger !== false;

        const overlay = document.createElement('div');
        overlay.className = 'custom-confirm-overlay';
        overlay.innerHTML = `
            <div class="custom-confirm-modal">
                <h3 class="custom-confirm-title">${title}</h3>
                <p class="custom-confirm-message">${escapeHtml(message)}</p>
                <div class="custom-confirm-actions">
                    <button class="cc-btn cc-cancel">${cancelText}</button>
                    <button class="cc-btn cc-ok ${danger ? 'cc-danger' : ''}">${okText}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('cc-visible'));

        const cleanup = (result) => {
            overlay.classList.remove('cc-visible');
            setTimeout(() => overlay.remove(), 150);
            resolve(result);
        };

        overlay.querySelector('.cc-ok').onclick = () => cleanup(true);
        overlay.querySelector('.cc-cancel').onclick = () => cleanup(false);
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
        const escHandler = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); cleanup(false); } };
        document.addEventListener('keydown', escHandler);
    });
}

// ============================================================
// CUSTOM NOTIFY
// ============================================================
function customNotify(message, type = 'info', duration = 3500) {
    const icons = { success: '✅', error: '❌', warn: '⚠️', info: 'ℹ️' };
    const colors = { success: '#4CAF50', error: '#f85149', warn: '#ff9800', info: '#2196F3' };

    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.style.setProperty('--toast-color', colors[type] || colors.info);
    toast.innerHTML = `
        <span class="custom-toast-icon">${icons[type] || icons.info}</span>
        <span class="custom-toast-msg">${escapeHtml(message)}</span>
        <button class="custom-toast-close" aria-label="Đóng">×</button>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    const remove = () => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 200);
    };
    toast.querySelector('.custom-toast-close').onclick = remove;
    if (duration > 0) setTimeout(remove, duration);}