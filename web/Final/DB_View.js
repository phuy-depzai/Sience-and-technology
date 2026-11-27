// ============================================================
// DB VIEWER — hardcode dropdown, 1 route /api/db/:table
// ============================================================
let dbState = { table: '', offset: 0, limit: 100, total: 0, q: '' };
let dbSearchTimer = null;

function debouncedDBSearch() {
    clearTimeout(dbSearchTimer);
    dbSearchTimer = setTimeout(() => {
        const searchEl = document.getElementById('db-search');
        if (!searchEl) return;
        dbState.q = searchEl.value.trim();
        dbState.offset = 0;
        loadDBTable();
    }, 300);
}


async function loadDBTable() {
    const sel = document.getElementById('db-table-select');
    if (!sel || !sel.value) return;

    dbState.table = sel.value;

    const thead = document.getElementById('db-thead');
    const tbody = document.getElementById('db-tbody');

    tbody.innerHTML = '<tr><td style="text-align:center; padding:20px; color:var(--text-muted);">Đang tải...</td></tr>';

    try {
        const params = new URLSearchParams({
            limit: dbState.limit,
            offset: dbState.offset,
            q: dbState.q
        });

        const r = await authFetch(
            API + '/api/db/' + encodeURIComponent(dbState.table) + '?' + params.toString(),
            { headers: { 'X-Auth-Token': getToken() } }
        );

        if (!r.ok) {
            const txt = await r.text();
            throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
        }

        const d = await r.json();
        if (d.error) throw new Error(d.error);

        dbState.total = d.total || 0;

        thead.innerHTML = '<tr>' + d.columns.map(c =>
            '<th>' + escapeHTML(c === 'id' ? 'STT' : c) + '</th>'
        ).join('') + '</tr>';

        if (!d.rows || !d.rows.length) {
            tbody.innerHTML = '<tr><td colspan="' + Math.max(d.columns.length, 1) +
                '" style="text-align:center; padding:20px; color:var(--text-muted);">' +
                'Không có data</td></tr>';
        } else {
            tbody.innerHTML = d.rows.map((row, index) => {
                const stt = dbState.total - (dbState.offset + index);
                return '<tr>' + d.columns.map(c => {
                    if (c === 'id') return '<td>' + stt + '</td>';
                    const raw = row[c];
                    let v = raw;
                    if (v === null || v === undefined) v = '—';
                    else if (typeof v === 'string' && v.length > 60) v = v.substring(0, 60) + '...';
                    return '<td title="' + escapeHTML(raw ?? '') + '">' + escapeHTML(v) + '</td>';
                }).join('') + '</tr>';
            }).join('');
        }

        const start = dbState.total === 0 ? 0 : dbState.offset + 1;
        const end = Math.min(dbState.offset + dbState.limit, dbState.total);
        document.getElementById('db-pagination').textContent = start + '–' + end + ' / ' + dbState.total;
        document.getElementById('db-prev').disabled = dbState.offset === 0;
        document.getElementById('db-next').disabled = end >= dbState.total;

    } catch (e) {
        console.error('[DB Viewer]', e);
        tbody.innerHTML = '<tr><td style="text-align:center; padding:20px; color:#f85149;">' +
            'Lỗi: ' + escapeHTML(e.message) + '</td></tr>';
    }
}

function dbPrevPage() {
    if (dbState.offset <= 0) return;
    dbState.offset = Math.max(0, dbState.offset - dbState.limit);
    loadDBTable();
}
function dbNextPage() {
    if (dbState.offset + dbState.limit >= dbState.total) return;
    dbState.offset += dbState.limit;
    loadDBTable();
}
function dbFirstPage() {
    if (dbState.offset === 0) return;
    dbState.offset = 0;
    loadDBTable();
}
function dbLastPage() {
    const last = Math.floor((dbState.total - 1) / dbState.limit) * dbState.limit;
    if (dbState.offset === last) return;
    dbState.offset = Math.max(0, last);
    loadDBTable();
}