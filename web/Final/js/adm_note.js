//============================================================
// ADMIN NOTES
// ============================================================
let notesData = [];
let notesFiltered = [];
let editingNoteId = null;

function getCurrentAuthor() { 
    return localStorage.getItem('username') || 'unknown'; 
}

async function loadNotes() {
    const box = document.getElementById('note-list');
    if (!box) return;
    box.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Đang tải...</div>';
    try {
        const author = document.getElementById('note-filter-author')?.value || '';
        const tag = document.getElementById('note-filter-tag')?.value || '';
        let url = API + '/api/notes?';
        if (author) url += 'author=' + encodeURIComponent(author) + '&';
        if (tag) url += 'tag=' + encodeURIComponent(tag);
        const r = await authFetch(url, { headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        notesData = await r.json();
        notesFiltered = notesData;
        renderNoteList();
    } catch(e) { box.innerHTML = '<div style="text-align:center; padding:40px; color:#f85149;">Lỗi: ' + e.message + '</div>'; }
}

function renderNoteList() {
    const box = document.getElementById('note-list');
    const count = document.getElementById('note-count');
    if (!box) return;
    if (count) count.textContent = notesFiltered.length + ' notes';
    if (!notesFiltered.length) { box.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">Chưa có ghi chú. Bấm "Ghi chú mới" để tạo.</div>'; return; }
    const tagIcon = { note: '📝', todo: '✅', bug: '🐛', maint: '🔧', idea: '💡', fatal: '💀' };
    box.innerHTML = notesFiltered.map(n => `
        <div class="note-card ${n.pinned ? 'pinned' : ''}" data-id="${n.id}">
            <div class="note-header">
                <div class="note-title-wrap">
                    ${n.pinned ? '<span class="note-pin">📌</span>' : ''}
                    <span class="note-tag tag-${n.tag}">${tagIcon[n.tag] || '📝'} ${n.tag}</span>
                    <h3 class="note-title">${escapeHTML(n.title)}</h3>
                </div>
                <div class="note-actions">
                    <button class="note-btn" onclick="togglePinNote(${n.id}, ${n.pinned ? 0 : 1})" title="${n.pinned ? 'Bỏ pin' : 'Pin'}">${n.pinned ? '📌' : '📍'}</button>
                    <button class="note-btn" onclick="openEditNoteDialog(${n.id})" title="Sửa">✏️</button>
                    <button class="note-btn note-btn-del" onclick="deleteNote(${n.id})" title="Xóa">🗑️</button>
                </div>
            </div>
            <div class="note-content">${escapeHTML(n.content)}</div>
            <div class="note-footer">
                <span>👤 <strong>${n.author}</strong></span>
                <span>🕐 ${n.ts || '--'}</span>
                ${n.updated_at ? '<span>✏️ sửa: ' + n.updated_at + '</span>' : ''}
            </div>
            <div class="note-comments">
                <button class="note-comments-toggle" onclick="toggleNoteComments(${n.id})">💬 Bình luận</button>
                <div id="nc-wrap-${n.id}" style="display:none;"></div>
            </div>
        </div>
    `).join('');
}

function filterNoteList() {
    const q = (document.getElementById('note-search')?.value || '').toLowerCase().trim();
    if (!q) { notesFiltered = notesData; }
    else { notesFiltered = notesData.filter(n => (n.title + ' ' + n.content + ' ' + n.author + ' ' + n.tag).toLowerCase().includes(q)); }
    renderNoteList();
}

function openNewNoteDialog() {
    editingNoteId = null;
    document.getElementById('note-dialog-title').textContent = '✏️ Ghi chú mới';
    document.getElementById('note-form-title').value = '';
    document.getElementById('note-form-content').value = '';
    document.getElementById('note-form-tag').value = 'note';
    document.getElementById('note-form-author').value = getCurrentAuthor();
    document.getElementById('note-dialog').style.display = 'flex';
    setTimeout(() => document.getElementById('note-form-title').focus(), 100);
}

function openEditNoteDialog(id) {
    const n = notesData.find(x => x.id === id);
    if (!n) return;
    editingNoteId = id;
    document.getElementById('note-dialog-title').textContent = '✏️ Sửa ghi chú #' + id;
    document.getElementById('note-form-title').value = n.title;
    document.getElementById('note-form-content').value = n.content;
    document.getElementById('note-form-tag').value = n.tag || 'note';
    document.getElementById('note-form-author').value = n.author;
    document.getElementById('note-dialog').style.display = 'flex';
}

function closeNoteDialog() { const dlg = document.getElementById('note-dialog'); if (dlg) dlg.style.display = 'none'; }

async function submitNote() {
    const title = document.getElementById('note-form-title').value.trim();
    const content = document.getElementById('note-form-content').value.trim();
    const tag = document.getElementById('note-form-tag').value;
    const author = document.getElementById('note-form-author').value || getCurrentAuthor();
    if (!title || !content) { customNotify('Vui lòng nhập tiêu đề và nội dung', 'warn'); return; }
    try {
        const isEdit = editingNoteId !== null;
        const url = isEdit ? API + '/api/notes/' + editingNoteId : API + '/api/notes';
        const method = isEdit ? 'PUT' : 'POST';
        const body = isEdit ? { title, content, tag } : { title, content, tag, author };
        if (tag === 'fatal') body.pinned = 1;
        const r = await authFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify(body)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction(isEdit ? 'note_updated' : 'note_created', 'note#' + (editingNoteId || 'new'), title, 'info');
        closeNoteDialog();
        await loadNotes();
    } catch(e) { customNotify('Lưu thất bại: ' + e.message, 'error'); }
}

async function deleteNote(id) {
    if (!(await customConfirm('Xóa ghi chú #' + id + '?'))) return;
    try {
        const r = await authFetch(API + '/api/notes/' + id, { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        logAction('note_deleted', 'note#' + id, '', 'warn');
        await loadNotes();
    } catch(e) { customNotify('Xóa thất bại: ' + e.message, 'error'); }
}

async function togglePinNote(id, pinned) {
    try {
        const r = await authFetch(API + '/api/notes/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ pinned: pinned })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadNotes();
    } catch(e) { customNotify('Đổi pin thất bại: ' + e.message, 'error'); }
}
// ============================================================
// NOTE COMMENTS
// ============================================================
async function loadNoteComments(noteId, container) {
    container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Đang tải...</div>';
    try {
        const r = await authFetch(API + '/api/notes/' + noteId + '/comments');
        const list = await r.json();
        renderNoteComments(noteId, container, list);
    } catch(e) { container.innerHTML = '<div style="font-size:12px; color:var(--red);">Lỗi: ' + e.message + '</div>'; }
}

function renderNoteComments(noteId, container, list) {
   const currentUser = localStorage.getItem('username') || '';
    const commentsHtml = list.length ? list.map(c => {
        const initial = (c.username || '?').charAt(0).toUpperCase();
        const canDel = c.username === currentUser || (typeof isHeadAdmin === 'function' && isHeadAdmin());
        return `
            <div class="comment-item">
                <div class="comment-avatar">${initial}</div>
                <div class="comment-body">
                    <div class="comment-header">
                        <span class="comment-user">${c.username}</span>
                        <span class="comment-time">${c.created_at || '--'}</span>
                        ${canDel ? `<button class="comment-del" onclick="delNoteComment(${c.id}, ${noteId}, this)" title="Xóa"/button>` : ''}
                    </div>
                    <div class="comment-content">${escapeHTML(c.content)}</div>
                </div>
            </div>
        `;
    }).join('') : '<div style="font-size:12px; color:var(--text-muted); font-style:italic;">Chưa có comment</div>';
    container.innerHTML = `
        <div class="note-comments-list" id="nc-list-${noteId}">${commentsHtml}</div>
        <div class="comment-input-row">
            <textarea class="comment-input" id="nc-input-${noteId}" placeholder="Viết comment..." rows="1"></textarea>
            <button class="btn-primary btn-mini" onclick="submitNoteComment(${noteId})">Gửi</button>
        </div>
    `;
}

async function submitNoteComment(noteId) {
    const input = document.getElementById('nc-input-' + noteId);
    const content = (input.value || '').trim();
    if (!content) return;
    try {
        const r = await authFetch(API + '/api/notes/' + noteId + '/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
            body: JSON.stringify({ content })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        input.value = '';
        await loadNoteComments(noteId, document.getElementById('nc-wrap-' + noteId));
    } catch(e) { customNotify('Lỗi: ' + e.message, 'error'); }
}

async function delNoteComment(id, noteId) {
    if (!(await customConfirm('Xóa comment này?'))) return;
    try {
        const r = await authFetch(API + '/api/comments/' + id, { method: 'DELETE', headers: { 'X-Auth-Token': getToken() } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await loadNoteComments(noteId, document.getElementById('nc-wrap-' + noteId));
    } catch(e) { customNotify('Lỗi: ' + e.message, 'error'); }
}

function toggleNoteComments(noteId) {
    const wrap = document.getElementById('nc-wrap-' + noteId);
    if (!wrap) return;
    if (wrap.style.display === 'none' || !wrap.style.display) { wrap.style.display = 'block'; loadNoteComments(noteId, wrap); }
    else { wrap.style.display = 'none'; }
}