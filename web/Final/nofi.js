let lastSeenLogId = parseInt(localStorage.getItem('last_seen_log_id') || '0');

async function checkNewNotifications() {
    if (!isAdmin()) return;
    try {
        const r = await authFetch(API + '/api/logs?limit=10', { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) return;
        const logs = await r.json();
        if (!Array.isArray(logs) || !logs.length) return;

        const newWarns = logs.filter(l => l.id > lastSeenLogId && (l.severity === 'warn' || l.severity === 'error'));
        const maxId = Math.max(...logs.map(l => l.id), lastSeenLogId);

        if (newWarns.length > 0) {
            newWarns.forEach(l => showToast(l));
            const badge = document.getElementById('log-badge');
            if (badge) {
                const current = parseInt(badge.textContent) || 0;
                badge.textContent = current + newWarns.length;
                badge.style.display = 'inline-block';
            }
        }

        if (maxId > lastSeenLogId) {
            lastSeenLogId = maxId;
            localStorage.setItem('last_seen_log_id', String(maxId));
        }
    } catch(e) { /* silent */ }
}
function showToast(log) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const color = log.severity === 'error' ? '#f85149' : '#d29922';
    const icon = log.severity === 'error' ? '🔴' : '⚠️';

    const toast = document.createElement('div');
    toast.setAttribute('data-toast', '1');
    toast.style.cssText = `
        background: var(--bg-card);
        border: 1px solid ${color};
        border-left: 4px solid ${color};
        border-radius: 10px;
        padding: 14px 44px 14px 18px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        animation: toastSlideIn 0.3s ease-out;
        font-size: 13px;
        position: relative;
    `;
    toast.innerHTML = `
        <button style="position:absolute; top:8px; right:8px; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:20px; padding:0; line-height:1; width:28px; height:28px; display:flex; align-items:center; justify-content:center; border-radius:6px; transition:all 0.15s;" 
                onmouseover="this.style.background='rgba(248,81,73,0.15)';this.style.color='#f85149';"
                onmouseout="this.style.background='none';this.style.color='var(--text-muted)';"
                onclick="this.closest('[data-toast]').remove(); updateToastClearBtn();">×</button>
        <div style="font-weight:700; color:${color}; margin-bottom:6px;">${icon} ${log.action}</div>
        <div style="font-size:12px; color:var(--text); margin-bottom:4px;">${log.details || ''}</div>
        <div style="font-size:11px; color:var(--text-muted);">
            🕐 ${log.ts || ''} ${log.target ? '· 🎯 ' + log.target : ''}
        </div>
    `;

    container.appendChild(toast);
    updateToastClearBtn();
}

function updateToastClearBtn() {
    const container = document.getElementById('toast-container');
    if (!container) return;
    let btn = document.getElementById('toast-clear-all');
    const count = container.querySelectorAll('[data-toast]').length;
    
    if (count > 1) {
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'toast-clear-all';
            btn.style.cssText = `
                align-self: flex-end;
                background: rgba(248,81,73,0.15);
                color: #f85149;
                border: 1px solid rgba(248,81,73,0.3);
                padding: 6px 12px;
                border-radius: 6px;
                font-size: 12px;
                cursor: pointer;
                font-weight: 600;
                font-family: inherit;
            `;
            btn.onclick = () => {
                container.querySelectorAll('[data-toast]').forEach(t => t.remove());
                updateToastClearBtn();
            };
            container.prepend(btn);
        }
        btn.textContent = `✕ Đóng tất cả (${count})`;
    } else if (btn) {
        btn.remove();
    }
}