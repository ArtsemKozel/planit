let adminSession = null;
let employees = [];
let weekDate = new Date();
let adminAvailDate = new Date();
let editShiftId = null;

// ── INIT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    adminSession = await requireAdminSession();
    if (!adminSession) return;

    const savedTab = localStorage.getItem('planit_admin_tab');
    if (savedTab) switchTab(savedTab);

    await loadEmployees();
    await loadWeekGrid();
    await loadAdminVacations();
    await loadAdminSwaps();
    await loadTeam();
    populateAvailEmployeeSelect();
    await loadAdminAvailability();
    await loadAdminVacationCalendar();
    await loadRequestsBadge();
});

function getBWHolidays(year) {
    return [
        `${year}-01-01`,
        `${year}-01-06`,
        ...getEasterDates(year),
        `${year}-05-01`,
        `${year}-10-03`,
        `${year}-11-01`,
        `${year}-12-25`,
        `${year}-12-26`,
    ];
}

function getEasterDates(year) {
    const a = year % 19, b = Math.floor(year/100), c = year % 100;
    const d = Math.floor(b/4), e = b % 4, f = Math.floor((b+8)/25);
    const g = Math.floor((b-f+1)/3), h = (19*a+b-d-g+15) % 30;
    const i = Math.floor(c/4), k = c % 4;
    const l = (32+2*e+2*i-h-k) % 7;
    const m = Math.floor((a+11*h+22*l)/451);
    const month = Math.floor((h+l-7*m+114)/31);
    const day = ((h+l-7*m+114) % 31) + 1;
    const easter = new Date(year, month-1, day);
    const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate()+n); return r.toISOString().split('T')[0]; };
    return [
        addDays(easter, -2),
        addDays(easter, 0),
        addDays(easter, 1),
        addDays(easter, 39),
        addDays(easter, 49),
        addDays(easter, 50),
        addDays(easter, 60),
    ];
}

// ── TAB WECHSEL ───────────────────────────────────────────
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.bottom-nav-item').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    const navBtn = document.getElementById('nav-' + tab);
    if (navBtn) navBtn.classList.add('active');
    if (tab === 'stunden') loadAdminStunden();
    if (tab === 'requests') { loadRequests(); loadRequestsStats(); }
    localStorage.setItem('planit_admin_tab', tab);
}

// ── MITARBEITER LADEN ─────────────────────────────────────
async function loadEmployees() {
    const { data } = await db
        .from('employees_planit')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .eq('is_active', true)
        .order('name')
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
    const weekHolidays = getBWHolidays(days[0].getFullYear());
    days.forEach((d, i) => {
        const dateStr = d.toISOString().split('T')[0];
        const isHoliday = weekHolidays.includes(dateStr);
        const header = document.createElement('div');
        header.className = 'week-header';
        header.innerHTML = `${dayNames[i]}<br><small style="color:${isHoliday ? '#E07070' : 'inherit'};">${d.getDate()}.${d.getMonth()+1}.${isHoliday ? ' 🎌' : ''}</small>`;
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

        // Offene Schichten Zeile ganz oben in der Abteilung
        const deptOpenShifts = shifts.filter(s => s.is_open && s.department === dept);
        const openEmpCell = document.createElement('div');
        openEmpCell.className = 'week-employee';
        openEmpCell.style.color = '#C97E7E';
        openEmpCell.style.fontWeight = '700';
        openEmpCell.textContent = 'Offen';
        grid.appendChild(openEmpCell);

        days.forEach(d => {
            const dateStr = d.toISOString().split('T')[0];
            const shift = deptOpenShifts.find(s => s.shift_date === dateStr);
            const cell = document.createElement('div');
            cell.className = 'week-cell' + (shift ? ' open-shift' : '');
            cell.textContent = shift ? `${shift.start_time.slice(0,5)}\n${shift.end_time.slice(0,5)}` : '+';
            cell.style.whiteSpace = 'pre';
            cell.onclick = () => openOpenShiftModal(dateStr, dept, shift || null);
            grid.appendChild(cell);
        });

        // Mitarbeiter Zeilen
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

    const deleteBtn = document.getElementById('shift-delete-btn');
    deleteBtn.style.display = existingShift ? 'block' : 'none';
    
    document.getElementById('shift-is-open').checked = existingShift ? (existingShift.is_open || false) : false;
    document.getElementById('shift-open-note').value = existingShift ? (existingShift.open_note || '') : '';
    document.getElementById('shift-employee').disabled = existingShift?.is_open || false;
    document.getElementById('shift-employee').closest('.form-group').style.opacity = existingShift?.is_open ? '0.4' : '1';
    document.getElementById('shift-open-note-group').style.display = existingShift?.is_open ? 'block' : 'none';
    document.getElementById('shift-dept-group').style.display = existingShift?.is_open ? 'block' : 'none';
    document.getElementById('shift-department').value = existingShift?.department || 'Service';
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

    const isOpen = document.getElementById('shift-is-open').checked;
    const payload = {
        user_id: adminSession.user.id,
        employee_id: isOpen ? null : employeeId,
        shift_date: date,
        start_time: start,
        end_time: end,
        break_minutes: breakMin ? parseInt(breakMin) : 0,
        notes: notes || null,
        is_open: isOpen,
        open_note: isOpen ? (document.getElementById('shift-open-note').value || null) : null,
        department: isOpen ? document.getElementById('shift-department').value : null
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

async function deleteShift() {
    if (!editShiftId) return;
    if (!confirm('Schicht wirklich löschen?')) return;
    const { error } = await db.from('shifts').delete().eq('id', editShiftId);
    if (error) {
        alert('Fehler beim Löschen!');
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

// ── URLAUBSKALENDER (ADMIN) ───────────────────────────────
let adminVacCalDate = new Date();

async function loadAdminVacationCalendar() {
    const year = adminVacCalDate.getFullYear();
    const month = adminVacCalDate.getMonth();
    const monthStr = `${year}-${String(month+1).padStart(2,'0')}`;
    const monthNames = ['Januar','Februar','März','April','Mai','Juni',
                        'Juli','August','September','Oktober','November','Dezember'];
    document.getElementById('admin-vac-cal-month-label').textContent = `${monthNames[month]} ${year}`;

    const firstDay = `${monthStr}-01`;
    const lastDay = `${year}-${String(month+1).padStart(2,'0')}-${new Date(year, month+1, 0).getDate()}`;

    const { data: vacations } = await db
        .from('vacation_requests')
        .select('*, employees_planit(name)')
        .eq('user_id', adminSession.user.id)
        .eq('status', 'approved')
        .lte('start_date', lastDay)
        .gte('end_date', firstDay);

    renderAdminVacationCalendar(year, month, vacations || []);
}

function renderAdminVacationCalendar(year, month, vacations) {
    const container = document.getElementById('admin-vac-calendar');
    container.innerHTML = '';

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = new Date(year, month, 1).getDay();
    const offset = firstWeekday === 0 ? 6 : firstWeekday - 1;

    const colors = ['#C9A24D','#7EB8C9','#A8C97E','#C97E9A','#9A7EC9','#C9A87E','#7EC9B8'];
    const empColors = {};
    let colorIdx = 0;
    vacations.forEach(v => {
        if (!empColors[v.employee_id]) {
            empColors[v.employee_id] = colors[colorIdx % colors.length];
            colorIdx++;
        }
    });

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    ['Mo','Di','Mi','Do','Fr','Sa','So'].forEach(d => {
        const h = document.createElement('div');
        h.className = 'calendar-day-header';
        h.textContent = d;
        grid.appendChild(h);
    });

    for (let i = 0; i < offset; i++) {
        const empty = document.createElement('div');
        empty.className = 'calendar-day empty';
        grid.appendChild(empty);
    }

    const holidays = getBWHolidays(year);
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dayVacations = vacations.filter(v => v.start_date <= dateStr && v.end_date >= dateStr);
        const isHoliday = holidays.includes(dateStr);
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day' + (isHoliday ? ' holiday' : '');
        dayEl.style.flexDirection = 'column';
        dayEl.style.gap = '2px';

        const numEl = document.createElement('span');
        numEl.textContent = d;
        numEl.style.fontSize = '0.8rem';
        dayEl.appendChild(numEl);

        dayVacations.forEach(v => {
            const bar = document.createElement('div');
            bar.style.width = '100%';
            bar.style.height = '4px';
            bar.style.borderRadius = '2px';
            bar.style.background = empColors[v.employee_id] || '#ccc';
            bar.title = v.employees_planit?.name || '';
            dayEl.appendChild(bar);
        });

        grid.appendChild(dayEl);
    }

    container.appendChild(grid);

    // Legende
    const legend = document.createElement('div');
    legend.style.display = 'flex';
    legend.style.flexWrap = 'wrap';
    legend.style.gap = '0.5rem';
    legend.style.marginTop = '0.75rem';

    vacations.forEach(v => {
        if (legend.querySelector(`[data-emp="${v.employee_id}"]`)) return;
        const item = document.createElement('div');
        item.setAttribute('data-emp', v.employee_id);
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '4px';
        item.style.fontSize = '0.75rem';
        const dot = document.createElement('div');
        dot.style.width = '10px';
        dot.style.height = '10px';
        dot.style.borderRadius = '50%';
        dot.style.background = empColors[v.employee_id] || '#ccc';
        item.appendChild(dot);
        item.appendChild(document.createTextNode(v.employees_planit?.name?.split(' ')[0] || '?'));
        legend.appendChild(item);
    });

    container.appendChild(legend);
}

function changeAdminVacCalMonth(dir) {
    adminVacCalDate.setMonth(adminVacCalDate.getMonth() + dir);
    loadAdminVacationCalendar();
}

// ── VERFÜGBARKEITEN ───────────────────────────────────────
function populateAvailEmployeeSelect() {
    const select = document.getElementById('avail-employee-select');
    select.innerHTML = employees.length
        ? `<option value="all">Alle Mitarbeiter</option>` + employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('')
        : '<option>Keine Mitarbeiter</option>';
}

async function loadAdminAvailability() {
    const employeeId = document.getElementById('avail-employee-select').value;
    if (!employeeId) return;

    if (employeeId === 'all') {
        await loadAllAvailabilities();
        return;
    }

    const year = adminAvailDate.getFullYear();
    const month = adminAvailDate.getMonth();
    const monthStr = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const monthNames = ['Januar','Februar','März','April','Mai','Juni',
                        'Juli','August','September','Oktober','November','Dezember'];
    document.getElementById('admin-avail-month-label').textContent = `${monthNames[month]} ${year}`;

    const { data } = await db
        .from('availability')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('month', monthStr)
        .maybeSingle();

    const availDays = (data && !Array.isArray(data.available_days)) ? data.available_days : {};
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = new Date(year, month, 1).getDay();
    const offset = firstWeekday === 0 ? 6 : firstWeekday - 1;

    const container = document.getElementById('admin-avail-grid');
    container.innerHTML = '';
    container.classList.remove('all-view');

    // Wochentag-Header
    ['Mo','Di','Mi','Do','Fr','Sa','So'].forEach(d => {
        const h = document.createElement('div');
        h.className = 'calendar-day-header';
        h.textContent = d;
        container.appendChild(h);
    });

    // Leere Felder
    for (let i = 0; i < offset; i++) {
        const empty = document.createElement('div');
        empty.className = 'avail-day';
        empty.style.visibility = 'hidden';
        container.appendChild(empty);
    }

    // Tage
    for (let d = 1; d <= daysInMonth; d++) {
        const entry = availDays[d] || null;
        const status = entry ? entry.status : null;

        const div = document.createElement('div');
        div.className = 'avail-day';
        div.style.flexDirection = 'column';
        div.style.fontSize = '0.75rem';
        div.style.gap = '2px';
        div.style.cursor = 'default';

        if (status === 'full') div.style.background = '#C8E6C9';
        else if (status === 'partial') div.style.background = '#FFF9C4';
        else if (status === 'off') div.style.background = '#FFCDD2';

        const timeLabel = (status === 'partial' && entry.from)
            ? `<span style="font-size:0.6rem">${entry.from}-${entry.to}</span>`
            : '';

        div.innerHTML = `<span>${d}</span><span style="font-size:0.9rem">${status === 'full' ? '🟢' : status === 'partial' ? '🟡' : status === 'off' ? '🔴' : ''}</span>${timeLabel}`;
        container.appendChild(div);
    }
}

function changeAdminAvailMonth(dir) {
    adminAvailDate.setMonth(adminAvailDate.getMonth() + dir);
    loadAdminAvailability();
}

async function loadAllAvailabilities() {
    const year = adminAvailDate.getFullYear();
    const month = adminAvailDate.getMonth();
    const monthStr = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const monthNames = ['Januar','Februar','März','April','Mai','Juni',
                        'Juli','August','September','Oktober','November','Dezember'];
    document.getElementById('admin-avail-month-label').textContent = `${monthNames[month]} ${year}`;

    const container = document.getElementById('admin-avail-grid');
    container.innerHTML = '';
    container.classList.add('all-view');

    for (const emp of employees) {
        const { data } = await db
            .from('availability')
            .select('*')
            .eq('employee_id', emp.id)
            .eq('month', monthStr)
            .maybeSingle();

        const availDays = (data && !Array.isArray(data.available_days)) ? data.available_days : {};

        // Mitarbeiter-Name als Titel
        const title = document.createElement('div');
        title.style.fontWeight = '700';
        title.style.fontSize = '0.9rem';
        title.style.margin = '1rem 0 0.5rem';
        title.style.color = 'var(--color-primary)';
        title.textContent = emp.name;
        container.appendChild(title);

        // Kalender
        const grid = document.createElement('div');
        grid.className = 'availability-grid';
        grid.style.marginBottom = '1.5rem';

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstWeekday = new Date(year, month, 1).getDay();
        const offset = firstWeekday === 0 ? 6 : firstWeekday - 1;

        ['Mo','Di','Mi','Do','Fr','Sa','So'].forEach(d => {
            const h = document.createElement('div');
            h.className = 'calendar-day-header';
            h.textContent = d;
            grid.appendChild(h);
        });

        for (let i = 0; i < offset; i++) {
            const empty = document.createElement('div');
            empty.className = 'avail-day';
            empty.style.visibility = 'hidden';
            grid.appendChild(empty);
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const entry = availDays[d] || null;
            const status = entry ? entry.status : null;

            const div = document.createElement('div');
            div.className = 'avail-day';
            div.style.flexDirection = 'column';
            div.style.fontSize = '0.75rem';
            div.style.gap = '2px';
            div.style.cursor = 'default';

            if (status === 'full') div.style.background = '#C8E6C9';
            else if (status === 'partial') div.style.background = '#FFF9C4';
            else if (status === 'off') div.style.background = '#FFCDD2';

            const timeLabel = (status === 'partial' && entry.from)
                ? `<span style="font-size:0.6rem">${entry.from}-${entry.to}</span>`
                : '';

            div.innerHTML = `<span>${d}</span><span style="font-size:0.9rem">${status === 'full' ? '🟢' : status === 'partial' ? '🟡' : status === 'off' ? '🔴' : ''}</span>${timeLabel}`;
            grid.appendChild(div);
        }

        container.appendChild(grid);
    }
}

// ── TEAM ──────────────────────────────────────────────────
async function loadTeam() {
    // Geburtstage diesen Monat
    const thisMonth = new Date().getMonth() + 1;
    const birthdays = employees.filter(e => {
        if (!e.birthdate) return false;
        const bMonth = parseInt(e.birthdate.split('-')[1]);
        return bMonth === thisMonth;
    });

    const bdContainer = document.getElementById('birthdays-this-month');
    if (birthdays.length > 0) {
        const monthName = new Date().toLocaleDateString('de-DE', { month: 'long' });
        bdContainer.innerHTML = `
            <div class="card" style="background:#FFF9EC; border-left:3px solid var(--color-primary);">
                <div style="font-size:0.8rem; color:var(--color-text-light); margin-bottom:0.5rem;">🎂 GEBURTSTAGE IM ${monthName.toUpperCase()}</div>
                ${birthdays.map(e => {
                    const date = new Date(e.birthdate + 'T00:00:00');
                    const day = date.getDate();
                    const month = date.toLocaleDateString('de-DE', { month: 'long' });
                    return `<div style="display:flex; justify-content:space-between; padding:0.25rem 0;">
                        <span style="font-weight:600;">${e.name}</span>
                        <span style="color:var(--color-text-light);">${day}. ${month}</span>
                    </div>`;
                }).join('')}
            </div>`;
    } else {
        bdContainer.innerHTML = '';
    }

    const container = document.getElementById('team-list');
    if (employees.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Mitarbeiter vorhanden.</p></div>';
        return;
    }
    container.innerHTML = employees.map(e => `
        <div class="list-item">
            <div class="list-item-info">
                <h4>${e.name}</h4>
                <p>${e.login_code} · ${e.department || 'Allgemein'}${e.birthdate ? ' · 🎂 ' + new Date(e.birthdate + 'T00:00:00').toLocaleDateString('de-DE', {day:'numeric', month:'long'}) : ''}</p>
            </div>
            <div style="display:flex; gap:0.5rem; align-items:center;">
                <button class="btn-small btn-approve" onclick="openEditEmployeeModal('${e.id}')">✏️</button>
                <button class="btn-small btn-reject" onclick="deleteEmployee('${e.id}', '${e.name}')">🗑</button>
            </div>
        </div>
    `).join('');
}

function openNewEmployeeModal() {
    document.getElementById('employee-modal').classList.add('open');
    document.getElementById('emp-modal-error').style.display = 'none';
    document.getElementById('new-emp-name').value = '';
    document.getElementById('new-emp-code').value = '';
    document.getElementById('new-emp-password').value = '';
}

function closeNewEmployeeModal() {
    document.getElementById('employee-modal').classList.remove('open');
}

async function submitNewEmployee() {
    const name = document.getElementById('new-emp-name').value.trim();
    const loginCode = document.getElementById('new-emp-code').value.trim();
    const password = document.getElementById('new-emp-password').value;
    const errorDiv = document.getElementById('emp-modal-error');

    errorDiv.style.display = 'none';

    if (!name || !loginCode || !password) {
        errorDiv.textContent = 'Bitte alle Felder ausfüllen.';
        errorDiv.style.display = 'block';
        return;
    }

    const department = document.getElementById('new-emp-department').value;

    const birthdate = document.getElementById('new-emp-birthdate').value || null;
    const { error } = await db.from('employees_planit').insert({
        user_id: adminSession.user.id,
        name,
        login_code: loginCode,
        password_hash: password,
        department: department,
        is_active: true,
        birthdate
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

function generateLoginCode(name) {
    const parts = name.trim().split(' ');
    const first = parts[0] || '';
    const last = parts[1] || '';
    const clean = str => str.replace(/ä/g,'a').replace(/ö/g,'o').replace(/ü/g,'u')
                            .replace(/Ä/g,'A').replace(/Ö/g,'O').replace(/Ü/g,'U');
    const code = clean(first).slice(0,2) + clean(last).slice(0,2);
    return code.charAt(0).toUpperCase() + code.slice(1,2).toLowerCase() +
           code.charAt(2).toUpperCase() + code.slice(3,4).toLowerCase();
}

function previewLoginCode() {
    const name = document.getElementById('new-emp-name').value;
    document.getElementById('new-emp-code').value = name.trim() ? generateLoginCode(name) : '';
}

//-------------

let editEmployeeId = null;

function openEditEmployeeModal(id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;
    editEmployeeId = id;
    document.getElementById('edit-emp-name').value = emp.name;
    document.getElementById('edit-emp-code').value = emp.login_code || '';
    document.getElementById('edit-emp-password').value = emp.password_hash || '';
    document.getElementById('edit-emp-department').value = emp.department || 'Allgemein';
    document.getElementById('edit-emp-error').style.display = 'none';
    document.getElementById('edit-emp-birthdate').value = emp.birthdate || '';
    document.getElementById('edit-employee-modal').classList.add('open');
}

function closeEditEmployeeModal() {
    document.getElementById('edit-employee-modal').classList.remove('open');
    editEmployeeId = null;
}

async function submitEditEmployee() {
    const name = document.getElementById('edit-emp-name').value.trim();
    const loginCode = document.getElementById('edit-emp-code').value.trim();
    const password = document.getElementById('edit-emp-password').value.trim();
    const department = document.getElementById('edit-emp-department').value;
    const errorDiv = document.getElementById('edit-emp-error');

    errorDiv.style.display = 'none';

    if (!name || !loginCode) {
        errorDiv.textContent = 'Name und Kürzel sind Pflichtfelder.';
        errorDiv.style.display = 'block';
        return;
    }

    const birthdate = document.getElementById('edit-emp-birthdate').value || null;
    const payload = { name, login_code: loginCode, department, birthdate };
    if (password) payload.password_hash = password;

    const { error } = await db.from('employees_planit').update(payload).eq('id', editEmployeeId);

    if (error) {
        errorDiv.textContent = 'Fehler beim Speichern.';
        errorDiv.style.display = 'block';
        return;
    }

    closeEditEmployeeModal();
    await loadEmployees();
    await loadTeam();
    populateAvailEmployeeSelect();
    await loadWeekGrid();
}

async function deleteEmployee(id, name) {
    if (!confirm(`${name} wirklich löschen?`)) return;
    await db.from('employees_planit').update({ is_active: false }).eq('id', id);
    await loadEmployees();
    await loadTeam();
    populateAvailEmployeeSelect();
    await loadWeekGrid();
}

let archiveVisible = false;

async function toggleArchive() {
    archiveVisible = !archiveVisible;
    const container = document.getElementById('archive-list');
    const btn = document.querySelector('[onclick="toggleArchive()"]');
    
    if (!archiveVisible) {
        container.style.display = 'none';
        btn.textContent = 'Anzeigen';
        return;
    }

    btn.textContent = 'Ausblenden';
    container.style.display = 'block';
    await loadArchive();
}

async function loadArchive() {
    const container = document.getElementById('archive-list');
    
    const { data } = await db
        .from('employees_planit')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .eq('is_active', false)
        .order('name');

    if (!data || data.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine archivierten Mitarbeiter.</p></div>';
        return;
    }

    container.innerHTML = data.map(e => `
        <div class="list-item">
            <div class="list-item-info">
                <h4 style="color:var(--color-text-light);">${e.name}</h4>
                <p>${e.login_code || ''} · ${e.department || 'Allgemein'}</p>
            </div>
            <div style="display:flex; gap:0.5rem;">
                <button class="btn-small btn-approve" onclick="restoreEmployee('${e.id}')">↩️</button>
                <button class="btn-small btn-reject" onclick="permanentDeleteEmployee('${e.id}', '${e.name}')">🗑</button>
            </div>
        </div>
    `).join('');
}

async function restoreEmployee(id) {
    await db.from('employees_planit').update({ is_active: true }).eq('id', id);
    await loadEmployees();
    await loadTeam();
    populateAvailEmployeeSelect();
    await loadWeekGrid();
    await loadArchive();
}

async function permanentDeleteEmployee(id, name) {
    if (!confirm(`${name} wirklich endgültig löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
    await db.from('employees_planit').delete().eq('id', id);
    await loadArchive();
}

// ============================================
// STUNDEN GENEHMIGEN
// ============================================
let adminStundenDate = new Date();

function changeAdminStundenMonth(dir) {
    adminStundenDate.setMonth(adminStundenDate.getMonth() + dir);
    loadAdminStunden();
}

async function loadAdminStunden() {
    const label = adminStundenDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    document.getElementById('admin-stunden-month-label').textContent = label;

    const year = adminStundenDate.getFullYear();
    const month = adminStundenDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const firstDay = `${monthStr}-01`;
    const lastDay = new Date(year, month + 1, 0).toISOString().split('T')[0];

    // Alle aktiven Mitarbeiter laden
    const { data: employees } = await db
        .from('employees_planit')
        .select('*')
        .eq('is_active', true)
        .order('name');

    if (!employees || employees.length === 0) {
        document.getElementById('admin-stunden-list').innerHTML = '<div class="empty-state"><p>Keine Mitarbeiter vorhanden.</p></div>';
        return;
    }

    // Alle Schichten des Monats laden
    const { data: shifts } = await db
        .from('shifts')
        .select('*')
        .gte('shift_date', firstDay)
        .lte('shift_date', lastDay);

    // Geleistete Stunden laden
    const { data: approved } = await db
        .from('approved_hours')
        .select('*')
        .eq('month', monthStr);

    const html = employees.map(emp => {
        // Geplante Stunden berechnen
        const empShifts = (shifts || []).filter(s => s.employee_id === emp.id);
        let plannedMinutes = 0;
        empShifts.forEach(s => {
            const [sh, sm] = s.start_time.split(':').map(Number);
            const [eh, em] = s.end_time.split(':').map(Number);
            plannedMinutes += (eh * 60 + em) - (sh * 60 + sm) - (s.break_minutes || 0);
        });
        const ph = Math.floor(plannedMinutes / 60);
        const pm = plannedMinutes % 60;

        // Geleistete Stunden
        const approvedEntry = (approved || []).find(a => a.employee_id === emp.id);
        const approvedMinutes = approvedEntry ? approvedEntry.approved_minutes : null;
        const ah = approvedMinutes !== null ? Math.floor(approvedMinutes / 60) : '–';
        const am = approvedMinutes !== null ? String(approvedMinutes % 60).padStart(2, '0') : '';
        const approvedDisplay = approvedMinutes !== null ? `${ah}h ${am}m` : '–';

        return `
        <div class="card" style="margin-bottom:0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
                <div style="font-weight:600;">${emp.name}</div>
                <div style="font-size:0.8rem; color:var(--color-text-light);">${emp.department}</div>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:0.75rem;">
                <div>
                    <div style="font-size:0.75rem; color:var(--color-text-light);">GEPLANT</div>
                    <div style="font-weight:600; color:var(--color-primary);">${ph}h ${String(pm).padStart(2,'0')}m</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:var(--color-text-light);">GELEISTET</div>
                    <div style="font-weight:600;">${approvedDisplay}</div>
                </div>
                <div style="display:flex; align-items:flex-end;">
                    <button class="btn-secondary" style="width:auto; font-size:0.85rem; padding:0.4rem 0.75rem;" 
                        data-empid="${emp.id}" data-name="${emp.name}" data-month="${monthStr}" data-minutes="${approvedMinutes !== null ? approvedMinutes : 0}" onclick="openApproveModal(this)">
                        Eintragen
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');

    document.getElementById('admin-stunden-list').innerHTML = html;
}

function openApproveModal(btn) {
    const employeeId = btn.dataset.empid;
    const name = btn.dataset.name;
    const month = btn.dataset.month;
    const currentMinutes = parseInt(btn.dataset.minutes) || 0;
    document.getElementById('approve-modal-title').textContent = name;
    document.getElementById('approve-employee-id').value = employeeId;
    document.getElementById('approve-month').value = month;
    const h = Math.floor(currentMinutes / 60);
    const m = currentMinutes % 60;
    document.getElementById('approve-hours').value = h;
    document.getElementById('approve-minutes').value = m;
    document.getElementById('approve-modal').classList.add('active');
}

function closeApproveModal() {
    document.getElementById('approve-modal').classList.remove('active');
}

async function saveApprovedHours() {
    const employeeId = document.getElementById('approve-employee-id').value;
    const month = document.getElementById('approve-month').value;
    const hours = parseInt(document.getElementById('approve-hours').value) || 0;
    const minutes = parseInt(document.getElementById('approve-minutes').value) || 0;
    const totalMinutes = hours * 60 + minutes;

    const { data: existing } = await db
        .from('approved_hours')
        .select('id')
        .eq('employee_id', employeeId)
        .eq('month', month)
        .maybeSingle();

    let error;
    if (existing) {
        ({ error } = await db
            .from('approved_hours')
            .update({ approved_minutes: totalMinutes })
            .eq('id', existing.id));
    } else {
        ({ error } = await db
            .from('approved_hours')
            .insert({ employee_id: employeeId, month, approved_minutes: totalMinutes, user_id: (await db.auth.getUser()).data.user.id }));
    }

    if (error) {
        alert('Fehler beim Speichern!');
        return;
    }

    closeApproveModal();
    loadAdminStunden();
}

function toggleOpenShift() {
    const isOpen = document.getElementById('shift-is-open').checked;
    document.getElementById('shift-employee').closest('.form-group').style.opacity = isOpen ? '0.4' : '1';
    document.getElementById('shift-employee').disabled = isOpen;
    document.getElementById('shift-open-note-group').style.display = isOpen ? 'block' : 'none';
    document.getElementById('shift-dept-group').style.display = isOpen ? 'block' : 'none';
}

// ============================================
// OFFENE SCHICHTEN
// ============================================
let openShiftData = null; // { dateStr, dept, existingShift }

function openOpenShiftModal(dateStr, dept, existingShift) {
    openShiftData = { dateStr, dept, existingShift };
    document.getElementById('open-shift-modal-title').textContent = 
        `Offen – ${dept} – ${new Date(dateStr + 'T00:00:00').toLocaleDateString('de-DE', {day:'numeric', month:'short'})}`;
    document.getElementById('open-shift-start').value = existingShift ? existingShift.start_time.slice(0,5) : '08:00';
    document.getElementById('open-shift-end').value = existingShift ? existingShift.end_time.slice(0,5) : '16:00';
    document.getElementById('open-shift-break').value = existingShift ? existingShift.break_minutes : 30;
    document.getElementById('open-shift-note').value = existingShift ? (existingShift.open_note || '') : '';
    document.getElementById('open-shift-error').style.display = 'none';
    document.getElementById('open-shift-delete-btn').style.display = existingShift ? 'block' : 'none';
    document.getElementById('open-shift-modal').classList.add('active');
}

function closeOpenShiftModal() {
    document.getElementById('open-shift-modal').classList.remove('active');
    openShiftData = null;
}

async function submitOpenShift() {
    const start = document.getElementById('open-shift-start').value;
    const end = document.getElementById('open-shift-end').value;
    const breakMin = document.getElementById('open-shift-break').value;
    const note = document.getElementById('open-shift-note').value;
    const errorDiv = document.getElementById('open-shift-error');
    errorDiv.style.display = 'none';

    if (!start || !end) {
        errorDiv.textContent = 'Bitte Von und Bis ausfüllen.';
        errorDiv.style.display = 'block';
        return;
    }

    const payload = {
        user_id: adminSession.user.id,
        employee_id: null,
        shift_date: openShiftData.dateStr,
        start_time: start,
        end_time: end,
        break_minutes: breakMin ? parseInt(breakMin) : 0,
        is_open: true,
        open_note: note || null,
        department: openShiftData.dept
    };

    let error;
    if (openShiftData.existingShift) {
        ({ error } = await db.from('shifts').update(payload).eq('id', openShiftData.existingShift.id));
    } else {
        ({ error } = await db.from('shifts').insert(payload));
    }

    if (error) {
        errorDiv.textContent = 'Fehler beim Speichern.';
        errorDiv.style.display = 'block';
        return;
    }

    closeOpenShiftModal();
    await loadWeekGrid();
}

async function deleteOpenShift() {
    if (!openShiftData?.existingShift) return;
    if (!confirm('Offene Schicht wirklich löschen?')) return;
    const { error } = await db.from('shifts').delete().eq('id', openShiftData.existingShift.id);
    if (error) { alert('Fehler beim Löschen!'); return; }
    closeOpenShiftModal();
    await loadWeekGrid();
}

// ============================================
// EINSPRING-REQUESTS
// ============================================
async function loadRequests() {
    // Alle offenen Schichten laden
    const { data: openShifts } = await db
        .from('shifts')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .eq('is_open', true)
        .order('shift_date');

    // Alle Requests laden (alle Status)
    const { data: requests } = await db
        .from('open_shift_requests')
        .select('*, employees_planit(name, department)')
        .eq('user_id', adminSession.user.id)
        .order('created_at', { ascending: false });

    // Alle Mitarbeiter laden
    const { data: allEmployees } = await db
        .from('employees_planit')
        .select('id, name, department')
        .eq('user_id', adminSession.user.id)
        .eq('is_active', true);

    const container = document.getElementById('requests-list');

    if (!openShifts || openShifts.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine offenen Schichten.</p></div>';
        return;
    }

    const html = openShifts.map(shift => {
        const date = new Date(shift.shift_date + 'T00:00:00').toLocaleDateString('de-DE', {day:'numeric', month:'long'});
        const time = `${shift.start_time.slice(0,5)} – ${shift.end_time.slice(0,5)} Uhr`;
        const dept = shift.department || 'Allgemein';

        // Mitarbeiter dieser Abteilung
        const deptEmployees = (allEmployees || []).filter(e => (e.department || 'Allgemein') === dept);

        // Requests für diese Schicht
        const shiftRequests = (requests || []).filter(r => r.shift_id === shift.id);

        const employeeRows = deptEmployees.map(emp => {
            const req = shiftRequests.find(r => r.employee_id === emp.id);
            let statusHtml = '<span style="color:#aaa; font-size:0.8rem;">— noch keine Antwort</span>';
            let actionHtml = '';

            if (req) {
                if (req.status === 'yes') {
                    statusHtml = '<span style="color:#4CAF50; font-weight:600;">✅ Ja</span>';
                    actionHtml = `<button class="btn-primary" style="padding:0.25rem 0.75rem; font-size:0.8rem;" onclick="approveRequest('${req.id}', '${shift.id}', '${emp.id}')">Einteilen</button>`;
                } else if (req.status === 'no') {
                    statusHtml = '<span style="color:#E57373; font-weight:600;">❌ Nein</span>';
                } else if (req.status === 'approved') {
                    statusHtml = '<span style="color:#4CAF50; font-weight:600;">✅ Eingeteilt</span>';
                } else if (req.status === 'rejected') {
                    statusHtml = '<span style="color:#aaa; font-weight:600;">Abgelehnt</span>';
                } else if (req.status === 'pending') {
                    statusHtml = '<span style="color:#C9A24D; font-weight:600;">⏳ Ausstehend</span>';
                }
            }

            return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid var(--color-border);">
                    <span style="font-size:0.9rem;">${emp.name}</span>
                    <div style="display:flex; align-items:center; gap:0.75rem;">
                        ${statusHtml}
                        ${actionHtml}
                    </div>
                </div>`;
        }).join('');

        return `
            <div class="card" style="margin-bottom:1rem;">
                <div style="font-weight:700; margin-bottom:0.25rem;">${date} · ${dept}</div>
                <div style="font-size:0.85rem; color:var(--color-text-light); margin-bottom:0.75rem;">${time}</div>
                ${employeeRows || '<div style="color:#aaa; font-size:0.85rem;">Keine Mitarbeiter in dieser Abteilung.</div>'}
            </div>`;
    }).join('');

    container.innerHTML = html;
}

async function approveRequest(requestId, shiftId, employeeId) {
    // Schicht dem Mitarbeiter zuweisen
    const { error: shiftError } = await db
        .from('shifts')
        .update({ employee_id: employeeId, is_open: false })
        .eq('id', shiftId);

    if (shiftError) { alert('Fehler!'); return; }

    // Request als genehmigt markieren
    await db.from('open_shift_requests').update({ status: 'approved' }).eq('id', requestId);
    
    // Alle anderen Requests für diese Schicht ablehnen
    await db.from('open_shift_requests')
        .update({ status: 'rejected' })
        .eq('shift_id', shiftId)
        .neq('id', requestId);

    await loadRequests();
    await loadWeekGrid();
    alert('Schicht wurde zugewiesen!');
}

async function rejectRequest(requestId) {
    await db.from('open_shift_requests').update({ status: 'rejected' }).eq('id', requestId);
    await loadRequests();
}

async function loadRequestsBadge() {
    const { data } = await db
        .from('open_shift_requests')
        .select('id')
        .eq('status', 'pending');
    
    const badge = document.getElementById('requests-badge');
    if (data && data.length > 0) {
        badge.textContent = data.length;
        badge.style.display = 'inline';
    } else {
        badge.style.display = 'none';
    }
}

async function loadRequestsStats() {
    const month = parseInt(document.getElementById('stats-month')?.value || '0');
    const year = parseInt(document.getElementById('stats-year')?.value || new Date().getFullYear());

    const { data: allEmployees } = await db
        .from('employees_planit')
        .select('id, name, department')
        .eq('user_id', adminSession.user.id)
        .eq('is_active', true)
        .order('name');

    let query = db
        .from('open_shift_requests')
        .select('employee_id, status, created_at')
        .eq('user_id', adminSession.user.id);

    // Datumsfilter
    if (month > 0) {
        const from = `${year}-${String(month).padStart(2,'0')}-01`;
        const to = `${year}-${String(month).padStart(2,'0')}-31`;
        query = query.gte('created_at', from).lte('created_at', to);
    } else {
        const from = `${year}-01-01`;
        const to = `${year}-12-31`;
        query = query.gte('created_at', from).lte('created_at', to);
    }

    const { data: requests } = await query;

    if (!allEmployees || allEmployees.length === 0) return;

    const stats = allEmployees.map(emp => {
        const empRequests = (requests || []).filter(r => r.employee_id === emp.id);
        const total = empRequests.filter(r => ['yes','no','approved','rejected'].includes(r.status)).length;
        const yes = empRequests.filter(r => r.status === 'yes' || r.status === 'approved').length;
        const percent = total > 0 ? Math.round((yes / total) * 100) : null;
        return { ...emp, total, yes, percent };
    });

    stats.sort((a, b) => {
        if (a.percent === null && b.percent === null) return 0;
        if (a.percent === null) return 1;
        if (b.percent === null) return -1;
        return b.percent - a.percent;
    });

    const html = stats.map(s => {
        const barColor = s.percent === null ? '#ddd' :
                         s.percent >= 70 ? '#4CAF50' :
                         s.percent >= 40 ? '#C9A24D' : '#E57373';
        const percentText = s.percent !== null ? `${s.percent}%` : '—';
        const subText = s.total > 0 ? `${s.yes} von ${s.total} Mal Ja gesagt` : 'Noch keine Anfragen';

        return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0; border-bottom:1px solid var(--color-border);">
                <div>
                    <div style="font-weight:600; font-size:0.9rem;">${s.name}</div>
                    <div style="font-size:0.78rem; color:var(--color-text-light);">${subText}</div>
                </div>
                <div style="font-size:1.1rem; font-weight:700; color:${barColor}; min-width:2.5rem; text-align:right;">${percentText}</div>
            </div>`;
    }).join('');

    document.getElementById('requests-stats').innerHTML = html;
}