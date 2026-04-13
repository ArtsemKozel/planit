let adminSession = null;
let employees = [];
let departmentNames = [];
let weekDate = new Date();
let adminAvailDate = new Date();
let editShiftId = null;
let _shiftModalScrollY = 0;
let planningMode = false;
let availabilityCache = {};
let urlaubYear = new Date().getFullYear();
let vacationExplainData = {};
let _terminationDates = {}; // { employee_id: requested_date }

function _cutoffChangeHandler(e) {
    const input = e.target;
    if (input.dataset && input.dataset.empid) {
        updateEmpAccount(input.dataset.empid);
    }
}
let editVacationApproveAfter = false;
let openTaskIds = new Set();
let currentShiftEmployeeId = null;
let currentShiftDateStr = null;
let trinkgeldDate = new Date();
window.window.inventurSortMode = 'inventory';

// ── ABTEILUNGS-AKTIONEN IM SCHICHTPLAN ───────────────────
let _deptActionMenu = null; // { el, dept }
let _selectionDept = null;
let _selectedShiftIds = new Set();

function _closeDeptActionMenu() {
    if (_deptActionMenu) { _deptActionMenu.el.remove(); _deptActionMenu = null; }
}

document.addEventListener('click', e => {
    if (_deptActionMenu && !_deptActionMenu.el.contains(e.target)) _closeDeptActionMenu();
});

function _openDeptActionMenu(btn, dept) {
    _closeDeptActionMenu();
    const menu = document.createElement('div');
    menu.style.cssText = 'position:absolute; z-index:999; background:white; border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,0.15); min-width:200px; overflow:hidden; right:0; top:calc(100% + 4px);';
    menu.innerHTML = `
        <button onclick="deptDeleteAll('${dept}')" style="display:block;width:100%;padding:0.75rem 1rem;text-align:left;background:none;border:none;border-bottom:1px solid var(--color-border);font-size:0.88rem;cursor:pointer;color:var(--color-danger);">Alle löschen</button>
        <button onclick="deptStartSelection('${dept}')" style="display:block;width:100%;padding:0.75rem 1rem;text-align:left;background:none;border:none;font-size:0.88rem;cursor:pointer;">Auswählen</button>
    `;
    btn.parentElement.style.position = 'relative';
    btn.parentElement.appendChild(menu);
    _deptActionMenu = { el: menu, dept };
}

async function deptDeleteAll(dept) {
    _closeDeptActionMenu();
    const monday = getMonday(weekDate);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const firstDay = monday.toISOString().split('T')[0];
    const lastDay  = sunday.toISOString().split('T')[0];
    if (!confirm(`Alle Schichten der Abteilung "${dept}" diese Woche (${firstDay} – ${lastDay}) löschen?`)) return;
    const { data: toDelete } = await db.from('shifts').select('id, employee_id, shift_date')
        .eq('user_id', adminSession.user.id).eq('department', dept)
        .gte('shift_date', firstDay).lte('shift_date', lastDay).eq('is_open', false);
    if (toDelete?.length) {
        await db.from('shifts').delete().in('id', toDelete.map(s => s.id));
        for (const s of toDelete) await syncTipHoursForShift(s.employee_id, s.shift_date);
    }
    await loadWeekGrid();
}

function deptStartSelection(dept) {
    _closeDeptActionMenu();
    _selectionDept = dept;
    _selectedShiftIds.clear();

    // Alle Zellen dieser Abteilung mit Schicht in Auswahlmodus versetzen
    document.querySelectorAll(`[data-dept="${dept}"][data-shift-id]`).forEach(cell => {
        cell.style.outline = '2px solid #C9A24D';
        cell.style.outlineOffset = '-2px';
        cell.onclick = () => _toggleShiftSelection(cell);
    });

    // "Ausgewählte löschen" Button einblenden
    const bar = document.getElementById('dept-selection-bar');
    bar.style.display = 'flex';
    bar.querySelector('#dept-selection-label').textContent = `0 Schichten ausgewählt`;
    bar.querySelector('#dept-selection-dept').textContent = dept;
}

function _toggleShiftSelection(cell) {
    const id = cell.dataset.shiftId;
    if (_selectedShiftIds.has(id)) {
        _selectedShiftIds.delete(id);
        cell.style.background = cell.dataset.origBg || '';
        cell.style.outline = '2px solid #C9A24D';
    } else {
        _selectedShiftIds.add(id);
        cell.style.background = '#C9A24D33';
        cell.style.outline = '2px solid #C9A24D';
    }
    document.getElementById('dept-selection-label').textContent = `${_selectedShiftIds.size} Schicht${_selectedShiftIds.size !== 1 ? 'en' : ''} ausgewählt`;
}

function deptCancelSelection() {
    _selectionDept = null;
    _selectedShiftIds.clear();
    document.getElementById('dept-selection-bar').style.display = 'none';
    // Zellen zurücksetzen
    document.querySelectorAll('[data-shift-id]').forEach(cell => {
        cell.style.outline = '';
        cell.style.background = cell.dataset.origBg || '';
    });
    // onclick wiederherstellen via reload ist am saubersten
    loadWeekGrid();
}

async function deptDeleteSelected() {
    if (_selectedShiftIds.size === 0) return;
    if (!confirm(`${_selectedShiftIds.size} ausgewählte Schicht(en) löschen?`)) return;
    const ids = [..._selectedShiftIds];
    const { data: toDelete } = await db.from('shifts').select('id, employee_id, shift_date')
        .in('id', ids);
    await db.from('shifts').delete().in('id', ids);
    if (toDelete?.length) {
        for (const s of toDelete) await syncTipHoursForShift(s.employee_id, s.shift_date);
    }
    _selectionDept = null;
    _selectedShiftIds.clear();
    document.getElementById('dept-selection-bar').style.display = 'none';
    await loadWeekGrid();
}

// ── INIT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    adminSession = await requireAdminSession();
    if (!adminSession) return;

    const savedTab = localStorage.getItem('planit_admin_tab');
    if (savedTab) switchTab(savedTab);

    await loadEmployees();
    populateAvailEmployeeSelect();
    await Promise.all([
        loadDepartmentNames(),
        loadWeekGrid(),
        loadAdminVacations(),
        loadAdminSwaps(),
        loadTeam(),
        loadDepartments(),
        loadAdminAvailability(),
        loadAdminVacationCalendar(),
        loadArchiveBadge(),
        loadSickLeaves(),
        loadRequestsBadge(),
        loadTerminationBadge(),
        loadInventurBadge(),
        loadUrlaubBadge(),
        loadHygieneBadge(),
        loadMehrBadge(),
    ]);
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
    if (tab === 'tasks') loadTasks();
    if (tab === 'notes') loadNotes();
    if (tab === 'trinkgeld') loadTrinkgeld();
    if (tab === 'trinkgeld-config') loadTrinkgeldConfig();
    if (tab === 'inventur') { loadInventur(); loadInventurSubmissions(); }
    if (tab === 'inventur-config') { loadInventurConfig(); loadInventurDelegation(); }
    if (tab === 'restaurant-info') loadRestaurantInfo();
    if (tab === 'terminations') loadTerminations();
    if (tab === 'hygiene') loadHygiene();
    localStorage.setItem('planit_admin_tab', tab);
}

// ── RESTAURANT-INFO ───────────────────────────────────────
async function loadRestaurantInfo() {
    const { data } = await db.from('planit_restaurants').select('*').eq('user_id', adminSession.user.id).maybeSingle();
    document.getElementById('restaurant-name').value = data?.name || '';
    document.getElementById('restaurant-street').value = data?.street || '';
    document.getElementById('restaurant-zip').value = data?.zip || '';
    document.getElementById('restaurant-city').value = data?.city || '';
}

async function saveRestaurantInfo() {
    const errorDiv = document.getElementById('restaurant-info-error');
    errorDiv.style.display = 'none';
    const payload = {
        user_id: adminSession.user.id,
        name: document.getElementById('restaurant-name').value.trim(),
        street: document.getElementById('restaurant-street').value.trim(),
        zip: document.getElementById('restaurant-zip').value.trim(),
        city: document.getElementById('restaurant-city').value.trim(),
    };
    const { data: existing } = await db.from('planit_restaurants').select('id').eq('user_id', adminSession.user.id).maybeSingle();
    const { error } = existing
        ? await db.from('planit_restaurants').update(payload).eq('user_id', adminSession.user.id)
        : await db.from('planit_restaurants').insert(payload);
    if (error) {
        errorDiv.textContent = 'Fehler beim Speichern.';
        errorDiv.style.display = 'block';
        return;
    }
    const btn = document.querySelector('[onclick="saveRestaurantInfo()"]');
    const orig = btn.textContent;
    btn.textContent = 'Gespeichert ✓';
    setTimeout(() => { btn.textContent = orig; }, 2000);
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
    await renderWeekGrid(days, shifts || [], availCache, sickLeaves || []);
    await renderHoursOverview(days, shifts || []);
}

async function togglePlanningMode() {
    planningMode = !planningMode;
    const btn = document.getElementById('planning-mode-btn');
    const icon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    btn.innerHTML = `${icon} Planungsmodus: ${planningMode ? 'AN' : 'AUS'}`;
    btn.style.background = '#C9A24D';
    btn.style.color = 'white';
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

async function renderWeekGrid(days, shifts, availCache = {}, sickLeaves = []) {
    const grid = document.getElementById('week-grid');
    grid.innerHTML = '';

    const dayNames = ['Mo','Di','Mi','Do','Fr','Sa','So'];
    const weekHolidays = getBWHolidays(days[0].getFullYear());
    // Monatsstunden laden
    const monday = days[0];
    const year = monday.getFullYear();
    const month = monday.getMonth() + 1;
    const monthStart = `${year}-${String(month).padStart(2,'0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2,'0')}-${new Date(year, month, 0).getDate()}`;
    const kwNumber = Math.ceil(((monday - new Date(year, 0, 1)) / 86400000 + new Date(year, 0, 1).getDay() + 1) / 7);
    const monthNames = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
    const { data: monthShifts } = await db
        .from('shifts')
        .select('employee_id, start_time, end_time, break_minutes')
        .eq('user_id', adminSession.user.id)
        .eq('is_open', false)
        .gte('shift_date', monthStart)
        .lte('shift_date', monthEnd);

    const addDayHeaders = (labelText, dept) => {
        const deptLabel = document.createElement('div');
        deptLabel.style.gridColumn = '1 / -1';
        deptLabel.style.display = 'flex';
        deptLabel.style.alignItems = 'center';
        deptLabel.style.justifyContent = 'space-between';
        deptLabel.style.gap = '0.5rem';
        deptLabel.style.fontWeight = '600';
        deptLabel.style.fontSize = '0.8rem';
        deptLabel.style.color = 'var(--color-primary)';
        deptLabel.style.padding = '0.75rem 0 0.25rem';
        deptLabel.style.borderTop = '2px solid var(--color-primary)';
        const trashSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
        deptLabel.innerHTML = `<span>${labelText}</span><button class="btn-small" onclick="event.stopPropagation(); _openDeptActionMenu(this, '${dept}')" style="padding:0.2rem 0.4rem; min-width:unset; height:1.6rem; display:flex; align-items:center; outline:none; -webkit-tap-highlight-color:transparent; background:#C9A24D; color:white;">${trashSvg}</button>`;
        grid.appendChild(deptLabel);

        const corner = document.createElement('div');
        corner.className = 'week-header';
        grid.appendChild(corner);
        days.forEach((d, i) => {
            const dateStr = d.toISOString().split('T')[0];
            const isHoliday = weekHolidays.includes(dateStr);
            const header = document.createElement('div');
            header.className = 'week-header';
            header.innerHTML = `${dayNames[i]}<br><small style="color:${isHoliday ? '#E07070' : 'inherit'};">${d.getDate()}.${d.getMonth()+1}.${isHoliday ? ' 🎌' : ''}</small>`;
            grid.appendChild(header);
        });
    };

    if (employees.length === 0) {
        const empty = document.createElement('div');
        empty.style.gridColumn = '1 / -1';
        empty.className = 'empty-state';
        empty.innerHTML = '<p>Keine Mitarbeiter vorhanden.</p>';
        grid.appendChild(empty);
        return;
    }

    // Alle Abteilungen eines Mitarbeiters (Haupt + Zusatz)
    const getEmpDepartments = (emp) => {
        const fromDepts = (emp.departments || '').split(',').map(s => s.trim()).filter(Boolean);
        if (fromDepts.length > 0) return fromDepts;
        return [emp.department || 'Allgemein'];
    };

    const departments = [...new Set(employees.flatMap(e => getEmpDepartments(e)))];

    departments.forEach(dept => {
        addDayHeaders(dept.toUpperCase(), dept);

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

        const deptEmployees = employees.filter(e => getEmpDepartments(e).includes(dept));
        deptEmployees.forEach(emp => {
            const empCell = document.createElement('div');
            empCell.className = 'week-employee';
            const parts = emp.name.trim().split(' ');
            const displayName = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];

            const empShifts = shifts.filter(s => s.employee_id === emp.id && !s.is_open);
            let weekMinutes = 0;
            empShifts.forEach(s => {
                const start = s.start_time.slice(0,5).split(':').map(Number);
                const end = s.end_time.slice(0,5).split(':').map(Number);
                weekMinutes += (end[0]*60+end[1]) - (start[0]*60+start[1]) - (s.break_minutes || 0);
            });

            empCell.textContent = displayName;
            grid.appendChild(empCell);

            days.forEach(d => {
                const dateStr = d.toISOString().split('T')[0];
                const shift = shifts.find(s => s.employee_id === emp.id && s.shift_date === dateStr && !s.is_open && (s.department === dept || (!s.department && (emp.department || 'Allgemein') === dept)));
                const cell = document.createElement('div');
                cell.className = 'week-cell' + (shift ? ' has-shift' : '');
                cell.style.whiteSpace = 'pre';
                cell.style.position = 'relative';
                if (shift) {
                    cell.textContent = `${shift.start_time.slice(0,5)}\n${shift.end_time.slice(0,5)}`;
                    if (shift.actual_start_time) {
                        cell.style.background = '#E8D4A0';
                    }
                } else {
                    cell.textContent = '+';
                }

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

                const isSick = sickLeaves.some(s => s.employee_id === emp.id && s.start_date <= dateStr && s.end_date >= dateStr);
                if (isSick && !shift) {
                    cell.style.background = '#FFE0CC';
                    cell.textContent = 'Krank';
                    cell.style.color = '#E07040';
                    cell.style.fontSize = '0.7rem';
                }

                cell.dataset.cell = `${emp.id}_${dateStr}`;
                cell.dataset.dept = dept;
                if (shift) {
                    cell.dataset.shiftId = shift.id;
                    cell.dataset.origBg = shift.actual_start_time ? '#E8D4A0' : '';
                }
                cell.onclick = () => openShiftModal(emp.id, dateStr, shift, dept);
                grid.appendChild(cell);
            });
        });
        // Stunden-Übersicht für diese Abteilung (klappbar)
        const deptStundenWrapper = document.createElement('div');
        deptStundenWrapper.style.gridColumn = '1 / -1';
        deptStundenWrapper.style.marginTop = '0.25rem';
        deptStundenWrapper.style.marginBottom = '0.5rem';

        const safeId = dept.replace(/[^a-zA-Z0-9]/g, '_');
        deptStundenWrapper.innerHTML = `
            <div onclick="toggleDeptStunden('${safeId}')" style="font-size:0.75rem; font-weight:700; letter-spacing:0.05em; padding:10px 16px; border-radius:8px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; background:#C9A24D; color:white; transition:background 0.2s;">
                <span>STUNDEN ÜBERSICHT</span>
                <span id="stunden-toggle-${safeId}">▶</span>
            </div>
            <div id="stunden-body-${safeId}" style="display:none; background:white; border-radius:0 0 8px 8px; padding:0.5rem 0.75rem;" data-stunden-dept="${dept}"></div>
        `;

        const deptEmps = employees.filter(e => (e.department || 'Allgemein') === dept);
        deptStundenWrapper.querySelector(`#stunden-body-${safeId}`).innerHTML =
            buildStundenDivHtml(deptEmps, shifts, monthShifts, kwNumber, month, monthNames);
        grid.appendChild(deptStundenWrapper);
    });
}

function buildStundenDivHtml(deptEmps, weekShifts, monthShifts, kwNumber, month, monthNames) {
    return deptEmps.map(emp => {
        const empWeekShifts = weekShifts.filter(s => s.employee_id === emp.id && !s.is_open);
        let weekMinutes = 0;
        empWeekShifts.forEach(s => {
            const start = s.start_time.slice(0,5).split(':').map(Number);
            const end = s.end_time.slice(0,5).split(':').map(Number);
            weekMinutes += (end[0]*60+end[1]) - (start[0]*60+start[1]) - (s.break_minutes || 0);
        });
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
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0; border-bottom:1px solid var(--color-border);">
            <span style="font-size:0.9rem; font-weight:600;">${displayName}</span>
            <div style="font-size:0.85rem;">
                <span style="color:${weekColor}; font-weight:600;">${weekH}h KW${kwNumber}</span>
                <span style="color:var(--color-text-light); margin-left:0.5rem;">/ ${monthH}h ${monthNames[month-1]}</span>
            </div>
        </div>`;
    }).join('');
}

async function refreshHoursOverview() {
    const divs = document.querySelectorAll('[data-stunden-dept]');
    if (!divs.length) return;

    const monday = getMonday(weekDate);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const year = monday.getFullYear();
    const month = monday.getMonth() + 1;
    const monthStart = `${year}-${String(month).padStart(2,'0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2,'0')}-${new Date(year, month, 0).getDate()}`;
    const weekStart = monday.toISOString().split('T')[0];
    const weekEnd = sunday.toISOString().split('T')[0];
    const kwNumber = Math.ceil(((monday - new Date(year, 0, 1)) / 86400000 + new Date(year, 0, 1).getDay() + 1) / 7);
    const monthNames = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

    const [{ data: weekShifts }, { data: monthShifts }] = await Promise.all([
        db.from('shifts').select('employee_id,start_time,end_time,break_minutes').eq('user_id', adminSession.user.id).eq('is_open', false).gte('shift_date', weekStart).lte('shift_date', weekEnd),
        db.from('shifts').select('employee_id,start_time,end_time,break_minutes').eq('user_id', adminSession.user.id).eq('is_open', false).gte('shift_date', monthStart).lte('shift_date', monthEnd),
    ]);

    divs.forEach(div => {
        const dept = div.dataset.stundenDept;
        const deptEmps = employees.filter(e => (e.department || 'Allgemein') === dept);
        div.innerHTML = buildStundenDivHtml(deptEmps, weekShifts || [], monthShifts || [], kwNumber, month, monthNames);
    });
}

async function renderHoursOverview() {
    // Wird in renderWeekGrid pro Abteilung als klappbarer Block gezeigt
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
async function openShiftModal(employeeId, dateStr, existingShift, defaultDept) {
    _shiftModalScrollY = window.scrollY;
    currentShiftEmployeeId = employeeId;
    currentShiftDateStr = dateStr;
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
    const isOpen = existingShift?.is_open || false;
    const empGroup = document.getElementById('shift-employee').closest('.form-group');
    document.getElementById('shift-employee').disabled = isOpen;
    // Felder ausblenden wenn Mitarbeiter + Datum + Abteilung vorausgewählt (normaler Klick auf Zeile)
    const preselected = !!(employeeId && dateStr && defaultDept && !isOpen);
    empGroup.style.display = preselected ? 'none' : 'block';
    empGroup.style.opacity = isOpen ? '0.4' : '1';
    document.getElementById('shift-date').closest('.form-group').style.display = preselected ? 'none' : 'block';
    document.getElementById('shift-dept-group').style.display = preselected ? 'none' : 'block';
    document.getElementById('shift-open-note-group').style.display = isOpen ? 'block' : 'none';
    const emp = employees.find(e => e.id === (existingShift?.employee_id || employeeId));
    const deptToSelect = existingShift?.department || defaultDept || emp?.department || departmentNames[0] || '';
    populateDeptSelect(document.getElementById('shift-department'), deptToSelect);
    document.getElementById('shift-actual-group').style.display = existingShift ? 'block' : 'none';
    document.getElementById('shift-actual-body').style.display = 'none';
    document.getElementById('shift-actual-toggle').textContent = '▶';
    document.getElementById('shift-actual-start').value = existingShift?.actual_start_time
        ? existingShift.actual_start_time.slice(0, 5)
        : (existingShift?.start_time ? existingShift.start_time.slice(0, 5) : '');
    document.getElementById('shift-actual-end').value = existingShift?.actual_end_time
        ? existingShift.actual_end_time.slice(0, 5)
        : (existingShift?.end_time ? existingShift.end_time.slice(0, 5) : '');
    document.getElementById('shift-actual-break').value = existingShift?.actual_break_minutes ?? '';
    document.getElementById('shift-repeat').checked = false;
    document.getElementById('shift-repeat-group').style.display = 'none';
    document.getElementById('shift-repeat-weeks').value = 4;
    await loadTemplates();
    document.getElementById('shift-modal').classList.add('open');
}

function closeShiftModal() {
    document.getElementById('shift-modal').classList.remove('open');
    editShiftId = null;
    window.scrollTo({ top: _shiftModalScrollY, behavior: 'instant' });
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
    const payload = editShiftId ? {
        actual_start_time: document.getElementById('shift-actual-start').value || null,
        actual_end_time: document.getElementById('shift-actual-end').value || null,
        actual_break_minutes: document.getElementById('shift-actual-break').value !== '' ? parseInt(document.getElementById('shift-actual-break').value) : null,
    } : {};
    Object.assign(payload, {
        user_id: adminSession.user.id,
        employee_id: isOpen ? null : employeeId,
        shift_date: date,
        start_time: start,
        end_time: end,
        break_minutes: breakMin ? parseInt(breakMin) : 0,
        notes: notes || null,
        is_open: isOpen,
        open_note: isOpen ? (document.getElementById('shift-open-note').value || null) : null,
        department: document.getElementById('shift-department').value || null
    });

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
    // Arbeitsrecht-Warnungen — nicht bei Ist-Zeiten
    if (!payload.actual_start_time && !payload.actual_end_time) {
        const warnings = await checkArbeitszeitWarnings(payload);
        if (warnings.length > 0) {
            const proceed = confirm('⚠️ Arbeitsrecht-Hinweise:\n\n' + warnings.join('\n\n') + '\n\nTrotzdem speichern?');
            if (!proceed) return;
        }
    }
    if (error) {
        errorDiv.textContent = 'Fehler beim Speichern.';
        errorDiv.style.display = 'block';
        return;
    }
    closeShiftModal();
    await updateShiftCell(currentShiftEmployeeId, currentShiftDateStr);
    await refreshHoursOverview();
    if (payload.employee_id) {
        if (!editShiftId && repeat && weeks > 1) {
            for (let i = 0; i < weeks; i++) {
                const d = new Date(payload.shift_date + 'T12:00:00');
                d.setDate(d.getDate() + i * 7);
                await syncTipHoursForShift(payload.employee_id, d.toISOString().split('T')[0]);
            }
        } else {
            await syncTipHoursForShift(payload.employee_id, payload.shift_date);
        }
    }
}

async function deleteShift() {
    if (!editShiftId) return;
    if (!confirm('Schicht wirklich löschen?')) return;

    await db.from('open_shift_requests').delete().eq('shift_id', editShiftId);
    await db.from('shift_swaps').delete().eq('shift_id', editShiftId);
    await db.from('shift_swaps').delete().eq('target_shift_id', editShiftId);
    await db.from('shift_handovers').delete().eq('shift_id', editShiftId);

    const { error } = await db.from('shifts').delete().eq('id', editShiftId);
    if (error) {
        alert('Fehler beim Löschen: ' + error.message);
        return;
    }
    closeShiftModal();
    await updateShiftCell(currentShiftEmployeeId, currentShiftDateStr);
    await refreshHoursOverview();
    await syncTipHoursForShift(currentShiftEmployeeId, currentShiftDateStr);
}

async function syncTipHoursForShift(employeeId, dateStr) {
    if (!employeeId || !dateStr) return;

    const { data: shifts } = await db.from('shifts')
        .select('start_time,end_time,break_minutes,actual_start_time,actual_end_time,actual_break_minutes,department')
        .eq('user_id', adminSession.user.id)
        .eq('employee_id', employeeId)
        .eq('shift_date', dateStr)
        .eq('is_open', false);

    // Always delete existing tip_hours for this employee+date first
    await db.from('tip_hours').delete()
        .eq('user_id', adminSession.user.id)
        .eq('employee_id', employeeId)
        .eq('work_date', dateStr);

    if (!shifts || shifts.length === 0) return;

    const { data: sick } = await db.from('sick_leaves')
        .select('id').eq('user_id', adminSession.user.id).eq('employee_id', employeeId)
        .lte('start_date', dateStr).gte('end_date', dateStr).maybeSingle();

    if (sick) return;

    const rows = [];
    for (const shift of shifts) {
        const startStr = shift.actual_start_time || shift.start_time;
        const endStr = shift.actual_end_time || shift.end_time;
        const breakMin = shift.actual_break_minutes ?? shift.break_minutes ?? 0;
        const [sh, sm] = startStr.split(':').map(Number);
        const [eh, em] = endStr.split(':').map(Number);
        const minutes = (eh * 60 + em) - (sh * 60 + sm) - breakMin;
        if (minutes > 0) {
            rows.push({ user_id: adminSession.user.id, employee_id: employeeId, work_date: dateStr, minutes, department: shift.department || null });
        }
    }

    if (rows.length > 0) {
        await db.from('tip_hours').upsert(rows, { onConflict: 'user_id,employee_id,work_date,department' });
    }
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
    const modal = document.getElementById('edit-task-template-modal');
    console.log('modal:', modal);
    modal.classList.add('active');
}

function closeEditTemplateModal() {
    document.getElementById('edit-task-template-modal').classList.remove('active');
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
${v.status === 'approved' ? `<p style="font-size:0.8rem; color:var(--color-primary);">${v.type === 'payout' ? '💰' : '🏖'} ${(Math.round((v.deducted_days || 0) * 100) / 100).toFixed(2)} ${v.type === 'payout' ? 'Urlaubstage ausgezahlt' : 'Urlaubstage abgezogen'}${v.payout_month ? ` · ${v.payout_month}` : ''}</p>` : ''}
            </div>
            <div style="display:flex; flex-direction:column; gap:0.4rem; align-items:flex-end;">
                <span class="badge badge-${v.status}">
                    ${v.status === 'pending' ? 'Ausstehend' : v.status === 'approved' ? 'Genehmigt' : 'Abgelehnt'}
                </span>
                ${v.status === 'pending' ? `
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn-small btn-approve" onclick="reviewVacation('${v.id}', 'approved')">✓</button>
                        <button class="btn-small btn-reject" onclick="reviewVacation('${v.id}', 'rejected')">✕</button>
                    </div>
                ` : `
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.3rem;">
                        <button class="btn-small btn-pdf-view btn-icon" onclick="editVacation('${v.id}', '${v.start_date}', '${v.end_date}', ${v.deducted_days || 0}, '${v.type || 'vacation'}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        ${v.pdf_url ? `<button class="btn-small btn-pdf-view btn-icon" onclick="downloadVacationPdf('${v.pdf_url}')"><svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>` : '<div></div>'}
                        ${v.pdf_url ? `<button class="btn-small btn-pdf-view btn-icon" onclick="saveVacationPdf('${v.pdf_url}')"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>` : '<div></div>'}
                        <button class="btn-small btn-delete btn-icon" onclick="deleteVacation('${v.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
                    </div>
                `}
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
    document.getElementById('edit-vacation-days-field').style.display = isPayout ? 'none' : 'block';
    document.getElementById('edit-vacation-payout-month-field').style.display = isPayout ? 'block' : 'none';
    document.getElementById('edit-vacation-start').value = vac.start_date;
    document.getElementById('edit-vacation-end').value = vac.end_date;
    document.getElementById('edit-vacation-days').value = vac.deducted_days || 0;
    document.getElementById('edit-vacation-hours').value = vac.deducted_hours ?? '';
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
    document.getElementById('edit-vacation-days-field').style.display = isPayout ? 'none' : 'block';
    document.getElementById('edit-vacation-payout-month-field').style.display = isPayout ? 'block' : 'none';
    document.getElementById('edit-vacation-start').value = startDate;
    document.getElementById('edit-vacation-end').value = endDate;
    document.getElementById('edit-vacation-days').value = deductedDays;
    document.getElementById('edit-vacation-hours').value = '';
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
    const payoutMonth = document.getElementById('edit-vacation-payout-month').value.trim() || null;
    const hoursRaw = document.getElementById('edit-vacation-hours').value;
    const deductedHours = hoursRaw !== '' ? parseFloat(hoursRaw) : null;
    const days = isPayout ? (deductedHours != null ? deductedHours / hoursPerDay : rawValue) : rawValue;
    const updateData = {
        start_date: start,
        end_date: end,
        deducted_days: days,
        deducted_hours: deductedHours,
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

    const { data: all } = await db.from('vacation_requests')
        .select('*, employees_planit(name, department)')
        .eq('user_id', adminSession.user.id)
        .eq('status', 'approved')
        .or(`and(type.neq.payout,start_date.lte.${lastDay},end_date.gte.${firstDay}),and(type.eq.payout,payout_month.eq.${monthStr})`);

    renderAdminVacationCalendar(year, month, all || []);
}

function goldGradient(n) {
    const shades = ['#C9A24D','#B8913C','#DAB35E','#A8803B','#EBC46F','#987030','#F0C47A'];
    if (n === 1) return shades[0];
    const stops = [];
    for (let i = 0; i < n; i++) {
        const pct1 = (i / n * 100).toFixed(2);
        const pct2 = ((i + 1) / n * 100).toFixed(2);
        const c = shades[i % shades.length];
        stops.push(`${c} ${pct1}%`, `${c} ${pct2}%`);
    }
    return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

function showVacDayModal(dateStr, dayVacations) {
    const [y, , d] = dateStr.split('-');
    const date = new Date(dateStr + 'T12:00:00');
    const dayNames = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
    const monthNames = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
    document.getElementById('vac-day-modal-title').textContent =
        `${dayNames[date.getDay()]}, ${parseInt(d)}. ${monthNames[date.getMonth()]} ${y}`;
    const typeLabel = t => t === 'payout' ? 'Auszahlung' : t === 'manual' ? 'Manuell' : 'Urlaub';
    const typeBg    = t => t === 'payout' ? '#FFF3CC' : t === 'manual' ? '#E8D0FF' : '#D8F0D8';
    const typeColor = t => t === 'payout' ? '#C9A24D' : t === 'manual' ? '#9B59B6' : '#4CAF50';
    document.getElementById('vac-day-modal-body').innerHTML = dayVacations.map(v => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid var(--color-border);">
            <span style="font-weight:600;">${v.employees_planit?.name || '—'}</span>
            <span style="font-size:0.75rem; padding:2px 8px; border-radius:6px; background:${typeBg(v.type)}; color:${typeColor(v.type)};">${typeLabel(v.type)}</span>
        </div>`).join('');
    document.getElementById('vac-day-modal').classList.add('active');
}

function closeVacDayModal() {
    document.getElementById('vac-day-modal').classList.remove('active');
}

function renderAdminVacationCalendar(year, month, vacations) {
    const container = document.getElementById('admin-vac-calendar');
    container.innerHTML = '';

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = new Date(year, month, 1).getDay();
    const offset = firstWeekday === 0 ? 6 : firstWeekday - 1;

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
        const dayVacations = vacations.filter(v => v.type !== 'payout' && v.start_date <= dateStr && v.end_date >= dateStr);
        const isHoliday = holidays.includes(dateStr);
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day' + (isHoliday ? ' holiday' : '');

        const numEl = document.createElement('span');
        numEl.textContent = d;
        numEl.style.fontSize = '0.8rem';
        dayEl.appendChild(numEl);

        if (dayVacations.length > 0) {
            dayEl.style.background = goldGradient(dayVacations.length);
            dayEl.style.color = 'white';
            numEl.style.color = 'white';
            dayEl.classList.add('has-vacation');
            dayEl.onclick = () => showVacDayModal(dateStr, dayVacations);
        }

        grid.appendChild(dayEl);
    }

    container.appendChild(grid);

    // Liste der Urlaubseinträge dieses Monats, nach Abteilung gruppiert
    if (vacations.length > 0) {
        const fmtShort = d => { const p = d.split('-'); return `${parseInt(p[2])}.${parseInt(p[1])}.`; };
        const typeLabel = t => t === 'payout' ? '💰' : t === 'manual' ? '✏️' : '🏖';
        const depts = [...new Set(vacations.map(v => v.employees_planit?.department || 'Allgemein'))].sort();
        const listEl = document.createElement('div');
        listEl.style.marginTop = '1rem';
        depts.forEach(dept => {
            const deptVacs = vacations.filter(v => (v.employees_planit?.department || 'Allgemein') === dept)
                .sort((a, b) => a.start_date.localeCompare(b.start_date));
            const section = document.createElement('div');
            section.style.marginBottom = '0.75rem';
            section.innerHTML = `<div style="font-size:0.75rem; font-weight:700; color:var(--color-text-light); letter-spacing:0.05em; margin-bottom:0.35rem;">${dept.toUpperCase()}</div>` +
                deptVacs.map(v => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.35rem 0; border-bottom:1px solid var(--color-border); font-size:0.85rem;">
                        <span>${typeLabel(v.type)} <strong>${v.employees_planit?.name || '—'}</strong></span>
                        <span style="color:var(--color-text-light);">${v.type === 'manual' ? fmtShort(v.start_date) : `${fmtShort(v.start_date)} – ${fmtShort(v.end_date)}`}</span>
                    </div>`).join('');
            listEl.appendChild(section);
        });
        container.appendChild(listEl);
    }
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

    // Loading-Guard: parallele Aufrufe abbrechen
    const loadId = `${employeeId}-${adminAvailDate.getFullYear()}-${adminAvailDate.getMonth()}`;
    loadAdminAvailability._currentLoad = loadId;

    // Container sofort leeren
    const container = document.getElementById('admin-avail-grid');
    container.innerHTML = '';
    container.classList.remove('all-view');

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

    const [{ data }, { data: vacations }] = await Promise.all([
        db.from('availability').select('*').eq('employee_id', employeeId).eq('month', monthStr).maybeSingle(),
        db.from('vacation_requests').select('start_date, end_date').eq('employee_id', employeeId).eq('status', 'approved').lte('start_date', `${year}-${String(month+1).padStart(2,'0')}-${new Date(year, month+1, 0).getDate()}`).gte('end_date', monthStr),
    ]);

    // Abbruch wenn zwischenzeitlich ein neuerer Aufruf gestartet wurde
    if (loadAdminAvailability._currentLoad !== loadId) return;

    const availDays = (data && !Array.isArray(data.available_days)) ? data.available_days : {};
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = new Date(year, month, 1).getDay();
    const offset = firstWeekday === 0 ? 6 : firstWeekday - 1;

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
        title.style.maxWidth = '480px';
        title.style.overflow = 'hidden';
        title.style.whiteSpace = 'nowrap';
        title.style.textOverflow = 'ellipsis';
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
    // Archivierungs-Hinweis
    const today = new Date().toISOString().split('T')[0];
    const { data: archivePending } = await db
        .from('planit_terminations')
        .select('employee_id, approved_date, employees_planit!planit_terminations_employee_id_fkey(name, is_active)')
        .eq('user_id', adminSession.user.id)
        .eq('status', 'approved')
        .lte('approved_date', today);

    const toArchive = (archivePending || []).filter(t => t.employees_planit?.is_active === true);
    const archiveCard = document.getElementById('archive-pending-card');
    if (toArchive.length > 0) {
        archiveCard.style.display = 'block';
        archiveCard.innerHTML = `
            <div class="card" style="border-left:3px solid var(--color-danger);">
                <div style="font-size:0.8rem; font-weight:700; color:var(--color-danger); margin-bottom:0.75rem;">ARCHIVIERUNG AUSSTEHEND</div>
                ${toArchive.map(t => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.35rem 0; border-top:1px solid var(--color-border);">
                        <div>
                            <div style="font-weight:600; font-size:0.9rem;">${t.employees_planit?.name || '–'}</div>
                            <div style="font-size:0.78rem; color:var(--color-text-light);">Letzter Arbeitstag: ${new Date(t.approved_date + 'T12:00:00').toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric' })}</div>
                        </div>
                        <button class="btn-small btn-delete btn-icon" onclick="archiveEmployee('${t.employee_id}')"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
                    </div>`).join('')}
            </div>`;
    } else {
        archiveCard.style.display = 'none';
    }

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

    const { data: allPhases } = await db
        .from('employment_phases')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .order('start_date');

    const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    const fmtShort = d => { if (!d) return 'offen'; const p = d.split('-'); return `${p[2]}.${p[1]}.${p[0]}`; };
    const departments = [...new Set(employees.map(e => e.department || 'Allgemein'))].sort();

    container.innerHTML = departments.map(dept => {
        const deptEmployees = employees.filter(e => (e.department || 'Allgemein') === dept);
        return `
            <div style="font-size:0.85rem; font-weight:700; color:var(--color-text-light); letter-spacing:0.05em; margin:1rem 0 0.5rem;">${dept.toUpperCase()}</div>
            ${deptEmployees.map(e => {
                const empPhases = (allPhases || []).filter(p => p.employee_id === e.id).sort((a, b) => a.start_date.localeCompare(b.start_date));
                const phasesHtml = empPhases.length > 0
                    ? empPhases.map(p => `
                        <div style="display:flex; gap:0.5rem; align-items:baseline; font-size:0.82rem; padding:0.2rem 0; border-bottom:1px solid var(--color-border);">
                            <span style="min-width:7rem; color:var(--color-text-light);">${fmtShort(p.start_date)} – ${fmtShort(p.end_date)}</span>
                            <span>${p.hours_per_vacation_day}h/UT${p.notes ? ' · ' + p.notes : ''}</span>
                        </div>`).join('')
                    : `<div style="font-size:0.82rem; color:var(--color-text-light);">Keine Phasen eingetragen</div>`;

                return `
                <div style="border-radius:14px; margin-bottom:0.5rem; overflow:hidden; background:var(--color-gray);">
                    <div onclick="toggleTeamEmployee('${e.id}')" style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem 1rem; cursor:pointer;">
                        <div style="display:flex; align-items:center; gap:0.6rem;">
                            <span style="font-weight:700;">${e.name}</span>
                            ${e.is_apprentice ? '<span style="background:#E8D0FF; color:#9B59B6; font-size:0.7rem; padding:2px 6px; border-radius:8px; font-weight:600;">Azubi</span>' : ''}
                        </div>
                        <div style="display:flex; gap:0.5rem; align-items:center;">
                            <button class="btn-small btn-pdf-view btn-icon" onclick="event.stopPropagation(); openEditEmployeeModal('${e.id}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                            <button class="btn-small btn-delete btn-icon" onclick="event.stopPropagation(); deleteEmployee('${e.id}', '${e.name}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
                            <span id="toggle-team-${e.id}" style="color:var(--color-text-light); font-size:0.85rem; margin-left:0.25rem;">▶</span>
                        </div>
                    </div>
                    <div id="teambody-${e.id}" style="display:none; padding:0.75rem 1rem; border-top:1px solid var(--color-border); background:white;">
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.4rem 1rem; font-size:0.85rem; margin-bottom:0.75rem;">
                            <div><span style="color:var(--color-text-light);">Kürzel</span><br><strong>${e.login_code}</strong></div>
                            <div><span style="color:var(--color-text-light);">PIN</span><br><strong>${e.password_hash || '—'}</strong></div>
                            <div><span style="color:var(--color-text-light);">Abteilung</span><br><strong>${e.department || 'Allgemein'}</strong></div>
                            <div><span style="color:var(--color-text-light);">Eintrittsdatum</span><br><strong>${fmtDate(e.start_date)}</strong></div>
                            <div><span style="color:var(--color-text-light);">Geburtstag</span><br><strong>${fmtDate(e.birthdate)}</strong></div>
                            <div><span style="color:var(--color-text-light);">Urlaubstage / Jahr</span><br><strong>${e.vacation_days_per_year ?? 20}</strong></div>
                        </div>
                        <div style="font-size:0.8rem; font-weight:600; color:var(--color-text-light); margin-bottom:0.4rem;">BESCHÄFTIGUNGSPHASEN</div>
                        ${phasesHtml}
                    </div>
                </div>`;
        }).join('')}`;
    }).join('');
}

function toggleTeamEmployee(id) {
    const body = document.getElementById(`teambody-${id}`);
    const arrow = document.getElementById(`toggle-team-${id}`);
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    if (arrow) arrow.textContent = open ? '▶' : '▼';
}

function openNewEmployeeModal() {
    document.getElementById('employee-modal').classList.add('open');
    document.getElementById('emp-modal-error').style.display = 'none';
    document.getElementById('new-emp-name').value = '';
    document.getElementById('new-emp-code').value = '';
    document.getElementById('new-emp-password').value = '';
    populateDeptSelect(document.getElementById('new-emp-department'), departmentNames[0] || '');
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
    const hygieneErste = document.getElementById('new-emp-hygiene-erste').value || null;
    const hygieneLetzte = document.getElementById('new-emp-hygiene-letzte').value || null;
    const hygieneMonate = parseInt(document.getElementById('new-emp-hygiene-monate').value) || 12;
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
        vacation_days_per_year: vacationDays,
        hygiene_erste: hygieneErste,
        hygiene_letzte: hygieneLetzte,
        hygiene_gueltig_monate: hygieneMonate
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

// ── ABTEILUNGEN ───────────────────────────────────────────
async function loadDepartmentNames() {
    const { data } = await db.from('planit_departments').select('name').eq('user_id', adminSession.user.id).order('name');
    departmentNames = (data || []).map(d => d.name);
}

function populateDeptSelect(selectEl, selectedValue) {
    selectEl.innerHTML = departmentNames.map(name =>
        `<option value="${name}" ${name === selectedValue ? 'selected' : ''}>${name}</option>`
    ).join('');
    if (selectedValue) selectEl.value = selectedValue;
}

function toggleDepartmentsSection() {
    const body = document.getElementById('departments-body');
    const toggle = document.getElementById('departments-toggle');
    const isOpen = body.style.display === 'block';
    body.style.display = isOpen ? 'none' : 'block';
    toggle.textContent = isOpen ? '▶' : '▼';
}

async function loadDepartments() {
    const { data: depts } = await db.from('planit_departments').select('*').eq('user_id', adminSession.user.id).order('name');
    const container = document.getElementById('departments-list');
    if (!container) return;
    if (!depts || depts.length === 0) {
        container.innerHTML = '<div style="font-size:0.85rem; color:var(--color-text-light); padding:0.25rem 0;">Keine Abteilungen vorhanden.</div>';
        return;
    }
    container.innerHTML = depts.map(d => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0; border-bottom:1px solid var(--color-border);">
            <span style="font-size:0.9rem;">${d.name}</span>
            <button class="btn-small btn-pdf-view btn-icon" style="width:1.8rem; height:1.8rem;" onclick="deleteDepartment('${d.id}')">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
        </div>
    `).join('');
}

async function addDepartment() {
    const input = document.getElementById('new-department-name');
    const name = input.value.trim();
    if (!name) return;
    await db.from('planit_departments').insert({ user_id: adminSession.user.id, name });
    input.value = '';
    await loadDepartmentNames();
    await loadDepartments();
}

async function deleteDepartment(id) {
    if (!confirm('Abteilung wirklich löschen?')) return;
    await db.from('planit_departments').delete().eq('id', id);
    await loadDepartmentNames();
    await loadDepartments();
}

// ── SCHICHTTAUSCH ─────────────────────────────────────────
async function loadAdminSwaps() {
    const { data: swaps } = await db
        .from('shift_swaps')
        .select('*, shifts!shift_id(shift_date, start_time, end_time), target:shifts!target_shift_id(shift_date, start_time, end_time), from_emp:employees_planit!from_employee_id(name), to_emp:employees_planit!to_employee_id(name)')
        .eq('user_id', adminSession.user.id)
        .eq('to_employee_status', 'accepted')
        .order('created_at', { ascending: false });

    const container = document.getElementById('admin-swap-list');
    if (!swaps || swaps.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Requests vorhanden.</p></div>';
        return;
    }

    container.innerHTML = swaps.map(s => {
        const colleagueStatus = s.to_employee_status === 'pending' ? '⏳ Wartet auf Kollege' 
            : s.to_employee_status === 'accepted' ? '✓ Kollege akzeptiert' 
            : '✗ Kollege abgelehnt';
        const canReview = s.status === 'pending' && s.to_employee_status === 'accepted';
        return `
            <div class="list-item" style="flex-direction:column; align-items:flex-start; gap:0.5rem;">
                <div style="display:flex; justify-content:space-between; width:100%;">
                    <h4>${s.from_emp?.name || '?'} ↔ ${s.to_emp?.name || '?'}</h4>
                    <span class="badge badge-${s.status}">
                        ${s.status === 'pending' ? 'Ausstehend' : s.status === 'approved' ? 'Genehmigt' : 'Abgelehnt'}
                    </span>
                </div>
                <div style="font-size:0.85rem; color:var(--color-text-light);">
                    ${s.from_emp?.name || '?'}: ${s.shifts ? formatDate(s.shifts.shift_date) + ' ' + s.shifts.start_time.slice(0,5) + ' – ' + s.shifts.end_time.slice(0,5) : '—'}
                </div>
                <div style="font-size:0.85rem; color:var(--color-text-light);">
                    ${s.to_emp?.name || '?'}: ${s.target ? formatDate(s.target.shift_date) + ' ' + s.target.start_time.slice(0,5) + ' – ' + s.target.end_time.slice(0,5) : '—'}
                </div>
                <div style="font-size:0.75rem; color:var(--color-text-light);">${colleagueStatus}</div>
                ${canReview ? `
                    <div style="display:flex; gap:0.5rem; margin-top:0.25rem;">
                        <button class="btn-small btn-approve btn-icon" onclick="reviewSwap('${s.id}', 'approved', '${s.shift_id}', '${s.target_shift_id}', '${s.from_employee_id}', '${s.to_employee_id}')">
                            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                        </button>
                        <button class="btn-small btn-reject btn-icon" onclick="reviewSwap('${s.id}', 'rejected', null, null, null, null)">
                            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                ` : ''}
            </div>`;
    }).join('');

    // Abzugebende Schichten laden
    const { data: handoverShifts } = await db
        .from('shifts')
        .select('*, employees_planit!shifts_employee_id_fkey(name, department)')
        .eq('user_id', adminSession.user.id)
        .eq('handover_requested', true)
        .gte('shift_date', new Date().toISOString().split('T')[0])
        .order('shift_date');

    const handoverContainer = document.getElementById('admin-handover-list');
    if (!handoverShifts || handoverShifts.length === 0) {
        handoverContainer.innerHTML = '<div class="empty-state"><p>Keine Requests vorhanden.</p></div>';
        return;
    }

    // Pro Schicht alle Interessenten laden
    const handoverHTML = await Promise.all(handoverShifts.map(async s => {
        const { data: applicants } = await db
            .from('shift_handovers')
            .select('*, to_emp:employees_planit!to_employee_id(name)')
            .eq('shift_id', s.id)
            .eq('status', 'pending');

        const applicantsList = applicants && applicants.length > 0
            ? applicants.map(a => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:0.3rem 0; border-bottom:1px solid var(--color-border);">
                    <span style="font-size:0.85rem;">${a.to_emp?.name || '—'}</span>
                    <button class="btn-small btn-pdf-view btn-icon" onclick="approveHandover('${s.id}', '${a.to_employee_id}')">
                        <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                </div>`).join('')
            : '<div style="font-size:0.85rem; color:var(--color-text-light);">Noch niemand gemeldet.</div>';

        return `
            <div class="list-item" style="flex-direction:column; align-items:flex-start; gap:0.5rem;">
                <div style="display:flex; justify-content:space-between; width:100%;">
                    <h4>${s.employees_planit?.name || '?'} gibt ab</h4>
                    <button class="btn-small btn-pdf-view btn-icon" onclick="cancelHandover('${s.id}')">
                        <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div style="font-size:0.85rem; color:var(--color-text-light);">
                    ${formatDate(s.shift_date)} | ${s.start_time.slice(0,5)} – ${s.end_time.slice(0,5)} Uhr · ${s.employees_planit?.department || ''}
                </div>
                <div style="font-weight:600; font-size:0.8rem; margin-top:0.25rem;">Interessenten:</div>
                ${applicantsList}
            </div>`;
    }));

    handoverContainer.innerHTML = handoverHTML.join('');
}

async function approveHandover(shiftId, toEmpId) {
    // Schicht übertragen
    await db.from('shifts')
        .update({ employee_id: toEmpId, handover_requested: false })
        .eq('id', shiftId);
    // Alle anderen Requests ablehnen
    await db.from('shift_handovers')
        .update({ status: 'rejected' })
        .eq('shift_id', shiftId);
    // Genehmigten Request updaten
    await db.from('shift_handovers')
        .update({ status: 'approved' })
        .eq('shift_id', shiftId)
        .eq('to_employee_id', toEmpId);
    await loadAdminSwaps();
    await loadWeekGrid();
}

async function cancelHandover(shiftId) {
    await db.from('shifts')
        .update({ handover_requested: false })
        .eq('id', shiftId);
    await db.from('shift_handovers')
        .update({ status: 'rejected' })
        .eq('shift_id', shiftId);
    await loadAdminSwaps();
}

async function reviewHandover(id, status, shiftId, toEmpId) {
    await db.from('shift_handovers')
        .update({ status })
        .eq('id', id);

    if (status === 'approved' && shiftId && toEmpId) {
        await db.from('shifts')
            .update({ employee_id: toEmpId })
            .eq('id', shiftId);
    }

    await loadAdminSwaps();
    await loadWeekGrid();
}

async function reviewSwap(id, status, shiftId, targetShiftId, fromEmpId, toEmpId) {
    await db.from('shift_swaps').update({
        status,
        reviewed_at: new Date().toISOString()
    }).eq('id', id);

    // Bei Genehmigung: Schichten tauschen
    if (status === 'approved') {
        await db.from('shifts').update({ employee_id: toEmpId }).eq('id', shiftId);
        await db.from('shifts').update({ employee_id: fromEmpId }).eq('id', targetShiftId);
    }

    await loadAdminSwaps();
    await loadWeekGrid();
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
    const selectedDepts = (emp.departments || emp.department || '').split(',').map(s => s.trim()).filter(Boolean);
    const checksContainer = document.getElementById('edit-emp-departments-checks');
    checksContainer.style.display = 'none';
    checksContainer.previousElementSibling.querySelector('.toggle-arrow').textContent = '▶';
    checksContainer.innerHTML = departmentNames.map(name => `
        <label style="display:flex; align-items:center; gap:0.35rem; font-size:0.9rem; background:#F5F5F5; padding:0.35rem 0.6rem; border-radius:8px; cursor:pointer;">
            <input type="checkbox" value="${name}" ${selectedDepts.includes(name) ? 'checked' : ''} style="width:auto;">
            ${name}
        </label>
    `).join('');
    document.getElementById('edit-emp-error').style.display = 'none';
    document.getElementById('edit-emp-birthdate').value = emp.birthdate || '';
    document.getElementById('edit-emp-vacation-days').value = emp.vacation_days_per_year ?? 20;
    document.getElementById('edit-emp-start-date').value = emp.start_date || '';
    document.getElementById('edit-emp-hours-per-vacation-day').value = emp.hours_per_vacation_day || 8.0;
    document.getElementById('edit-emp-apprentice').checked = emp.is_apprentice || false;
    document.getElementById('edit-emp-hygiene-erste').value = emp.hygiene_erste || '';
    document.getElementById('edit-emp-hygiene-letzte').value = emp.hygiene_letzte || '';
    document.getElementById('edit-emp-hygiene-monate').value = emp.hygiene_gueltig_monate ?? 12;
    // Phasen laden
    currentPhases = [];
    renderEmploymentPhases();
    db.from('employment_phases')
        .select('*')
        .eq('employee_id', id)
        .order('start_date')
        .then(({ data }) => {
            currentPhases = data || [];
            renderEmploymentPhases();
        });
    document.getElementById('edit-employee-modal').classList.add('open');
}

let currentPhases = [];

function renderEmploymentPhases() {
    const container = document.getElementById('edit-emp-phases');
    if (currentPhases.length === 0) {
        container.innerHTML = '<div style="font-size:0.85rem; color:var(--color-text-light); margin-bottom:0.5rem;">Keine Phasen — Standardwerte gelten fürs ganze Jahr.</div>';
        return;
    }
    container.innerHTML = currentPhases.map((p, i) => `
        <div style="background:#F5F5F5; border-radius:8px; padding:0.75rem; margin-bottom:0.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                <span style="font-size:0.8rem; font-weight:600;">Phase ${i + 1}</span>
                <button onclick="removeEmploymentPhase(${i})" style="background:none; border:none; color:var(--color-text-light); cursor:pointer; font-size:1rem;">✕</button>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-bottom:0.5rem;">
                <div>
                    <label style="font-size:0.75rem;">Von</label>
                    <input type="date" value="${p.start_date || ''}" onchange="updatePhase(${i}, 'start_date', this.value)" style="padding:0.4rem; font-size:0.8rem;">
                </div>
                <div>
                    <label style="font-size:0.75rem;">Bis (leer = offen)</label>
                    <input type="date" value="${p.end_date || ''}" onchange="updatePhase(${i}, 'end_date', this.value)" style="padding:0.4rem; font-size:0.8rem;">
                </div>
            </div>
            <div style="margin-bottom:0.5rem;">
                <label style="font-size:0.75rem;">Std/Urlaubstag</label>
                <input type="number" value="${p.hours_per_vacation_day ?? 8}" min="0" max="24" step="0.5" onchange="updatePhase(${i}, 'hours_per_vacation_day', parseFloat(this.value) || 0)" style="padding:0.4rem; font-size:0.8rem; width:100%;">
            </div>
            <div>
                <label style="font-size:0.75rem;">Kommentar (optional)</label>
                <input type="text" value="${p.notes || ''}" placeholder="z.B. Vollzeit, Minijob, Elternzeit..." onchange="updatePhase(${i}, 'notes', this.value)" style="padding:0.4rem; font-size:0.8rem;">
            </div>
        </div>
    `).join('');
}

function addEmploymentPhase() {
    currentPhases.push({
        start_date: '',
        end_date: '',
        hours_per_vacation_day: 8.0
    });
    renderEmploymentPhases();
}

function removeEmploymentPhase(index) {
    currentPhases.splice(index, 1);
    renderEmploymentPhases();
}

function updatePhase(index, field, value) {
    currentPhases[index][field] = value;
}

function closeEditEmployeeModal() {
    document.getElementById('edit-employee-modal').classList.remove('open');
    editEmployeeId = null;
}

async function submitEditEmployee() {
    const name = document.getElementById('edit-emp-name').value.trim();
    const loginCode = document.getElementById('edit-emp-code').value.trim();
    const password = document.getElementById('edit-emp-password').value.trim();
    const checkedDepts = [...document.querySelectorAll('#edit-emp-departments-checks input[type=checkbox]:checked')].map(cb => cb.value);
    const departments = checkedDepts.join(',') || null;
    const department = checkedDepts[0] || null;
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
    if (checkedDepts.length === 0) {
        errorDiv.textContent = 'Mindestens eine Abteilung muss ausgewählt sein.';
        errorDiv.style.display = 'block';
        return;
    }

    const is_apprentice = document.getElementById('edit-emp-apprentice').checked;
    const hygieneErste = document.getElementById('edit-emp-hygiene-erste').value || null;
    const hygieneLetzte = document.getElementById('edit-emp-hygiene-letzte').value || null;
    const hygieneMonate = parseInt(document.getElementById('edit-emp-hygiene-monate').value) || 12;
    const payload = { name, login_code: loginCode, department, departments, birthdate, vacation_days_per_year: vacationDays, is_apprentice, start_date: startDate, hours_per_vacation_day: hoursPerVacationDay, hygiene_erste: hygieneErste, hygiene_letzte: hygieneLetzte, hygiene_gueltig_monate: hygieneMonate };
    if (password) payload.password_hash = password;

    const { error } = await db.from('employees_planit').update(payload).eq('id', editEmployeeId);
    if (error) {
        errorDiv.textContent = 'Fehler beim Speichern.';
        errorDiv.style.display = 'block';
        return;
    }
    // Phasen speichern
    await db.from('employment_phases')
        .delete()
        .eq('employee_id', editEmployeeId);

    if (currentPhases.length > 0) {
        const phasesToInsert = currentPhases
            .filter(p => p.start_date)
            .map(p => ({
            user_id: adminSession.user.id,
            employee_id: editEmployeeId,
            start_date: p.start_date,
            end_date: p.end_date || null,
            hours_per_vacation_day: p.hours_per_vacation_day,
            vacation_days_per_year: p.vacation_days_per_year,
            notes: p.notes || null
        }));
        if (phasesToInsert.length > 0) {
            await db.from('employment_phases').insert(phasesToInsert);
        }
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

    // Alle Daten parallel laden
    const [
        { data: shifts },
        { data: approved },
        { data: actualHours },
        { data: vacations },
    ] = await Promise.all([
        db.from('shifts').select('*').gte('shift_date', firstDay).lte('shift_date', lastDay),
        db.from('approved_hours').select('*').eq('month', monthStr),
        db.from('actual_hours').select('*').eq('month', monthStr),
        db.from('vacation_requests')
            .select('employee_id, deducted_days, deducted_hours')
            .eq('user_id', adminSession.user.id)
            .eq('status', 'approved')
            .eq('type', 'vacation')
            .lte('start_date', lastDay)
            .gte('end_date', firstDay),
    ]);

    // Vormonat carry_over direkt aus actual_hours des aktuellen Monats

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

        // Gearbeitet: aus Schichten berechnen (actual_* wenn vorhanden, sonst geplante Zeiten)
        let actualMinutes = 0;
        empShifts.forEach(s => {
            const startStr = s.actual_start_time || s.start_time;
            const endStr = s.actual_end_time || s.end_time;
            const breakMin = (s.actual_break_minutes !== null && s.actual_break_minutes !== undefined)
                ? s.actual_break_minutes : (s.break_minutes || 0);
            const [sh, sm] = startStr.split(':').map(Number);
            const [eh, em] = endStr.split(':').map(Number);
            actualMinutes += (eh * 60 + em) - (sh * 60 + sm) - breakMin;
        });

        // Urlaubsstunden für diesen Monat
        const empVacations = (vacations || []).filter(v => v.employee_id === emp.id);
        const hoursPerDay = emp.hours_per_vacation_day || 8;
        let vacationMinutes = 0;
        empVacations.forEach(v => {
            if (v.deducted_hours != null) {
                vacationMinutes += Math.round(v.deducted_hours * 60);
            } else if (v.deducted_days) {
                vacationMinutes += Math.round(v.deducted_days * hoursPerDay * 60);
            }
        });

        const totalMinutes = actualMinutes + vacationMinutes;
        const fmtMins = m => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
        let actualDisplay = fmtMins(totalMinutes);
        if (vacationMinutes > 0) {
            actualDisplay += ` <span style="font-size:0.75rem; color:var(--color-text-light);">(inkl. ${fmtMins(vacationMinutes)} Urlaub)</span>`;
        }

        // Vormonat-Differenz (carry_over bleibt aus actual_hours)
        const actualEntry = (actualHours || []).find(a => a.employee_id === emp.id);
        const prevDiffMinutes = actualEntry ? (actualEntry.carry_over_minutes || 0) : 0;

        // Aktuelle Differenz
        const diffMinutes = approvedMinutes !== null
            ? totalMinutes - approvedMinutes + prevDiffMinutes
            : null;
        const diffDisplay = diffMinutes !== null
            ? `${diffMinutes >= 0 ? '+' : ''}${Math.floor(Math.abs(diffMinutes)/60)}h ${String(Math.abs(diffMinutes)%60).padStart(2,'00')}m`
            : '–';
        const diffColor = diffMinutes === null ? 'var(--color-text-light)' : diffMinutes > 0 ? '#2d7a2d' : diffMinutes < 0 ? 'var(--color-red)' : 'var(--color-text-light)';

        const shiftRows = empShifts
            .slice().sort((a, b) => a.shift_date.localeCompare(b.shift_date))
            .map(s => {
                const dateLabel = new Date(s.shift_date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
                const startStr = s.actual_start_time || s.start_time;
                const endStr = s.actual_end_time || s.end_time;
                const breakMin = (s.actual_break_minutes !== null && s.actual_break_minutes !== undefined) ? s.actual_break_minutes : (s.break_minutes || 0);
                const [sh, sm] = startStr.split(':').map(Number);
                const [eh, em] = endStr.split(':').map(Number);
                const mins = (eh * 60 + em) - (sh * 60 + sm) - breakMin;
                const durStr = `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,'0')}m`;
                const plannedStr = `${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}`;
                const hasActual = s.actual_start_time || s.actual_end_time;
                const actualStr = hasActual ? `<span style="color:var(--color-primary);">${(s.actual_start_time||s.start_time).slice(0,5)}–${(s.actual_end_time||s.end_time).slice(0,5)}${s.actual_break_minutes != null ? ` (${s.actual_break_minutes}m)` : ''}</span>` : '';
                return `<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; padding:0.25rem 0; border-bottom:1px solid var(--color-border);">
                    <span style="min-width:6rem;">${dateLabel}</span>
                    <span style="color:var(--color-text-light);">${plannedStr}</span>
                    ${actualStr}
                    <span style="font-weight:600; min-width:4rem; text-align:right;">${durStr}</span>
                </div>`;
            }).join('');

        return `
        <div class="card" style="margin-bottom:0.75rem;">
            <button style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:1rem; background:none; border:none; padding:0; cursor:pointer; touch-action:manipulation; text-align:left;" onclick="toggleStundenEmp('${emp.id}')">
                <div style="font-weight:600;">${emp.name}</div>
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <div style="font-size:0.8rem; color:var(--color-text-light);">${emp.department}</div>
                    <span id="stunden-toggle-${emp.id}" style="color:var(--color-text-light);">▶</span>
                </div>
            </button>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:1rem;">
                <div>
                    <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.3rem;">ABGERECHNET</div>
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <span style="font-weight:600;">${approvedDisplay}</span>
                        <button class="btn-small btn-pdf-view btn-icon" data-empid="${emp.id}" data-name="${emp.name}" data-month="${monthStr}" data-minutes="${approvedMinutes !== null ? approvedMinutes : 0}" onclick="openApproveModal(this)">
                            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                    </div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.3rem;">GEARBEITET</div>
                    <div style="font-weight:600;">${actualDisplay}</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.3rem;">VORMONAT</div>
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <span style="font-weight:600;">${prevDiffMinutes >= 0 ? '+' : '-'}${Math.floor(Math.abs(prevDiffMinutes)/60)}h ${String(Math.abs(prevDiffMinutes)%60).padStart(2,'0')}m</span>
                        <button class="btn-small btn-pdf-view btn-icon" data-empid="${emp.id}" data-name="${emp.name}" data-month="${monthStr}" data-minutes="${prevDiffMinutes}" onclick="openCarryOverModal(this)">
                            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                    </div>
                </div>
            </div>
            <div style="margin-top:0.75rem; padding-top:0.75rem; border-top:1px solid var(--color-border);">
                <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.2rem;">SALDO</div>
                <div style="font-weight:700; font-size:1.1rem; color:${diffColor};">${diffDisplay}</div>
            </div>
            <div id="stunden-shifts-${emp.id}" style="display:none; margin-top:0.75rem; padding-top:0.75rem; border-top:1px solid var(--color-border);">
                ${shiftRows || '<div style="font-size:0.8rem; color:var(--color-text-light);">Keine Schichten.</div>'}
            </div>
        </div>`;
    }).join('');

    document.getElementById('admin-stunden-list').innerHTML = html;
}

function toggleShiftActual() {
    const body = document.getElementById('shift-actual-body');
    const toggle = document.getElementById('shift-actual-toggle');
    const open = body.style.display === 'none';
    body.style.display = open ? 'block' : 'none';
    toggle.textContent = open ? '▼' : '▶';
}

function toggleStundenEmp(empId) {
    const body = document.getElementById(`stunden-shifts-${empId}`);
    const toggle = document.getElementById(`stunden-toggle-${empId}`);
    const open = body.style.display === 'none';
    body.style.display = open ? 'block' : 'none';
    toggle.textContent = open ? '▼' : '▶';
}

async function downloadStundenPdf() {
    const year = adminStundenDate.getFullYear();
    const month = adminStundenDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthLabel = adminStundenDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    const firstDay = `${monthStr}-01`;
    const lastDay = new Date(year, month + 1, 0).toISOString().split('T')[0];

    const [{ data: emps }, { data: shifts }, { data: approved }, { data: actualHours }] = await Promise.all([
        db.from('employees_planit').select('*').eq('is_active', true).order('name'),
        db.from('shifts').select('*').eq('user_id', adminSession.user.id).eq('is_open', false).gte('shift_date', firstDay).lte('shift_date', lastDay),
        db.from('approved_hours').select('*').eq('user_id', adminSession.user.id).eq('month', monthStr),
        db.from('actual_hours').select('*').eq('user_id', adminSession.user.id).eq('month', monthStr),
    ]);

    if (!emps || emps.length === 0) { alert('Keine Mitarbeiter vorhanden.'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageW = 210;
    const marginL = 15;
    const marginR = 15;
    const contentW = pageW - marginL - marginR;

    emps.forEach((emp, empIdx) => {
        if (empIdx > 0) doc.addPage();

        const empShifts = (shifts || [])
            .filter(s => s.employee_id === emp.id)
            .sort((a, b) => a.shift_date.localeCompare(b.shift_date));

        // Kopfzeile
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(emp.name, marginL, 22);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(120);
        doc.text(emp.department || '', marginL, 29);
        doc.text(monthLabel, pageW - marginR, 22, { align: 'right' });
        doc.setTextColor(0);

        // Trennlinie
        doc.setDrawColor(200);
        doc.line(marginL, 33, pageW - marginR, 33);

        // Schicht-Tabelle Header
        let y = 42;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setFillColor(245, 245, 245);
        doc.rect(marginL, y - 5, contentW, 7, 'F');
        doc.text('Datum', marginL + 1, y);
        doc.text('Geplant', marginL + 38, y);
        doc.text('Tatsächlich', marginL + 75, y);
        doc.text('Pause', marginL + 120, y);
        doc.text('Stunden', pageW - marginR, y, { align: 'right' });
        y += 6;

        doc.setFont('helvetica', 'normal');
        let totalActualMin = 0;

        if (empShifts.length === 0) {
            doc.setTextColor(150);
            doc.text('Keine Schichten in diesem Monat.', marginL + 1, y + 3);
            doc.setTextColor(0);
            y += 10;
        } else {
            empShifts.forEach((s, i) => {
                if (y > 250) { doc.addPage(); y = 20; }
                const dateLabel = new Date(s.shift_date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
                const planned = `${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}`;
                const startStr = s.actual_start_time || s.start_time;
                const endStr = s.actual_end_time || s.end_time;
                const breakMin = (s.actual_break_minutes !== null && s.actual_break_minutes !== undefined) ? s.actual_break_minutes : (s.break_minutes || 0);
                const hasActual = s.actual_start_time || s.actual_end_time;
                const actual = hasActual ? `${startStr.slice(0,5)}–${endStr.slice(0,5)}` : '–';
                const [sh, sm] = startStr.split(':').map(Number);
                const [eh, em] = endStr.split(':').map(Number);
                const mins = (eh * 60 + em) - (sh * 60 + sm) - breakMin;
                totalActualMin += mins;
                const durStr = `${Math.floor(mins/60)}:${String(mins%60).padStart(2,'0')}`;

                if (i % 2 === 0) {
                    doc.setFillColor(250, 250, 250);
                    doc.rect(marginL, y - 4, contentW, 6, 'F');
                }
                doc.text(dateLabel, marginL + 1, y);
                doc.text(planned, marginL + 38, y);
                if (hasActual) { doc.setTextColor(180, 140, 50); }
                doc.text(actual, marginL + 75, y);
                doc.setTextColor(0);
                doc.text(`${breakMin} Min`, marginL + 120, y);
                doc.text(durStr, pageW - marginR, y, { align: 'right' });
                y += 6;
            });
        }

        // Trennlinie vor Summen
        y += 2;
        doc.setDrawColor(200);
        doc.line(marginL, y, pageW - marginR, y);
        y += 7;

        // Summen
        const approvedEntry = (approved || []).find(a => a.employee_id === emp.id);
        const approvedMin = approvedEntry ? approvedEntry.approved_minutes : null;
        const actualEntry = (actualHours || []).find(a => a.employee_id === emp.id);
        const carryMin = actualEntry ? (actualEntry.carry_over_minutes || 0) : 0;
        const diffMin = approvedMin !== null ? totalActualMin - approvedMin + carryMin : null;

        const fmtMin = (m) => `${Math.floor(Math.abs(m)/60)}:${String(Math.abs(m)%60).padStart(2,'0')}`;

        doc.setFontSize(9);
        const col1 = marginL + 1;
        const col2 = marginL + 60;
        const col3 = marginL + 110;

        doc.setFont('helvetica', 'bold');
        doc.text('Gearbeitet:', col1, y);
        doc.setFont('helvetica', 'normal');
        doc.text(`${Math.floor(totalActualMin/60)}:${String(totalActualMin%60).padStart(2,'0')} h`, col1 + 28, y);

        doc.setFont('helvetica', 'bold');
        doc.text('Abgerechnet:', col2, y);
        doc.setFont('helvetica', 'normal');
        doc.text(approvedMin !== null ? `${fmtMin(approvedMin)} h` : '–', col2 + 32, y);

        doc.setFont('helvetica', 'bold');
        doc.text('Vormonat:', col3, y);
        doc.setFont('helvetica', 'normal');
        doc.text(`${carryMin >= 0 ? '+' : '-'}${fmtMin(carryMin)} h`, col3 + 24, y);
        y += 7;

        doc.setFont('helvetica', 'bold');
        doc.text('Saldo:', col1, y);
        if (diffMin !== null) {
            doc.setTextColor(diffMin > 0 ? 45 : diffMin < 0 ? 180 : 0, diffMin > 0 ? 122 : diffMin < 0 ? 50 : 0, 0);
            doc.text(`${diffMin >= 0 ? '+' : '-'}${fmtMin(diffMin)} h`, col1 + 28, y);
            doc.setTextColor(0);
        } else {
            doc.setFont('helvetica', 'normal');
            doc.text('–', col1 + 28, y);
        }

        // Unterschrift-Feld
        y = Math.max(y + 20, 240);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setDrawColor(150);
        doc.line(marginL, y, marginL + 70, y);
        doc.line(pageW - marginR - 70, y, pageW - marginR, y);
        doc.setTextColor(130);
        doc.text('Datum, Unterschrift Mitarbeiter', marginL, y + 5);
        doc.text('Datum, Unterschrift Vorgesetzter', pageW - marginR - 70, y + 5);
        doc.setTextColor(0);
    });

    doc.save(`Stundenkonto_${monthStr}.pdf`);
}

function openActualModal(btn) {
    const empId = btn.dataset.empid;
    const name = btn.dataset.name;
    const month = btn.dataset.month;
    const minutes = parseInt(btn.dataset.minutes) || 0;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    document.getElementById('approve-modal-title').textContent = `Gearbeitet: ${name}`;
    document.getElementById('approve-hours').value = hours;
    document.getElementById('approve-minutes').value = mins;

    document.querySelector('#approve-modal .btn-primary').onclick = () => submitActualHours(empId, month);
    document.getElementById('approve-modal').classList.add('active');
}

function openCarryOverModal(btn) {
    const empId = btn.dataset.empid;
    const name = btn.dataset.name;
    const month = btn.dataset.month;
    const minutes = parseInt(btn.dataset.minutes) || 0;
    const isNegative = minutes < 0;
    const absMinutes = Math.abs(minutes);
    document.getElementById('approve-modal-title').textContent = `Vormonat: ${name}`;
    document.getElementById('approve-hours').value = Math.floor(absMinutes / 60) * (isNegative ? -1 : 1);
    document.getElementById('approve-minutes').value = absMinutes % 60;
    document.querySelector('#approve-modal .btn-primary').onclick = () => submitCarryOver(empId, month);
    document.getElementById('approve-modal').classList.add('active');
}

async function submitCarryOver(empId, month) {
    const h = parseInt(document.getElementById('approve-hours').value) || 0;
    const m = parseInt(document.getElementById('approve-minutes').value) || 0;
    const totalMinutes = h * 60 + (h < 0 ? -m : m);
    const { error } = await db.from('actual_hours').upsert({
        employee_id: empId,
        month: month,
        carry_over_minutes: totalMinutes,
        user_id: (await db.auth.getUser()).data.user.id
    }, { onConflict: 'employee_id,month' });
    if (error) { alert('Fehler: ' + error.message); return; }
    document.getElementById('approve-modal').classList.remove('active');
    loadAdminStunden();
}

async function submitActualHours(empId, month) {
    const h = parseInt(document.getElementById('approve-hours').value) || 0;
    const m = parseInt(document.getElementById('approve-minutes').value) || 0;
    const totalMinutes = h * 60 + m;

    const { error } = await db.from('actual_hours').upsert({
        employee_id: empId,
        month: month,
        actual_minutes: totalMinutes,
        user_id: (await db.auth.getUser()).data.user.id
    }, { onConflict: 'employee_id,month' });

    if (error) { alert('Fehler: ' + error.message); return; }
    document.getElementById('approve-modal').classList.remove('active');
    loadAdminStunden();
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
    document.querySelector('#approve-modal .btn-primary').onclick = () => saveApprovedHours();
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
}

// ============================================
// OFFENE SCHICHTEN
// ============================================
let openShiftData = null; // { dateStr, dept, existingShift }

function openOpenShiftModal(dateStr, dept, existingShift) {
    currentShiftEmployeeId = null;
    currentShiftDateStr = dateStr;
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

async function loadMehrBadge() {
    const uid = adminSession.user.id;
    const [{ data: terminations }, { data: inventur }, { data: hygieneEmps }] = await Promise.all([
        db.from('planit_terminations').select('id').eq('user_id', uid).eq('status', 'pending'),
        db.from('planit_inventory_submissions').select('id').eq('user_id', uid),
        db.from('employees_planit').select('hygiene_erste, hygiene_letzte, hygiene_gueltig_monate').eq('user_id', uid).eq('is_active', true),
    ]);
    const soon = new Date();
    soon.setHours(0, 0, 0, 0);
    soon.setDate(soon.getDate() + 14);
    const hygieneCount = (hygieneEmps || []).filter(emp => {
        const basis = emp.hygiene_letzte || emp.hygiene_erste;
        if (!basis) return false;
        const n = new Date(basis + 'T00:00:00');
        n.setMonth(n.getMonth() + (emp.hygiene_gueltig_monate ?? 12));
        return n <= soon;
    }).length;
    const total = (terminations?.length || 0) + (inventur?.length || 0) + hygieneCount;
    console.log('mehr total:', total);
    const badge = document.getElementById('mehr-badge');
    if (!badge) return;
    if (total > 0) {
        badge.textContent = total;
        badge.style.display = 'inline';
        console.log('mehr-badge nach set:', badge.style.display, badge.textContent);
    } else {
        badge.style.display = 'none';
    }
}

async function loadHygieneBadge() {
    const { data } = await db
        .from('employees_planit')
        .select('hygiene_erste, hygiene_letzte, hygiene_gueltig_monate')
        .eq('user_id', adminSession.user.id)
        .eq('is_active', true);

    const soon = new Date();
    soon.setHours(0, 0, 0, 0);
    soon.setDate(soon.getDate() + 14);

    const count = (data || []).filter(emp => {
        const basis = emp.hygiene_letzte || emp.hygiene_erste;
        if (!basis) return false;
        const n = new Date(basis + 'T00:00:00');
        n.setMonth(n.getMonth() + (emp.hygiene_gueltig_monate ?? 12));
        return n <= soon;
    }).length;

    const badge = document.getElementById('hygiene-badge');
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline';
    } else {
        badge.style.display = 'none';
    }
    await loadMehrBadge();
}

async function loadUrlaubBadge() {
    const { data } = await db
        .from('vacation_requests')
        .select('id')
        .eq('user_id', adminSession.user.id)
        .eq('status', 'pending');

    console.log('urlaub badge count:', data?.length);
    const badge = document.getElementById('urlaub-badge');
    if (!badge) return;
    if (data && data.length > 0) {
        badge.textContent = data.length;
        badge.style.display = 'inline';
    } else {
        badge.style.display = 'none';
    }
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

async function loadTerminations() {
    const container = document.getElementById('terminations-list');
    container.innerHTML = '<div style="color:var(--color-text-light); font-size:0.9rem;">Lädt…</div>';

    const { data } = await db
        .from('planit_terminations')
        .select('*, employees_planit(name)')
        .eq('user_id', adminSession.user.id)
        .order('created_at', { ascending: false });

    if (!data || data.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Kündigungsanträge vorhanden.</p></div>';
        return;
    }

    container.innerHTML = data.map(t => {
        const name = t.employees_planit?.name || '–';
        const date = t.requested_date ? new Date(t.requested_date + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) : '–';
        const statusColor = t.status === 'approved' ? '#2d7a2d' : t.status === 'rejected' ? 'var(--color-danger)' : 'var(--color-text-light)';
        const statusLabel = t.status === 'approved' ? 'Genehmigt' : t.status === 'rejected' ? 'Abgelehnt' : 'Offen';
        const address = [t.street, `${t.zip || ''} ${t.city || ''}`.trim()].filter(Boolean).join(', ');
        return `
        <div class="card" style="margin-bottom:0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                <div style="font-weight:700; font-size:1rem;">${name}</div>
                <span style="font-size:0.8rem; font-weight:600; color:${statusColor};">${statusLabel}</span>
            </div>
            ${address ? `<div style="font-size:0.85rem; color:var(--color-text-light); margin-bottom:0.25rem;">${address}</div>` : ''}
            <div style="font-size:0.85rem; margin-bottom:0.25rem;">Letzter Arbeitstag: <strong>${date}</strong></div>
            ${t.reason ? `<div style="font-size:0.85rem; color:var(--color-text-light); margin-bottom:0.75rem;">Grund: ${t.reason}</div>` : '<div style="margin-bottom:0.75rem;"></div>'}
            <div style="display:flex; gap:0.5rem; align-items:center;">
                ${t.pdf_url ? `<button class="btn-small btn-pdf-view btn-icon" onclick="downloadTerminationPdf('${t.pdf_url}')"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>` : ''}
                ${t.status === 'pending' ? `<button class="btn-small btn-pdf-view btn-icon" onclick="approveTermination('${t.id}')"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></button>` : ''}
                ${t.status === 'pending' ? `<button class="btn-small btn-delete btn-icon" onclick="rejectTermination('${t.id}')"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
                <button class="btn-small btn-delete btn-icon" onclick="deleteTermination('${t.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
            </div>
        </div>`;
    }).join('');
}

async function approveTermination(id) {
    if (!confirm('Kündigung genehmigen?')) return;
    const { data: t } = await db.from('planit_terminations').select('requested_date, employee_id').eq('id', id).maybeSingle();
    const approvedDate = t?.requested_date || null;
    await db.from('planit_terminations').update({ status: 'approved', approved_date: approvedDate }).eq('id', id);
    if (approvedDate && t?.employee_id) {
        // Phasen mit start_date > approved_date löschen (versehentlich angelegte)
        await db.from('employment_phases')
            .delete()
            .eq('employee_id', t.employee_id)
            .gt('start_date', approvedDate);
        // Offene Phase schließen
        await db.from('employment_phases')
            .update({ end_date: approvedDate })
            .eq('employee_id', t.employee_id)
            .is('end_date', null);
    }
    await loadTerminations();
    await loadTerminationBadge();
    await loadMehrBadge();
}

async function rejectTermination(id) {
    if (!confirm('Kündigung ablehnen?')) return;
    await db.from('planit_terminations').update({ status: 'rejected' }).eq('id', id);
    await loadTerminations();
    await loadTerminationBadge();
    await loadMehrBadge();
}

async function downloadTerminationPdf(filePath) {
    const win = window.open('', '_blank');
    const { data, error } = await db.storage
        .from('termination-pdfs')
        .createSignedUrl(filePath, 60);
    if (error || !data?.signedUrl) {
        win.close();
        alert('PDF konnte nicht geladen werden.');
        return;
    }
    win.location.href = data.signedUrl;
}

async function deleteTermination(id) {
    if (!confirm('Kündigungsantrag unwiderruflich löschen?')) return;
    const { data: t } = await db.from('planit_terminations').select('employee_id, approved_date').eq('id', id).maybeSingle();
    await db.from('planit_terminations').delete().eq('id', id);
    if (t?.employee_id) {
        const { data: phase } = await db.from('employment_phases')
            .select('id')
            .eq('employee_id', t.employee_id)
            .not('end_date', 'is', null)
            .order('start_date', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (phase) {
            await db.from('employment_phases').update({ end_date: null }).eq('id', phase.id);
        }
    }
    await loadTerminations();
    await loadTerminationBadge();
    await loadMehrBadge();

    if (t?.employee_id) {
        switchTab('team');
        await loadTeam();
        toggleTeamEmployee(t.employee_id);
        const body = document.getElementById(`teambody-${t.employee_id}`);
        if (body) {
            const hint = document.createElement('div');
            hint.style.cssText = 'background:#FFF3CD; border-radius:8px; padding:0.65rem 0.85rem; font-size:0.85rem; color:#856404; margin-bottom:0.75rem;';
            hint.textContent = 'Bitte Beschäftigungsphasen prüfen und anpassen.';
            body.prepend(hint);
        }
    }
}

async function loadArchiveBadge() {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await db
        .from('planit_terminations')
        .select('employee_id, employees_planit!planit_terminations_employee_id_fkey(name, is_active)')
        .eq('user_id', adminSession.user.id)
        .eq('status', 'approved')
        .lte('approved_date', today);

    const pending = (data || []).filter(t => t.employees_planit?.is_active === true);

    const badge = document.getElementById('archive-badge');
    if (badge) {
        if (pending.length > 0) {
            badge.textContent = pending.length;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }
    }
}

async function archiveEmployee(employeeId) {
    await db.from('employees_planit').update({ is_active: false }).eq('id', employeeId);
    await loadEmployees();
    await loadTeam();
    await loadArchiveBadge();
}

async function loadTerminationBadge() {
    const { data } = await db
        .from('planit_terminations')
        .select('id')
        .eq('user_id', adminSession.user.id)
        .eq('status', 'pending');

    const badge = document.getElementById('termination-badge');
    if (badge) {
        if (data && data.length > 0) {
            badge.textContent = data.length;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }
    }
}

async function loadInventurBadge() {
    const { data } = await db
        .from('planit_inventory_submissions')
        .select('id')
        .eq('user_id', adminSession.user.id);

    const badge = document.getElementById('inventur-badge');
    if (data && data.length > 0) {
        badge.textContent = data.length;
        badge.style.display = 'inline';
    } else {
        badge.style.display = 'none';
    }
}

async function loadInventurSubmissions() {
    const { data: submissions } = await db
        .from('planit_inventory_submissions')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .order('submitted_at', { ascending: false });

    const container = document.getElementById('submissions-list');
    if (!submissions || submissions.length === 0) {
        container.innerHTML = '';
        return;
    }

    const { data: employees } = await db
        .from('employees_planit')
        .select('id, name')
        .eq('user_id', adminSession.user.id);

    const empMap = {};
    (employees || []).forEach(e => { empMap[e.id] = e.name; });

    container.innerHTML = `
        <div style="font-size:0.85rem; font-weight:700; color:var(--color-text-light); letter-spacing:0.05em; margin-bottom:0.5rem;">EINGEREICHTE INVENTUREN</div>
        ${submissions.map(s => {
            const name = empMap[s.employee_id] || 'Unbekannt';
            const date = new Date(s.submission_date + 'T12:00:00');
            const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const time = new Date(s.submitted_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            return `
            <div class="card" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem; padding:0.6rem 0.75rem;">
                <div>
                    <div style="font-size:0.9rem; font-weight:600;">${name}</div>
                    <div style="font-size:0.75rem; color:var(--color-text-light);">${dateStr} · ${time} Uhr</div>
                </div>
                <button class="btn-small btn-pdf-view" style="font-size:0.75rem; padding:0.3rem 0.75rem; height:auto; width:auto;" onclick="markInventurSubmissionSeen('${s.id}')">Gesehen</button>
            </div>`;
        }).join('')}
    `;
}

async function markInventurSubmissionSeen(id) {
    await db.from('planit_inventory_submissions').delete().eq('id', id);
    await loadInventurSubmissions();
    await loadInventurBadge();
}

async function loadInventurDelegation() {
    const { data: employees } = await db
        .from('employees_planit')
        .select('id, name, can_do_inventory')
        .eq('user_id', adminSession.user.id)
        .eq('is_active', true)
        .order('name', { ascending: true });

    const container = document.getElementById('inventur-delegation-list');
    if (!employees || employees.length === 0) {
        container.innerHTML = '<div style="font-size:0.85rem; color:var(--color-text-light);">Keine Mitarbeiter vorhanden.</div>';
        return;
    }

    container.innerHTML = employees.map(e => `
        <label style="display:flex; align-items:center; gap:0.75rem; padding:0.4rem 0; border-bottom:1px solid var(--color-border); cursor:pointer;">
            <input type="checkbox" data-emp-id="${e.id}" ${e.can_do_inventory ? 'checked' : ''} style="width:1.1rem; height:1.1rem; accent-color:var(--color-primary); cursor:pointer;">
            <span style="font-size:0.9rem;">${e.name}</span>
        </label>
    `).join('');
}

function toggleDelegationSection() {
    const body = document.getElementById('delegation-body');
    const toggle = document.getElementById('delegation-toggle');
    const isOpen = body.style.display === 'block';
    body.style.display = isOpen ? 'none' : 'block';
    toggle.textContent = isOpen ? '▶' : '▼';
}

async function saveInventurDelegation() {
    const checkboxes = document.querySelectorAll('#inventur-delegation-list input[data-emp-id]');
    for (const cb of checkboxes) {
        await db.from('employees_planit')
            .update({ can_do_inventory: cb.checked })
            .eq('id', cb.dataset.empId);
    }
    alert('Gespeichert!');
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
    const fromYearEl = document.getElementById('carry-over-from-year');
    const toYearEl = document.getElementById('carry-over-to-year');
    if (fromYearEl) fromYearEl.textContent = urlaubYear;
    if (toYearEl) toYearEl.textContent = urlaubYear + 1;
    const year = urlaubYear;
    const container = document.getElementById('urlaubsverwaltung-list');
    container.innerHTML = '<div style="color:var(--color-text-light);">Wird geladen...</div>';

    // Frische Mitarbeiterdaten laden (inkl. carry_over_days/hours)
    const [{ data: freshEmps }, { data: allPhases }, { data: vacations }, { data: allShifts }, { data: terminations }] = await Promise.all([
        db.from('employees_planit')
            .select('*')
            .eq('user_id', adminSession.user.id)
            .eq('is_active', true)
            .order('name'),
        db.from('employment_phases')
            .select('*')
            .eq('user_id', adminSession.user.id)
            .order('start_date'),
        db.from('vacation_requests')
            .select('*, employees_planit(name)')
            .eq('user_id', adminSession.user.id)
            .eq('status', 'approved')
            .gte('start_date', `${year}-01-01`)
            .lte('end_date', `${year}-12-31`),
        db.from('shifts')
            .select('employee_id, start_time, end_time, break_minutes, actual_start_time, actual_end_time, actual_break_minutes')
            .eq('user_id', adminSession.user.id)
            .gte('shift_date', `${year}-01-01`)
            .lte('shift_date', `${year}-12-31`)
            .not('employee_id', 'is', null),
        db.from('planit_terminations')
            .select('employee_id, requested_date')
            .eq('user_id', adminSession.user.id)
            .eq('status', 'approved'),
    ]);

    _terminationDates = {};
    (terminations || []).forEach(t => { _terminationDates[t.employee_id] = t.requested_date; });

    container.innerHTML = '';
    container.removeEventListener('change', _cutoffChangeHandler);
    container.addEventListener('change', _cutoffChangeHandler);

    (freshEmps || []).forEach(emp => {
        const block = document.createElement('div');
        block.style.cssText = 'border-radius:14px; margin-bottom:1rem; overflow:hidden; background:var(--color-gray);';

        // Urlaubskonto berechnen
        const empPhases = (allPhases || []).filter(p => p.employee_id === emp.id);
        const terminationCutoff = _terminationDates[emp.id] || null;
        const account = calculateVacationAccount(emp, year, vacations || [], [], empPhases, terminationCutoff);
        const empVacations = (vacations || []).filter(v => v.employee_id === emp.id).sort((a, b) => a.start_date.localeCompare(b.start_date));
        vacationExplainData[emp.id] = { emp, account, phases: empPhases, vacations: empVacations, year };

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

        // Durchschnittliche Schichtlänge berechnen
        const empShifts = (allShifts || []).filter(s => s.employee_id === emp.id);
        let avgShiftText = '';
        if (empShifts.length > 0) {
            const totalMin = empShifts.reduce((sum, s) => {
                const startStr = s.actual_start_time || s.start_time;
                const endStr   = s.actual_end_time   || s.end_time;
                const brk      = s.actual_break_minutes ?? s.break_minutes ?? 0;
                const [sh, sm] = startStr.split(':').map(Number);
                const [eh, em] = endStr.split(':').map(Number);
                return sum + Math.max(0, (eh * 60 + em) - (sh * 60 + sm) - brk);
            }, 0);
            const avgMin = Math.round(totalMin / empShifts.length);
            const avgH   = Math.floor(avgMin / 60);
            const avgM   = avgMin % 60;
            avgShiftText = ` | Ø ${avgH}h${avgM > 0 ? ` ${avgM}m` : ''} (${empShifts.length} Schichten)`;
        }

        // Konto-Übersicht
        body.innerHTML = `
            <div class="form-group">
                <label>Anspruch bis${terminationCutoff ? ' <span style="font-size:0.78rem; background:#E6F4E6; color:#2d7a2d; border-radius:6px; padding:1px 6px; vertical-align:middle;">Kündigung genehmigt</span>' : ''}</label>
                <input type="date" id="cutoff-${emp.id}" value="${terminationCutoff || `${year}-12-31`}" data-empid="${emp.id}"${terminationCutoff ? ' disabled' : ''}>
            </div>
            <div id="account-boxes-${emp.id}">${buildAccountBoxesHtml(emp.id, account)}</div>
            ${empPhases.length > 0
                ? empPhases.map(p => {
                    const formatShort = d => {
                        const parts = d.split('-');
                        return `${parts[2]}.${parts[1]}.${parts[0].slice(2)}`;
                    };
                    const von = formatShort(p.start_date);
                    const bis = p.end_date ? formatShort(p.end_date) : 'offen';
                    return `<div style="font-size:0.8rem; color:var(--color-text-light); margin-bottom:0.25rem;">Std. pro UT: ${p.hours_per_vacation_day}h (${von} – ${bis})${p.notes ? ` · ${p.notes}` : ''}${avgShiftText}</div>`;
                }).join('')
                : `<div style="font-size:0.8rem; color:var(--color-text-light); margin-bottom:0.25rem;">Std. pro UT: ${emp.hours_per_vacation_day || 8.0}h${avgShiftText}</div>`
            }
            <div style="font-size:0.8rem; color:var(--color-text-light); margin-bottom:1rem;">Eintrittsdatum: ${emp.start_date ? formatDate(emp.start_date) : '–'}</div>
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
                                <span style="font-weight:600; white-space:nowrap; text-align:right;">
                                    ${(Math.round((v.deducted_days || 0) * 100) / 100).toFixed(2)} Tage
                                    ${(() => {
                                        if (v.deducted_hours != null) return `<div style="font-size:0.75rem; color:var(--color-text-light); font-weight:400;">${v.deducted_hours} Std</div>`;
                                        if (v.type === 'payout') return `<div style="font-size:0.75rem; color:var(--color-text-light); font-weight:400;">${((v.deducted_days || 0) * (emp.hours_per_vacation_day || 8)).toFixed(1)} Std</div>`;
                                        return '';
                                    })()}
                                </span>
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

function buildAccountBoxesHtml(empId, account) {
    const remColor = account.remaining <= 3 ? '#E57373' : 'var(--color-primary)';
    return `<div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-bottom:1rem;">
        <div class="info-box-clickable" style="background:#F5F5F5;" onclick="showVacationExplain('${empId}', 'jahresanspruch')">
            <div style="font-size:0.75rem; color:var(--color-text-light);">Jahresanspruch ⓘ</div>
            <div style="font-weight:700;">${account.entitlement.toFixed(2)} Tage</div>
            <div style="font-size:0.75rem; color:var(--color-text-light);">${account.entitlementH.toFixed(2)} Std</div>
        </div>
        <div class="info-box-clickable" style="background:#F5F5F5;" onclick="showVacationExplain('${empId}', 'carryover')">
            <div style="font-size:0.75rem; color:var(--color-text-light);">Übertrag Vorjahr ⓘ</div>
            <div style="font-weight:700;">${account.carryover.toFixed(2)} Tage</div>
            <div style="font-size:0.75rem; color:var(--color-text-light);">${account.carryoverH.toFixed(2)} Std</div>
        </div>
        <div class="info-box-clickable" style="background:#F5F5F5;" onclick="showVacationExplain('${empId}', 'genommen')">
            <div style="font-size:0.75rem; color:var(--color-text-light);">Genommen ⓘ</div>
            <div style="font-weight:700;">${account.used.toFixed(2)} Tage</div>
            <div style="font-size:0.75rem; color:var(--color-text-light);">${account.usedH.toFixed(2)} Std</div>
        </div>
        <div class="info-box-clickable" style="background:#F5F5F5;" onclick="showVacationExplain('${empId}', 'uebrig')">
            <div style="font-size:0.75rem; color:var(--color-text-light);">Übrig ⓘ</div>
            <div style="font-weight:700; color:${remColor};">${account.remaining.toFixed(2)} Tage</div>
            <div style="font-size:0.75rem; color:var(--color-text-light);">${account.remainingH.toFixed(2)} Std</div>
        </div>
    </div>`;
}

function updateEmpAccount(empId) {
    const d = vacationExplainData[empId];
    if (!d) return;
    const cutoff = _terminationDates[empId] || document.getElementById(`cutoff-${empId}`)?.value || `${d.year}-12-31`;
    const account = calculateVacationAccount(d.emp, d.year, d.vacations, [], d.phases, cutoff);
    vacationExplainData[empId].account = account;
    document.getElementById(`account-boxes-${empId}`).innerHTML = buildAccountBoxesHtml(empId, account);
}

function showVacationExplain(empId, type) {
    const d = vacationExplainData[empId];
    if (!d) return;
    const { emp, account, phases, vacations, year } = d;
    const daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const fmt = dateStr => { const p = dateStr.split('-'); return `${p[2]}.${p[1]}.${p[0].slice(2)}`; };

    let title = '', body = '';

    if (type === 'jahresanspruch') {
        title = 'Jahresanspruch – Berechnung';
        const totalDaysPerYear = emp.vacation_days_per_year ?? 20;
        if (phases.length > 0) {
            body = phases.map(p => {
                const phaseStart = new Date(Math.max(new Date(p.start_date + 'T12:00:00'), new Date(yearStart + 'T12:00:00')));
                const phaseEnd = new Date(Math.min(p.end_date ? new Date(p.end_date + 'T12:00:00') : new Date(yearEnd + 'T12:00:00'), new Date(yearEnd + 'T12:00:00')));
                const daysInPhase = Math.round((phaseEnd - phaseStart) / 86400000) + 1;
                const phaseDays = p.hours_per_vacation_day === 0 ? 0 : Math.round((daysInPhase / daysInYear) * totalDaysPerYear * 100) / 100;
                const von = fmt(phaseStart.toISOString().split('T')[0]);
                const bis = fmt(phaseEnd.toISOString().split('T')[0]);
                return `<div style="padding:0.4rem 0; border-bottom:1px solid var(--color-border);">
                    <span style="color:var(--color-text-light);">${von} – ${bis}</span><br>
                    ${daysInPhase} / ${daysInYear} Tage × ${totalDaysPerYear} = <strong>${phaseDays.toFixed(2)} Tage</strong>
                    <span style="color:var(--color-text-light); font-size:0.8rem;">(${p.hours_per_vacation_day} Std/UT${p.notes ? ' · ' + p.notes : ''})</span>
                </div>`;
            }).join('');
        } else {
            const anteilig = emp.start_date && new Date(emp.start_date + 'T12:00:00').getFullYear() === year
                ? ` (anteilig ab ${fmt(emp.start_date)})`
                : '';
            body = `<div>${totalDaysPerYear} Tage/Jahr${anteilig}</div>`;
        }
        body += `<div style="margin-top:0.75rem; font-weight:700;">Gesamt: ${account.entitlement.toFixed(2)} Tage / ${account.entitlementH.toFixed(2)} Std</div>`;

    } else if (type === 'carryover') {
        title = 'Übertrag Vorjahr';
        body = `<div style="display:grid; grid-template-columns:auto 1fr; gap:0.25rem 1rem;">
            <span style="color:var(--color-text-light);">Tage</span><strong>${account.carryover.toFixed(2)}</strong>
            <span style="color:var(--color-text-light);">Stunden</span><strong>${account.carryoverH.toFixed(2)}</strong>
        </div>
        <div style="margin-top:0.75rem; font-size:0.8rem; color:var(--color-text-light);">Werte aus Mitarbeiter-Stammdaten (carry_over_days / carry_over_hours) — direkt addiert, keine Umrechnung.</div>`;

    } else if (type === 'genommen') {
        title = 'Genommen – Einträge';
        if (vacations.length === 0) {
            body = '<div style="color:var(--color-text-light);">Keine Einträge.</div>';
        } else {
            body = vacations.map(v => {
                const typeLabel = v.type === 'payout' ? '💰' : v.type === 'manual' ? '✏️' : '🏖';
                const hrs = v.deducted_hours != null ? ` / ${v.deducted_hours} Std` : '';
                return `<div style="display:flex; justify-content:space-between; align-items:baseline; padding:0.35rem 0; border-bottom:1px solid var(--color-border); font-size:0.85rem;">
                    <span>${typeLabel} ${fmt(v.start_date)}${v.reason ? ' · ' + v.reason : ''}</span>
                    <span style="font-weight:600; margin-left:0.5rem; white-space:nowrap;">${(Math.round((v.deducted_days || 0) * 100) / 100).toFixed(2)} T${hrs}</span>
                </div>`;
            }).join('');
            body += `<div style="margin-top:0.75rem; font-weight:700;">Gesamt: ${account.used.toFixed(2)} Tage / ${account.usedH.toFixed(2)} Std</div>`;
        }

    } else if (type === 'uebrig') {
        title = 'Übrig – Formel';
        const remColor = account.remaining <= 3 ? '#E57373' : 'var(--color-primary)';
        body = `<div style="display:grid; grid-template-columns:auto 1fr auto; gap:0.35rem 0.75rem; align-items:baseline;">
            <span style="color:var(--color-text-light);">Jahresanspruch</span><span></span><span><strong>${account.entitlement.toFixed(2)} T</strong> / ${account.entitlementH.toFixed(2)} Std</span>
            <span style="color:var(--color-text-light);">+ Übertrag</span><span></span><span><strong>${account.carryover.toFixed(2)} T</strong> / ${account.carryoverH.toFixed(2)} Std</span>
            <span style="color:var(--color-text-light);">− Genommen</span><span></span><span><strong>${account.used.toFixed(2)} T</strong> / ${account.usedH.toFixed(2)} Std</span>
        </div>
        <div style="margin-top:0.75rem; padding-top:0.6rem; border-top:2px solid var(--color-border); font-weight:700; font-size:1.05rem; color:${remColor};">
            = ${account.remaining.toFixed(2)} Tage / ${account.remainingH.toFixed(2)} Std
        </div>`;
    }

    document.getElementById('vacation-explain-title').textContent = title;
    document.getElementById('vacation-explain-body').innerHTML = body;
    document.getElementById('vacation-explain-modal').classList.add('active');
}

function closeVacationExplainModal() {
    document.getElementById('vacation-explain-modal').classList.remove('active');
}

let carryOverSectionOpen = false;
function toggleDeptStunden(safeId) {
    const body   = document.getElementById(`stunden-body-${safeId}`);
    const toggle = document.getElementById(`stunden-toggle-${safeId}`);
    const header = toggle?.parentElement;
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display      = open ? 'none' : 'block';
    toggle.textContent      = open ? '▶' : '▼';
    if (header) {
        header.style.background = open ? '#C9A24D' : 'var(--color-gray)';
        header.style.color      = open ? 'white' : 'var(--color-text-light)';
        header.style.borderRadius = open ? '8px' : '8px 8px 0 0';
    }
}

function toggleCarryOverSection() {
    const body = document.getElementById('carry-over-body');
    const icon = document.getElementById('carry-over-toggle-icon');
    const btn = document.querySelector('#carry-over-body').previousElementSibling;
    carryOverSectionOpen = !carryOverSectionOpen;
    body.style.display = carryOverSectionOpen ? 'block' : 'none';
    icon.textContent = carryOverSectionOpen ? '▼' : '▶';
    btn.style.background = carryOverSectionOpen ? 'none' : '#C9A24D';
    btn.style.color = carryOverSectionOpen ? 'inherit' : 'white';
    if (carryOverSectionOpen) loadCarryOverSection();
}

async function loadCarryOverSection() {
    const list = document.getElementById('carry-over-list');
    list.innerHTML = '<div style="color:var(--color-text-light); font-size:0.85rem; padding:0.5rem 0;">Wird geladen...</div>';
    const { data: emps } = await db
        .from('employees_planit')
        .select('id, name, department, carry_over_days, carry_over_hours, carry_over_set_at')
        .eq('user_id', adminSession.user.id)
        .eq('is_active', true)
        .order('name');

    if (!emps || emps.length === 0) {
        list.innerHTML = '<div style="color:var(--color-text-light); font-size:0.85rem;">Keine Mitarbeiter</div>';
        return;
    }

    list.dataset.empIds = emps.map(e => e.id).join(',');
    // Original-Werte merken für Änderungserkennung beim Speichern
    list.dataset.origValues = JSON.stringify(
        Object.fromEntries(emps.map(e => [e.id, { days: e.carry_over_days || 0, hours: e.carry_over_hours || 0 }]))
    );
    list.innerHTML = emps.map(emp => {
        const setAt = emp.carry_over_set_at
            ? `<div style="font-size:0.72rem; color:var(--color-text-light); margin-top:0.2rem;">Eingetragen am ${formatDate(emp.carry_over_set_at.split('T')[0])}</div>`
            : '';
        return `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:0.6rem 0; border-bottom:1px solid var(--color-border); gap:0.75rem;">
            <div style="min-width:0; flex:1;">
                <div style="font-weight:600; font-size:0.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${emp.name}</div>
                <div style="font-size:0.75rem; color:var(--color-text-light);">${emp.department || 'Allgemein'}</div>
                ${setAt}
            </div>
            <div style="display:flex; align-items:center; gap:0.35rem; flex-shrink:0;">
                <input type="number" min="0" id="co-days-${emp.id}" value="${emp.carry_over_days || 0}"
                    style="width:60px; padding:0.3rem 0.4rem; border:1px solid var(--color-border); border-radius:6px; font-size:0.9rem; font-weight:700; text-align:center;">
                <span style="font-size:0.75rem; color:var(--color-text-light);">T</span>
                <input type="number" min="0" id="co-hours-${emp.id}" value="${emp.carry_over_hours || 0}"
                    style="width:60px; padding:0.3rem 0.4rem; border:1px solid var(--color-border); border-radius:6px; font-size:0.9rem; font-weight:700; text-align:center;">
                <span style="font-size:0.75rem; color:var(--color-text-light);">Std</span>
            </div>
        </div>`;
    }).join('');
}

async function saveAllCarryOvers() {
    const list = document.getElementById('carry-over-list');
    const empIds = (list.dataset.empIds || '').split(',').filter(Boolean);
    if (!empIds.length) return;
    const orig = JSON.parse(list.dataset.origValues || '{}');
    const now = new Date().toISOString();
    let changed = 0;
    for (const empId of empIds) {
        const days  = Number(document.getElementById(`co-days-${empId}`)?.value  ?? 0) || 0;
        const hours = Number(document.getElementById(`co-hours-${empId}`)?.value ?? 0) || 0;
        const o = orig[empId] || { days: 0, hours: 0 };
        if (days === o.days && hours === o.hours) continue;
        changed++;
        const { error } = await db.from('employees_planit')
            .update({ carry_over_days: days, carry_over_hours: hours, carry_over_set_at: now })
            .eq('id', empId);
        if (error) { alert('Fehler bei ' + empId + ': ' + error.message); return; }
        await db.from('planit_audit_log').insert({
            user_id: adminSession.user.id,
            action: 'update_carry_over',
            target_type: 'employee',
            target_id: empId,
            details: { carry_over_days: days, carry_over_hours: hours }
        });
    }
    if (changed === 0) { alert('Keine Änderungen.'); return; }
    // Section schließen
    const body = document.getElementById('carry-over-body');
    const icon = document.getElementById('carry-over-toggle-icon');
    const btn = body.previousElementSibling;
    carryOverSectionOpen = false;
    body.style.display = 'none';
    icon.textContent = '▶';
    btn.style.background = '#C9A24D';
    btn.style.color = 'white';
    loadUrlaubsverwaltung();
}

async function applyYearEndCarryOver() {
    if (!confirm(`Saldo ${urlaubYear} für alle Mitarbeiter als Übertrag ${urlaubYear + 1} speichern?\n\nDies überschreibt bestehende Übertrag-Werte.`)) return;

    const { data: allPhases } = await db
        .from('employment_phases')
        .select('*')
        .eq('user_id', adminSession.user.id);
    const { data: vacations } = await db
        .from('vacation_requests')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .eq('status', 'approved')
        .gte('start_date', `${urlaubYear}-01-01`)
        .lte('end_date', `${urlaubYear}-12-31`);
    const { data: emps } = await db
        .from('employees_planit')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .eq('is_active', true);

    const now = new Date().toISOString();
    for (const emp of (emps || [])) {
        const empPhases = (allPhases || []).filter(p => p.employee_id === emp.id);
        const account = calculateVacationAccount(emp, urlaubYear, vacations || [], [], empPhases);
        const remainingDays = Math.max(0, account.remaining);
        await db.from('employees_planit').update({
            carry_over_days: Math.round(remainingDays * 100) / 100,
            carry_over_hours: 0,
            carry_over_set_at: now
        }).eq('id', emp.id);
    }
    alert(`Übertrag ${urlaubYear + 1} für alle Mitarbeiter gespeichert.`);
    await loadCarryOverSection();
    loadUrlaubsverwaltung();
}

async function saveCarryOver(empId, daysVal, hoursVal) {
    // Immer beide Felder explizit setzen (SET, kein ADD)
    const days = daysVal !== null ? (Number(daysVal) || 0) : undefined;
    const hours = hoursVal !== null ? (Number(hoursVal) || 0) : undefined;
    const update = {};
    if (days !== undefined) update.carry_over_days = days;
    if (hours !== undefined) update.carry_over_hours = hours;
    await db.from('employees_planit').update(update).eq('id', empId);
    await db.from('planit_audit_log').insert({
        user_id: adminSession.user.id,
        action: 'update_carry_over',
        target_type: 'employee',
        target_id: empId,
        details: update
    });
}

function calculateVacationAccount(emp, year, vacations, _prevVacations, phases = [], cutoffDate = null) {

    // Jahre vor 2026 → alles 0
    if (year < 2026) {
        return { entitlement: 0, carryover: 0, used: 0, remaining: 0, entitlementH: 0, carryoverH: 0, usedH: 0, remainingH: 0 };
    }

    // Phasen für dieses Jahr filtern
    const yearStart = `${year}-01-01`;
    const yearEnd = cutoffDate || `${year}-12-31`;
    const activePhases = phases.filter(p =>
        p.start_date <= yearEnd && (!p.end_date || p.end_date >= yearStart)
    );

    let entitlement = 0;
    let entitlementH = 0;

    if (activePhases.length > 0) {
        // Mit Phasen — monatsweise berechnen
        for (const phase of activePhases) {
            const phaseStart = new Date(Math.max(
                new Date(phase.start_date + 'T12:00:00'),
                new Date(yearStart + 'T12:00:00')
            ));
            const phaseEnd = new Date(Math.min(
                phase.end_date ? new Date(phase.end_date + 'T12:00:00') : new Date(yearEnd + 'T12:00:00'),
                new Date(yearEnd + 'T12:00:00')
            ));

            const totalDaysPerYear = emp.vacation_days_per_year ?? 20;
            const monthlyDays = totalDaysPerYear / 12;
            let phaseDays = 0;

            const startMonth = phaseStart.getMonth();
            const endMonth = phaseEnd.getMonth();

            for (let m = startMonth; m <= endMonth; m++) {
                const daysInMonth = new Date(year, m + 1, 0).getDate();
                const firstDay = m === startMonth ? phaseStart.getDate() : 1;
                const lastDay  = m === endMonth   ? phaseEnd.getDate()   : daysInMonth;
                phaseDays += monthlyDays * ((lastDay - firstDay + 1) / daysInMonth);
            }

            if (phase.hours_per_vacation_day === 0) phaseDays = 0;
            console.log(`[calculateVacationAccount] ${emp.name} | Phase ${phase.start_date}–${phase.end_date || 'offen'} | phaseDays=${phaseDays.toFixed(4)}`);
            entitlement += phaseDays;
            entitlementH += phaseDays * (phase.hours_per_vacation_day || 0);
        }
    } else {
        // Ohne Phasen — monatsweise ab Eintrittsdatum bis yearEnd (cutoff)
        const totalDays = emp.vacation_days_per_year ?? 20;
        const hoursPerDay = emp.hours_per_vacation_day || 8.0;
        const monthlyDays = totalDays / 12;
        console.log(`[calculateVacationAccount] ${emp.name} | Keine Phasen | vacation_days_per_year=${totalDays}`);

        const cutoffEnd = new Date(yearEnd + 'T12:00:00');

        if (emp.start_date) {
            const start = new Date(emp.start_date + 'T12:00:00');
            if (start.getFullYear() > year) {
                entitlement = 0;
            } else {
                const fromMonth = start.getFullYear() === year ? start.getMonth() : 0;
                const fromDay   = start.getFullYear() === year ? start.getDate()  : 1;
                const toMonth   = cutoffEnd.getMonth();
                const toDay     = cutoffEnd.getDate();
                for (let m = fromMonth; m <= toMonth; m++) {
                    const daysInMonth = new Date(year, m + 1, 0).getDate();
                    const firstDay = m === fromMonth ? fromDay : 1;
                    const lastDay  = m === toMonth   ? toDay   : daysInMonth;
                    entitlement += monthlyDays * ((lastDay - firstDay + 1) / daysInMonth);
                }
            }
        } else {
            // Kein Eintrittsdatum — ab Januar bis cutoff
            const toMonth = cutoffEnd.getMonth();
            const toDay   = cutoffEnd.getDate();
            for (let m = 0; m <= toMonth; m++) {
                const daysInMonth = new Date(year, m + 1, 0).getDate();
                const lastDay = m === toMonth ? toDay : daysInMonth;
                entitlement += monthlyDays * (lastDay / daysInMonth);
            }
        }
        entitlementH = entitlement * hoursPerDay;
    }

    // Genommene Tage und Stunden dieses Jahr (bis cutoff)
    const empVacations = vacations.filter(v => v.employee_id === emp.id && v.start_date <= yearEnd);
    const used = empVacations.reduce((sum, v) => sum + (v.deducted_days || 0), 0);
    const usedH = empVacations.reduce((sum, v) => {
        if (v.deducted_hours != null) return sum + v.deducted_hours;
        const date = v.start_date;
        const phase = phases.find(p => p.start_date <= date && (!p.end_date || p.end_date >= date));
        const hpd = phase ? (phase.hours_per_vacation_day || 0) : (emp.hours_per_vacation_day || 8.0);
        return sum + (v.deducted_days || 0) * hpd;
    }, 0);

    // Alle Zwischenwerte auf 2 Dezimalstellen runden
    const r2 = v => Math.round(v * 100) / 100;
    const entitlementR  = r2(entitlement);
    const entitlementHR = r2(entitlementH);
    const usedR  = r2(used);
    const usedHR = r2(usedH);

    // Übertrag Vorjahr aus Mitarbeiter-Stammdaten (direkt, keine Umrechnung)
    const carryover  = r2(emp.carry_over_days  || 0);
    const carryoverH = r2(emp.carry_over_hours || 0);

    console.log(`[calculateVacationAccount] ${emp.name} | carryover=${carryover}, carryoverH=${carryoverH}`);
    const remaining  = r2(entitlementR  + carryover  - usedR);
    const remainingH = r2(entitlementHR + carryoverH - usedHR);
    return {
        entitlement: entitlementR, carryover, used: usedR, remaining,
        entitlementH: entitlementHR,
        carryoverH,
        usedH: usedHR,
        remainingH
    };
}

// ── AUFGABEN ─────────────────────────────────────────
async function loadTasks() {
    const archiveContainerCleanup = document.getElementById('tasks-archive');
    if (archiveContainerCleanup) archiveContainerCleanup.innerHTML = '';
    await loadTaskTemplates();
    const { data: tasks } = await db
        .from('tasks')
        .select('*, task_steps(*)')
        .eq('user_id', adminSession.user.id)
        .eq('is_archived', false)
        .order('created_at', { ascending: false });

    const { data: archivedTasks } = await db
        .from('tasks')
        .select('*, task_steps(*)')
        .eq('user_id', adminSession.user.id)
        .eq('is_archived', true)
        .order('created_at', { ascending: false });

    const container = document.getElementById('tasks-list');
    if (!tasks || tasks.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Aufgaben vorhanden.</p></div>';
        return;
    }

    container.innerHTML = tasks.map(t => {
        const steps = t.task_steps || [];
        const done = steps.filter(s => s.is_done).length;
        const total = steps.length;
        const progress = total > 0 ? Math.round((done / total) * 100) : 0;

        return `
            <div style="background:var(--color-gray); border-radius:14px; margin-bottom:1rem; overflow:hidden;">
                <div style="display:flex; justify-content:space-between; align-items:center; padding:1rem 1.25rem; cursor:pointer;" onclick="toggleTask('${t.id}')">
                    <div>
                        <div style="font-weight:700; font-size:1rem;">${t.title}</div>
                        <div style="font-size:0.8rem; color:var(--color-text-light); margin-top:0.2rem;">${done}/${total} Schritte erledigt</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:1rem;">
                        <div style="font-weight:700; color:${progress === 100 ? 'var(--color-green)' : 'var(--color-primary)'};">${progress}%</div>
                        <span id="task-toggle-${t.id}" style="color:var(--color-text-light);">▶</span>
                    </div>
                </div>
                <div id="task-body-${t.id}" style="display:none; padding:0 1.25rem 1rem; background:white; border-top:1px solid var(--color-border);" onclick="event.stopPropagation()">
                    <div id="task-steps-${t.id}" style="margin-top:0.75rem;">
                        ${steps.sort((a,b) => a.position - b.position).map((s, idx) => `
                            <div style="display:flex; align-items:center; gap:0.5rem; padding:0.4rem 0; border-bottom:1px solid var(--color-border);">
                                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                                    ${idx > 0 ? `<button class="btn-small btn-pdf-view btn-icon" style="width:1.8rem; height:1.8rem;" onclick="moveStep('${s.id}', '${t.id}', -1)">
                                        <svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
                                    </button>` : `<div style="width:1.8rem; height:1.8rem;"></div>`}
                                    ${idx < steps.length - 1 ? `<button class="btn-small btn-pdf-view btn-icon" style="width:1.8rem; height:1.8rem;" onclick="moveStep('${s.id}', '${t.id}', 1)">
                                        <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
                                    </button>` : `<div style="width:1.8rem; height:1.8rem;"></div>`}
                                </div>
                                <input type="checkbox" ${s.is_done ? 'checked' : ''} onchange="toggleStep('${s.id}', this.checked, '${t.id}')" onclick="event.stopPropagation()" style="width:auto; cursor:pointer;">
                                <span style="flex:1; min-width:0; word-break:break-word; ${s.is_done ? 'text-decoration:line-through; color:var(--color-text-light);' : ''}">${s.title}</span>
                                <button class="btn-small btn-pdf-view btn-icon" onclick="editStep('${s.id}', \`${s.title.replace(/`/g, '\\`')}\`, '${t.id}')" style="width:2rem; height:2rem; flex-shrink:0;">
                                    <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                                <button class="btn-small btn-pdf-view btn-icon" onclick="deleteStep('${s.id}', '${t.id}')" style="width:2rem; height:2rem; flex-shrink:0;">
                                    <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                                </button>
                            </div>
                        `).join('')}
                    </div>
                    <div style="display:flex; gap:0.5rem; margin-top:0.75rem;">
                        <input type="text" id="new-step-${t.id}" placeholder="Neuer Schritt..." style="flex:1; padding:0.5rem; border-radius:8px; border:1px solid var(--color-border); font-size:0.85rem;">
                        <button class="btn-small btn-pdf-view btn-icon" onclick="addStep('${t.id}')">
                            <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        </button>
                    </div>
                    <button onclick="archiveTask('${t.id}')" style="margin-top:0.75rem; background:none; border:none; color:var(--color-primary); font-size:0.85rem; cursor:pointer; font-weight:600;">✓ Archivieren</button>
                    <button onclick="deleteTask('${t.id}')" style="margin-top:0.5rem; margin-left:1rem; background:none; border:none; color:var(--color-text-light); font-size:0.8rem; cursor:pointer;">🗑 Aufgabe löschen</button>
                </div>
            </div>`;
    }).join('');

    // Archiv
    const archiveHtml = (archivedTasks || []).map(t => {
        const steps = t.task_steps || [];
        const done = steps.filter(s => s.is_done).length;
        const total = steps.length;
        return `
        <div style="background:var(--color-gray); border-radius:14px; margin-bottom:0.75rem; overflow:hidden; opacity:0.7;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:1rem 1.25rem; cursor:pointer;" onclick="toggleTask('${t.id}')">
                <div>
                    <div style="font-weight:700; font-size:1rem;">${t.title}</div>
                    <div style="font-size:0.8rem; color:var(--color-text-light); margin-top:0.2rem;">${done}/${total} Schritte erledigt</div>
                </div>
                <div style="display:flex; align-items:center; gap:1rem;">
                    <span style="font-size:0.75rem; color:var(--color-text-light);">Archiviert</span>
                    <span id="task-toggle-${t.id}" style="color:var(--color-text-light);">▶</span>
                </div>
            </div>
            <div id="task-body-${t.id}" style="display:none; padding:0 1.25rem 1rem; background:white; border-top:1px solid var(--color-border);">
                <div style="margin-top:0.75rem;">
                    ${steps.sort((a,b) => a.position - b.position).map(s => `
                        <div style="display:flex; align-items:center; gap:0.75rem; padding:0.4rem 0; border-bottom:1px solid var(--color-border);">
                            <input type="checkbox" ${s.is_done ? 'checked' : ''} disabled style="width:auto;">
                            <span style="${s.is_done ? 'text-decoration:line-through; color:var(--color-text-light);' : ''}">${s.title}</span>
                        </div>
                    `).join('')}
                </div>
                <button onclick="unarchiveTask('${t.id}')" style="margin-top:0.75rem; background:none; border:none; color:var(--color-primary); font-size:0.85rem; cursor:pointer; font-weight:600;">↩ Wiederherstellen</button>
                <button onclick="deleteTask('${t.id}')" style="margin-top:0.5rem; margin-left:1rem; background:none; border:none; color:var(--color-text-light); font-size:0.8rem; cursor:pointer;">🗑 Löschen</button>
            </div>
        </div>`;
    }).join('');

    const archiveContainer = document.getElementById('tasks-archive');
    if (archiveContainer) {
        archiveContainer.innerHTML = '';
        if (archivedTasks && archivedTasks.length > 0) {
            archiveContainer.innerHTML = `
        <div>
            <div style="font-size:0.85rem; font-weight:700; color:var(--color-text-light); letter-spacing:0.05em; margin-bottom:0.75rem; cursor:pointer; display:flex; justify-content:space-between;" onclick="toggleArchive()">
                <span>ARCHIV (${archivedTasks.length})</span>
                <span id="tasks-archive-toggle">▶</span>
            </div>
            <div id="tasks-archive-list" style="display:none;">${archiveHtml}</div>
        </div>`;
        }
    }

    // Offene Tasks wiederherstellen
    openTaskIds.forEach(taskId => {
        const body = document.getElementById(`task-body-${taskId}`);
        const toggle = document.getElementById(`task-toggle-${taskId}`);
        if (body) {
            body.style.display = 'block';
            toggle.textContent = '▼';
        }
    });
}

async function archiveTask(taskId) {
    await db.from('tasks').update({ is_archived: true }).eq('id', taskId);
    openTaskIds.delete(taskId);
    await loadTasks();
}

async function unarchiveTask(taskId) {
    await db.from('tasks').update({ is_archived: false }).eq('id', taskId);
    await loadTasks();
}

function toggleArchive() {
    const list = document.getElementById('tasks-archive-list');
    const toggle = document.getElementById('tasks-archive-toggle');
    const isOpen = list.style.display === 'block';
    list.style.display = isOpen ? 'none' : 'block';
    toggle.textContent = isOpen ? '▶' : '▼';
}

async function moveStep(stepId, taskId, direction) {
    const { data: steps } = await db.from('task_steps').select('id, position').eq('task_id', taskId).order('position', { ascending: true });
    if (!steps) return;

    const idx = steps.findIndex(s => s.id === stepId);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= steps.length) return;

    const posA = steps[idx].position;
    const posB = steps[swapIdx].position;

    await db.from('task_steps').update({ position: posB }).eq('id', steps[idx].id);
    await db.from('task_steps').update({ position: posA }).eq('id', steps[swapIdx].id);

    await loadTasks();
}

async function deleteStep(stepId, taskId) {
    if (!confirm('Schritt löschen?')) return;
    await db.from('task_steps').delete().eq('id', stepId);
    await loadTasks();
}

async function editStep(stepId, currentTitle, taskId) {
    const newTitle = prompt('Schritt bearbeiten:', currentTitle);
    if (!newTitle || !newTitle.trim() || newTitle.trim() === currentTitle) return;
    await db.from('task_steps').update({ title: newTitle.trim() }).eq('id', stepId);
    await loadTasks();
}

async function insertStepAfter(taskId, afterPosition) {
    const title = prompt('Neuer Schritt:');
    if (!title || !title.trim()) return;

    // Alle Schritte nach dieser Position um 1 erhöhen
    const { data: steps } = await db.from('task_steps').select('id, position').eq('task_id', taskId).gt('position', afterPosition);
    for (const s of steps || []) {
        await db.from('task_steps').update({ position: s.position + 1 }).eq('id', s.id);
    }
    await db.from('task_steps').insert({
        user_id: adminSession.user.id,
        task_id: taskId,
        title: title.trim(),
        position: afterPosition + 1
    });
    await loadTasks();
}

function toggleTask(taskId) {
    const body = document.getElementById(`task-body-${taskId}`);
    const toggle = document.getElementById(`task-toggle-${taskId}`);
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    toggle.textContent = isOpen ? '▶' : '▼';
    if (isOpen) {
        openTaskIds.delete(taskId);
    } else {
        openTaskIds.add(taskId);
    }
}

async function toggleStep(stepId, isDone, taskId) {
    await db.from('task_steps').update({ is_done: isDone }).eq('id', stepId);
    await loadTasks();
    // Body wieder öffnen
    const body = document.getElementById(`task-body-${taskId}`);
    const toggle = document.getElementById(`task-toggle-${taskId}`);
    if (body) { body.style.display = 'block'; toggle.textContent = '▼'; }
}

async function addStep(taskId) {
    const input = document.getElementById(`new-step-${taskId}`);
    const title = input.value.trim();
    if (!title) return;

    const { data: steps } = await db.from('task_steps').select('position').eq('task_id', taskId).order('position', { ascending: false }).limit(1);
    const nextPos = steps && steps.length > 0 ? steps[0].position + 1 : 0;

    await db.from('task_steps').insert({
        user_id: adminSession.user.id,
        task_id: taskId,
        title,
        position: nextPos
    });
    await loadTasks();
}

async function deleteTask(taskId) {
    if (!confirm('Aufgabe wirklich löschen?')) return;
    await db.from('tasks').delete().eq('id', taskId);
    await loadTasks();
}

async function openNewTaskModal() {
    document.getElementById('new-task-title').value = '';
    document.getElementById('new-task-error').style.display = 'none';

    // Vorlagen laden für Dropdown
    const { data: templates } = await db
        .from('task_templates')
        .select('id, title')
        .eq('user_id', adminSession.user.id)
        .order('title');

    const select = document.getElementById('new-task-template-id');
    select.innerHTML = '<option value="">— Keine Vorlage —</option>';
    if (templates) {
        select.innerHTML += templates.map(t =>
            `<option value="${t.id}">${t.title}</option>`
        ).join('');
    }

    document.getElementById('new-task-modal').classList.add('active');
}

function closeNewTaskModal() {
    document.getElementById('new-task-modal').classList.remove('active');
}

async function submitNewTask() {
    const title = document.getElementById('new-task-title').value.trim();
    const templateId = document.getElementById('new-task-template-id').value;
    const errorDiv = document.getElementById('new-task-error');
    errorDiv.style.display = 'none';

    if (!title) {
        errorDiv.textContent = 'Bitte Titel eingeben.';
        errorDiv.style.display = 'block';
        return;
    }

    const { data: task, error } = await db.from('tasks').insert({
        user_id: adminSession.user.id,
        title
    }).select().maybeSingle();

    if (error || !task) return;

    // Wenn Vorlage gewählt — Schritte kopieren
    if (templateId) {
        const { data: templateSteps } = await db
            .from('task_template_steps')
            .select('*')
            .eq('template_id', templateId)
            .order('position');

        if (templateSteps && templateSteps.length > 0) {
            await db.from('task_steps').insert(
                templateSteps.map(s => ({
                    user_id: adminSession.user.id,
                    task_id: task.id,
                    title: s.title,
                    position: s.position
                }))
            );
        }
    }

    closeNewTaskModal();
    await loadTasks();
}

// ── VORLAGEN ─────────────────────────────────────────
let newTemplateSteps = [];

function openNewTemplateModal() {
    document.getElementById('new-template-title').value = '';
    document.getElementById('new-template-error').style.display = 'none';
    newTemplateSteps = [];
    renderTemplateSteps();
    document.getElementById('new-template-modal').classList.add('active');
}

function closeNewTemplateModal() {
    document.getElementById('new-template-modal').classList.remove('active');
}

function addTemplateStep() {
    const input = document.getElementById('new-template-step-input');
    const title = input.value.trim();
    if (!title) return;
    newTemplateSteps.push(title);
    input.value = '';
    renderTemplateSteps();
}

function removeTemplateStep(index) {
    newTemplateSteps.splice(index, 1);
    renderTemplateSteps();
}

function renderTemplateSteps() {
    const container = document.getElementById('template-steps-list');
    if (newTemplateSteps.length === 0) {
        container.innerHTML = '<div style="font-size:0.85rem; color:var(--color-text-light);">Noch keine Schritte.</div>';
        return;
    }
    container.innerHTML = newTemplateSteps.map((s, i) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0; border-bottom:1px solid var(--color-border); font-size:0.85rem;">
            <span>${i + 1}. ${s}</span>
            <button onclick="removeTemplateStep(${i})" style="background:none; border:none; color:var(--color-text-light); cursor:pointer;">✕</button>
        </div>
    `).join('');
}

async function submitNewTemplate() {
    const title = document.getElementById('new-template-title').value.trim();
    const errorDiv = document.getElementById('new-template-error');
    errorDiv.style.display = 'none';

    if (!title) {
        errorDiv.textContent = 'Bitte Name eingeben.';
        errorDiv.style.display = 'block';
        return;
    }

    if (newTemplateSteps.length === 0) {
        errorDiv.textContent = 'Bitte mindestens einen Schritt hinzufügen.';
        errorDiv.style.display = 'block';
        return;
    }

    const { data: template, error } = await db.from('task_templates').insert({
        user_id: adminSession.user.id,
        title
    }).select().maybeSingle();

    if (error || !template) return;

    await db.from('task_template_steps').insert(
        newTemplateSteps.map((s, i) => ({
            user_id: adminSession.user.id,
            template_id: template.id,
            title: s,
            position: i
        }))
    );

    closeNewTemplateModal();
    await loadTasks();
}

async function loadTaskTemplates() {
    const { data: templates } = await db
        .from('task_templates')
        .select('*, task_template_steps(*)')
        .eq('user_id', adminSession.user.id)
        .order('created_at', { ascending: false });

    const container = document.getElementById('templates-list');
    if (!templates || templates.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Vorlagen vorhanden.</p></div>';
        return;
    }

    container.innerHTML = templates.map(t => {
        const steps = (t.task_template_steps || []).sort((a, b) => a.position - b.position);
        return `
            <div style="background:var(--color-gray); border-radius:12px; padding:1rem 1.25rem; margin-bottom:0.75rem; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:700;">${t.title}</div>
                    <div style="font-size:0.8rem; color:var(--color-text-light);">${steps.length} Schritte</div>
                </div>
                <div style="display:flex; gap:0.5rem;">
                    <button class="btn-small btn-pdf-view btn-icon" onclick="editTaskTemplate('${t.id}')">
                        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-small btn-delete btn-icon" onclick="deleteTemplate('${t.id}')">
                        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>
                </div>
            </div>`;
    }).join('');
}

async function deleteTemplate(templateId) {
    if (!confirm('Vorlage wirklich löschen?')) return;
    await db.from('task_templates').delete().eq('id', templateId);
    await loadTasks();
}

function useTemplate(templateId, templateTitle) {
    document.getElementById('new-task-title').value = templateTitle;
    document.getElementById('new-task-template-id').value = templateId;
    document.getElementById('new-task-error').style.display = 'none';
    document.getElementById('new-task-modal').classList.add('active');
}

let editTemplateSteps = [];

async function editTaskTemplate(templateId) {
    editTemplateId = templateId;
    const { data: template } = await db
        .from('task_templates')
        .select('*, task_template_steps(*)')
        .eq('id', templateId)
        .maybeSingle();

    if (!template) return;

    document.getElementById('edit-template-title').value = template.title;
    editTemplateSteps = (template.task_template_steps || [])
        .sort((a, b) => a.position - b.position)
        .map(s => ({ id: s.id, title: s.title }));
    renderEditTemplateSteps();
    document.getElementById('edit-task-template-modal').classList.add('active');
}

function closeEditTaskTemplateModal() {
    document.getElementById('edit-task-template-modal').classList.remove('active');
}

function renderEditTemplateSteps() {
    const container = document.getElementById('edit-template-steps-list');
    if (editTemplateSteps.length === 0) {
        container.innerHTML = '<div style="font-size:0.85rem; color:var(--color-text-light); margin-bottom:0.5rem;">Noch keine Schritte.</div>';
        return;
    }
    container.innerHTML = editTemplateSteps.map((s, i) => `
        <div style="display:flex; align-items:center; gap:0.5rem; padding:0.4rem 0; border-bottom:1px solid var(--color-border);">
            <div style="display:flex; flex-direction:column; gap:0.2rem;">
                ${i > 0 ? `<button class="btn-small btn-pdf-view btn-icon" style="width:1.8rem; height:1.8rem;" onclick="moveTemplateStep(${i}, -1)">
                    <svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
                </button>` : `<div style="width:1.8rem; height:1.8rem;"></div>`}
                ${i < editTemplateSteps.length - 1 ? `<button class="btn-small btn-pdf-view btn-icon" style="width:1.8rem; height:1.8rem;" onclick="moveTemplateStep(${i}, 1)">
                    <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
                </button>` : `<div style="width:1.8rem; height:1.8rem;"></div>`}
            </div>
            <span style="flex:1; font-size:0.85rem; word-break:break-word;">${s.title}</span>
            <button class="btn-small btn-pdf-view btn-icon" style="width:2rem; height:2rem; flex-shrink:0;" onclick="editTemplateStep(${i})">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-small btn-pdf-view btn-icon" style="width:2rem; height:2rem; flex-shrink:0;" onclick="removeEditTemplateStep(${i})">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
        </div>
    `).join('');
}

function moveTemplateStep(index, direction) {
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= editTemplateSteps.length) return;
    const temp = editTemplateSteps[index];
    editTemplateSteps[index] = editTemplateSteps[swapIndex];
    editTemplateSteps[swapIndex] = temp;
    renderEditTemplateSteps();
}

function editTemplateStep(index) {
    const newTitle = prompt('Schritt bearbeiten:', editTemplateSteps[index].title);
    if (!newTitle || !newTitle.trim()) return;
    editTemplateSteps[index].title = newTitle.trim();
    renderEditTemplateSteps();
}

function addEditTemplateStep() {
    const input = document.getElementById('edit-template-step-input');
    const title = input.value.trim();
    if (!title) return;
    editTemplateSteps.push({ id: null, title });
    input.value = '';
    renderEditTemplateSteps();
}

function removeEditTemplateStep(index) {
    editTemplateSteps.splice(index, 1);
    renderEditTemplateSteps();
}

async function submitEditTaskTemplate() {
    const title = document.getElementById('edit-template-title').value.trim();
    if (!title) return;

    await db.from('task_templates').update({ title }).eq('id', editTemplateId);

    // Alle alten Schritte löschen und neu einfügen
    await db.from('task_template_steps').delete().eq('template_id', editTemplateId);
    if (editTemplateSteps.length > 0) {
        await db.from('task_template_steps').insert(
            editTemplateSteps.map((s, i) => ({
                user_id: adminSession.user.id,
                template_id: editTemplateId,
                title: s.title,
                position: i
            }))
        );
    }

    closeEditTaskTemplateModal();
    await loadTasks();
}

function updateEditTemplateStep(index, value) {
    editTemplateSteps[index].title = value;
}

// ── NOTIZEN ─────────────────────────────────────────
let editNoteId = null;

async function loadNotes() {
    const { data: notes } = await db
        .from('notes')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .order('updated_at', { ascending: false });

    const container = document.getElementById('notes-list');
    if (!notes || notes.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Notizen vorhanden.</p></div>';
        return;
    }

    container.innerHTML = notes.map(n => `
        <div style="background:var(--color-gray); border-radius:12px; padding:1rem 1.25rem; margin-bottom:0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem;">
                <div style="font-weight:700; font-size:1rem;">${n.title}</div>
                <div style="display:flex; gap:0.5rem;">
                    <button class="btn-small btn-pdf-view btn-icon" onclick="openEditNoteModal('${n.id}', \`${n.title.replace(/`/g, '\\`')}\`, \`${(n.content || '').replace(/`/g, '\\`')}\`)">
                        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-small btn-delete btn-icon" onclick="deleteNote('${n.id}')">
                        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>
                </div>
            </div>
            <div style="font-size:0.85rem; color:var(--color-text-light); white-space:pre-wrap;">${n.content || ''}</div>
            <div style="font-size:0.75rem; color:var(--color-text-light); margin-top:0.5rem;">${new Date(n.updated_at).toLocaleDateString('de-DE')}</div>
        </div>
    `).join('');
}

function openNewNoteModal() {
    editNoteId = null;
    document.getElementById('note-modal-title').textContent = 'Neue Notiz';
    document.getElementById('note-title').value = '';
    document.getElementById('note-content').value = '';
    document.getElementById('note-error').style.display = 'none';
    document.getElementById('note-modal').classList.add('active');
}

function openEditNoteModal(id, title, content) {
    editNoteId = id;
    document.getElementById('note-modal-title').textContent = 'Notiz bearbeiten';
    document.getElementById('note-title').value = title;
    document.getElementById('note-content').value = content;
    document.getElementById('note-error').style.display = 'none';
    document.getElementById('note-modal').classList.add('active');
}

function closeNoteModal() {
    document.getElementById('note-modal').classList.remove('active');
}

async function submitNote() {
    const title = document.getElementById('note-title').value.trim();
    const content = document.getElementById('note-content').value.trim();
    const errorDiv = document.getElementById('note-error');
    errorDiv.style.display = 'none';

    if (!title) {
        errorDiv.textContent = 'Bitte Titel eingeben.';
        errorDiv.style.display = 'block';
        return;
    }

    if (editNoteId) {
        await db.from('notes').update({
            title, content,
            updated_at: new Date().toISOString()
        }).eq('id', editNoteId);
    } else {
        await db.from('notes').insert({
            user_id: adminSession.user.id,
            title, content
        });
    }

    closeNoteModal();
    await loadNotes();
}

async function deleteNote(id) {
    if (!confirm('Notiz wirklich löschen?')) return;
    await db.from('notes').delete().eq('id', id);
    await loadNotes();
}

async function updateShiftCell(employeeId, dateStr) {
    const { data: shifts } = await db
        .from('shifts')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .eq('shift_date', dateStr);

    const weekHolidays = getBWHolidays(new Date(dateStr).getFullYear());
    const sickLeaves = [];

    if (employeeId) {
        // Alle Zellen dieses Mitarbeiters an diesem Tag (eine pro Abteilung)
        const cells = document.querySelectorAll(`[data-cell="${employeeId}_${dateStr}"]`);
        if (!cells.length) { await loadWeekGrid(); return; }

        const empShifts = (shifts || []).filter(s => s.employee_id === employeeId && !s.is_open);

        cells.forEach(cell => {
            const cellDept = cell.dataset.dept;
            const shift = empShifts.find(s => s.department === cellDept || (!s.department && !cellDept));
            cell.className = 'week-cell' + (shift ? ' has-shift' : '');
            cell.style.whiteSpace = 'pre';
            cell.style.position = 'relative';
            cell.style.background = '';
            cell.style.color = '';
            cell.style.fontSize = '';
            cell.innerHTML = '';
            if (shift) {
                cell.textContent = `${shift.start_time.slice(0,5)}\n${shift.end_time.slice(0,5)}`;
                if (shift.actual_start_time) {
                    cell.style.background = '#E8D4A0';
                }
            } else {
                cell.textContent = '+';
            }
            cell.onclick = () => openShiftModal(employeeId, dateStr, shift || null, cellDept);
        });
    } else {
        // Offene Schicht
        await loadWeekGrid();
    }
}

function changeTrinkgeldMonth(dir) {
    trinkgeldDate.setMonth(trinkgeldDate.getMonth() + dir);
    loadTrinkgeld();
}

async function loadTrinkgeld() {
    const year = trinkgeldDate.getFullYear();
    const month = trinkgeldDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const label = trinkgeldDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    document.getElementById('trinkgeld-month-label').textContent = label;

    const firstDay = `${monthStr}-01`;
    const lastDay = new Date(year, month + 1, 0).toISOString().split('T')[0];
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Alle Daten laden
    const [
        { data: entries },
        { data: depts },
        { data: monthShifts },
        { data: sickLeaves },
    ] = await Promise.all([
        db.from('tip_entries').select('*').eq('user_id', adminSession.user.id).gte('entry_date', firstDay).lte('entry_date', lastDay).order('entry_date', { ascending: false }),
        db.from('tip_departments').select('*').eq('user_id', adminSession.user.id),
        db.from('shifts').select('employee_id,shift_date,start_time,end_time,break_minutes,actual_start_time,actual_end_time,actual_break_minutes,department').eq('user_id', adminSession.user.id).eq('is_open', false).gte('shift_date', firstDay).lte('shift_date', lastDay),
        db.from('sick_leaves').select('employee_id,start_date,end_date').eq('user_id', adminSession.user.id).lte('start_date', lastDay).gte('end_date', firstDay),
    ]);

    // Schichten in tip_hours synchronisieren (eine Zeile pro Schicht/Abteilung)
    const tipHoursRows = [];
    for (const shift of (monthShifts || [])) {
        if (!shift.employee_id) continue;
        const d = shift.shift_date;
        if ((sickLeaves || []).some(s => s.employee_id === shift.employee_id && s.start_date <= d && s.end_date >= d)) continue;
        const startStr = shift.actual_start_time || shift.start_time;
        const endStr = shift.actual_end_time || shift.end_time;
        const breakMin = shift.actual_break_minutes ?? shift.break_minutes ?? 0;
        const [sh, sm] = startStr.split(':').map(Number);
        const [eh, em] = endStr.split(':').map(Number);
        const minutes = (eh * 60 + em) - (sh * 60 + sm) - breakMin;
        if (minutes <= 0) continue;
        tipHoursRows.push({ user_id: adminSession.user.id, employee_id: shift.employee_id, work_date: d, minutes, department: shift.department || null });
    }
    if (tipHoursRows.length > 0) {
        await db.from('tip_hours').upsert(tipHoursRows, { onConflict: 'user_id,employee_id,work_date,department' });
    }

    const { data: tipHours } = await db.from('tip_hours').select('*, employees_planit(name, department)').eq('user_id', adminSession.user.id).gte('work_date', firstDay).lte('work_date', lastDay);
    // Fehlende Tage des Monats in tip_entries anlegen
    const existingDates = new Set((entries || []).map(e => e.entry_date));
    const toInsert = [];
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
        if (!existingDates.has(dateStr)) {
            toInsert.push({ user_id: adminSession.user.id, entry_date: dateStr, amount_card: 0, amount_cash: 0 });
        }
    }
    if (toInsert.length > 0) {
        await db.from('tip_entries').upsert(toInsert, { onConflict: 'user_id,entry_date' });
        toInsert.forEach(e => (entries || []).push(e));
    }

    // Alle Tage des Monats aufsteigend
    const allDates = [];
    for (let d = 1; d <= daysInMonth; d++) {
        allDates.push(`${monthStr}-${String(d).padStart(2, '0')}`);
    }

    // Pool-Abteilungen: monatliche Gesamtstunden + Monatsanteile pro Mitarbeiter (für täglichen Durchschnitt)
    const poolDeptMonthMinutes = {};
    const poolEmpMonthShares = {}; // dept.department → { empId: share (0–1) }
    for (const dept of (depts || [])) {
        if (!dept.pool_department) continue;
        const deptHours = (tipHours || []).filter(h => (h.department || h.employees_planit.department) === dept.department);
        const totalMins = deptHours.reduce((sum, h) => sum + h.minutes, 0);
        poolDeptMonthMinutes[dept.department] = totalMins;
        // Monatlichen Anteil pro Mitarbeiter berechnen
        const empTotals = {};
        for (const h of deptHours) {
            empTotals[h.employee_id] = (empTotals[h.employee_id] || 0) + h.minutes;
        }
        poolEmpMonthShares[dept.department] = {};
        if (totalMins > 0) {
            for (const [empId, mins] of Object.entries(empTotals)) {
                poolEmpMonthShares[dept.department][empId] = mins / totalMins;
            }
        }
    }

    // Pro Tag berechnen
    const empMonthTotals = {};
    const dayResults = {};

    for (const dateStr of allDates) {
        const dayEntry = (entries || []).find(e => e.entry_date === dateStr);
        const dayCard = dayEntry ? parseFloat(dayEntry.amount_card) : 0;
        const dayCash = dayEntry ? parseFloat(dayEntry.amount_cash) : 0;
        const dayHours = (tipHours || []).filter(h => h.work_date === dateStr);
        dayResults[dateStr] = { card: dayCard, cash: dayCash, hours: dayHours, empResults: {} };

        if (dayCard === 0 && dayCash === 0 && dayHours.length === 0) continue;
        if (!depts || depts.length === 0) continue;

        for (const dept of depts) {
            if (dept.pool_department) continue; // Pool-Abteilungen werden über ihren Haupt-Pool verrechnet
            const deptDayCard = dayCard * (dept.percentage / 100);
            const deptDayCash = dayCash * (dept.percentage / 100);

            // Pool-Abteilungen die diesem Dept zugeordnet sind (z.B. Bäckerei → Küche)
            const poolDepts = depts.filter(d => d.pool_department === dept.department);

            const empDayMinutes = {};
            let totalDeptMinutes = 0;
            for (const h of dayHours) {
                const hDept = h.department || h.employees_planit.department;
                if (hDept !== dept.department) continue;
                empDayMinutes[h.employee_id] = (empDayMinutes[h.employee_id] || 0) + h.minutes;
                totalDeptMinutes += h.minutes;
            }

            // Täglichen Durchschnitt der Pool-Abteilungen addieren
            const poolDailyAvg = {};
            for (const poolDept of poolDepts) {
                const avg = (poolDeptMonthMinutes[poolDept.department] || 0) / daysInMonth;
                poolDailyAvg[poolDept.department] = avg;
                totalDeptMinutes += avg;
            }

            if (totalDeptMinutes === 0) continue;

            // Echte Mitarbeiter dieser Abteilung
            for (const [empId, minutes] of Object.entries(empDayMinutes)) {
                const share = minutes / totalDeptMinutes;
                const key = empId + '__' + dept.department;
                if (!dayResults[dateStr].empResults[key]) dayResults[dateStr].empResults[key] = { empId, dept: dept.department, card: 0, cash: 0 };
                dayResults[dateStr].empResults[key].card += deptDayCard * share;
                dayResults[dateStr].empResults[key].cash += deptDayCash * share;
                if (!empMonthTotals[empId]) empMonthTotals[empId] = { card: 0, cash: 0 };
                empMonthTotals[empId].card += deptDayCard * share;
                empMonthTotals[empId].cash += deptDayCash * share;
            }

            // Pool-Anteil auf individuelle Pool-Mitarbeiter nach monatlichem Anteil verteilen (tägl. Durchschnitt)
            for (const poolDept of poolDepts) {
                const poolShare = poolDailyAvg[poolDept.department] / totalDeptMinutes;
                const poolDayCard = deptDayCard * poolShare;
                const poolDayCash = deptDayCash * poolShare;
                const shares = poolEmpMonthShares[poolDept.department] || {};
                for (const [empId, empShare] of Object.entries(shares)) {
                    const key = empId + '__' + poolDept.department;
                    if (!dayResults[dateStr].empResults[key]) dayResults[dateStr].empResults[key] = { empId, dept: poolDept.department, card: 0, cash: 0 };
                    dayResults[dateStr].empResults[key].card += poolDayCard * empShare;
                    dayResults[dateStr].empResults[key].cash += poolDayCash * empShare;
                    if (!empMonthTotals[empId]) empMonthTotals[empId] = { card: 0, cash: 0 };
                    empMonthTotals[empId].card += poolDayCard * empShare;
                    empMonthTotals[empId].cash += poolDayCash * empShare;
                }
            }
        }
    }

    // Tage rendern
    const daysContainer = document.getElementById('trinkgeld-days-list');
    if (allDates.length === 0) {
        daysContainer.innerHTML = '<div class="empty-state"><p>Keine Einträge vorhanden.</p></div>';
    } else {
        daysContainer.innerHTML = allDates.map(dateStr => {
            const d = dayResults[dateStr];
            const dateLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
            const total = (d.card + d.cash).toFixed(2);

            // Nach Abteilung gruppieren
            const getEmpName = (empId) => {
                const fromHours = (tipHours || []).find(h => h.employee_id === empId);
                if (fromHours) return fromHours.employees_planit.name;
                const fromEmp = employees.find(e => e.id === empId);
                return fromEmp ? fromEmp.name : empId;
            };
            const empResultsSorted = Object.values(d.empResults).sort((a, b) => {
                const deptCmp = (a.dept || 'zzz').localeCompare(b.dept || 'zzz');
                if (deptCmp !== 0) return deptCmp;
                return getEmpName(a.empId).localeCompare(getEmpName(b.empId));
            });

            let lastDept = null;
            const empRows = empResultsSorted.map(r => {
                const name = getEmpName(r.empId);
                const currentDept = r.dept;
                let deptHeader = '';
                if (currentDept && currentDept !== lastDept) {
                    lastDept = currentDept;
                    deptHeader = `<div style="font-size:0.75rem; font-weight:700; color:var(--color-primary); padding:0.4rem 0 0.2rem; letter-spacing:0.05em;">${currentDept.toUpperCase()}</div>`;
                }
                const isPoolDept = (depts || []).find(pd => pd.department === currentDept && pd.pool_department);
                let hoursDisplay = '';
                if (isPoolDept) {
                    const avgMins = (poolDeptMonthMinutes[currentDept] || 0) / daysInMonth;
                    if (avgMins > 0) hoursDisplay = `⌀ ${Math.floor(avgMins/60)}h ${String(Math.round(avgMins%60)).padStart(2,'0')}m`;
                } else {
                    const hours = d.hours.find(h => h.employee_id === r.empId && (h.department === currentDept || (!h.department && !currentDept)));
                    if (hours) hoursDisplay = `${Math.floor(hours.minutes/60)}h ${String(hours.minutes%60).padStart(2,'0')}m`;
                }
                return `${deptHeader}
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.85rem; padding:0.3rem 0; border-bottom:1px solid var(--color-border);">
                    <span>${name}</span>
                    <div style="display:flex; align-items:center; gap:1rem;">
                        ${hoursDisplay ? `<span style="color:var(--color-text-light);">${hoursDisplay}</span>` : ''}
                        <span style="font-weight:600; min-width:4rem; text-align:right;">${(r.card + r.cash).toFixed(2)} €</span>
                    </div>
                </div>`;
            }).join('');

            return `
            <div style="background:var(--color-gray); border-radius:12px; margin-bottom:0.75rem; overflow:hidden;">
                <div style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem 1rem; cursor:pointer;" onclick="toggleTrinkgeldDay('${dateStr}')">
                    <div style="font-weight:600;">${dateLabel}</div>
                    <div style="display:flex; align-items:center; gap:0.75rem;">
                        <span style="font-size:0.85rem; color:var(--color-primary); font-weight:700;">${total} €</span>
                        <button class="btn-small btn-pdf-view btn-icon" style="width:1.8rem; height:1.8rem;" onclick="event.stopPropagation(); openTrinkgeldDayModal('${dateStr}')">
                            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="btn-small btn-pdf-view btn-icon" style="width:1.8rem; height:1.8rem;" onclick="event.stopPropagation(); deleteTrinkgeldDay('${dateStr}')">
                            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                        </button>
                        <span id="trinkgeld-day-toggle-${dateStr}" style="color:var(--color-text-light);">▶</span>
                    </div>
                </div>
                <div id="trinkgeld-day-body-${dateStr}" style="display:none; padding:0.5rem 1rem 0.75rem; background:white; border-top:1px solid var(--color-border);">
                    <div style="display:flex; gap:1rem; margin-bottom:0.5rem; font-size:0.8rem; color:var(--color-text-light);">
                        <span>Karte: ${d.card.toFixed(2)} €</span>
                        <span>Bar: ${d.cash.toFixed(2)} €</span>
                    </div>
                    ${empRows || '<div style="font-size:0.85rem; color:var(--color-text-light);">Keine Stunden eingetragen.</div>'}
                </div>
            </div>`;
        }).join('');
    }

    // Zusammenfassung rendern
    const resultsContainer = document.getElementById('trinkgeld-results');
    if (Object.keys(empMonthTotals).length === 0) {
        resultsContainer.innerHTML = '<div class="empty-state"><p>Keine Daten vorhanden.</p></div>';
    } else {
        let totalCard = 0;
        let totalCash = 0;
        (entries || []).forEach(e => { totalCard += parseFloat(e.amount_card); totalCash += parseFloat(e.amount_cash); });

        resultsContainer.innerHTML = `
            <div class="card" style="margin-bottom:0.75rem; display:flex; justify-content:space-between;">
                <div>
                    <div style="font-size:0.75rem; color:var(--color-text-light);">KARTE GESAMT</div>
                    <div style="font-weight:700;">${totalCard.toFixed(2)} €</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:var(--color-text-light);">BAR GESAMT</div>
                    <div style="font-weight:700;">${totalCash.toFixed(2)} €</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:var(--color-text-light);">GESAMT</div>
                    <div style="font-weight:700; color:var(--color-primary);">${(totalCard + totalCash).toFixed(2)} €</div>
                </div>
            </div>
            ${Object.entries(empMonthTotals).sort(([aId], [bId]) => {
                const aEmp = (tipHours || []).find(h => h.employee_id === aId);
                const bEmp = (tipHours || []).find(h => h.employee_id === bId);
                const aDept = aEmp ? aEmp.employees_planit.department : 'zzz';
                const bDept = bEmp ? bEmp.employees_planit.department : 'zzz';
                if (aDept !== bDept) return aDept.localeCompare(bDept);
                const aName = aEmp ? aEmp.employees_planit.name : aId;
                const bName = bEmp ? bEmp.employees_planit.name : bId;
                return aName.localeCompare(bName);
            }).map(([empId, totals], idx, arr) => {
            const emp = (tipHours || []).find(h => h.employee_id === empId);
            const name = emp ? emp.employees_planit.name : empId;
            const currentDept = emp ? emp.employees_planit.department : '';
            const prevEmp = idx > 0 ? (tipHours || []).find(h => h.employee_id === arr[idx-1][0]) : null;
            const prevDept = prevEmp ? prevEmp.employees_planit.department : '';
            const deptHeader = currentDept && currentDept !== prevDept ? `<div style="font-size:0.75rem; font-weight:700; color:var(--color-primary); padding:0.5rem 0 0.25rem; letter-spacing:0.05em;">${currentDept.toUpperCase()}</div>` : '';
            const empTotalMinutes = (tipHours || []).filter(h => h.employee_id === empId).reduce((sum, h) => sum + h.minutes, 0);
            const empHoursDisplay = empTotalMinutes > 0 ? `${Math.floor(empTotalMinutes/60)}h ${String(empTotalMinutes%60).padStart(2,'0')}m` : '';
            return `${deptHeader}
                                <div class="list-item">
                                    <div class="list-item-info">
                                        <h4>${name}</h4>
                                        <p>Karte: ${totals.card.toFixed(2)} € | Bar: ${totals.cash.toFixed(2)} €</p>
                                    </div>
                                    <div style="text-align:right;">
                                        <div style="font-weight:700; color:var(--color-primary);">${(totals.card + totals.cash).toFixed(2)} €</div>
                                        ${empHoursDisplay ? `<div style="font-size:0.8rem; color:var(--color-text-light);">${empHoursDisplay}</div>` : ''}
                                    </div>
                                </div>`;
            }).join('')}`;
    }
}

function toggleTrinkgeldSummary() {
    const body = document.getElementById('trinkgeld-summary');
    const toggle = document.getElementById('trinkgeld-summary-toggle');
    const isOpen = body.style.display === 'block';
    body.style.display = isOpen ? 'none' : 'block';
    toggle.textContent = isOpen ? '▶' : '▼';
}

function toggleTrinkgeldDay(dateStr) {
    const body = document.getElementById(`trinkgeld-day-body-${dateStr}`);
    const toggle = document.getElementById(`trinkgeld-day-toggle-${dateStr}`);
    const isOpen = body.style.display === 'block';
    body.style.display = isOpen ? 'none' : 'block';
    toggle.textContent = isOpen ? '▶' : '▼';
}

async function deleteTrinkgeldDay(dateStr) {
    if (!confirm(`Tag ${new Date(dateStr + 'T12:00:00').toLocaleDateString('de-DE')} löschen?`)) return;
    await db.from('tip_entries').delete().eq('user_id', adminSession.user.id).eq('entry_date', dateStr);
    await db.from('tip_hours').delete().eq('user_id', adminSession.user.id).eq('work_date', dateStr);
    loadTrinkgeld();
}

async function loadTrinkgeldConfig() {
    const { data: config } = await db
        .from('tip_config')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .maybeSingle();

    if (config) {
        document.getElementById('tip-mode').value = config.mode;
        document.getElementById('tip-show-employees').checked = config.show_to_employees;
    }

    const { data: depts } = await db
        .from('tip_departments')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .order('created_at', { ascending: true });

    renderTipDepartments(depts || []);
}

function renderTipDepartments(depts) {
    const container = document.getElementById('tip-departments-list');
    if (depts.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Abteilungen konfiguriert.</p></div>';
        return;
    }
    container.innerHTML = depts.map(d => `
        <div class="card" style="margin-bottom:0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                <div style="font-weight:600;">${d.department}</div>
                <button class="btn-small btn-pdf-view btn-icon" onclick="deleteTipDepartment('${d.id}')">
                    <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
                <div>
                    <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.25rem;">ANTEIL %</div>
                    <input type="number" value="${d.percentage}" min="0" max="100" onchange="updateTipDept('${d.id}', 'percentage', this.value)" style="padding:0.4rem; font-size:0.85rem;">
                </div>
                <div>
                    <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.25rem;">POOL (falls fix)</div>
                    <input type="text" value="${d.pool_department || ''}" placeholder="z.B. Küche" onchange="updateTipDept('${d.id}', 'pool_department', this.value)" style="padding:0.4rem; font-size:0.85rem;">
                </div>
            </div>
            <div style="margin-top:0.5rem;">
                <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.25rem;">FIX STUNDEN/MONAT (optional)</div>
                <input type="number" value="${d.fixed_hours_per_month || ''}" placeholder="z.B. 30" onchange="updateTipDept('${d.id}', 'fixed_hours_per_month', this.value)" style="padding:0.4rem; font-size:0.85rem;">
            </div>
        </div>
    `).join('');
}

async function addTipDepartment() {
    const name = prompt('Abteilungsname:');
    if (!name || !name.trim()) return;
    await db.from('tip_departments').insert({
        user_id: adminSession.user.id,
        department: name.trim(),
        percentage: 0
    });
    loadTrinkgeldConfig();
}

async function deleteTipDepartment(id) {
    if (!confirm('Abteilung löschen?')) return;
    await db.from('tip_departments').delete().eq('id', id);
    loadTrinkgeldConfig();
}

async function updateTipDept(id, field, value) {
    await db.from('tip_departments').update({ [field]: value || null }).eq('id', id);
}

async function saveTipConfig() {
    const mode = document.getElementById('tip-mode').value;
    const showToEmployees = document.getElementById('tip-show-employees').checked;
    const { error } = await db.from('tip_config').upsert({
        user_id: adminSession.user.id,
        mode,
        show_to_employees: showToEmployees
    }, { onConflict: 'user_id' });
    if (error) { alert('Fehler: ' + error.message); return; }
    alert('Gespeichert!');
}

async function openTrinkgeldDayModal(date = null) {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('trinkgeld-hours-date').value = date || today;

    if (date) {
        const { data: entry } = await db.from('tip_entries').select('*').eq('user_id', adminSession.user.id).eq('entry_date', date).maybeSingle();
        document.getElementById('trinkgeld-entry-card').value = entry ? entry.amount_card : '';
        document.getElementById('trinkgeld-entry-cash').value = entry ? entry.amount_cash : '';
        document.getElementById('trinkgeld-entry-id').value = entry ? entry.id : '';
    } else {
        document.getElementById('trinkgeld-entry-card').value = '';
        document.getElementById('trinkgeld-entry-cash').value = '';
        document.getElementById('trinkgeld-entry-id').value = '';
    }

    await loadTrinkgeldHoursEmployees(date || today);
    document.getElementById('trinkgeld-hours-modal').classList.add('active');
}

function closeTrinkgeldEntryModal() {
    document.getElementById('trinkgeld-entry-modal').classList.remove('active');
}

async function saveTrinkgeldEntry() {
    const id = document.getElementById('trinkgeld-entry-id').value;
    const date = document.getElementById('trinkgeld-entry-date').value;
    const card = parseFloat(document.getElementById('trinkgeld-entry-card').value) || 0;
    const cash = parseFloat(document.getElementById('trinkgeld-entry-cash').value) || 0;
    if (!date) { alert('Bitte Datum eingeben.'); return; }

    if (id) {
        await db.from('tip_entries').update({ entry_date: date, amount_card: card, amount_cash: cash }).eq('id', id);
    } else {
        await db.from('tip_entries').upsert({
            user_id: adminSession.user.id,
            entry_date: date,
            amount_card: card,
            amount_cash: cash
        }, { onConflict: 'user_id,entry_date' });
    }
    closeTrinkgeldEntryModal();
    loadTrinkgeld();
}

async function deleteTrinkgeldEntry() {
    const id = document.getElementById('trinkgeld-entry-id').value;
    if (!confirm('Eintrag löschen?')) return;
    await db.from('tip_entries').delete().eq('id', id);
    closeTrinkgeldEntryModal();
    loadTrinkgeld();
}

async function calculateTrinkgeld() {
    const year = trinkgeldDate.getFullYear();
    const month = trinkgeldDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const firstDay = `${monthStr}-01`;
    const lastDay = new Date(year, month + 1, 0).toISOString().split('T')[0];
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Konfiguration laden
    const { data: config } = await db.from('tip_config').select('*').eq('user_id', adminSession.user.id).maybeSingle();
    if (!config) { alert('Bitte zuerst Einstellungen konfigurieren.'); return; }

    // Abteilungen laden
    const { data: depts } = await db.from('tip_departments').select('*').eq('user_id', adminSession.user.id);
    if (!depts || depts.length === 0) { alert('Bitte Abteilungen konfigurieren.'); return; }

    // Einträge laden
    const { data: entries } = await db.from('tip_entries').select('*').eq('user_id', adminSession.user.id).gte('entry_date', firstDay).lte('entry_date', lastDay);
    if (!entries || entries.length === 0) { alert('Keine Einträge für diesen Monat.'); return; }

    // Mitarbeiter laden
    const { data: emps } = await db.from('employees_planit').select('*').eq('user_id', adminSession.user.id).eq('is_active', true);

    // Actual hours laden
    const { data: actualHours } = await db.from('actual_hours').select('*').eq('user_id', adminSession.user.id).eq('month', monthStr);

    // Urlaub/Krank laden
    const { data: vacations } = await db.from('vacation_requests').select('*').eq('user_id', adminSession.user.id).eq('status', 'approved').or(`start_date.lte.${lastDay},end_date.gte.${firstDay}`);
    const { data: sickLeaves } = await db.from('sick_leaves').select('*').eq('user_id', adminSession.user.id).lte('start_date', lastDay).gte('end_date', firstDay);

    // Gesamtbeträge
    let totalCard = 0;
    let totalCash = 0;
    entries.forEach(e => { totalCard += parseFloat(e.amount_card); totalCash += parseFloat(e.amount_cash); });

    if (config.mode === 'monthly') {
        await calculateMonthly(monthStr, totalCard, totalCash, depts, emps, actualHours, vacations, sickLeaves);
    } else {
        await calculateDaily(monthStr, firstDay, lastDay, daysInMonth, totalCard, totalCash, depts, emps, vacations, sickLeaves, entries);
    }

    loadTrinkgeld();
    alert('Berechnung abgeschlossen!');
}

async function calculateMonthly(monthStr, totalCard, totalCash, depts, emps, actualHours, vacations, sickLeaves) {
    const results = [];

    for (const dept of depts) {
        if (dept.fixed_hours_per_month) continue; // Fixer Anteil wird separat behandelt
        const deptCard = totalCard * (dept.percentage / 100);
        const deptCash = totalCash * (dept.percentage / 100);

        // Mitarbeiter dieser Abteilung
        const deptEmps = emps.filter(e => e.department === dept.department);

        // Fixer Anteil Mitarbeiter die in diesen Pool fließen
        const fixedDepts = depts.filter(d => d.pool_department === dept.department && d.fixed_hours_per_month);
        let fixedMinutes = 0;
        fixedDepts.forEach(d => { fixedMinutes += d.fixed_hours_per_month * 60; });

        // Stunden pro Mitarbeiter
        let totalDeptMinutes = fixedMinutes;
        const empMinutes = {};

        for (const emp of deptEmps) {
            const isOnVacation = (vacations || []).some(v => v.employee_id === emp.id);
            const isOnSick = (sickLeaves || []).some(s => s.employee_id === emp.id);
            if (isOnVacation || isOnSick) { empMinutes[emp.id] = 0; continue; }

            const ah = (actualHours || []).find(a => a.employee_id === emp.id);
            const minutes = ah ? ah.actual_minutes : 0;
            empMinutes[emp.id] = minutes;
            totalDeptMinutes += minutes;
        }

        if (totalDeptMinutes === 0) continue;

        // Fixer Anteil Mitarbeiter berechnen
        for (const fixedDept of fixedDepts) {
            const fixedEmp = emps.find(e => e.department === fixedDept.department);
            if (!fixedEmp) continue;
            const share = (fixedDept.fixed_hours_per_month * 60) / totalDeptMinutes;
            results.push({ employee_id: fixedEmp.id, amount_card: deptCard * share, amount_cash: deptCash * share });
        }

        // Normale Mitarbeiter
        for (const emp of deptEmps) {
            if (!empMinutes[emp.id]) continue;
            const share = empMinutes[emp.id] / totalDeptMinutes;
            results.push({ employee_id: emp.id, amount_card: deptCard * share, amount_cash: deptCash * share });
        }
    }

    // Ergebnisse speichern
    for (const r of results) {
        await db.from('tip_results').upsert({
            user_id: (await db.auth.getUser()).data.user.id,
            employee_id: r.employee_id,
            month: monthStr,
            amount_card: Math.round(r.amount_card * 100) / 100,
            amount_cash: Math.round(r.amount_cash * 100) / 100
        }, { onConflict: 'user_id,employee_id,month' });
    }
}

async function calculateDaily(monthStr, firstDay, lastDay, daysInMonth, totalCard, totalCash, depts, emps, vacations, sickLeaves, entries) {
    // tip_hours laden
    const { data: tipHours } = await db.from('tip_hours').select('*').eq('user_id', adminSession.user.id).gte('work_date', firstDay).lte('work_date', lastDay);
    
    if (!tipHours || tipHours.length === 0) { alert('Keine Stunden eingetragen.'); return; }

    const empTotals = {};
    const fixedTotals = {};
    emps.forEach(e => { empTotals[e.id] = { card: 0, cash: 0 }; });

    // Arbeitstage ermitteln
    const workDays = [...new Set(tipHours.map(h => h.work_date))];
    if (workDays.length === 0) return;

    for (const dateStr of workDays) {
        const dayHours = tipHours.filter(h => h.work_date === dateStr);
        const dayEntry = (entries || []).find(e => e.entry_date === dateStr);
        const dayCard = dayEntry ? parseFloat(dayEntry.amount_card) : 0;
        const dayCash = dayEntry ? parseFloat(dayEntry.amount_cash) : 0;
        if (dayCard === 0 && dayCash === 0) continue;

        for (const dept of depts) {
            if (dept.fixed_hours_per_month) continue;
            const deptDayCard = dayCard * (dept.percentage / 100);
            const deptDayCash = dayCash * (dept.percentage / 100);

            // Fixer Anteil Mitarbeiter die in diesen Pool fließen
            const fixedDepts = depts.filter(d => d.pool_department === dept.department && d.fixed_hours_per_month);
            let totalDeptMinutes = 0;
            fixedDepts.forEach(d => { totalDeptMinutes += (d.fixed_hours_per_month / daysInMonth) * 60; });

            // Normale Mitarbeiter dieser Abteilung
            const empDayMinutes = {};
            for (const h of dayHours) {
                const emp = emps.find(e => e.id === h.employee_id);
                if (!emp || emp.department !== dept.department) continue;
                const isOnVacation = (vacations || []).some(v => v.employee_id === h.employee_id && v.start_date <= dateStr && v.end_date >= dateStr);
                const isOnSick = (sickLeaves || []).some(s => s.employee_id === h.employee_id && s.start_date <= dateStr && s.end_date >= dateStr);
                if (isOnVacation || isOnSick) continue;
                empDayMinutes[h.employee_id] = h.minutes;
                totalDeptMinutes += h.minutes;
            }

            if (totalDeptMinutes === 0) continue;

            // Fixer Anteil
            for (const fixedDept of fixedDepts) {
                const fixedMins = (fixedDept.fixed_hours_per_month / daysInMonth) * 60;
                const share = fixedMins / totalDeptMinutes;
                if (!fixedTotals[fixedDept.department]) fixedTotals[fixedDept.department] = { card: 0, cash: 0 };
                fixedTotals[fixedDept.department].card += deptDayCard * share;
                fixedTotals[fixedDept.department].cash += deptDayCash * share;
            }

            // Normale Mitarbeiter
            for (const [empId, minutes] of Object.entries(empDayMinutes)) {
                const share = minutes / totalDeptMinutes;
                empTotals[empId].card += deptDayCard * share;
                empTotals[empId].cash += deptDayCash * share;
            }
        }
    }

    // Fixer Anteil in tip_results als "virtuelle" Einträge speichern mit employee_id = null
    // Stattdessen in tip_config als JSON speichern
    const userId = (await db.auth.getUser()).data.user.id;
    await db.from('tip_config').update({ 
        fixed_results: JSON.stringify(fixedTotals) 
    }).eq('user_id', userId);

    // Speichern
    for (const [empId, totals] of Object.entries(empTotals)) {
        if (totals.card === 0 && totals.cash === 0) continue;
        await db.from('tip_results').upsert({
            user_id: userId,
            employee_id: empId,
            month: monthStr,
            amount_card: Math.round(totals.card * 100) / 100,
            amount_cash: Math.round(totals.cash * 100) / 100
        }, { onConflict: 'user_id,employee_id,month' });
    }
}

async function openTrinkgeldHoursModal() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('trinkgeld-hours-date').value = today;
    await loadTrinkgeldHoursEmployees(today);
    document.getElementById('trinkgeld-hours-modal').classList.add('active');
}

function closeTrinkgeldHoursModal() {
    document.getElementById('trinkgeld-hours-modal').classList.remove('active');
}

async function loadTrinkgeldHoursEmployees(date) {
    const { data: existing } = await db
        .from('tip_hours')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .eq('work_date', date);

    const container = document.getElementById('trinkgeld-hours-employees');
    container.innerHTML = employees.map(emp => {
        const entry = (existing || []).find(e => e.employee_id === emp.id);
        const hours = entry ? Math.floor(entry.minutes / 60) : 0;
        const mins = entry ? entry.minutes % 60 : 0;
        const label = (hours === 0 && mins === 0) ? '—' : `${hours}h ${String(mins).padStart(2,'0')}m`;
        return `
        <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:0.5rem;">
            <div style="flex:1; font-size:0.9rem; font-weight:600;">${emp.name}</div>
            <input type="hidden" id="tip-hours-h-${emp.id}" value="${hours}">
            <input type="hidden" id="tip-hours-m-${emp.id}" value="${mins}">
            <button id="tip-time-btn-${emp.id}"
                onclick="openTimePicker('${emp.id}', '${emp.name.replace(/'/g, "\\'")}')"
                style="padding:0.45rem 0.85rem; border-radius:8px; border:1.5px solid var(--color-gray); background:white; font-size:0.9rem; font-weight:600; cursor:pointer; min-width:90px; text-align:center; color:var(--color-text);">
                ${label}
            </button>
        </div>`;
    }).join('');
}

let timePickerEmpId = null;
let timePickerCleanup = [];
const TP_ITEM_H = 48;
const TP_H_COUNT = 24;
const TP_M_COUNT = 60;

function openTimePicker(empId, empName) {
    timePickerEmpId = empId;
    document.getElementById('time-picker-emp-name').textContent = empName;
    const currentH = parseInt(document.getElementById(`tip-hours-h-${empId}`)?.value) || 0;
    const currentM = parseInt(document.getElementById(`tip-hours-m-${empId}`)?.value) || 0;

    const hCol = document.getElementById('time-picker-hours');
    const mCol = document.getElementById('time-picker-minutes');

    const buildCircular = (count) => {
        let html = '';
        for (let rep = 0; rep < 3; rep++) {
            for (let i = 0; i < count; i++) {
                html += `<div class="time-picker-item">${String(i).padStart(2, '0')}</div>`;
            }
        }
        return html;
    };

    hCol.innerHTML = buildCircular(TP_H_COUNT);
    mCol.innerHTML = buildCircular(TP_M_COUNT);

    document.getElementById('time-picker-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
        hCol.scrollTop = (TP_H_COUNT + currentH - 1) * TP_ITEM_H;
        mCol.scrollTop = (TP_M_COUNT + currentM - 1) * TP_ITEM_H;
    }, 50);

    timePickerCleanup.forEach(fn => fn());
    timePickerCleanup = [];

    const attachInfinite = (col, count) => {
        let timer = null;
        const check = () => {
            if (col.scrollTop < count * TP_ITEM_H) {
                col.scrollTop += count * TP_ITEM_H;
            } else if (col.scrollTop >= count * 2 * TP_ITEM_H) {
                col.scrollTop -= count * TP_ITEM_H;
            }
        };
        const handler = () => { clearTimeout(timer); timer = setTimeout(check, 100); };
        col.addEventListener('scroll', handler);
        timePickerCleanup.push(() => { col.removeEventListener('scroll', handler); clearTimeout(timer); });
    };

    attachInfinite(hCol, TP_H_COUNT);
    attachInfinite(mCol, TP_M_COUNT);

    const stopProp = (e) => { e.stopPropagation(); };
    for (const col of [hCol, mCol]) {
        col.addEventListener('touchstart', stopProp);
        col.addEventListener('touchmove', stopProp);
        col.addEventListener('touchend', stopProp);
        timePickerCleanup.push(() => {
            col.removeEventListener('touchstart', stopProp);
            col.removeEventListener('touchmove', stopProp);
            col.removeEventListener('touchend', stopProp);
        });
    }
}

function closeTimePicker() {
    document.getElementById('time-picker-modal').classList.remove('active');
    document.body.style.overflow = '';
    timePickerCleanup.forEach(fn => fn());
    timePickerCleanup = [];
    timePickerEmpId = null;
}

function resetTimePicker() {
    document.getElementById('time-picker-hours').scrollTop = (TP_H_COUNT - 1) * TP_ITEM_H;
    document.getElementById('time-picker-minutes').scrollTop = (TP_M_COUNT - 1) * TP_ITEM_H;
}

function confirmTimePicker() {
    if (!timePickerEmpId) return;
    const hCol = document.getElementById('time-picker-hours');
    const mCol = document.getElementById('time-picker-minutes');
    const h = (Math.round(hCol.scrollTop / TP_ITEM_H) + 1) % TP_H_COUNT;
    const m = (Math.round(mCol.scrollTop / TP_ITEM_H) + 1) % TP_M_COUNT;

    document.getElementById(`tip-hours-h-${timePickerEmpId}`).value = h;
    document.getElementById(`tip-hours-m-${timePickerEmpId}`).value = m;
    const label = (h === 0 && m === 0) ? '—' : `${h}h ${String(m).padStart(2, '0')}m`;
    document.getElementById(`tip-time-btn-${timePickerEmpId}`).textContent = label;

    closeTimePicker();
}

async function saveTrinkgeldHours() {
    const date = document.getElementById('trinkgeld-hours-date').value;
    if (!date) { alert('Bitte Datum eingeben.'); return; }
    const userId = (await db.auth.getUser()).data.user.id;
    const card = parseFloat(document.getElementById('trinkgeld-entry-card').value) || 0;
    const cash = parseFloat(document.getElementById('trinkgeld-entry-cash').value) || 0;
    const entryId = document.getElementById('trinkgeld-entry-id').value;

    // Eintrag speichern
    if (card > 0 || cash > 0) {
        if (entryId) {
            await db.from('tip_entries').update({ entry_date: date, amount_card: card, amount_cash: cash }).eq('id', entryId);
        } else {
            await db.from('tip_entries').upsert({ user_id: userId, entry_date: date, amount_card: card, amount_cash: cash }, { onConflict: 'user_id,entry_date' });
        }
    }

    // Stunden speichern
    for (const emp of employees) {
        const h = parseInt(document.getElementById(`tip-hours-h-${emp.id}`)?.value) || 0;
        const m = parseInt(document.getElementById(`tip-hours-m-${emp.id}`)?.value) || 0;
        const totalMinutes = h * 60 + m;
        if (totalMinutes === 0) continue;
        await db.from('tip_hours').upsert({
            user_id: userId,
            employee_id: emp.id,
            work_date: date,
            minutes: totalMinutes
        }, { onConflict: 'user_id,employee_id,work_date' });
    }

    closeTrinkgeldHoursModal();
    await loadTrinkgeld();
    await saveTrinkgeldResults();
}

async function loadTrinkgeldHours() {
    const year = trinkgeldDate.getFullYear();
    const month = trinkgeldDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const firstDay = `${monthStr}-01`;
    const lastDay = new Date(year, month + 1, 0).toISOString().split('T')[0];

    const { data: hours } = await db
        .from('tip_hours')
        .select('*, employees_planit(name)')
        .eq('user_id', adminSession.user.id)
        .gte('work_date', firstDay)
        .lte('work_date', lastDay)
        .order('work_date', { ascending: false });

    const container = document.getElementById('trinkgeld-hours-list');
    if (!hours || hours.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Stunden eingetragen.</p></div>';
        return;
    }

    // Gruppieren nach Datum
    const byDate = {};
    hours.forEach(h => {
        if (!byDate[h.work_date]) byDate[h.work_date] = [];
        byDate[h.work_date].push(h);
    });

    container.innerHTML = Object.entries(byDate).map(([date, entries]) => `
        <div class="card" style="margin-bottom:0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                <div style="font-weight:600;">${new Date(date + 'T12:00:00').toLocaleDateString('de-DE', {weekday:'short', day:'numeric', month:'short'})}</div>
                <div style="display:flex; gap:0.5rem;">
                    <button class="btn-small btn-pdf-view btn-icon" onclick="openTrinkgeldHoursModalDate('${date}')">
                        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-small btn-pdf-view btn-icon" onclick="deleteTrinkgeldHoursDate('${date}')">
                        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>
                </div>
            </div>
            ${entries.map(e => `
                <div style="display:flex; justify-content:space-between; font-size:0.85rem; padding:0.2rem 0;">
                    <span>${e.employees_planit.name.split(' ')[0]}</span>
                    <span style="font-weight:600;">${Math.floor(e.minutes/60)}h ${String(e.minutes%60).padStart(2,'0')}m</span>
                </div>
            `).join('')}
        </div>
    `).join('');
}

async function openTrinkgeldHoursModalDate(date) {
    document.getElementById('trinkgeld-hours-date').value = date;
    await loadTrinkgeldHoursEmployees(date);
    document.getElementById('trinkgeld-hours-modal').classList.add('active');
}

async function deleteTrinkgeldHoursDate(date) {
    if (!confirm(`Alle Stunden für ${new Date(date + 'T12:00:00').toLocaleDateString('de-DE')} löschen?`)) return;
    await db.from('tip_hours').delete().eq('user_id', adminSession.user.id).eq('work_date', date);
    loadTrinkgeldHours();
}

async function deleteTrinkgeldEntryDirect(id) {
    if (!confirm('Eintrag löschen?')) return;
    await db.from('tip_entries').delete().eq('id', id);
    loadTrinkgeld();
}

async function saveTrinkgeldResults() {
    const year = trinkgeldDate.getFullYear();
    const month = trinkgeldDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const firstDay = `${monthStr}-01`;
    const lastDay = new Date(year, month + 1, 0).toISOString().split('T')[0];
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const { data: entries } = await db.from('tip_entries').select('*').eq('user_id', adminSession.user.id).gte('entry_date', firstDay).lte('entry_date', lastDay);
    const { data: tipHours } = await db.from('tip_hours').select('*, employees_planit(name, department)').eq('user_id', adminSession.user.id).gte('work_date', firstDay).lte('work_date', lastDay);
    const { data: depts } = await db.from('tip_departments').select('*').eq('user_id', adminSession.user.id);
    const { data: emps } = await db.from('employees_planit').select('*').eq('user_id', adminSession.user.id).eq('is_active', true);
    const { data: vacations } = await db.from('vacation_requests').select('*').eq('user_id', adminSession.user.id).eq('status', 'approved').or(`start_date.lte.${lastDay},end_date.gte.${firstDay}`);
    const { data: sickLeaves } = await db.from('sick_leaves').select('*').eq('user_id', adminSession.user.id).lte('start_date', lastDay).gte('end_date', firstDay);

    if (!entries || entries.length === 0 || !depts || depts.length === 0) return;

    const empMonthTotals = {};
    const allDates = [...new Set((tipHours || []).map(h => h.work_date))];

    for (const dateStr of allDates) {
        const dayEntry = (entries || []).find(e => e.entry_date === dateStr);
        const dayCard = dayEntry ? parseFloat(dayEntry.amount_card) : 0;
        const dayCash = dayEntry ? parseFloat(dayEntry.amount_cash) : 0;
        if (dayCard === 0 && dayCash === 0) continue;

        const dayHours = (tipHours || []).filter(h => h.work_date === dateStr);

        for (const dept of depts) {
            if (dept.fixed_hours_per_month) continue;
            const deptDayCard = dayCard * (dept.percentage / 100);
            const deptDayCash = dayCash * (dept.percentage / 100);

            const fixedDepts = depts.filter(d => d.pool_department === dept.department && d.fixed_hours_per_month);
            let totalDeptMinutes = 0;
            fixedDepts.forEach(d => { totalDeptMinutes += (d.fixed_hours_per_month / daysInMonth) * 60; });

            const empDayMinutes = {};
            for (const h of dayHours) {
                if (h.employees_planit.department !== dept.department) continue;
                const isOnVacation = (vacations || []).some(v => v.employee_id === h.employee_id && v.start_date <= dateStr && v.end_date >= dateStr);
                const isOnSick = (sickLeaves || []).some(s => s.employee_id === h.employee_id && s.start_date <= dateStr && s.end_date >= dateStr);
                if (isOnVacation || isOnSick) continue;
                empDayMinutes[h.employee_id] = h.minutes;
                totalDeptMinutes += h.minutes;
            }

            if (totalDeptMinutes === 0) continue;

            for (const [empId, minutes] of Object.entries(empDayMinutes)) {
                const share = minutes / totalDeptMinutes;
                if (!empMonthTotals[empId]) empMonthTotals[empId] = { card: 0, cash: 0 };
                empMonthTotals[empId].card += deptDayCard * share;
                empMonthTotals[empId].cash += deptDayCash * share;
            }
        }
    }

    const userId = (await db.auth.getUser()).data.user.id;
    for (const [empId, totals] of Object.entries(empMonthTotals)) {
        await db.from('tip_results').upsert({
            user_id: userId,
            employee_id: empId,
            month: monthStr,
            amount_card: Math.round(totals.card * 100) / 100,
            amount_cash: Math.round(totals.cash * 100) / 100
        }, { onConflict: 'user_id,employee_id,month' });
    }
    console.log('saved results:', empMonthTotals);
}

async function downloadTrinkgeldPdf() {
    const year = trinkgeldDate.getFullYear();
    const month = trinkgeldDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthLabel = trinkgeldDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

    const { data: results } = await db
        .from('tip_results')
        .select('*, employees_planit(name)')
        .eq('user_id', adminSession.user.id)
        .eq('month', monthStr)
        .order('employee_id');

    if (!results || results.length === 0) {
        alert('Keine Daten für diesen Monat.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Monat oben rechts
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(monthLabel, 190, 20, { align: 'right' });

    // Tabellen-Header
    let y = 35;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.rect(15, y - 6, 90, 10);
    doc.rect(105, y - 6, 85, 10);
    doc.text('Mitarbeiter:', 17, y);
    doc.text('Trinkgeld, €', 188, y, { align: 'right' });

    y += 10;
    doc.setFont('helvetica', 'normal');

    let total = 0;
    for (const r of results) {
        const amount = Math.round(parseFloat(r.amount_card));
        total += amount;
        doc.rect(15, y - 6, 90, 10);
        doc.rect(105, y - 6, 85, 10);
        doc.text(r.employees_planit.name, 17, y);
        doc.text(String(amount), 188, y, { align: 'right' });
        y += 10;
    }

    // Leerzeile
    y += 5;

    // Insgesamt
    doc.setFont('helvetica', 'bold');
    doc.rect(15, y - 6, 90, 10);
    doc.rect(105, y - 6, 85, 10);
    doc.text('Insgesamt:', 17, y);
    doc.text(String(total), 188, y, { align: 'right' });

    doc.save(`Trinkgeld_${monthStr}.pdf`);
}

async function checkArbeitszeitWarnings(payload) {
    const warnings = [];
    const start = payload.start_time.split(':').map(Number);
    const end = payload.end_time.split(':').map(Number);
    const startMinutes = start[0] * 60 + start[1];
    const endMinutes = end[0] * 60 + end[1];
    const durationMinutes = endMinutes - startMinutes - (payload.break_minutes || 0);
    const durationHours = durationMinutes / 60;

    // Warnung 1: Schicht über 10h
    if (durationHours > 10) {
        warnings.push(`🕐 Schicht zu lang: ${durationHours.toFixed(1)}h (max. 10h erlaubt)`);
    }

    // Warnung 3: Pausenempfehlung
    const breakMinutes = payload.break_minutes || 0;
    if (durationHours > 9 && breakMinutes < 45) {
        warnings.push(`☕ Pausenempfehlung: Ab 9h Arbeit mindestens 45 Min Pause (aktuell: ${breakMinutes} Min)`);
    } else if (durationHours > 6 && breakMinutes < 30) {
        warnings.push(`☕ Pausenempfehlung: Ab 6h Arbeit mindestens 30 Min Pause (aktuell: ${breakMinutes} Min)`);
    }

    // Warnung 2: Ruhezeit unter 11h
    if (payload.employee_id) {
        const prevDate = new Date(payload.shift_date + 'T12:00:00');
        prevDate.setDate(prevDate.getDate() - 1);
        const prevDateStr = prevDate.toISOString().split('T')[0];

        const { data: prevShift } = await db
            .from('shifts')
            .select('end_time')
            .eq('employee_id', payload.employee_id)
            .eq('shift_date', prevDateStr)
            .maybeSingle();

        if (prevShift) {
            const prevEnd = prevShift.end_time.split(':').map(Number);
            const prevEndMinutes = prevEnd[0] * 60 + prevEnd[1];
            const restMinutes = (24 * 60 - prevEndMinutes) + startMinutes;
            if (restMinutes < 11 * 60) {
                const restHours = (restMinutes / 60).toFixed(1);
                warnings.push(`😴 Ruhezeit zu kurz: Nur ${restHours}h zwischen den Schichten (min. 11h erforderlich)`);
            }
        }
    }

    return warnings;
}

// ------- INVENTUR ---------

async function loadInventurConfig() {
    // Geöffnete Lieferanten merken, damit sie nach dem Re-Render wieder offen sind
    const openSuppliers = new Set(
        [...document.querySelectorAll('[id^="inventur-config-supplier-body-"]')]
            .filter(el => el.style.display === 'block')
            .map(el => el.id.replace('inventur-config-supplier-body-', ''))
    );

    const { data: suppliers } = await db
        .from('planit_suppliers')
        .select('*, planit_inventory_items(*)')
        .eq('user_id', adminSession.user.id)
        .order('created_at', { ascending: true });

    const container = document.getElementById('suppliers-list');
    if (!suppliers || suppliers.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Lieferanten vorhanden.</p></div>';
        return;
    }

    // Positionen initialisieren BEVOR Rendern
    for (const s of suppliers || []) {
        const items = (s.planit_inventory_items || []);
        for (let idx = 0; idx < items.length; idx++) {
            const updates = {};
            if (items[idx].inventory_position === null || items[idx].inventory_position === undefined) {
                updates.inventory_position = idx;
                items[idx].inventory_position = idx;
            }
            if (items[idx].order_position === null || items[idx].order_position === undefined) {
                updates.order_position = idx;
                items[idx].order_position = idx;
            }
            if (Object.keys(updates).length > 0) {
                await db.from('planit_inventory_items').update(updates).eq('id', items[idx].id);
            }
        }
    }

    const sortField = window.inventurSortMode === 'order' ? 'order_position' : 'inventory_position';
    container.innerHTML = suppliers.map(s => {
        const items = (s.planit_inventory_items || []).sort((a, b) => (a[sortField] ?? 0) - (b[sortField] ?? 0));
        return `
        <div style="margin-bottom:0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; padding:0.75rem 1rem; background:var(--color-gray); border-radius:12px; margin-bottom:0.25rem;" onclick="toggleInventurConfigSupplier('${s.id}')">
                <div style="font-size:0.85rem; font-weight:700; color:var(--color-primary); letter-spacing:0.05em;">${s.name.toUpperCase()}</div>
                <span id="inventur-config-supplier-toggle-${s.id}" style="color:var(--color-text-light);">▶</span>
            </div>
            <div id="inventur-config-supplier-body-${s.id}" style="display:none;">
            <div id="inventur-config-groups-${s.id}" style="margin-bottom:0.5rem;"></div>
            <div class="card" style="margin-bottom:0;">
                ${window.inventurSortMode === 'inventory' ? `
                <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-bottom:0.75rem;">
                    <button class="btn-small btn-pdf-view btn-icon" style="width:2rem; height:2rem;" onclick="addInventurItem('${s.id}')">
                        <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                    <button class="btn-small btn-pdf-view btn-icon" style="width:2rem; height:2rem;" onclick="deleteSupplier('${s.id}')">
                        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>
                </div>` : ''}
                ${items.length === 0 ? '<div style="font-size:0.85rem; color:var(--color-text-light);">Keine Waren.</div>' :
                items.map((item, i) => `
                    <div style="display:flex; align-items:center; gap:0.5rem; padding:0.4rem 0; border-bottom:1px solid var(--color-border);">
                        <div style="flex:1;">
                            <div style="font-size:0.85rem;"><span style="font-size:0.75rem; color:var(--color-text-light); margin-right:0.35rem;">${i + 1}.</span>${item.name}</div>
                            <div style="font-size:0.75rem; color:var(--color-text-light);">Soll: ${item.target_amount} ${item.unit} · ${(item.price_per_unit || 0).toFixed(2)} €</div>
                        </div>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.2rem;">
                            ${i > 0 ? `<button class="btn-small btn-pdf-view btn-icon" style="width:1.8rem; height:1.8rem;" onclick="moveInventurItem('${s.id}', ${i}, -1, '${window.inventurSortMode}')">
                                <svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
                            </button>` : `<div style="width:1.8rem; height:1.8rem;"></div>`}
                            ${window.inventurSortMode === 'inventory' ? `
                            <button class="btn-small btn-pdf-view btn-icon" style="width:1.8rem; height:1.8rem;" onclick="editInventurItem('${item.id}', '${s.id}', '${item.name}', '${item.unit}', ${item.target_amount}, ${item.price_per_unit || 0}, '${item.group_id || ''}')">
                                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>` : `<div style="width:1.8rem; height:1.8rem;"></div>`}
                            ${i < items.length - 1 ? `<button class="btn-small btn-pdf-view btn-icon" style="width:1.8rem; height:1.8rem;" onclick="moveInventurItem('${s.id}', ${i}, 1, '${window.inventurSortMode}')">
                                <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
                            </button>` : `<div style="width:1.8rem; height:1.8rem;"></div>`}
                            ${window.inventurSortMode === 'inventory' ? `
                            <button class="btn-small btn-pdf-view btn-icon" style="width:1.8rem; height:1.8rem;" onclick="deleteInventurItem('${item.id}')">
                                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                            </button>` : `<div style="width:1.8rem; height:1.8rem;"></div>`}
                        </div>
                    </div>
                `).join('')}
            </div>
            </div>
        </div>`;
    }).join('');

    // Geöffnete Lieferanten wiederherstellen
    openSuppliers.forEach(id => {
        const body = document.getElementById(`inventur-config-supplier-body-${id}`);
        const toggle = document.getElementById(`inventur-config-supplier-toggle-${id}`);
        if (body) body.style.display = 'block';
        if (toggle) toggle.textContent = '▼';
        if (window.inventurSortMode === 'inventory') loadGroups(id);
    });

    // Aktiven Sort-Tab wiederherstellen
    document.getElementById('inventur-sort-tab-inventory')?.classList.toggle('active', window.inventurSortMode === 'inventory');
    document.getElementById('inventur-sort-tab-order')?.classList.toggle('active', window.inventurSortMode === 'order');
}

async function addSupplier() {
    openInventurSupplierModal();
}

async function deleteSupplier(id) {
    if (!confirm('Lieferant und alle Waren löschen?')) return;
    await db.from('planit_suppliers').delete().eq('id', id);
    loadInventurConfig();
}

async function addInventurItem(supplierId) {
    openInventurItemModal(supplierId);
}

async function editInventurItem(id, supplierId, name, unit, target, price, groupId) {
    openInventurItemModal(supplierId, id, name, unit, target, price, groupId);
}

async function deleteInventurItem(id) {
    if (!confirm('Ware löschen?')) return;
    await db.from('planit_inventory_items').delete().eq('id', id);
    loadInventurConfig();
}

async function loadInventur() {
    updateInventurDateLabel();
    const date = document.getElementById('inventur-date').value;

    const [{ data: suppliers }, { data: entries }, { data: groups }] = await Promise.all([
        db.from('planit_suppliers').select('*, planit_inventory_items(*)').eq('user_id', adminSession.user.id).order('created_at', { ascending: true }),
        db.from('planit_inventory_entries').select('*').eq('user_id', adminSession.user.id).eq('entry_date', date),
        db.from('planit_inventory_groups').select('*').eq('user_id', adminSession.user.id).order('position', { ascending: true })
    ]);

    const container = document.getElementById('inventur-list');
    if (!suppliers || suppliers.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Waren konfiguriert. Bitte zuerst Einstellungen öffnen.</p></div>';
        return;
    }

    const groupMap = {};
    (groups || []).forEach(g => { groupMap[g.id] = g; });

    const renderItemRow = (item, supplierName) => {
        const entry = (entries || []).find(e => e.item_id === item.id);
        const actual = entry ? entry.actual_amount : '';
        const order = actual !== '' ? Math.max(0, item.target_amount - parseFloat(actual)) : '';
        return `
        <div style="display:grid; grid-template-columns:1fr 5rem 5rem 5rem; gap:0.5rem; padding:0.5rem 0.75rem; border-bottom:1px solid var(--color-border); align-items:center;">
            <div>
                <div style="font-size:0.9rem; font-weight:600;">${item.name}</div>
                <div style="font-size:0.75rem; color:var(--color-text-light);">${item.unit}</div>
            </div>
            <div style="text-align:center; font-size:0.9rem;">${item.target_amount}</div>
            <input type="number" value="${actual}" min="0" step="0.1"
                data-item-id="${item.id}"
                data-target="${item.target_amount}"
                data-price="${item.price_per_unit || 0}"
                data-supplier="${supplierName}"
                onchange="updateOrderValue(this)"
                style="text-align:center; padding:0.3rem; border-radius:6px; border:1px solid var(--color-border); font-size:0.85rem; width:100%;">
            <div id="order-${item.id}" style="text-align:center; font-size:0.9rem; font-weight:600; color:${order > 0 ? 'var(--color-red)' : 'var(--color-green)'};">
                ${order !== '' ? order : '–'}
            </div>
        </div>`;
    };

    const renderGroupSection = (groupKey, groupName, items, supplierName) => {
        if (items.length === 0) return '';
        return `
        <div style="margin-bottom:0.25rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; padding:0.4rem 0.75rem; background:var(--color-beige-light); border-radius:8px; margin-bottom:0.1rem;" onclick="toggleInventurGroup('${groupKey}')">
                <div style="font-size:0.8rem; font-weight:700; color:var(--color-secondary);">${groupName}</div>
                <span id="inventur-group-toggle-${groupKey}" style="font-size:0.75rem; color:var(--color-text-light);">▶</span>
            </div>
            <div id="inventur-group-body-${groupKey}" style="display:none;">
                ${items.map(item => renderItemRow(item, supplierName)).join('')}
            </div>
        </div>`;
    };

    container.innerHTML = suppliers.map(s => {
        const items = (s.planit_inventory_items || []).sort((a, b) => (a.inventory_position ?? 0) - (b.inventory_position ?? 0));
        if (items.length === 0) return '';

        // Supplier-Gruppen in Reihenfolge ermitteln
        const supplierGroups = (groups || []).filter(g => g.supplier_id === s.id);
        const grouped = {};
        const ungrouped = [];
        items.forEach(item => {
            if (item.group_id && groupMap[item.group_id]) {
                if (!grouped[item.group_id]) grouped[item.group_id] = [];
                grouped[item.group_id].push(item);
            } else {
                ungrouped.push(item);
            }
        });

        const hasGroups = supplierGroups.length > 0;

        return `
        <div style="margin-bottom:0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; padding:0.75rem 1rem; background:var(--color-gray); border-radius:12px; margin-bottom:0.25rem;" onclick="toggleInventurSupplier('${s.id}')">
                <div style="font-size:0.85rem; font-weight:700; color:var(--color-primary); letter-spacing:0.05em;">${s.name.toUpperCase()}</div>
                <span id="inventur-supplier-toggle-${s.id}" style="color:var(--color-text-light);">▶</span>
            </div>
            <div id="inventur-supplier-body-${s.id}" style="display:none;">
            <div class="card" style="padding:0;">
                <div style="display:grid; grid-template-columns:1fr 5rem 5rem 5rem; gap:0.5rem; padding:0.5rem 0.75rem; border-bottom:2px solid var(--color-border);">
                    <div style="font-size:0.75rem; font-weight:700; color:var(--color-text-light);">WARE</div>
                    <div style="font-size:0.75rem; font-weight:700; color:var(--color-text-light); text-align:center;">SOLL</div>
                    <div style="font-size:0.75rem; font-weight:700; color:var(--color-text-light); text-align:center;">IST</div>
                    <div style="font-size:0.75rem; font-weight:700; color:var(--color-text-light); text-align:center;">BESTELL</div>
                </div>
                ${hasGroups
                    ? supplierGroups.map(g => renderGroupSection(g.id, g.name, grouped[g.id] || [], s.name)).join('')
                      + (ungrouped.length > 0 ? renderGroupSection(`${s.id}-allgemein`, 'Allgemein', ungrouped, s.name) : '')
                    : items.map(item => renderItemRow(item, s.name)).join('')
                }
            </div>
            </div>
        </div>`;
    }).join('');

    // Lagerwert Container
    container.innerHTML += `<div class="card" id="lagerwert-block" style="margin-top:1rem;"></div>`;
    updateLagerwert();
}

function updateOrderValue(input) {
    const actual = parseFloat(input.value) || 0;
    const target = parseFloat(input.dataset.target) || 0;
    const price = parseFloat(input.dataset.price) || 0;
    const order = Math.max(0, target - actual);
    const orderDiv = document.getElementById(`order-${input.dataset.itemId}`);
    if (orderDiv) {
        orderDiv.textContent = order;
        orderDiv.style.color = order > 0 ? 'var(--color-red)' : 'var(--color-green)';
    }
    // Lagerwert neu berechnen
    updateLagerwert();
}

function updateLagerwert() {
    const inputs = document.querySelectorAll('#inventur-list input[data-item-id]');
    const supplierValues = {};
    let totalValue = 0;

    inputs.forEach(input => {
        const actual = parseFloat(input.value) || 0;
        const price = parseFloat(input.dataset.price) || 0;
        const supplier = input.dataset.supplier;
        const value = actual * price;
        if (value > 0) {
            if (!supplierValues[supplier]) supplierValues[supplier] = 0;
            supplierValues[supplier] += value;
            totalValue += value;
        }
    });

    const lagerwertDiv = document.getElementById('lagerwert-block');
    if (!lagerwertDiv) return;

    if (totalValue > 0) {
        lagerwertDiv.innerHTML = `
            <div style="font-size:0.85rem; font-weight:700; color:var(--color-text-light); letter-spacing:0.05em; margin-bottom:0.75rem;">LAGERWERT</div>
            ${Object.entries(supplierValues).map(([name, value]) => `
                <div style="display:flex; justify-content:space-between; font-size:0.85rem; padding:0.3rem 0; border-bottom:1px solid var(--color-border);">
                    <span>${name}</span>
                    <span style="font-weight:600;">${value.toFixed(2)} €</span>
                </div>
            `).join('')}
            <div style="display:flex; justify-content:space-between; margin-top:0.75rem; padding-top:0.5rem; border-top:2px solid var(--color-border);">
                <span style="font-weight:700;">Gesamt</span>
                <span style="font-weight:700; font-size:1.1rem; color:var(--color-primary);">${totalValue.toFixed(2)} €</span>
            </div>`;
        lagerwertDiv.style.display = 'block';
    } else {
        lagerwertDiv.innerHTML = '';
    }
}

async function saveInventur() {
    const date = document.getElementById('inventur-date').value;
    if (!date) return;
    const userId = (await db.auth.getUser()).data.user.id;
    const inputs = document.querySelectorAll('#inventur-list input[data-item-id]');
    for (const input of inputs) {
        const actual = parseFloat(input.value);
        if (isNaN(actual)) continue;
        await db.from('planit_inventory_entries').upsert({
            user_id: userId,
            item_id: input.dataset.itemId,
            entry_date: date,
            actual_amount: actual
        }, { onConflict: 'user_id,item_id,entry_date' });
    }
    alert('Gespeichert!');
}

async function downloadInventurPdf() {
    const date = document.getElementById('inventur-date').value;
    if (!date) { alert('Bitte Datum wählen.'); return; }

    const { data: suppliers } = await db
        .from('planit_suppliers')
        .select('*, planit_inventory_items(*)')
        .eq('user_id', adminSession.user.id)
        .order('created_at', { ascending: true });

    const { data: entries } = await db
        .from('planit_inventory_entries')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .eq('entry_date', date);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('de-DE');

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Inventur', 15, 20);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(dateLabel, 190, 20, { align: 'right' });

    let y = 35;

    for (const s of suppliers || []) {
        const items = (s.planit_inventory_items || []).sort((a, b) => a.position - b.position);
        if (items.length === 0) continue;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(s.name, 15, y);
        y += 7;

        // Header
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('Ware', 15, y);
        doc.text('Einheit', 90, y);
        doc.text('Soll', 120, y, { align: 'right' });
        doc.text('Ist', 150, y, { align: 'right' });
        doc.text('Bestell', 185, y, { align: 'right' });
        y += 5;
        doc.line(15, y, 195, y);
        y += 5;

        doc.setFont('helvetica', 'normal');
        for (const item of items) {
            const entry = (entries || []).find(e => e.item_id === item.id);
            const actual = entry ? entry.actual_amount : '–';
            const order = entry ? Math.max(0, item.target_amount - parseFloat(entry.actual_amount)) : '–';
            doc.text(item.name, 15, y);
            doc.text(item.unit, 90, y);
            doc.text(String(item.target_amount), 120, y, { align: 'right' });
            doc.text(String(actual), 150, y, { align: 'right' });
            doc.text(String(order), 185, y, { align: 'right' });
            y += 7;
            if (y > 270) { doc.addPage(); y = 20; }
        }
        y += 5;
    }

    doc.save(`Inventur_${date}.pdf`);
}

let inventurDate = new Date();

function changeInventurDate(dir) {
    inventurDate.setDate(inventurDate.getDate() + dir);
    updateInventurDateLabel();
    loadInventur();
    if (document.getElementById('inventur-subtab-bestellung').style.display !== 'none') {
        renderBestellansicht();
    }
}

function updateInventurDateLabel() {
    const dateStr = inventurDate.toISOString().split('T')[0];
    document.getElementById('inventur-date').value = dateStr;
}

function onInventurDateChange() {
    const val = document.getElementById('inventur-date').value;
    if (!val) return;
    inventurDate = new Date(val + 'T12:00:00');
    loadInventur();
    if (document.getElementById('inventur-subtab-bestellung').style.display !== 'none') {
        renderBestellansicht();
    }
}

function switchInventurSubTab(tab) {
    document.getElementById('inventur-subtab-inventur').style.display = tab === 'inventur' ? 'block' : 'none';
    document.getElementById('inventur-subtab-bestellung').style.display = tab === 'bestellung' ? 'block' : 'none';
    document.getElementById('inventur-sub-tab-inventur').classList.toggle('active', tab === 'inventur');
    document.getElementById('inventur-sub-tab-bestellung').classList.toggle('active', tab === 'bestellung');
    if (tab === 'bestellung') renderBestellansicht();
}

async function renderBestellansicht() {
    const date = inventurDate.toISOString().split('T')[0];
    const container = document.getElementById('bestellung-list');
    container.innerHTML = '<div style="text-align:center; color:var(--color-text-light); padding:1rem;">Lädt...</div>';

    const { data: suppliers } = await db
        .from('planit_suppliers')
        .select('*, planit_inventory_items(*)')
        .eq('user_id', adminSession.user.id)
        .order('created_at', { ascending: true });

    const { data: entries } = await db
        .from('planit_inventory_entries')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .eq('entry_date', date);

    if (!suppliers || suppliers.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Waren konfiguriert.</p></div>';
        return;
    }

    let html = '';
    for (const s of suppliers) {
        const items = (s.planit_inventory_items || [])
            .sort((a, b) => (a.order_position ?? 0) - (b.order_position ?? 0));
        if (items.length === 0) continue;

        html += `<div style="margin-bottom:1rem;">
            <div style="font-size:0.85rem; font-weight:700; color:var(--color-primary); letter-spacing:0.05em; padding:0.5rem 0; border-bottom:2px solid var(--color-border); margin-bottom:0.5rem;">${s.name.toUpperCase()}</div>`;

        for (const item of items) {
            const entry = (entries || []).find(e => e.item_id === item.id);
            const hasEntry = !!entry;
            const actual = hasEntry ? parseFloat(entry.actual_amount) : null;
            const orderAmt = hasEntry ? Math.max(0, item.target_amount - actual) : null;

            if (hasEntry) {
                html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0; border-bottom:1px solid var(--color-border);">
                    <div>
                        <div style="font-size:0.9rem; font-weight:600;">${item.name}</div>
                        <div style="font-size:0.75rem; color:var(--color-text-light);">Ist: ${actual} ${item.unit}</div>
                    </div>
                    <div style="font-size:1rem; font-weight:700; color:${orderAmt > 0 ? 'var(--color-primary)' : 'var(--color-text-light)'};">
                        ${orderAmt} ${item.unit}
                    </div>
                </div>`;
            } else {
                html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0; border-bottom:1px solid var(--color-border); opacity:0.45;">
                    <div>
                        <div style="font-size:0.9rem;">${item.name}</div>
                        <div style="font-size:0.75rem; color:var(--color-text-light);">nicht erfasst</div>
                    </div>
                    <div style="font-size:0.75rem; color:var(--color-text-light);">—</div>
                </div>`;
            }
        }
        html += `</div>`;
    }

    container.innerHTML = html || '<div class="empty-state"><p>Keine Waren gefunden.</p></div>';
}

async function openInventurItemModal(supplierId, itemId = null, name = '', unit = 'Stück', target = 0, price = 0, groupId = '') {
    document.getElementById('inventur-item-id').value = itemId || '';
    document.getElementById('inventur-item-supplier-id').value = supplierId;
    document.getElementById('inventur-item-name').value = name;
    document.getElementById('inventur-item-unit').value = unit;
    document.getElementById('inventur-item-target').value = target;
    document.getElementById('inventur-item-price').value = price;
    document.getElementById('inventur-item-modal-title').textContent = itemId ? 'Ware bearbeiten' : 'Ware hinzufügen';

    const select = document.getElementById('inventur-item-group');
    select.innerHTML = '<option value="">— Kein Bereich —</option>';
    if (supplierId) {
        const { data: groups } = await db
            .from('planit_inventory_groups')
            .select('id, name')
            .eq('supplier_id', supplierId)
            .order('position', { ascending: true });
        (groups || []).forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            if (g.id === groupId) opt.selected = true;
            select.appendChild(opt);
        });
    }

    document.getElementById('inventur-item-modal').classList.add('active');
}

function closeInventurItemModal() {
    document.getElementById('inventur-item-modal').classList.remove('active');
}

async function saveInventurItem() {
    const id = document.getElementById('inventur-item-id').value;
    const supplierId = document.getElementById('inventur-item-supplier-id').value;
    const name = document.getElementById('inventur-item-name').value.trim();
    const unit = document.getElementById('inventur-item-unit').value;
    const target = parseFloat(document.getElementById('inventur-item-target').value) || 0;
    const price = parseFloat(document.getElementById('inventur-item-price').value) || 0;
    const groupId = document.getElementById('inventur-item-group').value || null;
    if (!name) { alert('Bitte Name eingeben.'); return; }

    if (id) {
        await db.from('planit_inventory_items').update({ name, unit, target_amount: target, price_per_unit: price, group_id: groupId }).eq('id', id);
    } else {
        await db.from('planit_inventory_items').insert({
            user_id: adminSession.user.id,
            supplier_id: supplierId,
            name,
            unit,
            target_amount: target,
            price_per_unit: price,
            group_id: groupId
        });
    }
    closeInventurItemModal();
    loadInventurConfig();
}

function openInventurSupplierModal(id = null, name = '') {
    document.getElementById('inventur-supplier-id').value = id || '';
    document.getElementById('inventur-supplier-name').value = name;
    document.getElementById('inventur-supplier-modal').classList.add('active');
}

function closeInventurSupplierModal() {
    document.getElementById('inventur-supplier-modal').classList.remove('active');
}

function openInventurInfoModal() {
    document.getElementById('inventur-info-modal').classList.add('active');
}

function closeInventurInfoModal() {
    document.getElementById('inventur-info-modal').classList.remove('active');
}

async function saveInventurSupplier() {
    const id = document.getElementById('inventur-supplier-id').value;
    const name = document.getElementById('inventur-supplier-name').value.trim();
    if (!name) { alert('Bitte Name eingeben.'); return; }

    if (id) {
        await db.from('planit_suppliers').update({ name }).eq('id', id);
    } else {
        await db.from('planit_suppliers').insert({ user_id: adminSession.user.id, name });
    }
    closeInventurSupplierModal();
    loadInventurConfig();
}

function openJahresberichtModal() {
    document.getElementById('jahresbericht-date').value = inventurDate.toISOString().split('T')[0];
    document.getElementById('jahresbericht-modal').classList.add('active');
}

function closeJahresberichtModal() {
    document.getElementById('jahresbericht-modal').classList.remove('active');
}

async function downloadJahresberichtPdf() {
    const date = document.getElementById('jahresbericht-date').value;
    if (!date) { alert('Bitte Datum wählen.'); return; }

    const { data: suppliers } = await db
        .from('planit_suppliers')
        .select('*, planit_inventory_items(*)')
        .eq('user_id', adminSession.user.id)
        .order('created_at', { ascending: true });

    const { data: entries } = await db
        .from('planit_inventory_entries')
        .select('*')
        .eq('user_id', adminSession.user.id)
        .eq('entry_date', date);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('de-DE');

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Jahresinventur', 15, 20);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(dateLabel, 190, 20, { align: 'right' });

    let y = 35;
    let grandTotal = 0;

    for (const s of suppliers || []) {
        const items = (s.planit_inventory_items || []).sort((a, b) => a.position - b.position);
        if (items.length === 0) continue;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(s.name, 15, y);
        y += 7;

        // Header
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('Ware', 15, y);
        doc.text('Einheit', 70, y);
        doc.text('Menge', 100, y, { align: 'right' });
        doc.text('Preis/Einheit', 140, y, { align: 'right' });
        doc.text('Gesamtwert', 185, y, { align: 'right' });
        y += 5;
        doc.line(15, y, 195, y);
        y += 5;

        let supplierTotal = 0;
        doc.setFont('helvetica', 'normal');
        for (const item of items) {
            const entry = (entries || []).find(e => e.item_id === item.id);
            const actual = entry ? parseFloat(entry.actual_amount) : 0;
            const price = parseFloat(item.price_per_unit) || 0;
            const value = actual * price;
            supplierTotal += value;
            grandTotal += value;

            doc.text(item.name, 15, y);
            doc.text(item.unit, 70, y);
            doc.text(String(actual), 100, y, { align: 'right' });
            doc.text(`${price.toFixed(2)} €`, 140, y, { align: 'right' });
            doc.text(`${value.toFixed(2)} €`, 185, y, { align: 'right' });
            y += 7;
            if (y > 270) { doc.addPage(); y = 20; }
        }

        // Lieferant Summe
        doc.setFont('helvetica', 'bold');
        doc.text(`Gesamt ${s.name}:`, 140, y, { align: 'right' });
        doc.text(`${supplierTotal.toFixed(2)} €`, 185, y, { align: 'right' });
        y += 10;
    }

    // Gesamtsumme
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.line(15, y, 195, y);
    y += 7;
    doc.text('GESAMTLAGERWERT:', 140, y, { align: 'right' });
    doc.text(`${grandTotal.toFixed(2)} €`, 185, y, { align: 'right' });

    doc.save(`Jahresinventur_${date}.pdf`);
    closeJahresberichtModal();
}

function toggleInventurSupplier(supplierId) {
    const body = document.getElementById(`inventur-supplier-body-${supplierId}`);
    const toggle = document.getElementById(`inventur-supplier-toggle-${supplierId}`);
    const isOpen = body.style.display === 'block';
    body.style.display = isOpen ? 'none' : 'block';
    toggle.textContent = isOpen ? '▶' : '▼';
}

function toggleInventurGroup(groupKey) {
    const body = document.getElementById(`inventur-group-body-${groupKey}`);
    const toggle = document.getElementById(`inventur-group-toggle-${groupKey}`);
    const isOpen = body.style.display === 'block';
    body.style.display = isOpen ? 'none' : 'block';
    toggle.textContent = isOpen ? '▶' : '▼';
}

function toggleInventurConfigSupplier(supplierId) {
    const body = document.getElementById(`inventur-config-supplier-body-${supplierId}`);
    const toggle = document.getElementById(`inventur-config-supplier-toggle-${supplierId}`);
    const isOpen = body.style.display === 'block';
    body.style.display = isOpen ? 'none' : 'block';
    toggle.textContent = isOpen ? '▶' : '▼';
    if (!isOpen && window.inventurSortMode === 'inventory') loadGroups(supplierId);
}

async function loadGroups(supplierId) {
    const { data: groups } = await db
        .from('planit_inventory_groups')
        .select('*')
        .eq('supplier_id', supplierId)
        .eq('user_id', adminSession.user.id)
        .order('position', { ascending: true });

    renderGroups(supplierId, groups || []);
}

function renderGroups(supplierId, groups) {
    const container = document.getElementById(`inventur-config-groups-${supplierId}`);
    if (!container) return;

    container.innerHTML = `
        <div class="card" style="margin-bottom:0; padding:0.5rem 0.75rem;">
            <div style="font-size:0.75rem; font-weight:700; color:var(--color-text-light); letter-spacing:0.05em; margin-bottom:0.5rem;">BEREICHE</div>
            ${groups.length === 0
                ? '<div style="font-size:0.8rem; color:var(--color-text-light); margin-bottom:0.5rem;">Keine Bereiche.</div>'
                : groups.map((g, i) => `
                    <div style="display:flex; align-items:center; gap:0.3rem; padding:0.3rem 0; border-bottom:1px solid var(--color-border);">
                        <input id="group-name-${g.id}" type="text" value="${g.name}"
                            style="flex:1; font-size:0.85rem; border:1px solid transparent; border-radius:6px; padding:0.2rem 0.35rem; background:transparent;"
                            onfocus="this.style.borderColor='var(--color-border)'"
                            onblur="this.style.borderColor='transparent'"
                            onkeydown="if(event.key==='Enter') renameGroup('${g.id}','${supplierId}',this.value)">
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.2rem;">
                            ${i > 0 ? `<button class="btn-small btn-pdf-view btn-icon" style="width:1.6rem; height:1.6rem;" onclick="moveGroup('${g.id}','${supplierId}',-1)">
                                <svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
                            </button>` : `<div style="width:1.6rem;"></div>`}
                            <button class="btn-small btn-pdf-view btn-icon" style="width:1.6rem; height:1.6rem;" onclick="renameGroup('${g.id}','${supplierId}',document.getElementById('group-name-${g.id}').value)">
                                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            ${i < groups.length - 1 ? `<button class="btn-small btn-pdf-view btn-icon" style="width:1.6rem; height:1.6rem;" onclick="moveGroup('${g.id}','${supplierId}',1)">
                                <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
                            </button>` : `<div style="width:1.6rem;"></div>`}
                            <button class="btn-small btn-pdf-view btn-icon" style="width:1.6rem; height:1.6rem;" onclick="deleteGroup('${g.id}','${supplierId}')">
                                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                            </button>
                        </div>
                    </div>
                `).join('')}
            <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                <input type="text" id="new-group-input-${supplierId}" placeholder="Neuer Bereich…" style="flex:1; padding:0.3rem 0.5rem; border:1px solid var(--color-border); border-radius:6px; font-size:0.85rem;">
                <button class="btn-small btn-pdf-view" style="font-size:0.75rem; height:auto; width:auto; padding:0.3rem 0.6rem;" onclick="addGroup('${supplierId}')">+</button>
            </div>
        </div>
    `;
}

async function addGroup(supplierId) {
    const input = document.getElementById(`new-group-input-${supplierId}`);
    const name = input?.value.trim();
    if (!name) return;

    const { data: existing } = await db
        .from('planit_inventory_groups')
        .select('position')
        .eq('supplier_id', supplierId)
        .order('position', { ascending: false })
        .limit(1);

    const nextPos = existing && existing.length > 0 ? (existing[0].position ?? 0) + 1 : 0;

    await db.from('planit_inventory_groups').insert({
        user_id: adminSession.user.id,
        supplier_id: supplierId,
        name,
        position: nextPos
    });
    loadGroups(supplierId);
}

async function deleteGroup(groupId, supplierId) {
    if (!confirm('Bereich löschen?')) return;
    await db.from('planit_inventory_groups').delete().eq('id', groupId);
    loadGroups(supplierId);
}

async function renameGroup(groupId, supplierId, newName) {
    const name = newName?.trim();
    if (!name) return;
    await db.from('planit_inventory_groups').update({ name }).eq('id', groupId);
    loadGroups(supplierId);
}

async function moveGroup(groupId, supplierId, dir) {
    const { data: groups } = await db
        .from('planit_inventory_groups')
        .select('*')
        .eq('supplier_id', supplierId)
        .order('position', { ascending: true });

    if (!groups) return;
    const idx = groups.findIndex(g => g.id === groupId);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= groups.length) return;

    const posA = groups[idx].position ?? idx;
    const posB = groups[swapIdx].position ?? swapIdx;
    await db.from('planit_inventory_groups').update({ position: posB }).eq('id', groups[idx].id);
    await db.from('planit_inventory_groups').update({ position: posA }).eq('id', groups[swapIdx].id);
    loadGroups(supplierId);
}

function setInventurSortMode(mode) {
    window.inventurSortMode = mode;
    document.getElementById('inventur-sort-tab-inventory').classList.toggle('active', mode === 'inventory');
    document.getElementById('inventur-sort-tab-order').classList.toggle('active', mode === 'order');
    loadInventurConfig();
}

async function moveInventurItem(supplierId, index, direction, type) {
    const { data: supplier } = await db
        .from('planit_suppliers')
        .select('*, planit_inventory_items(*)')
        .eq('id', supplierId)
        .maybeSingle();

    if (!supplier) return;
    const posField = type === 'order' ? 'order_position' : 'inventory_position';
    const items = (supplier.planit_inventory_items || [])
        .sort((a, b) => (a[posField] ?? 0) - (b[posField] ?? 0));
    // Wenn alle Positionen gleich sind (z.B. alle null/0), erst mit eindeutigen Werten initialisieren
    if (type === 'order') {
        const positions = items.map(i => i[posField] ?? 0);
        const allSame = positions.every(p => p === positions[0]);
        if (allSame) {
            for (let i = 0; i < items.length; i++) {
                await db.from('planit_inventory_items').update({ [posField]: i }).eq('id', items[i].id);
                items[i][posField] = i;
            }
        }
    }

    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= items.length) return;

    const posA = items[index][posField] ?? index;
    const posB = items[swapIndex][posField] ?? swapIndex;

    await db.from('planit_inventory_items').update({ [posField]: posB }).eq('id', items[index].id);
    await db.from('planit_inventory_items').update({ [posField]: posA }).eq('id', items[swapIndex].id);

    loadInventurConfig();
}

async function loadHygiene() {
    const container = document.getElementById('hygiene-list');
    container.innerHTML = '<div style="color:var(--color-text-light); font-size:0.9rem;">Lädt…</div>';

    const [{ data }, { data: restaurant }, { data: inactiveData }] = await Promise.all([
        db.from('employees_planit')
            .select('id, name, department, hygiene_erste, hygiene_letzte, hygiene_gueltig_monate')
            .eq('user_id', adminSession.user.id)
            .eq('is_active', true)
            .order('name'),
        db.from('planit_restaurants')
            .select('hygiene_link_erst, hygiene_link_erneuerung')
            .eq('user_id', adminSession.user.id)
            .maybeSingle(),
        db.from('employees_planit')
            .select('id, name, department, hygiene_erste, hygiene_letzte, hygiene_gueltig_monate')
            .eq('user_id', adminSession.user.id)
            .eq('is_active', false)
            .order('name'),
    ]);
    console.log('inaktive Mitarbeiter:', inactiveData?.length);

    const erstInput = document.getElementById('hygiene-link-erst');
    const erneuerungInput = document.getElementById('hygiene-link-erneuerung');
    if (erstInput) erstInput.value = restaurant?.hygiene_link_erst || '';
    if (erneuerungInput) erneuerungInput.value = restaurant?.hygiene_link_erneuerung || '';

    if (!data || data.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine aktiven Mitarbeiter gefunden.</p></div>';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    function addMonths(dateStr, months) {
        const d = new Date(dateStr + 'T00:00:00');
        d.setMonth(d.getMonth() + months);
        return d;
    }

    function fmtD(dateStr) {
        if (!dateStr) return '–';
        return new Date(dateStr + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
    }

    function statusBadge(naechste) {
        const s = 'width:18px; height:18px; display:inline-block; border-radius:50%; padding:2px; flex-shrink:0;';
        if (!naechste) return `<span style="${s} background:#e2e3e5;"><svg viewBox="0 0 24 24" fill="none" stroke="#6c757d" stroke-width="3"><circle cx="12" cy="12" r="1"/><line x1="12" y1="6" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="18"/><line x1="12" y1="8" x2="12" y2="16"/></svg></span>`;
        const diff = (naechste - today) / (1000 * 60 * 60 * 24);
        if (diff < 0)  return `<span style="${s} background:#f8d7da;"><svg viewBox="0 0 24 24" fill="none" stroke="#dc3545" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>`;
        if (diff < 14) return `<span style="${s} background:#fff3cd;"><svg viewBox="0 0 24 24" fill="none" stroke="#856404" stroke-width="3"><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="17" r="0.5" fill="#856404" stroke="#856404"/></svg></span>`;
        return `<span style="${s} background:#d4edda;"><svg viewBox="0 0 24 24" fill="none" stroke="#28a745" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span>`;
    }

    const groups = {};
    for (const emp of data) {
        const dept = emp.department || 'Allgemein';
        if (!groups[dept]) groups[dept] = [];
        groups[dept].push(emp);
    }

    const activeHtml = Object.entries(groups).map(([dept, emps]) => {
        const rows = emps.map(emp => {
            const monate = emp.hygiene_gueltig_monate ?? 12;
            const basisDatum = emp.hygiene_letzte || emp.hygiene_erste || null;
            const naechste = basisDatum ? addMonths(basisDatum, monate) : null;
            const naechsteStr = naechste ? naechste.toISOString().split('T')[0] : null;
            return `
            <div style="border-bottom:1px solid #F0F0F0;">
                <div onclick="const b=this.nextElementSibling; const open=b.style.display!=='none'; b.style.display=open?'none':'block'; this.querySelector('.hyg-arrow').textContent=open?'▶':'▼';"
                     class="hygiene-row" style="display:grid; gap:0.5rem; align-items:center; padding:0.6rem 0; font-size:0.85rem; cursor:pointer;">
                    <div style="font-weight:600;">${emp.name}</div>
                    <div style="color:var(--color-text-light);">${fmtD(emp.hygiene_erste)}</div>
                    <div style="color:var(--color-text-light);">${naechsteStr ? fmtD(naechsteStr) : '–'}</div>
                    <div>${statusBadge(naechste)}</div>
                    <div class="hyg-arrow" style="color:var(--color-text-light); font-size:0.7rem; min-width:1rem; text-align:center;">▶</div>
                </div>
                <div style="display:none; padding:0.75rem 0 1rem;">
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.75rem; margin-bottom:0.75rem;">
                        <div>
                            <label style="font-size:0.75rem; color:var(--color-text-light); display:block; margin-bottom:0.25rem;">Erstbelehrung</label>
                            <input type="date" id="hyg-erste-${emp.id}" value="${emp.hygiene_erste || ''}" style="width:100%; padding:0.4rem; font-size:0.85rem; border:1px solid #ddd; border-radius:6px;">
                        </div>
                        <div>
                            <label style="font-size:0.75rem; color:var(--color-text-light); display:block; margin-bottom:0.25rem;">Letzte</label>
                            <input type="date" id="hyg-letzte-${emp.id}" value="${emp.hygiene_letzte || ''}" style="width:100%; padding:0.4rem; font-size:0.85rem; border:1px solid #ddd; border-radius:6px;">
                        </div>
                        <div>
                            <label style="font-size:0.75rem; color:var(--color-text-light); display:block; margin-bottom:0.25rem;">Gültig (Monate)</label>
                            <input type="number" id="hyg-monate-${emp.id}" value="${monate}" min="1" style="width:100%; padding:0.4rem; font-size:0.85rem; border:1px solid #ddd; border-radius:6px;">
                        </div>
                    </div>
                    <button onclick="saveHygiene('${emp.id}')" class="btn-primary" style="padding:0.4rem 1rem; font-size:0.85rem;">Speichern</button>
                </div>
            </div>`;
        }).join('');

        return `
        <div style="font-size:0.75rem; font-weight:700; color:var(--color-text-light); letter-spacing:0.08em; margin:1rem 0 0.4rem;">${dept.toUpperCase()}</div>
        <div style="background:white; border-radius:12px; overflow:hidden; padding:0 0.75rem;">
            <div class="hygiene-row" style="display:grid; gap:0.5rem; padding:0.4rem 0; border-bottom:2px solid #F0F0F0; font-size:0.7rem; font-weight:700; color:var(--color-text-light);">
                <div>NAME</div><div>ERSTE</div><div>NÄCHSTE</div><div></div><div></div>
            </div>
            ${rows}
        </div>`;
    }).join('');

    let inactiveContent = '';
    if (inactiveData && inactiveData.length > 0) {
        const inactiveRows = inactiveData.map(emp => {
            const monate = emp.hygiene_gueltig_monate ?? 12;
            const basisDatum = emp.hygiene_letzte || emp.hygiene_erste || null;
            const naechste = basisDatum ? addMonths(basisDatum, monate) : null;
            const naechsteStr = naechste ? naechste.toISOString().split('T')[0] : null;
            return `
            <div style="border-bottom:1px solid #F0F0F0;">
                <div class="hygiene-row" style="display:grid; gap:0.5rem; align-items:center; padding:0.6rem 0; font-size:0.85rem;">
                    <div style="font-weight:600; color:var(--color-text-light);">${emp.name}</div>
                    <div style="color:var(--color-text-light);">${fmtD(emp.hygiene_erste)}</div>
                    <div style="color:var(--color-text-light);">${naechsteStr ? fmtD(naechsteStr) : '–'}</div>
                    <div>${statusBadge(naechste)}</div>
                    <div></div>
                </div>
            </div>`;
        }).join('');
        inactiveContent = `
            <div style="background:white; border-radius:12px; overflow:hidden; padding:0 0.75rem; margin-top:0.4rem;">
                <div class="hygiene-row" style="display:grid; gap:0.5rem; padding:0.4rem 0; border-bottom:2px solid #F0F0F0; font-size:0.7rem; font-weight:700; color:var(--color-text-light);">
                    <div>NAME</div><div>ERSTE</div><div>NÄCHSTE</div><div></div><div></div>
                </div>
                ${inactiveRows}
            </div>`;
    } else {
        inactiveContent = `<p style="font-size:0.85rem; color:var(--color-text-light); margin:0.5rem 0 0;">Keine ehemaligen Mitarbeiter</p>`;
    }

    const inactiveHtml = `
        <div style="margin-top:1.5rem;">
            <div onclick="const b=document.getElementById('hygiene-inactive-body'); const open=b.style.display!=='none'; b.style.display=open?'none':'block'; this.querySelector('.hyg-inactive-arrow').textContent=open?'▶':'▼';"
                 style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem; background:#F5F5F5; border-radius:8px; cursor:pointer;">
                <span style="font-weight:700; font-size:1.1rem; color:var(--color-primary);">Ehemalige Mitarbeiter</span>
                <span class="hyg-inactive-arrow" style="font-size:0.85rem; color:var(--color-text-light);">▶</span>
            </div>
            <div id="hygiene-inactive-body" style="display:none; margin-top:0.5rem;">
                ${inactiveContent}
            </div>
        </div>`;

    container.innerHTML = activeHtml + inactiveHtml;
}

async function saveHygiene(employeeId) {
    const erste = document.getElementById(`hyg-erste-${employeeId}`).value || null;
    const letzte = document.getElementById(`hyg-letzte-${employeeId}`).value || null;
    const monate = parseInt(document.getElementById(`hyg-monate-${employeeId}`).value) || 12;
    await db.from('employees_planit').update({
        hygiene_erste: erste,
        hygiene_letzte: letzte,
        hygiene_gueltig_monate: monate
    }).eq('id', employeeId);
    await Promise.all([loadHygiene(), loadHygieneBadge()]);
}

async function saveHygieneLinks() {
    const erst = document.getElementById('hygiene-link-erst').value.trim() || null;
    const erneuerung = document.getElementById('hygiene-link-erneuerung').value.trim() || null;
    const btn = document.querySelector('#hygiene-links-body button');
    if (btn) { btn.disabled = true; btn.textContent = 'Speichert…'; }

    const { error } = await db.from('planit_restaurants')
        .update({ hygiene_link_erst: erst, hygiene_link_erneuerung: erneuerung })
        .eq('user_id', adminSession.user.id);

    if (btn) { btn.disabled = false; btn.textContent = 'Speichern'; }

    if (error) {
        alert('Fehler beim Speichern: ' + error.message);
        return;
    }

    const body = document.getElementById('hygiene-links-body');
    if (body) body.style.display = 'none';
    const arrow = document.querySelector('.hyg-links-arrow');
    if (arrow) arrow.textContent = '▶';

    const header = document.querySelector('.hyg-links-arrow')?.closest('div[style*="background:#F5F5F5"]');
    if (header) {
        const msg = document.createElement('span');
        msg.textContent = ' ✓ Gespeichert';
        msg.style.cssText = 'font-size:0.8rem; color:#155724; font-weight:500; margin-left:0.5rem;';
        header.querySelector('span:first-child').appendChild(msg);
        setTimeout(() => msg.remove(), 2500);
    }
}
