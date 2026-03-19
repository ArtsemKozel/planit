let adminSession = null;
let employees = [];
let weekDate = new Date();
let adminAvailDate = new Date();
let editShiftId = null;
let planningMode = false;
let availabilityCache = {};
let urlaubYear = new Date().getFullYear();
let editVacationApproveAfter = false;

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
    await loadSickLeaves();
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
    const addDays = (d, n) => { 
        const r = new Date(d); 
        r.setDate(r.getDate()+n); 
        return `${r.getFullYear()}-${String(r.getMonth()+1).padStart(2,'0')}-${String(r.getDate()).padStart(2,'0')}`;
    };
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
    if (tab === 'urlaubsverwaltung') loadUrlaubsverwaltung();
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
    
    // Krankmeldungen für diese Woche laden
    const { data: sickLeaves } = await db
        .from('sick_leaves')
        .select('employee_id, start_date, end_date')
        .eq('user_id', adminSession.user.id)
        .lte('start_date', lastDay)
        .gte('end_date', firstDay);

    const availCache = await loadAvailabilityForWeek(days);
    renderWeekGrid(days, shifts || [], availCache, sickLeaves || []);
    await renderHoursOverview(days, shifts || []);
}

async function togglePlanningMode() {
    planningMode = !planningMode;
    const btn = document.getElementById('planning-mode-btn');
    btn.textContent = planningMode ? '🗓 Planungsmodus: AN' : '🗓 Planungsmodus: AUS';
    btn.style.background = planningMode ? '#D8F0D8' : '#f0f0f0';
    btn.style.color = planningMode ? '#6aaa6a' : 'var(--color-text)';
    await loadWeekGrid();
}

async function loadAvailabilityForWeek(days) {
    if (!planningMode) return {};

    const months = [...new Set(days.map(d => {
        const y = d.getFullYear();
        const m = d.getMonth();
        return `${y}-${String(m+1).padStart(2,'0')}-01`;
    }))];

    const weekStart = days[0].toISOString().split('T')[0];
    const weekEnd = days[days.length-1].toISOString().split('T')[0];

    const { data } = await db
        .from('availability')
        .select('employee_id, available_days, month')
        .eq('user_id', adminSession.user.id)
        .in('month', months);

    const { data: vacations } = await db
        .from('vacation_requests')
        .select('employee_id, start_date, end_date')
        .eq('user_id', adminSession.user.id)
        .eq('status', 'approved')
        .lte('start_date', weekEnd)
        .gte('end_date', weekStart);

    const cache = {};
    (data || []).forEach(a => {
        if (!cache[a.employee_id]) cache[a.employee_id] = {};
        const monthDate = new Date(a.month);
        const monthNum = monthDate.getMonth();
        const year = monthDate.getFullYear();
        Object.entries(a.available_days || {}).forEach(([day, val]) => {
            const dateStr = `${year}-${String(monthNum+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            cache[a.employee_id][dateStr] = val;
        });
    });

    // Urlaubstage als 'vacation' markieren
    (vacations || []).forEach(v => {
        if (!cache[v.employee_id]) cache[v.employee_id] = {};
        days.forEach(d => {
            const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            if (v.start_date <= dateStr && v.end_date >= dateStr) {
                cache[v.employee_id][dateStr] = { status: 'vacation' };
            }
        });
    });

    return cache;
}

function renderWeekGrid(days, shifts, availCache = {}, sickLeaves = []) {
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

            // Wochenstunden berechnen
            const empShifts = shifts.filter(s => s.employee_id === emp.id && !s.is_open);
            let weekMinutes = 0;
            empShifts.forEach(s => {
                const start = s.start_time.slice(0,5).split(':').map(Number);
                const end = s.end_time.slice(0,5).split(':').map(Number);
                const minutes = (end[0]*60+end[1]) - (start[0]*60+start[1]) - (s.break_minutes || 0);
                weekMinutes += minutes;
            });
            const weekHours = (weekMinutes / 60).toFixed(1);
            const hoursColor = weekMinutes === 0 ? 'var(--color-text-light)' :
                            weekMinutes > 600 ? '#E8A0A0' :
                            weekMinutes < 240 ? '#FFF3CC' : '#D8F0D8';

            empCell.textContent = displayName;
            grid.appendChild(empCell);

            days.forEach(d => {
                const dateStr = d.toISOString().split('T')[0];
                const shift = shifts.find(s => s.employee_id === emp.id && s.shift_date === dateStr);
                const cell = document.createElement('div');
                cell.className = 'week-cell' + (shift ? ' has-shift' : '');
                cell.textContent = shift ? `${shift.start_time.slice(0,5)}\n${shift.end_time.slice(0,5)}` : '+';
                cell.style.whiteSpace = 'pre';

                // Planungsmodus: Verfügbarkeitsfarbe
                if (planningMode && !shift) {
                    const empAvail = availCache[emp.id] || {};
                    const entry = empAvail[dateStr];
                    const status = entry ? entry.status : null;
                    if (status === 'vacation') cell.style.background = '#D0E8FF';
                    else if (status === 'school') cell.style.background = '#E8D0FF';
                    else if (status === 'full') cell.style.background = '#D8F0D8';
                    else if (status === 'partial') {
                        cell.style.background = '#FFF3CC';
                        if (entry.from && entry.to) {
                            cell.textContent = `${entry.from.slice(0,5)}\n${entry.to.slice(0,5)}`;
                            cell.style.whiteSpace = 'pre';
                            cell.style.fontSize = '0.65rem';
                        }
                    }
                    else if (status === 'off') cell.style.background = '#FFD9D9';
                }

                // Krankmeldung Orange markieren
                const isSick = sickLeaves.some(s => s.employee_id === emp.id && s.start_date <= dateStr && s.end_date >= dateStr);
                if (isSick && !shift) {
                    cell.style.background = '#FFE0CC';
                    cell.textContent = 'Krank';
                    cell.style.color = '#E07040';
                    cell.style.fontSize = '0.7rem';
                }

                cell.onclick = () => openShiftModal(emp.id, dateStr, shift);
                grid.appendChild(cell);
            });
        });
    });
}

async function renderHoursOverview(days, weekShifts) {
    const container = document.getElementById('hours-overview');
    if (!container) return;

    // KW berechnen
    const monday = days[0];
    const sunday = days[6];
    const mondayStr = `${monday.getDate().toString().padStart(2,'0')}.${(monday.getMonth()+1).toString().padStart(2,'0')}`;
    const sundayStr = `${sunday.getDate().toString().padStart(2,'0')}.${(sunday.getMonth()+1).toString().padStart(2,'0')}`;

    // KW Nummer berechnen
    const startOfYear = new Date(monday.getFullYear(), 0, 1);
    const kwNumber = Math.ceil(((monday - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);

    // Monatsstunden laden
    const year = monday.getFullYear();
    const month = monday.getMonth() + 1;
    const monthStart = `${year}-${String(month).padStart(2,'0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2,'0')}-${new Date(year, month, 0).getDate()}`;
    const monthNames = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

    const { data: monthShifts } = await db
        .from('shifts')
        .select('employee_id, start_time, end_time, break_minutes')
        .eq('user_id', adminSession.user.id)
        .eq('is_open', false)
        .gte('shift_date', monthStart)
        .lte('shift_date', monthEnd);

    const html = employees.map(emp => {
        // Wochenstunden
        const empWeekShifts = weekShifts.filter(s => s.employee_id === emp.id && !s.is_open);
        let weekMinutes = 0;
        empWeekShifts.forEach(s => {
            const start = s.start_time.slice(0,5).split(':').map(Number);
            const end = s.end_time.slice(0,5).split(':').map(Number);
            weekMinutes += (end[0]*60+end[1]) - (start[0]*60+start[1]) - (s.break_minutes || 0);
        });

        // Monatsstunden
        const empMonthShifts = (monthShifts || []).filter(s => s.employee_id === emp.id);
        let monthMinutes = 0;
        empMonthShifts.forEach(s => {
            const start = s.start_time.slice(0,5).split(':').map(Number);
            const end = s.end_time.slice(0,5).split(':').map(Number);
            monthMinutes += (end[0]*60+end[1]) - (start[0]*60+start[1]) - (s.break_minutes || 0);
        });

        const weekH = (weekMinutes / 60).toFixed(1);
        const monthH = (monthMinutes / 60).toFixed(1);

        const weekColor = weekMinutes === 0 ? 'var(--color-text-light)' :
                          weekMinutes > 600 ? '#c05050' :
                          weekMinutes < 240 ? '#b8a020' : '#6aaa6a';

        const parts = emp.name.trim().split(' ');
        const displayName = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];

        return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid var(--color-border);">
                <span style="font-size:0.9rem; font-weight:600;">${displayName}</span>
                <div style="text-align:right; font-size:0.85rem;">
                    <span style="color:${weekColor}; font-weight:600;">${weekH}h KW${kwNumber}</span>
                    <span style="color:var(--color-text-light); margin-left:0.5rem;">/ ${monthH}h ${monthNames[month-1]}</span>
                </div>
            </div>`;
    }).join('');

    container.innerHTML = html || '<div class="empty-state"><p>Keine Mitarbeiter.</p></div>';
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
async function openShiftModal(employeeId, dateStr, existingShift) {
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
    document.getElementById('shift-repeat').checked = false;
    document.getElementById('shift-repeat-group').style.display = 'none';
    document.getElementById('shift-repeat-weeks').value = 4;
    await loadTemplates();
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

    const repeat = document.getElementById('shift-repeat').checked;
    const weeks = parseInt(document.getElementById('shift-repeat-weeks').value) || 1;

    // Verfügbarkeit prüfen (nur bei normalen Schichten, nicht offenen)
    if (!isOpen) {
        const warning = await checkAvailabilityWarning(employeeId, date, start, end);
        if (warning) {
            pendingShiftPayload = payload;
            pendingShiftIsRepeat = repeat;
            pendingShiftWeeks = weeks;
            document.getElementById('avail-warning-text').textContent = warning;
            document.getElementById('avail-warning-modal').classList.add('active');
            return;
        }
    }

    await saveShift(payload, repeat, weeks);
}

let pendingShiftPayload = null;
let pendingShiftIsRepeat = false;
let pendingShiftWeeks = 1;

function closeAvailWarningModal() {
    document.getElementById('avail-warning-modal').classList.remove('active');
    pendingShiftPayload = null;
}

async function confirmShiftDespiteWarning() {
    document.getElementById('avail-warning-modal').classList.remove('active');
    await saveShift(pendingShiftPayload, pendingShiftIsRepeat, pendingShiftWeeks);
}

async function checkAvailabilityWarning(employeeId, date, start, end) {
    if (!employeeId || !date) return null;
    const emp = employees.find(e => e.id === employeeId);
    if (!emp) return null;

    // Urlaub prüfen
    const { data: vacations } = await db
        .from('vacation_requests')
        .select('start_date, end_date')
        .eq('user_id', adminSession.user.id)
        .eq('employee_id', employeeId)
        .eq('status', 'approved')
        .lte('start_date', date)
        .gte('end_date', date);

    if (vacations && vacations.length > 0) {
        return `${emp.name} hat an diesem Tag genehmigten Urlaub!`;
    }

    // Verfügbarkeit prüfen
    const d = new Date(date + 'T12:00:00');
    const monthStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    const dayNum = d.getDate();

    const { data } = await db
        .from('availability')
        .select('available_days')
        .eq('employee_id', employeeId)
        .eq('month', monthStr)
        .maybeSingle();

    if (!data) return null;
    const entry = (data.available_days || {})[dayNum];
    if (!entry) return null;

    if (entry.status === 'off') {
        return `${emp.name} ist an diesem Tag nicht verfügbar!`;
    }

    if (entry.status === 'school') {
        return `${emp.name} hat an diesem Tag Schule!`;
    }

    if (entry.status === 'partial' && entry.from && entry.to) {
        const toMinutes = t => parseInt(t.split(':')[0]) * 60 + parseInt(t.split(':')[1]);
        const availFrom = toMinutes(entry.from);
        const availTo = toMinutes(entry.to);
        const shiftFrom = toMinutes(start);
        const shiftTo = toMinutes(end);
        if (shiftFrom < availFrom || shiftTo > availTo) {
            return `${emp.name} ist nur von ${entry.from}–${entry.to} Uhr verfügbar. Die Schicht liegt außerhalb!`;
        }
    }

    return null;
}

async function saveShift(payload, repeat, weeks) {
    const errorDiv = document.getElementById('shift-error');
    let error;
    if (editShiftId) {
        ({ error } = await db.from('shifts').update(payload).eq('id', editShiftId));
    } else {
        if (repeat && weeks > 1) {
            const payloads = [];
            for (let i = 0; i < weeks; i++) {
                const d = new Date(payload.shift_date + 'T12:00:00');
                d.setDate(d.getDate() + i * 7);
                payloads.push({ ...payload, shift_date: d.toISOString().split('T')[0] });
            }
            ({ error } = await db.from('shifts').insert(payloads));
        } else {
            ({ error } = await db.from('shifts').insert(payload));
        }
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

    await db.from('open_shift_requests').delete().eq('shift_id', editShiftId);
    await db.from('shift_swaps').delete().eq('shift_id', editShiftId);

    const { error } = await db.from('shifts').delete().eq('id', editShiftId);
    if (error) {
        alert('Fehler beim Löschen: ' + error.message);
        return;
    }
    closeShiftModal();
    await loadWeekGrid();
}

function toggleRepeat() {
    const checked = document.getElementById('shift-repeat').checked;
    document.getElementById('shift-repeat-group').style.display = checked ? 'block' : 'none';
}

// ── SCHICHT-VORLAGEN ──────────────────────────────────────
let shiftTemplates = [];

async function loadTemplates() {
    const { data: templates } = await db
        .from('shift_templates')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .order('name');

    shiftTemplates = templates || [];
        
    const select = document.getElementById('shift-template');
    select.innerHTML = '<option value="">— Keine Vorlage —</option>';
    (templates || []).forEach(t => {
        select.innerHTML += `<option value="${t.id}" data-start="${t.start_time}" data-end="${t.end_time}" data-break="${t.break_minutes}">${t.name} (${t.start_time.slice(0,5)}–${t.end_time.slice(0,5)})</option>`;
    });
}

function applyShiftTemplate() {
    const select = document.getElementById('shift-template');
    const selected = select.options[select.selectedIndex];
    if (!selected.value) return;
    document.getElementById('shift-start').value = selected.dataset.start.slice(0,5);
    document.getElementById('shift-end').value = selected.dataset.end.slice(0,5);
    document.getElementById('shift-break').value = selected.dataset.break;
}

function openSaveTemplateModal() {
    document.getElementById('template-name').value = '';
    document.getElementById('template-error').style.display = 'none';
    document.getElementById('save-template-modal').classList.add('active');
}

function openManageTemplatesModal() {
    const list = document.getElementById('manage-templates-list');
    list.innerHTML = '';
    if (!shiftTemplates || shiftTemplates.length === 0) {
        list.innerHTML = '<div style="color:var(--color-text-light); font-size:0.9rem;">Keine Vorlagen vorhanden.</div>';
    } else {
        shiftTemplates.forEach(t => {
            const row = document.createElement('div');
            row.className = 'list-item';
            row.innerHTML = `
                <div class="list-item-info">
                    <h4>${t.name}</h4>
                    <p>${t.start_time.slice(0,5)} – ${t.end_time.slice(0,5)}, Pause: ${t.break_minutes} Min</p>
                </div>
                <div style="display:flex; gap:0.5rem;">
                    <button class="btn-small btn-approve" onclick="openEditTemplateModal('${t.id}')">✎</button>
                    <button class="btn-small btn-reject" onclick="deleteTemplate('${t.id}')">🗑</button>
                </div>
            `;
            list.appendChild(row);
        });
    }
    document.getElementById('manage-templates-modal').classList.add('active');
}

function closeManageTemplatesModal() {
    document.getElementById('manage-templates-modal').classList.remove('active');
}

async function deleteTemplate(id) {
    if (!confirm('Vorlage wirklich löschen?')) return;
    const { error } = await db.from('shift_templates').delete().eq('id', id);
    if (!error) {
        await loadTemplates();
        openManageTemplatesModal();
    }
}

let editTemplateId = null;

function openEditTemplateModal(id) {
    const t = shiftTemplates.find(t => t.id === id);
    if (!t) return;
    editTemplateId = id;
    document.getElementById('edit-template-name').value = t.name;
    document.getElementById('edit-template-start').value = t.start_time.slice(0,5);
    document.getElementById('edit-template-end').value = t.end_time.slice(0,5);
    document.getElementById('edit-template-break').value = t.break_minutes || 0;
    document.getElementById('edit-template-modal').classList.add('active');
}

function closeEditTemplateModal() {
    document.getElementById('edit-template-modal').classList.remove('active');
}

async function submitEditTemplate() {
    const name = document.getElementById('edit-template-name').value.trim();
    const start = document.getElementById('edit-template-start').value;
    const end = document.getElementById('edit-template-end').value;
    const breakMin = parseInt(document.getElementById('edit-template-break').value) || 0;
    if (!name || !start || !end) return;
    const { error } = await db.from('shift_templates')
        .update({ name, start_time: start, end_time: end, break_minutes: breakMin })
        .eq('id', editTemplateId);
    if (!error) {
        await loadTemplates();
        closeEditTemplateModal();
        openManageTemplatesModal();
    }
}

function closeSaveTemplateModal() {
    document.getElementById('save-template-modal').classList.remove('active');
}

async function saveTemplate() {
    const name = document.getElementById('template-name').value.trim();
    const start = document.getElementById('shift-start').value;
    const end = document.getElementById('shift-end').value;
    const breakMin = document.getElementById('shift-break').value || 0;
    const errorDiv = document.getElementById('template-error');

    if (!name) {
        errorDiv.textContent = 'Bitte einen Namen eingeben.';
        errorDiv.style.display = 'block';
        return;
    }
    if (!start || !end) {
        errorDiv.textContent = 'Bitte erst Von/Bis im Schicht-Modal ausfüllen.';
        errorDiv.style.display = 'block';
        return;
    }

    const { error } = await db.from('shift_templates').insert({
        user_id: adminSession.user.id,
        name,
        start_time: start,
        end_time: end,
        break_minutes: parseInt(breakMin)
    });

    if (error) {
        errorDiv.textContent = 'Fehler beim Speichern.';
        errorDiv.style.display = 'block';
        return;
    }

    closeSaveTemplateModal();
    await loadTemplates();
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

    const thisYear = new Date().getFullYear();
    const today = new Date().toISOString().split('T')[0];
    const current = vacations.filter(v => v.end_date >= today || v.status === 'pending');
    const archived = vacations.filter(v => v.end_date < today && v.status !== 'pending');

    const renderItem = v => `
        <div class="list-item">
            <div class="list-item-info">
                <h4>${v.employees_planit?.name || 'Unbekannt'}</h4>
                <p>${v.type === 'payout' ? `Erstellt am ${formatDate(v.start_date)}` : `${formatDate(v.start_date)} – ${formatDate(v.end_date)}`}</p>
${v.reason ? `<p style="font-size:0.8rem;">${v.reason}</p>` : ''}
${v.status === 'approved' ? `<p style="font-size:0.8rem; color:var(--color-primary);">🏖 ${v.deducted_days || 0} ${v.type === 'payout' ? 'Urlaubstage ausgezahlt' : 'Urlaubstage abgezogen'}${v.payout_month ? ` · ${v.payout_month}` : ''}</p>` : ''}
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
                ` : `
                    <button class="btn-small btn-approve" onclick="editVacation('${v.id}', '${v.start_date}', '${v.end_date}', ${v.deducted_days || 0}, '${v.type || 'vacation'}')">✎</button>
                `}
                ${v.pdf_url ? `
                    <button class="btn-small" style="background:#D0E8FF; color:#5B7C9E;" onclick="downloadVacationPdf('${v.pdf_url}')">📄</button>
                    <button class="btn-small" style="background:#D8F0D8; color:#4CAF50;" onclick="saveVacationPdf('${v.pdf_url}')">⬇️</button>
                ` : ''}
                <button class="btn-small" style="background:#FFD9D9; color:#C97E7E;" onclick="deleteVacation('${v.id}')">🗑</button>
            </div>
        </div>`;

    let html = current.length > 0
        ? current.map(renderItem).join('')
        : '<div class="empty-state"><p>Keine aktuellen Anträge.</p></div>';

    if (archived.length > 0) {
        // Nach Jahr gruppieren
        const byYear = {};
        archived.forEach(v => {
            const year = new Date(v.start_date).getFullYear();
            if (!byYear[year]) byYear[year] = [];
            byYear[year].push(v);
        });

        const archiveHtml = Object.keys(byYear).sort((a,b) => b-a).map(year => `
            <div style="margin-bottom:1rem;">
                <div style="font-size:0.8rem; font-weight:700; color:var(--color-text-light); margin-bottom:0.5rem;">${year}</div>
                ${byYear[year].map(renderItem).join('')}
            </div>
        `).join('');

        html += `
        <div style="margin-top:1.5rem;">
            <button onclick="toggleVacationArchive()" style="background:none; border:none; cursor:pointer; font-size:0.85rem; color:var(--color-text-light); display:flex; align-items:center; gap:0.5rem; padding:0;">
                <span id="archive-toggle-icon">▶</span> Archiv (${archived.length} Anträge)
            </button>
            <div id="vacation-archive" style="display:none; margin-top:0.75rem;">
                ${archiveHtml}
            </div>
        </div>`;
    }

    container.innerHTML = html;
}

async function saveVacationPdf(filePath) {
    const { data, error } = await db.storage
        .from('vacation-pdfs')
        .createSignedUrl(filePath, 60);
    if (error || !data?.signedUrl) { alert('PDF konnte nicht geladen werden.'); return; }
    const response = await fetch(data.signedUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `Urlaubsantrag_${filePath.split('/').pop()}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
}

async function downloadVacationPdf(filePath) {
    const { data, error } = await db.storage
        .from('vacation-pdfs')
        .createSignedUrl(filePath, 60);

    if (error || !data?.signedUrl) {
        alert('PDF konnte nicht geladen werden.');
        return;
    }

    window.location.href = data.signedUrl;
}

function toggleVacationArchive() {
    const archive = document.getElementById('vacation-archive');
    const icon = document.getElementById('archive-toggle-icon');
    if (archive.style.display === 'none') {
        archive.style.display = 'block';
        icon.textContent = '▼';
    } else {
        archive.style.display = 'none';
        icon.textContent = '▶';
    }
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
    // Bei Genehmigung: erst deducted_days prüfen
    const { data: vac } = await db
        .from('vacation_requests')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (!vac) return;

    if (!vac.deducted_days || vac.deducted_days === 0) {
        // Edit-Modal öffnen, dann nach Speichern genehmigen
        editVacationAndApprove(vac);
        return;
    }

    await db.from('vacation_requests').update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminSession.user.id
    }).eq('id', id);
    await loadAdminVacations();
}

function editVacationAndApprove(vac) {
    editVacationId = vac.id;
    editVacationApproveAfter = true;
    const isPayout = vac.type === 'payout';
    document.getElementById('edit-vacation-date-fields').style.display = isPayout ? 'none' : 'block';
    document.getElementById('edit-vacation-days-label').textContent = isPayout ? 'Urlaubsstunden' : 'Abzuziehende Urlaubstage';
    document.getElementById('edit-vacation-start').value = vac.start_date;
    document.getElementById('edit-vacation-end').value = vac.end_date;
    document.getElementById('edit-vacation-days').value = vac.deducted_days || 0;
    document.getElementById('edit-vacation-modal').classList.add('active');
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

async function deleteVacation(id) {
    if (!confirm('Urlaubsantrag wirklich löschen?')) return;
    const { error } = await db
        .from('vacation_requests')
        .delete()
        .eq('id', id);
    if (!error) await loadAdminVacations();
}

let editVacationId = null;

function editVacation(id, startDate, endDate, deductedDays, type) {
    editVacationId = id;
    const isPayout = type === 'payout';
    document.getElementById('edit-vacation-date-fields').style.display = isPayout ? 'none' : 'block';
    document.getElementById('edit-vacation-days-label').textContent = isPayout ? 'Urlaubsstunden' : 'Abzuziehende Urlaubstage';
    document.getElementById('edit-vacation-payout-month-field').style.display = isPayout ? 'block' : 'none';
    document.getElementById('edit-vacation-start').value = startDate;
    document.getElementById('edit-vacation-end').value = endDate;
    document.getElementById('edit-vacation-days').value = deductedDays;
    document.getElementById('edit-vacation-payout-month').value = '';
    document.getElementById('edit-vacation-modal').classList.add('active');
}

function closeEditVacationModal() {
    document.getElementById('edit-vacation-modal').classList.remove('active');
}

async function submitEditVacation() {
    const start = document.getElementById('edit-vacation-start').value;
    const end = document.getElementById('edit-vacation-end').value;
    const rawValue = parseFloat(document.getElementById('edit-vacation-days').value) || 0;

    // Bei Auszahlung: Wert ist Stunden → in Tage umrechnen
    const { data: vac } = await db
        .from('vacation_requests')
        .select('type, employees_planit(hours_per_vacation_day)')
        .eq('id', editVacationId)
        .maybeSingle();

    const isPayout = vac?.type === 'payout';
    const hoursPerDay = vac?.employees_planit?.hours_per_vacation_day || 8.0;
    const days = isPayout ? rawValue / hoursPerDay : rawValue;

    const payoutMonth = document.getElementById('edit-vacation-payout-month').value.trim() || null;
    const updateData = {
        start_date: start,
        end_date: end,
        deducted_days: days,
        ...(isPayout && payoutMonth ? { payout_month: payoutMonth } : {})
    };

    if (editVacationApproveAfter) {
        updateData.status = 'approved';
        updateData.reviewed_at = new Date().toISOString();
        updateData.reviewed_by = adminSession.user.id;
        editVacationApproveAfter = false;
    }

    const { error } = await db.from('vacation_requests')
        .update(updateData)
        .eq('id', editVacationId);
    if (error) console.log('Update error:', JSON.stringify(error));

    if (!error) {
        closeEditVacationModal();
        await loadAdminVacations();
    }
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
        item.appendChild(document.createTextNode(v.employees_planit?.name || '?'));
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

    // Urlaubstage laden
    const monthStart = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const monthEnd = `${year}-${String(month+1).padStart(2,'0')}-${new Date(year, month+1, 0).getDate()}`;
    const { data: vacations } = await db
        .from('vacation_requests')
        .select('start_date, end_date')
        .eq('employee_id', employeeId)
        .eq('status', 'approved')
        .gte('start_date', monthStart)
        .lte('end_date', monthEnd);

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

        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isVacation = (vacations || []).some(v => v.start_date <= dateStr && v.end_date >= dateStr);

        if (isVacation) div.style.background = '#D0E8FF';
        else if (status === 'school') div.style.background = '#E8D0FF';
        else if (status === 'full') div.style.background = '#D8F0D8';
        else if (status === 'partial') div.style.background = '#FFF3CC';
        else if (status === 'off') div.style.background = '#FFD9D9';
        const timeHtml = (status === 'partial' && entry?.from)
            ? `<span style="font-size:0.6rem; line-height:1.2;">${entry.from}</span><span style="font-size:0.6rem; line-height:1.2;">${entry.to}</span>`
            : '';
        const commentHtml = entry?.comment
            ? `<span style="font-size:0.55rem; color:#888; line-height:1.2; white-space:normal; text-align:center;">${entry.comment}</span>`
            : '';
        div.innerHTML = `<span>${d}</span>${timeHtml}${commentHtml}`;
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
    const loadId = `${year}-${month}`;
    loadAllAvailabilities._currentLoad = loadId;

    const monthStr = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const monthNames = ['Januar','Februar','März','April','Mai','Juni',
                        'Juli','August','September','Oktober','November','Dezember'];
    document.getElementById('admin-avail-month-label').textContent = `${monthNames[month]} ${year}`;

    const container = document.getElementById('admin-avail-grid');
    container.innerHTML = '';
    container.classList.add('all-view');

    const monthStart = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const monthEnd = `${year}-${String(month+1).padStart(2,'0')}-${new Date(year, month+1, 0).getDate()}`;

    for (const emp of employees) {
        if (loadAllAvailabilities._currentLoad !== loadId) return;

        const { data } = await db
            .from('availability')
            .select('*')
            .eq('employee_id', emp.id)
            .eq('month', monthStr)
            .maybeSingle();

        if (loadAllAvailabilities._currentLoad !== loadId) return;

        const availDays = (data && !Array.isArray(data.available_days)) ? data.available_days : {};

        const { data: vacations } = await db
            .from('vacation_requests')
            .select('start_date, end_date')
            .eq('user_id', adminSession.user.id)
            .eq('employee_id', emp.id)
            .eq('status', 'approved')
            .lte('start_date', monthEnd)
            .gte('end_date', monthStart);

        if (loadAllAvailabilities._currentLoad !== loadId) return;

        const title = document.createElement('div');
        title.style.fontWeight = '700';
        title.style.fontSize = '0.9rem';
        title.style.margin = '1rem 0 0.5rem';
        title.style.color = 'var(--color-primary)';
        title.textContent = emp.name;
        container.appendChild(title);

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

            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const isVacation = (vacations || []).some(v => v.start_date <= dateStr && v.end_date >= dateStr);

            if (isVacation) div.style.background = '#D0E8FF';
            else if (status === 'school') div.style.background = '#E8D0FF';
            else if (status === 'full') div.style.background = '#D8F0D8';
            else if (status === 'partial') div.style.background = '#FFF3CC';
            else if (status === 'off') div.style.background = '#FFD9D9';

            const timeHtml = (status === 'partial' && entry?.from)
                ? `<span style="font-size:0.6rem; line-height:1.2;">${entry.from}</span><span style="font-size:0.6rem; line-height:1.2;">${entry.to}</span>`
                : '';
            const commentHtml = entry?.comment
                ? `<span style="font-size:0.55rem; color:#888; line-height:1.2; white-space:normal; text-align:center;">${entry.comment}</span>`
                : '';
            div.innerHTML = `<span>${d}</span>${timeHtml}${commentHtml}`;
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

    // Urlaubsanträge dieses Jahr laden
    const year = new Date().getFullYear();
    const { data: vacations } = await db
        .from('vacation_requests')
        .select('employee_id, start_date, end_date, deducted_days')
        .eq('user_id', adminSession.user.id)
        .eq('status', 'approved')
        .gte('start_date', `${year}-01-01`)
        .lte('end_date', `${year}-12-31`);

    const departments = [...new Set(employees.map(e => e.department || 'Allgemein'))].sort();

    container.innerHTML = departments.map(dept => {
        const deptEmployees = employees.filter(e => (e.department || 'Allgemein') === dept);
        return `
            <div style="font-size:0.85rem; font-weight:700; color:var(--color-text-light); letter-spacing:0.05em; margin:1rem 0 0.5rem;">${dept.toUpperCase()}</div>
            ${deptEmployees.map(e => {
        // Urlaubstage berechnen
        const empVacations = (vacations || []).filter(v => v.employee_id === e.id);
        let usedDays = 0;
        empVacations.forEach(v => {
            usedDays += v.deducted_days || 0;
        });
        const totalDays = e.vacation_days_per_year ?? 20;
        const remaining = totalDays - usedDays;
        const color = remaining <= 3 ? '#E57373' : remaining <= 7 ? '#C9A24D' : 'var(--color-primary)';

        return `
        <div class="list-item">
            <div class="list-item-info">
                <h4>${e.name}${e.is_apprentice ? ' <span style="background:#E8D0FF; color:#9B59B6; font-size:0.7rem; padding:2px 6px; border-radius:8px; font-weight:600;">Azubi</span>' : ''}</h4>
                <p>${e.login_code} · PIN: ${e.password_hash || '—'} · ${e.department || 'Allgemein'}${e.birthdate ? ' · 🎂 ' + new Date(e.birthdate + 'T00:00:00').toLocaleDateString('de-DE', {day:'numeric', month:'long'}) : ''}</p>
                <p style="font-size:0.8rem; color:${color}; margin-top:0.2rem;">🏖 ${remaining} von ${totalDays} Urlaubstagen übrig</p>
            </div>
            <div style="display:flex; gap:0.5rem; align-items:center;">
                <button class="btn-small btn-approve" onclick="openEditEmployeeModal('${e.id}')">✏️</button>
                <button class="btn-small btn-reject" onclick="deleteEmployee('${e.id}', '${e.name}')">🗑</button>
            </div>
        </div>`;

    }).join('')}`;
}).join('');
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
    const is_apprentice = document.getElementById('new-emp-apprentice').checked;
    const startDate = document.getElementById('new-emp-start-date').value || null;
    const hoursPerVacationDay = parseFloat(document.getElementById('new-emp-hours-per-vacation-day').value) || 8.0;
    const vacationDays = parseInt(document.getElementById('new-emp-vacation-days')?.value) || 20;
    const { error } = await db.from('employees_planit').insert({
        user_id: adminSession.user.id,
        name,
        login_code: loginCode,
        password_hash: password,
        department: department,
        is_active: true,
        birthdate,
        is_apprentice,
        start_date: startDate,
        hours_per_vacation_day: hoursPerVacationDay,
        vacation_days_per_year: vacationDays
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
    document.getElementById('edit-emp-vacation-days').value = emp.vacation_days_per_year ?? 20;
    document.getElementById('edit-emp-start-date').value = emp.start_date || '';
    document.getElementById('edit-emp-hours-per-vacation-day').value = emp.hours_per_vacation_day || 8.0;
    document.getElementById('edit-emp-apprentice').checked = emp.is_apprentice || false;
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
    const birthdate = document.getElementById('edit-emp-birthdate').value || null;
    const vacationDays = parseInt(document.getElementById('edit-emp-vacation-days').value) || 20;
    const startDate = document.getElementById('edit-emp-start-date').value || null;
    const hoursPerVacationDay = parseFloat(document.getElementById('edit-emp-hours-per-vacation-day').value) || 8.0;
    const errorDiv = document.getElementById('edit-emp-error');
    errorDiv.style.display = 'none';

    if (!name || !loginCode) {
        errorDiv.textContent = 'Name und Kürzel sind Pflichtfelder.';
        errorDiv.style.display = 'block';
        return;
    }

    const is_apprentice = document.getElementById('edit-emp-apprentice').checked;
    const payload = { name, login_code: loginCode, department, birthdate, vacation_days_per_year: vacationDays, is_apprentice, start_date: startDate, hours_per_vacation_day: hoursPerVacationDay };
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
    
    // Erst alle Requests für diese Schicht löschen
    await db.from('open_shift_requests')
        .delete()
        .eq('shift_id', openShiftData.existingShift.id);

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

// ── KRANKMELDUNGEN ─────────────────────────────────────────
let extendSickLeaveId = null;

function openSickLeaveModal() {
    const select = document.getElementById('sick-leave-employee');
    select.innerHTML = employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
    document.getElementById('sick-leave-start').value = '';
    document.getElementById('sick-leave-end').value = '';
    document.getElementById('sick-leave-modal').classList.add('active');
}

function closeSickLeaveModal() {
    document.getElementById('sick-leave-modal').classList.remove('active');
}

function openExtendSickLeaveModal(id, currentEnd) {
    extendSickLeaveId = id;
    document.getElementById('extend-sick-leave-end').value = currentEnd;
    document.getElementById('extend-sick-leave-modal').classList.add('active');
}

function closeExtendSickLeaveModal() {
    document.getElementById('extend-sick-leave-modal').classList.remove('active');
}

async function loadSickLeaves() {
    const { data: sickLeaves } = await db
        .from('sick_leaves')
        .select('*, employees_planit(name)')
        .eq('user_id', adminSession.user.id)
        .order('start_date', { ascending: false });

    const container = document.getElementById('sick-leave-list');
    if (!sickLeaves || sickLeaves.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Krankmeldungen vorhanden.</p></div>';
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    container.innerHTML = sickLeaves.map(s => {
        const isActive = s.end_date >= today;
        return `
        <div class="list-item">
            <div class="list-item-info">
                <h4>${s.employees_planit?.name || 'Unbekannt'} ${isActive ? '<span style="background:#FFE0CC; color:#E07040; font-size:0.7rem; padding:2px 6px; border-radius:8px;">Aktiv</span>' : ''}</h4>
                <p>${formatDate(s.start_date)} – ${formatDate(s.end_date)}</p>
            </div>
            <div style="display:flex; gap:0.5rem; align-items:center;">
                <button class="btn-small btn-approve" onclick="openExtendSickLeaveModal('${s.id}', '${s.end_date}')">✎</button>
                <button class="btn-small" style="background:#FFD9D9; color:#C97E7E;" onclick="deleteSickLeave('${s.id}')">🗑</button>
            </div>
        </div>`;
    }).join('');
}

async function submitSickLeave() {
    const employeeId = document.getElementById('sick-leave-employee').value;
    const start = document.getElementById('sick-leave-start').value;
    const end = document.getElementById('sick-leave-end').value;
    if (!employeeId || !start || !end) return;

    // Krankmeldung speichern
    const { error } = await db.from('sick_leaves').insert({
        user_id: adminSession.user.id,
        employee_id: employeeId,
        start_date: start,
        end_date: end
    });
    if (error) return;

    // Schichten in diesem Zeitraum automatisch öffnen
    const emp = employees.find(e => e.id === employeeId);
    const { data: shifts } = await db
        .from('shifts')
        .select('id, department')
        .eq('user_id', adminSession.user.id)
        .eq('employee_id', employeeId)
        .gte('shift_date', start)
        .lte('shift_date', end);

    if (shifts && shifts.length > 0) {
        for (const shift of shifts) {
            await db.from('shifts').update({
                is_open: true,
                employee_id: null,
                open_note: 'Krankmeldung',
                department: shift.department || emp?.department || 'Allgemein'
            }).eq('id', shift.id);
        }
    }

    closeSickLeaveModal();
    await loadSickLeaves();
    await loadWeekGrid();
}

async function submitExtendSickLeave() {
    const newEnd = document.getElementById('extend-sick-leave-end').value;
    if (!newEnd) return;

    // Erst alte Daten laden
    const { data: sick } = await db
        .from('sick_leaves')
        .select('*')
        .eq('id', extendSickLeaveId)
        .maybeSingle();

    if (!sick) return;

    // Enddatum aktualisieren
    await db.from('sick_leaves').update({ end_date: newEnd }).eq('id', extendSickLeaveId);

    if (newEnd > sick.end_date) {
        // Verlängern — neue Schichten öffnen
        const { data: shifts } = await db
            .from('shifts')
            .select('id, department')
            .eq('user_id', adminSession.user.id)
            .eq('employee_id', sick.employee_id)
            .gt('shift_date', sick.end_date)
            .lte('shift_date', newEnd);
        if (shifts && shifts.length > 0) {
            const emp = await db.from('employees_planit').select('department').eq('id', sick.employee_id).maybeSingle();
            for (const shift of shifts) {
                await db.from('shifts').update({
                    is_open: true,
                    employee_id: null,
                    open_note: 'Krankmeldung',
                    department: shift.department || emp.data?.department || 'Allgemein'
                }).eq('id', shift.id);
            }
        }
    } else if (newEnd < sick.end_date) {
        // Verkürzen — Schichten zurück zum Mitarbeiter
        const { data: shifts } = await db
            .from('shifts')
            .select('id')
            .eq('user_id', adminSession.user.id)
            .eq('is_open', true)
            .eq('open_note', 'Krankmeldung')
            .gt('shift_date', newEnd)
            .lte('shift_date', sick.end_date);
            console.log('Shifts to restore:', shifts, 'newEnd:', newEnd, 'sick.end_date:', sick.end_date);
        if (shifts && shifts.length > 0) {
            for (const shift of shifts) {
                await db.from('shifts').update({
                    is_open: false,
                    employee_id: sick.employee_id,
                    open_note: null,
                    department: null
                }).eq('id', shift.id);
            }
        }
    }

    closeExtendSickLeaveModal();
    await loadSickLeaves();
    await loadWeekGrid();
}

async function deleteSickLeave(id) {
    if (!confirm('Krankmeldung wirklich löschen?')) return;
    
    // Erst Krankmeldung laden um Daten zu haben
    const { data: sick } = await db
        .from('sick_leaves')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (!sick) return;

    // Schichten zurück dem Mitarbeiter zuweisen
    const { data: shifts } = await db
        .from('shifts')
        .select('id')
        .eq('user_id', adminSession.user.id)
        .eq('is_open', true)
        .eq('open_note', 'Krankmeldung')
        .gte('shift_date', sick.start_date)
        .lte('shift_date', sick.end_date);

    if (shifts && shifts.length > 0) {
        for (const shift of shifts) {
            await db.from('shifts').update({
                is_open: false,
                employee_id: sick.employee_id,
                open_note: null,
                department: null
            }).eq('id', shift.id);
        }
    }

    await db.from('sick_leaves').delete().eq('id', id);
    await loadSickLeaves();
    await loadWeekGrid();
}

// ── URLAUBSVERWALTUNG ─────────────────────────────────────────

async function loadUrlaubsverwaltung() {
    document.getElementById('urlaubsverwaltung-year-label').textContent = urlaubYear;
    const year = urlaubYear;
    const container = document.getElementById('urlaubsverwaltung-list');
    container.innerHTML = '<div style="color:var(--color-text-light);">Wird geladen...</div>';

    // Alle genehmigten Urlaubsanträge des Jahres laden
    const { data: vacations } = await db
        .from('vacation_requests')
        .select('*, employees_planit(name)')
        .eq('user_id', adminSession.user.id)
        .eq('status', 'approved')
        .gte('start_date', `${year}-01-01`)
        .lte('end_date', `${year}-12-31`);

    // Vorjahr laden für Übertrag
    const { data: prevVacations } = await db
        .from('vacation_requests')
        .select('employee_id, deducted_days')
        .eq('user_id', adminSession.user.id)
        .eq('status', 'approved')
        .gte('start_date', `${year-1}-01-01`)
        .lte('end_date', `${year-1}-12-31`);

    container.innerHTML = '';

    employees.forEach(emp => {
        const block = document.createElement('div');
        block.style.cssText = 'border-radius:14px; margin-bottom:1rem; overflow:hidden; background:var(--color-gray);';

        // Urlaubskonto berechnen
        const account = calculateVacationAccount(emp, year, vacations || [], prevVacations || []);

        const header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:1rem 1.25rem; cursor:pointer;';
        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.75rem;">
                <div>
                    <div style="font-weight:700; font-size:1rem;">${emp.name}</div>
                    <div style="font-size:0.8rem; color:var(--color-text-light);">${emp.department || 'Allgemein'}</div>
                </div>
                ${emp.is_apprentice ? '<span style="background:#E8D0FF; color:#9B59B6; font-size:0.7rem; padding:2px 6px; border-radius:8px;">Azubi</span>' : ''}
            </div>
            <div style="display:flex; align-items:center; gap:1rem;">
                <div style="text-align:right;">
                    <div style="font-size:0.75rem; color:var(--color-text-light);">ÜBRIG</div>
                    <div style="font-weight:700; color:${account.remaining <= 3 ? '#E57373' : account.remaining <= 7 ? '#C9A24D' : 'var(--color-primary)'};">${account.remaining.toFixed(2)} Tage</div>
                </div>
                <span id="toggle-${emp.id}" style="color:var(--color-text-light); font-size:0.85rem;">▶</span>
            </div>
        `;

        const body = document.createElement('div');
        body.id = `urlaubsbody-${emp.id}`;
        body.style.cssText = 'display:none; padding:1rem 1.25rem; border-top:1px solid var(--color-border); background:white;';

        // Konto-Übersicht
        body.innerHTML = `
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-bottom:1rem;">
                <div style="background:#F5F5F5; border-radius:8px; padding:0.5rem 0.75rem;">
                    <div style="font-size:0.75rem; color:var(--color-text-light);">Jahresanspruch</div>
                    <div style="font-weight:700;">${account.entitlement.toFixed(2)} Tage</div>
                    <div style="font-size:0.75rem; color:var(--color-text-light);">${account.entitlementH.toFixed(2)} Std</div>
                </div>
                <div style="background:#F5F5F5; border-radius:8px; padding:0.5rem 0.75rem;">
                    <div style="font-size:0.75rem; color:var(--color-text-light);">Übertrag Vorjahr</div>
                    <div style="font-weight:700;">${account.carryover.toFixed(2)} Tage</div>
                    <div style="font-size:0.75rem; color:var(--color-text-light);">${account.carryoverH.toFixed(2)} Std</div>
                </div>
                <div style="background:#F5F5F5; border-radius:8px; padding:0.5rem 0.75rem;">
                    <div style="font-size:0.75rem; color:var(--color-text-light);">Genommen</div>
                    <div style="font-weight:700;">${account.used.toFixed(2)} Tage</div>
                    <div style="font-size:0.75rem; color:var(--color-text-light);">${account.usedH.toFixed(2)} Std</div>
                </div>
                <div style="background:#F5F5F5; border-radius:8px; padding:0.5rem 0.75rem;">
                    <div style="font-size:0.75rem; color:var(--color-text-light);">Übrig</div>
                    <div style="font-weight:700; color:${account.remaining <= 3 ? '#E57373' : 'var(--color-primary)'};">${account.remaining.toFixed(2)} Tage</div>
                    <div style="font-size:0.75rem; color:var(--color-text-light);">${account.remainingH.toFixed(2)} Std</div>
                </div>
            </div>
            <div style="font-size:0.8rem; color:var(--color-text-light); margin-bottom:1rem;">Std. pro Urlaubstag: ${emp.hours_per_vacation_day || 8.0}h · Eintrittsdatum: ${emp.start_date ? formatDate(emp.start_date) : '–'}</div>
            <div style="font-weight:600; font-size:0.85rem; margin-bottom:0.5rem;">Einträge ${year}:</div>
            <div id="eintraege-${emp.id}">
                ${(vacations || []).filter(v => v.employee_id === emp.id).length === 0
                    ? '<div style="color:var(--color-text-light); font-size:0.85rem; margin-bottom:0.75rem;">Keine Einträge</div>'
                    : (vacations || [])
                        .filter(v => v.employee_id === emp.id)
                        .sort((a, b) => a.start_date.localeCompare(b.start_date))
                        .map(v => `
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0; border-bottom:1px solid var(--color-border); font-size:0.85rem;">
                                <div>
                                    <span style="display:inline-block; font-size:0.7rem; padding:1px 6px; border-radius:6px; margin-right:0.4rem; background:${v.type === 'payout' ? '#FFF3CC' : v.type === 'manual' ? '#E8D0FF' : '#D8F0D8'}; color:${v.type === 'payout' ? '#C9A24D' : v.type === 'manual' ? '#9B59B6' : '#4CAF50'};">${v.type === 'payout' ? 'Auszahlung' : v.type === 'manual' ? 'Manuell' : 'Urlaub'}</span>
                                    <span>${v.type === 'manual' ? formatDate(v.start_date) : formatDate(v.start_date) + ' – ' + formatDate(v.end_date)}</span>
                                    ${v.reason ? `<div style="font-size:0.75rem; color:var(--color-text-light);">${v.reason}</div>` : ''}
                                </div>
                                <span style="font-weight:600; white-space:nowrap;">${(v.deducted_days || 0).toFixed(2)} Tage</span>
                            </div>`).join('')
                }
            </div>
            <button onclick="showAddEintragForm('${emp.id}', ${emp.hours_per_vacation_day || 8.0})" style="margin-top:0.75rem; width:100%; padding:0.6rem; border:2px dashed var(--color-border); border-radius:8px; background:transparent; color:var(--color-text-light); font-size:0.85rem; cursor:pointer;">+ Eintrag hinzufügen</button>
            <div id="eintrag-form-${emp.id}" style="display:none; margin-top:0.75rem; background:#F5F5F5; border-radius:8px; padding:0.75rem;">
                <div style="font-weight:600; font-size:0.85rem; margin-bottom:0.5rem;">Neuer Eintrag</div>
                <select id="eintrag-type-${emp.id}" style="width:100%; padding:0.5rem; border-radius:8px; border:1px solid var(--color-border); margin-bottom:0.5rem; font-size:0.85rem;">
                    <option value="vacation">Urlaub genommen</option>
                    <option value="payout">Auszahlung</option>
                    <option value="manual">Manuelle Korrektur</option>
                </select>
                <input type="date" id="eintrag-date-${emp.id}" style="width:100%; padding:0.5rem; border-radius:8px; border:1px solid var(--color-border); margin-bottom:0.5rem; font-size:0.85rem; box-sizing:border-box;">
                <div style="display:flex; gap:0.5rem; margin-bottom:0.5rem;">
                    <input type="number" id="eintrag-hours-${emp.id}" placeholder="Stunden" step="0.25" min="0" style="flex:1; padding:0.5rem; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem;" oninput="syncEintragDays('${emp.id}', ${emp.hours_per_vacation_day || 8.0})">
                    <input type="number" id="eintrag-days-${emp.id}" placeholder="Tage" step="0.01" min="0" style="flex:1; padding:0.5rem; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem;" oninput="syncEintragHours('${emp.id}', ${emp.hours_per_vacation_day || 8.0})">
                </div>
                <input type="text" id="eintrag-comment-${emp.id}" placeholder="Kommentar (optional)" style="width:100%; padding:0.5rem; border-radius:8px; border:1px solid var(--color-border); margin-bottom:0.5rem; font-size:0.85rem; box-sizing:border-box;">
                <div style="display:flex; gap:0.5rem;">
                    <button onclick="saveEintrag('${emp.id}')" style="flex:1; padding:0.6rem; background:var(--color-primary); color:white; border:none; border-radius:8px; font-size:0.85rem; cursor:pointer;">Speichern</button>
                    <button onclick="hideAddEintragForm('${emp.id}')" style="flex:1; padding:0.6rem; background:#F5F5F5; color:var(--color-text); border:1px solid var(--color-border); border-radius:8px; font-size:0.85rem; cursor:pointer;">Abbrechen</button>
                </div>
            </div>
        `;

        header.onclick = () => {
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            document.getElementById(`toggle-${emp.id}`).textContent = isOpen ? '▶' : '▼';
        };

        block.appendChild(header);
        block.appendChild(body);
        container.appendChild(block);
    });
}

function showAddEintragForm(empId, hoursPerDay) {
    document.getElementById(`eintrag-form-${empId}`).style.display = 'block';
    document.getElementById(`eintrag-date-${empId}`).value = new Date().toISOString().split('T')[0];
}

function hideAddEintragForm(empId) {
    document.getElementById(`eintrag-form-${empId}`).style.display = 'none';
}

function syncEintragDays(empId, hoursPerDay) {
    const hours = parseFloat(document.getElementById(`eintrag-hours-${empId}`).value) || 0;
    document.getElementById(`eintrag-days-${empId}`).value = (hours / hoursPerDay).toFixed(2);
}

function syncEintragHours(empId, hoursPerDay) {
    const days = parseFloat(document.getElementById(`eintrag-days-${empId}`).value) || 0;
    document.getElementById(`eintrag-hours-${empId}`).value = (days * hoursPerDay).toFixed(2);
}

async function saveEintrag(empId) {
    const type = document.getElementById(`eintrag-type-${empId}`).value;
    const date = document.getElementById(`eintrag-date-${empId}`).value;
    const days = parseFloat(document.getElementById(`eintrag-days-${empId}`).value) || 0;
    const comment = document.getElementById(`eintrag-comment-${empId}`).value.trim();

    if (!date || days <= 0) {
        alert('Bitte Datum und Stunden/Tage eingeben.');
        return;
    }

    const { error } = await db.from('vacation_requests').insert({
        user_id: adminSession.user.id,
        employee_id: empId,
        start_date: date,
        end_date: date,
        status: 'approved',
        type: type,
        deducted_days: days,
        reason: comment || null
    });

    if (error) { alert('Fehler beim Speichern.'); return; }
    hideAddEintragForm(empId);
    loadUrlaubsverwaltung();
}

function changeUrlaubYear(dir) {
    urlaubYear += dir;
    loadUrlaubsverwaltung();
}

function calculateVacationAccount(emp, year, vacations, prevVacations) {
    const totalDays = emp.vacation_days_per_year ?? 20;
    const today = new Date();

    // Jahre vor 2026 → alles 0
    if (year < 2026) {
        return { entitlement: 0, carryover: 0, used: 0, remaining: 0 };
    }

    // Anteiliger Anspruch im Eintrittsjahr
    let entitlement = totalDays;
    if (emp.start_date) {
        const start = new Date(emp.start_date + 'T12:00:00');
        if (start.getFullYear() === year) {
            const dayOfMonth = start.getDate();
            const fractionOfMonth = dayOfMonth === 1 ? 1 : dayOfMonth <= 15 ? 1 : 0.5;
            const monthsWorked = (12 - start.getMonth() - 1) + fractionOfMonth;
            entitlement = Math.round((monthsWorked / 12) * totalDays * 100) / 100;
        } else if (start.getFullYear() > year) {
            entitlement = 0;
        }
    }

    // Genommene Tage dieses Jahr
    const used = vacations
        .filter(v => v.employee_id === emp.id)
        .reduce((sum, v) => sum + (v.deducted_days || 0), 0);

    // Übertrag vom Vorjahr — nur ab 2027
    let carryover = 0;
    if (year >= 2027) {
        const prevUsed = prevVacations
            .filter(v => v.employee_id === emp.id)
            .reduce((sum, v) => sum + (v.deducted_days || 0), 0);
        const prevEntitlement = totalDays;
        const prevRemaining = prevEntitlement - prevUsed;
        if (prevRemaining > 0) {
            // Verfällt am 31. März des aktuellen Jahres
            const expiry = new Date(year, 2, 31);
            if (today <= expiry) {
                carryover = prevRemaining;
            }
            // Nach 31. März: Übertrag verfallen, wird nicht mehr angezeigt
        }
    }

    const remaining = entitlement + carryover - used;
    const hoursPerDay = emp.hours_per_vacation_day || 8.0;
    return { 
        entitlement, carryover, used, remaining,
        entitlementH: entitlement * hoursPerDay,
        carryoverH: carryover * hoursPerDay,
        usedH: used * hoursPerDay,
        remainingH: remaining * hoursPerDay
    };
}