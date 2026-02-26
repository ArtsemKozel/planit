let adminSession = null;
let employees = [];
let weekDate = new Date();
let adminAvailDate = new Date();
let editShiftId = null;

// ── INIT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    adminSession = await requireAdminSession();
    if (!adminSession) return;

    await loadEmployees();
    await loadWeekGrid();
    await loadAdminVacations();
    await loadAdminSwaps();
    await loadTeam();
    populateAvailEmployeeSelect();
    await loadAdminAvailability();
});

// ── TAB WECHSEL ───────────────────────────────────────────
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.bottom-nav-item').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    const navBtn = document.getElementById('nav-' + tab);
    if (navBtn) navBtn.classList.add('active');
}

// ── MITARBEITER LADEN ─────────────────────────────────────
async function loadEmployees() {
    const { data } = await db
        .from('employees_planit')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .eq('is_active', true)
        .order('employee_number');
    employees = data || [];
}

// ── WOCHENANSICHT ─────────────────────────────────────────
async function loadWeekGrid() {
    const monday = getMonday(weekDate);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push(d);
    }

    document.getElementById('week-label').textContent =
        `${monday.toLocaleDateString('de-DE', {day:'numeric', month:'short'})} – ${sunday.toLocaleDateString('de-DE', {day:'numeric', month:'short', year:'numeric'})}`;

    const firstDay = monday.toISOString().split('T')[0];
    const lastDay = sunday.toISOString().split('T')[0];

    const { data: shifts } = await db
        .from('shifts')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .gte('shift_date', firstDay)
        .lte('shift_date', lastDay);

    renderWeekGrid(days, shifts || []);
}

function renderWeekGrid(days, shifts) {
    const grid = document.getElementById('week-grid');
    grid.innerHTML = '';

    const dayNames = ['Mo','Di','Mi','Do','Fr','Sa','So'];

    // Leere Ecke
    const corner = document.createElement('div');
    corner.className = 'week-header';
    grid.appendChild(corner);

    // Tag-Header
    days.forEach((d, i) => {
        const header = document.createElement('div');
        header.className = 'week-header';
        header.innerHTML = `${dayNames[i]}<br><small>${d.getDate()}.${d.getMonth()+1}.</small>`;
        grid.appendChild(header);
    });

    // Mitarbeiter-Zeilen
    // Mitarbeiter-Zeilen gruppiert nach Abteilung
    if (employees.length === 0) {
        const empty = document.createElement('div');
        empty.style.gridColumn = '1 / -1';
        empty.className = 'empty-state';
        empty.innerHTML = '<p>Keine Mitarbeiter vorhanden.</p>';
        grid.appendChild(empty);
        return;
    }

    // Abteilungen sammeln
    const departments = [...new Set(employees.map(e => e.department || 'Allgemein'))];

    departments.forEach(dept => {
        // Abteilungs-Trennzeile
        const deptRow = document.createElement('div');
        deptRow.style.gridColumn = '1 / -1';
        deptRow.style.padding = '0.4rem 0.5rem';
        deptRow.style.fontSize = '0.75rem';
        deptRow.style.fontWeight = '600';
        deptRow.style.color = 'var(--color-primary)';
        deptRow.style.borderTop = '1px solid var(--color-border)';
        deptRow.style.marginTop = '0.25rem';
        deptRow.textContent = dept.toUpperCase();
        grid.appendChild(deptRow);

        const deptEmployees = employees.filter(e => (e.department || 'Allgemein') === dept);

        deptEmployees.forEach(emp => {
            const empCell = document.createElement('div');
            empCell.className = 'week-employee';
            const parts = emp.name.trim().split(' ');
            const displayName = parts.length > 1 
                ? `${parts[0]} ${parts[1][0]}.` 
                : parts[0];
            empCell.textContent = displayName;
            grid.appendChild(empCell);

            days.forEach(d => {
                const dateStr = d.toISOString().split('T')[0];
                const shift = shifts.find(s => s.employee_id === emp.id && s.shift_date === dateStr);

                const cell = document.createElement('div');
                cell.className = 'week-cell' + (shift ? ' has-shift' : '');
                cell.textContent = shift ? `${shift.start_time.slice(0,5)}\n${shift.end_time.slice(0,5)}` : '+';
                cell.style.whiteSpace = 'pre';
                cell.onclick = () => openShiftModal(emp.id, dateStr, shift);
                grid.appendChild(cell);
            });
        });
    });
}

function changeWeek(dir) {
    weekDate.setDate(weekDate.getDate() + dir * 7);
    loadWeekGrid();
}

function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d;
}

// ── SCHICHT MODAL ─────────────────────────────────────────
function openShiftModal(employeeId, dateStr, existingShift) {
    editShiftId = existingShift ? existingShift.id : null;

    document.getElementById('shift-modal-title').textContent =
        existingShift ? 'Schicht bearbeiten' : 'Schicht erstellen';

    // Mitarbeiter Select befüllen
    const select = document.getElementById('shift-employee');
    select.innerHTML = employees.map(e =>
        `<option value="${e.id}" ${e.id === employeeId ? 'selected' : ''}>${e.name}</option>`
    ).join('');

    document.getElementById('shift-date').value = dateStr;
    document.getElementById('shift-start').value = existingShift ? existingShift.start_time.slice(0,5) : '08:00';
    document.getElementById('shift-end').value = existingShift ? existingShift.end_time.slice(0,5) : '16:00';
    document.getElementById('shift-break').value = existingShift ? existingShift.break_minutes : 30;
    document.getElementById('shift-notes').value = existingShift ? existingShift.notes || '' : '';
    document.getElementById('shift-error').style.display = 'none';

    document.getElementById('shift-modal').classList.add('open');
}

function closeShiftModal() {
    document.getElementById('shift-modal').classList.remove('open');
    editShiftId = null;
}

async function submitShift() {
    const employeeId = document.getElementById('shift-employee').value;
    const date = document.getElementById('shift-date').value;
    const start = document.getElementById('shift-start').value;
    const end = document.getElementById('shift-end').value;
    const breakMin = document.getElementById('shift-break').value;
    const notes = document.getElementById('shift-notes').value;
    const errorDiv = document.getElementById('shift-error');

    errorDiv.style.display = 'none';

    if (!date || !start || !end) {
        errorDiv.textContent = 'Bitte alle Pflichtfelder ausfüllen.';
        errorDiv.style.display = 'block';
        return;
    }

    const payload = {
        user_id: adminSession.user.id,
        employee_id: employeeId,
        shift_date: date,
        start_time: start,
        end_time: end,
        break_minutes: breakMin ? parseInt(breakMin) : 0,
        notes: notes || null
    };

    let error;
    if (editShiftId) {
        ({ error } = await db.from('shifts').update(payload).eq('id', editShiftId));
    } else {
        ({ error } = await db.from('shifts').insert(payload));
    }

    if (error) {
        errorDiv.textContent = 'Fehler beim Speichern.';
        errorDiv.style.display = 'block';
        return;
    }

    closeShiftModal();
    await loadWeekGrid();
}

// ── URLAUB ────────────────────────────────────────────────
async function loadAdminVacations() {
    const { data: vacations } = await db
        .from('vacation_requests')
        .select('*, employees_planit(name)')
        .eq('user_id', adminSession.user.id)
        .order('created_at', { ascending: false });

    const container = document.getElementById('admin-vacation-list');

    if (!vacations || vacations.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Anträge vorhanden.</p></div>';
        return;
    }

    container.innerHTML = vacations.map(v => `
        <div class="list-item">
            <div class="list-item-info">
                <h4>${v.employees_planit?.name || 'Unbekannt'}</h4>
                <p>${formatDate(v.start_date)} – ${formatDate(v.end_date)}</p>
                <p style="font-size:0.8rem;">${v.reason || 'Kein Grund'}</p>
            </div>
            <div style="display:flex; flex-direction:column; gap:0.5rem; align-items:flex-end;">
                <span class="badge badge-${v.status}">
                    ${v.status === 'pending' ? 'Ausstehend' : v.status === 'approved' ? 'Genehmigt' : 'Abgelehnt'}
                </span>
                ${v.status === 'pending' ? `
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn-small btn-approve" onclick="reviewVacation('${v.id}', 'approved')">✓</button>
                        <button class="btn-small btn-reject" onclick="reviewVacation('${v.id}', 'rejected')">✕</button>
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('');
}

let rejectVacationId = null;

function openRejectModal(id) {
    rejectVacationId = id;
    document.getElementById('reject-reason').value = '';
    document.getElementById('reject-modal').classList.add('open');
}

function closeRejectModal() {
    document.getElementById('reject-modal').classList.remove('open');
    rejectVacationId = null;
}

async function submitReject() {
    const reason = document.getElementById('reject-reason').value.trim();
    if (!reason) {
        alert('Bitte Grund eingeben.');
        return;
    }
    await db.from('vacation_requests').update({
        status: 'rejected',
        rejection_reason: reason,
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminSession.user.id
    }).eq('id', rejectVacationId);
    closeRejectModal();
    await loadAdminVacations();
}

async function reviewVacation(id, status) {
    if (status === 'rejected') {
        openRejectModal(id);
        return;
    }
    await db.from('vacation_requests').update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminSession.user.id
    }).eq('id', id);
    await loadAdminVacations();
}

async function downloadAllVacations() {
    const { data: vacations } = await db
        .from('vacation_requests')
        .select('*, employees_planit(name)')
        .eq('user_id', adminSession.user.id)
        .order('created_at', { ascending: false });

    if (!vacations || vacations.length === 0) {
        alert('Keine Anträge vorhanden.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Alle Urlaubsanträge', 20, 20);

    let y = 35;
    vacations.forEach(v => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(v.employees_planit?.name || 'Unbekannt', 20, y);
        doc.setFont('helvetica', 'normal');
        doc.text(`${formatDate(v.start_date)} – ${formatDate(v.end_date)}`, 70, y);
        const status = v.status === 'pending' ? 'Ausstehend' : v.status === 'approved' ? 'Genehmigt' : 'Abgelehnt';
        doc.text(status, 160, y);
        y += 10;
    });

    doc.save('Urlaubsantraege.pdf');
}

// ── VERFÜGBARKEITEN ───────────────────────────────────────
function populateAvailEmployeeSelect() {
    const select = document.getElementById('avail-employee-select');
    select.innerHTML = employees.length
        ? employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('')
        : '<option>Keine Mitarbeiter</option>';
}

async function loadAdminAvailability() {
    const employeeId = document.getElementById('avail-employee-select').value;
    if (!employeeId) return;

    const year = adminAvailDate.getFullYear();
    const month = adminAvailDate.getMonth();
    const monthStr = `${year}-${String(month+1).padStart(2,'0')}-01`;

    const monthNames = ['Januar','Februar','März','April','Mai','Juni',
                        'Juli','August','September','Oktober','November','Dezember'];
    document.getElementById('admin-avail-month-label').textContent =
        `${monthNames[month]} ${year}`;

    const { data } = await db
        .from('availability')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('month', monthStr)
        .single();

    const availDays = data ? data.available_days : [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const container = document.getElementById('admin-avail-grid');
    container.innerHTML = '';

    for (let d = 1; d <= daysInMonth; d++) {
        const div = document.createElement('div');
        div.className = 'avail-day' + (availDays.includes(d) ? ' selected' : '');
        div.textContent = d;
        div.style.cursor = 'default';
        container.appendChild(div);
    }
}

function changeAdminAvailMonth(dir) {
    adminAvailDate.setMonth(adminAvailDate.getMonth() + dir);
    loadAdminAvailability();
}

// ── TEAM ──────────────────────────────────────────────────
async function loadTeam() {
    const container = document.getElementById('team-list');

    if (employees.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Mitarbeiter vorhanden.</p></div>';
        return;
    }

    container.innerHTML = employees.map(e => `
        <div class="list-item">
            <div class="list-item-info">
                <h4>${e.name}</h4>
                <p>Nr. ${e.employee_number} · ${e.department || 'Allgemein'}</p>
            </div>
            <span class="badge badge-approved">Aktiv</span>
        </div>
    `).join('');
}

function openNewEmployeeModal() {
    document.getElementById('employee-modal').classList.add('open');
    document.getElementById('emp-modal-error').style.display = 'none';
    document.getElementById('new-emp-name').value = '';
    document.getElementById('new-emp-number').value = '';
    document.getElementById('new-emp-password').value = '';
}

function closeNewEmployeeModal() {
    document.getElementById('employee-modal').classList.remove('open');
}

async function submitNewEmployee() {
    const name = document.getElementById('new-emp-name').value.trim();
    const number = document.getElementById('new-emp-number').value.trim();
    const password = document.getElementById('new-emp-password').value;
    const errorDiv = document.getElementById('emp-modal-error');

    errorDiv.style.display = 'none';

    if (!name || !number || !password) {
        errorDiv.textContent = 'Bitte alle Felder ausfüllen.';
        errorDiv.style.display = 'block';
        return;
    }

    const department = document.getElementById('new-emp-department').value;

    const { error } = await db.from('employees_planit').insert({
        user_id: adminSession.user.id,
        name,
        employee_number: number,
        password_hash: password,
        department: department,
        is_active: true
    });

    if (error) {
        errorDiv.textContent = error.message.includes('unique')
            ? 'Mitarbeiter-Nummer bereits vergeben.'
            : 'Fehler beim Anlegen.';
        errorDiv.style.display = 'block';
        return;
    }

    closeNewEmployeeModal();
    await loadEmployees();
    await loadTeam();
    populateAvailEmployeeSelect();
    await loadWeekGrid();
}

// ── SCHICHTTAUSCH ─────────────────────────────────────────
async function loadAdminSwaps() {
    const { data: swaps } = await db
        .from('shift_swaps')
        .select('*, shifts(shift_date, start_time, end_time), from:from_employee_id(name), to:to_employee_id(name)')
        .eq('user_id', adminSession.user.id)
        .order('created_at', { ascending: false });

    const container = document.getElementById('admin-swap-list');

    if (!swaps || swaps.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Requests vorhanden.</p></div>';
        return;
    }

    container.innerHTML = swaps.map(s => `
        <div class="list-item">
            <div class="list-item-info">
                <h4>${s.from?.name || '?'} → ${s.to?.name || '?'}</h4>
                <p>${s.shifts ? formatDate(s.shifts.shift_date) : ''} | ${s.shifts ? s.shifts.start_time.slice(0,5) + ' – ' + s.shifts.end_time.slice(0,5) : ''}</p>
            </div>
            <div style="display:flex; flex-direction:column; gap:0.5rem; align-items:flex-end;">
                <span class="badge badge-${s.status}">
                    ${s.status === 'pending' ? 'Ausstehend' : s.status === 'approved' ? 'Genehmigt' : 'Abgelehnt'}
                </span>
                ${s.status === 'pending' ? `
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn-small btn-approve" onclick="reviewSwap('${s.id}', 'approved')">✓</button>
                        <button class="btn-small btn-reject" onclick="reviewSwap('${s.id}', 'rejected')">✕</button>
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('');
}

async function reviewSwap(id, status) {
    await db.from('shift_swaps').update({
        status,
        reviewed_at: new Date().toISOString()
    }).eq('id', id);
    await loadAdminSwaps();
}

// ── HELPER ────────────────────────────────────────────────
function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('de-DE', {
        day: 'numeric', month: 'long', year: 'numeric'
    });
}