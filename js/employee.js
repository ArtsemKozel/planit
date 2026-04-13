let currentEmployee = null;
let calendarDate = new Date();
let availDate = new Date();
let myShifts = [];
let selectedSwapShift = null;
let selectedAvailDays = {};
let overviewDate = new Date();
let empTrinkgeldDate = new Date();

// ── INIT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    currentEmployee = requireEmployeeSession();
    if (!currentEmployee) return;
    document.getElementById('employee-name').textContent = currentEmployee.name;

    const savedTab = localStorage.getItem('planit_emp_tab');
    if (savedTab) switchTab(savedTab);

    await loadWeekGrid();
    await loadVacations();
    await loadAvailability();
    await loadPayroll();
    await loadSwaps();
    await loadOverview();
    await loadVacationCalendar();
    await checkTrinkgeldVisibility();
    checkInventurVisibility();
});

function getBWHolidays(year) {
    return [
        `${year}-01-01`, // Neujahr
        `${year}-01-06`, // Heilige Drei Könige
        // Ostern dynamisch berechnen
        ...getEasterDates(year),
        `${year}-05-01`, // Tag der Arbeit
        `${year}-10-03`, // Tag der Deutschen Einheit
        `${year}-11-01`, // Allerheiligen
        `${year}-12-25`, // 1. Weihnachtstag
        `${year}-12-26`, // 2. Weihnachtstag
    ];
}

function getEasterDates(year) {
    // Gaußsche Osterformel
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
        addDays(easter, -2), // Karfreitag
        addDays(easter, 0),  // Ostersonntag
        addDays(easter, 1),  // Ostermontag
        addDays(easter, 39), // Christi Himmelfahrt
        addDays(easter, 49), // Pfingstsonntag
        addDays(easter, 50), // Pfingstmontag
        addDays(easter, 60), // Fronleichnam
    ];
}

// ── TAB WECHSEL ───────────────────────────────────────────
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.bottom-nav-item').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    const navBtn = document.getElementById('nav-' + tab);
    if (navBtn) navBtn.classList.add('active');
    if (tab === 'schichtplan') { loadWeekGrid(); loadMyRequests(); }
    if (tab === 'urlaub') { loadVacations(); loadVacationAccount(); }
    if (tab === 'profil') loadProfil();
    if (tab === 'stunden') loadMeineStunden();
    if (tab === 'trinkgeld') loadEmpTrinkgeld();
    if (tab === 'inventur-emp') loadEmpInventur();
    if (tab === 'mehr') {
        document.getElementById('trinkgeld-menu-item').style.display = 'none';
        const invItem = document.getElementById('inventur-emp-menu-item');
        if (invItem) invItem.style.display = 'none';
        Promise.all([checkTrinkgeldVisibility(), checkInventurVisibility()]);
    }
    localStorage.setItem('planit_emp_tab', tab);
}

// ── KALENDER ─────────────────────────────────────────────
let empWeekDate = new Date();

async function loadWeekGrid() {
    const monday = getMonday(empWeekDate);
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

    // Alle Schichten der Woche laden (alle Mitarbeiter)
    const { data: shifts } = await db
        .from('shifts')
        .select('*')
        .eq('user_id', currentEmployee.user_id)
        .gte('shift_date', firstDay)
        .lte('shift_date', lastDay);

    // Alle Mitarbeiter laden
    const { data: colleagues } = await db
        .from('employees_planit')
        .select('*')
        .eq('user_id', currentEmployee.user_id)
        .eq('is_active', true)
        .order('name');

    // Krankmeldungen für diese Woche laden
    const { data: sickLeaves } = await db
        .from('sick_leaves')
        .select('employee_id, start_date, end_date')
        .eq('user_id', currentEmployee.user_id)
        .lte('start_date', lastDay)
        .gte('end_date', firstDay);

    renderWeekGrid(days, shifts || [], colleagues || [], sickLeaves || []);
}

function renderWeekGrid(days, shifts, colleagues, sickLeaves = []) {
    const grid = document.getElementById('emp-week-grid');
    grid.innerHTML = '';
    const dayNames = ['Mo','Di','Mi','Do','Fr','Sa','So'];

    const corner = document.createElement('div');
    corner.className = 'week-header';
    grid.appendChild(corner);

    const weekHolidays = getBWHolidays(days[0].getFullYear());
    days.forEach((d, i) => {
        const dateStr = d.toISOString().split('T')[0];
        const isHoliday = weekHolidays.includes(dateStr);
        const header = document.createElement('div');
        header.className = 'week-header';
        header.innerHTML = `${dayNames[i]}<br><small style="color:${isHoliday ? '#E07070' : 'inherit'};">${d.getDate()}.${d.getMonth()+1}.${isHoliday ? ' 🎌' : ''}</small>`;
        grid.appendChild(header);
    });

    // Abteilungen sammeln
    const departments = [...new Set(colleagues.map(e => e.department || 'Allgemein'))];

    departments.forEach(dept => {
        // Abteilungs-Label
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

        // Offene Schichten Zeile
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
            cell.textContent = shift ? `${shift.start_time.slice(0,5)}\n${shift.end_time.slice(0,5)}` : '';
            cell.style.whiteSpace = 'pre';
            if (shift) cell.onclick = () => openRequestModal(shift);
            grid.appendChild(cell);
        });

        // Mitarbeiter der Abteilung
        const deptColleagues = colleagues.filter(e => (e.department || 'Allgemein') === dept);
        deptColleagues.forEach(emp => {
            const empCell = document.createElement('div');
            empCell.className = 'week-employee';
            empCell.textContent = emp.name.split(' ')[0];
            if (emp.id === currentEmployee.id) {
                empCell.style.color = 'var(--color-primary)';
                empCell.style.fontWeight = '700';
            }
            grid.appendChild(empCell);

            days.forEach(d => {
                const dateStr = d.toISOString().split('T')[0];
                const shift = shifts.find(s => s.employee_id === emp.id && s.shift_date === dateStr);
                const cell = document.createElement('div');
                const isOwn = emp.id === currentEmployee.id;
                cell.className = 'week-cell' + (shift ? ' has-shift' : '');
                if (shift && isOwn) cell.style.background = 'var(--color-primary)';
                cell.textContent = shift ? `${shift.start_time.slice(0,5)}\n${shift.end_time.slice(0,5)}` : '';
                cell.style.whiteSpace = 'pre';
                const isSick = sickLeaves.some(s => s.employee_id === emp.id && s.start_date <= dateStr && s.end_date >= dateStr);
                if (isSick && !shift) {
                    cell.style.background = '#FFE0CC';
                    cell.textContent = 'Krank';
                    cell.style.color = '#E07040';
                    cell.style.fontSize = '0.7rem';
                }
                grid.appendChild(cell);
            });
        });
    });
}

function changeWeek(dir) {
    empWeekDate.setDate(empWeekDate.getDate() + dir * 7);
    loadWeekGrid();
}

function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d;
}

// ── URLAUBSKALENDER ───────────────────────────────────────
let vacCalDate = new Date();

async function loadVacationCalendar() {
    const year = vacCalDate.getFullYear();
    const month = vacCalDate.getMonth();
    const monthStr = `${year}-${String(month+1).padStart(2,'0')}`;
    const monthNames = ['Januar','Februar','März','April','Mai','Juni',
                        'Juli','August','September','Oktober','November','Dezember'];
    document.getElementById('vac-cal-month-label').textContent = `${monthNames[month]} ${year}`;

    const firstDay = `${monthStr}-01`;
    const lastDay = `${year}-${String(month+1).padStart(2,'0')}-${new Date(year, month+1, 0).getDate()}`;

    const { data: all } = await db.from('vacation_requests')
        .select('*, employees_planit(name, department)')
        .eq('user_id', currentEmployee.user_id)
        .eq('status', 'approved')
        .or(`and(type.neq.payout,start_date.lte.${lastDay},end_date.gte.${firstDay}),and(type.eq.payout,payout_month.eq.${monthStr})`);

    renderVacationCalendar(year, month, all || []);
}

function renderVacationCalendar(year, month, vacations) {
    const container = document.getElementById('vac-calendar');
    container.innerHTML = '';

    const myDept = currentEmployee.department || 'Allgemein';
    // Nur eigene + gleiche Abteilung anzeigen
    const visible = vacations.filter(v =>
        v.employee_id === currentEmployee.id ||
        (v.employees_planit?.department || 'Allgemein') === myDept
    );

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
        const dayVacations = visible.filter(v => v.type !== 'payout' && v.start_date <= dateStr && v.end_date >= dateStr);
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
            dayEl.onclick = () => showEmpVacDayModal(dateStr, dayVacations);
        }

        grid.appendChild(dayEl);
    }

    container.appendChild(grid);

    // Liste der Urlaubseinträge dieses Monats — nur gleiche Abteilung
    if (visible.length > 0) {
        const fmtShort = d => { const p = d.split('-'); return `${parseInt(p[2])}.${parseInt(p[1])}.`; };
        const typeLabel = t => t === 'payout' ? '💰' : t === 'manual' ? '✏️' : '🏖';
        const listEl = document.createElement('div');
        listEl.style.marginTop = '1rem';
        const sorted = [...visible].sort((a, b) => a.start_date.localeCompare(b.start_date));
        listEl.innerHTML = sorted.map(v => {
            const name = v.employee_id === currentEmployee.id ? 'Ich' : (v.employees_planit?.name || '—');
            return `<div style="display:flex; justify-content:space-between; align-items:center; padding:0.35rem 0; border-bottom:1px solid var(--color-border); font-size:0.85rem;">
                <span>${typeLabel(v.type)} <strong>${name}</strong></span>
                <span style="color:var(--color-text-light);">${v.type === 'manual' ? fmtShort(v.start_date) : `${fmtShort(v.start_date)} – ${fmtShort(v.end_date)}`}</span>
            </div>`;
        }).join('');
        container.appendChild(listEl);
    }
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

function showEmpVacDayModal(dateStr, dayVacations) {
    const [y, , d] = dateStr.split('-');
    const date = new Date(dateStr + 'T12:00:00');
    const dayNames = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
    const monthNames = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
    document.getElementById('emp-vac-day-modal-title').textContent =
        `${dayNames[date.getDay()]}, ${parseInt(d)}. ${monthNames[date.getMonth()]} ${y}`;
    const typeLabel = t => t === 'payout' ? 'Auszahlung' : t === 'manual' ? 'Manuell' : 'Urlaub';
    const typeBg    = t => t === 'payout' ? '#FFF3CC' : t === 'manual' ? '#E8D0FF' : '#D8F0D8';
    const typeColor = t => t === 'payout' ? '#C9A24D' : t === 'manual' ? '#9B59B6' : '#4CAF50';
    document.getElementById('emp-vac-day-modal-body').innerHTML = dayVacations.map(v => {
        const name = v.employee_id === currentEmployee.id ? 'Ich' : (v.employees_planit?.name || '—');
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid var(--color-border);">
            <span style="font-weight:600;">${name}</span>
            <span style="font-size:0.75rem; padding:2px 8px; border-radius:6px; background:${typeBg(v.type)}; color:${typeColor(v.type)};">${typeLabel(v.type)}</span>
        </div>`;
    }).join('');
    document.getElementById('emp-vac-day-modal').classList.add('active');
}

function closeEmpVacDayModal() {
    document.getElementById('emp-vac-day-modal').classList.remove('active');
}

function changeVacCalMonth(dir) {
    vacCalDate.setMonth(vacCalDate.getMonth() + dir);
    loadVacationCalendar();
}

// ── URLAUB ────────────────────────────────────────────────
async function loadVacations() {
    const { data: vacations } = await db
        .from('vacation_requests')
        .select('*')
        .eq('employee_id', currentEmployee.id)
        .order('created_at', { ascending: false });

    const container = document.getElementById('vacation-list');

    if (!vacations || vacations.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Anträge vorhanden.</p></div>';
        return;
    }

    container.innerHTML = vacations.map(v => `
        <div class="list-item">
            <div class="list-item-info">
                <h4>${formatDate(v.start_date)} – ${formatDate(v.end_date)}</h4>
                <p>${v.reason || 'Kein Grund angegeben'}</p>
                ${v.status === 'rejected' && v.rejection_reason ? `<p style="color:var(--color-red); font-size:0.85rem; margin-top:0.3rem;">Grund: ${v.rejection_reason}</p>` : ''}
            </div>
            <span class="badge badge-${v.status}">
                ${v.status === 'pending' ? 'Ausstehend' : v.status === 'approved' ? 'Genehmigt' : 'Abgelehnt'}
            </span>
        </div>
    `).join('');
}

let _vacEmp = null;
let _vacPhases = null;
let _vacRequests = null;
let _vacYear = new Date().getFullYear();
let _vacLastAccount = null;

async function loadVacationAccount() {
    _vacYear = new Date().getFullYear();
    document.getElementById('vacation-year-label').textContent = _vacYear;

    const [{ data: emp }, { data: phases }, { data: requests }] = await Promise.all([
        db.from('employees_planit')
            .select('vacation_days_per_year, start_date, hours_per_vacation_day, carry_over_days, carry_over_hours')
            .eq('id', currentEmployee.id)
            .maybeSingle(),
        db.from('employment_phases')
            .select('*')
            .eq('employee_id', currentEmployee.id)
            .order('start_date'),
        db.from('vacation_requests')
            .select('deducted_days, deducted_hours, start_date, type')
            .eq('employee_id', currentEmployee.id)
            .eq('status', 'approved')
            .gte('start_date', `${_vacYear}-01-01`)
            .lte('start_date', `${_vacYear}-12-31`),
    ]);

    _vacEmp = emp;
    _vacPhases = phases || [];
    _vacRequests = requests || [];

    const cutoffEl = document.getElementById('vac-cutoff');
    cutoffEl.value = `${_vacYear}-12-31`;
    cutoffEl.disabled = false;

    renderVacationAccount(`${_vacYear}-12-31`);
}

async function renderVacationAccount(cutoffDate) {
    if (!_vacEmp && !_vacPhases) return;

    // Genehmigte Kündigung prüfen
    const { data: termination } = await db.from('planit_terminations')
        .select('approved_date')
        .eq('employee_id', currentEmployee.id)
        .eq('status', 'approved')
        .limit(1)
        .maybeSingle();

    const cutoffEl = document.getElementById('vac-cutoff');
    if (termination?.approved_date) {
        cutoffDate = termination.approved_date;
        cutoffEl.value = termination.approved_date;
        cutoffEl.disabled = true;
    } else {
        cutoffEl.disabled = false;
    }

    const year = _vacYear;
    const yearStart = `${year}-01-01`;
    const yearEnd = cutoffDate || `${year}-12-31`;

    const totalDays = _vacEmp?.vacation_days_per_year ?? 20;
    const hoursPerDay = _vacEmp?.hours_per_vacation_day || 8.0;
    const monthlyDays = totalDays / 12;

    // Anspruch berechnen — monatsweise
    let entitlement = 0;
    let entitlementH = 0;
    const activePhases = _vacPhases.filter(p =>
        p.start_date <= yearEnd && (!p.end_date || p.end_date >= yearStart)
    );

    if (activePhases.length > 0) {
        for (const phase of activePhases) {
            const phaseStart = new Date(Math.max(
                new Date(phase.start_date + 'T12:00:00'),
                new Date(yearStart + 'T12:00:00')
            ));
            const phaseEnd = new Date(Math.min(
                phase.end_date ? new Date(phase.end_date + 'T12:00:00') : new Date(yearEnd + 'T12:00:00'),
                new Date(yearEnd + 'T12:00:00')
            ));
            const phaseMonthlyDays = totalDays / 12;
            let phaseDays = 0;
            for (let m = phaseStart.getMonth(); m <= phaseEnd.getMonth(); m++) {
                const daysInMonth = new Date(year, m + 1, 0).getDate();
                const firstDay = m === phaseStart.getMonth() ? phaseStart.getDate() : 1;
                const lastDay  = m === phaseEnd.getMonth()   ? phaseEnd.getDate()   : daysInMonth;
                phaseDays += phaseMonthlyDays * ((lastDay - firstDay + 1) / daysInMonth);
            }
            if (phase.hours_per_vacation_day === 0) phaseDays = 0;
            entitlement += phaseDays;
            entitlementH += phaseDays * (phase.hours_per_vacation_day || 0);
        }
    } else {
        const cutoffEnd = new Date(yearEnd + 'T12:00:00');
        if (_vacEmp?.start_date) {
            const start = new Date(_vacEmp.start_date + 'T12:00:00');
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

    // Übertrag Vorjahr (direkt, keine Umrechnung)
    const carryover = _vacEmp?.carry_over_days || 0;
    const carryoverH = _vacEmp?.carry_over_hours || 0;

    // Genommene Tage bis cutoff — phasengenau, deducted_hours direkt
    const usedEntries = _vacRequests.filter(r => r.start_date <= yearEnd);
    const usedDays = usedEntries.reduce((sum, r) => sum + (r.deducted_days || 0), 0);
    const usedH = usedEntries.reduce((sum, r) => {
        if (r.deducted_hours != null) return sum + r.deducted_hours;
        const phase = _vacPhases.find(p => p.start_date <= r.start_date && (!p.end_date || p.end_date >= r.start_date));
        const hpd = phase ? (phase.hours_per_vacation_day || 0) : hoursPerDay;
        return sum + (r.deducted_days || 0) * hpd;
    }, 0);

    const remaining = entitlement + carryover - usedDays;
    const remainingH = entitlementH + carryoverH - usedH;

    // Für Erklär-Modal speichern
    _vacLastAccount = { entitlement, entitlementH, carryover, carryoverH,
        used: usedDays, usedH, remaining, remainingH, usedEntries, activePhases, yearEnd, year };

    const fmt2 = v => v.toFixed(2);
    const sub = v => `<span style="font-size:0.75rem; color:var(--color-text-light);">${v}</span>`;

    document.getElementById('vacation-account').style.color =
        remaining <= 3 ? '#E57373' : remaining <= 7 ? '#C9A24D' : 'var(--color-primary)';

    document.getElementById('vac-entitlement').innerHTML =
        `${fmt2(entitlement)} Tage<br>${sub(fmt2(entitlementH) + ' Std')}`;
    document.getElementById('vac-carryover').innerHTML =
        `${fmt2(carryover)} Tage<br>${sub(fmt2(carryoverH) + ' Std')}`;
    document.getElementById('vac-used-detail').innerHTML =
        `${fmt2(usedDays)} Tage<br>${sub(fmt2(usedH) + ' Std')}`;
    document.getElementById('vac-remaining-detail').innerHTML =
        `${fmt2(remaining)} Tage<br>${sub(fmt2(remainingH) + ' Std')}`;

    // Phasen-Info
    const phasesInfo = document.getElementById('vac-phases-info');
    if (activePhases.length > 0) {
        const fmt = d => { const p = d.split('-'); return `${p[2]}.${p[1]}.${p[0].slice(2)}`; };
        phasesInfo.innerHTML = activePhases.map(p =>
            `Std. pro UT: ${p.hours_per_vacation_day}h (${fmt(p.start_date)} – ${p.end_date ? fmt(p.end_date) : 'offen'})${p.notes ? ` · ${p.notes}` : ''}`
        ).join('<br>');
    } else {
        phasesInfo.innerHTML = `Std. pro UT: ${hoursPerDay}h`;
    }
}

function showVacExplain(type) {
    const d = _vacLastAccount;
    if (!d) return;
    const fmt = dateStr => { const p = dateStr.split('-'); return `${p[2]}.${p[1]}.${p[0].slice(2)}`; };
    const f2 = v => v.toFixed(2);

    let title = '', body = '';

    if (type === 'jahresanspruch') {
        title = 'Jahresanspruch – Berechnung';
        const totalDaysPerYear = _vacEmp?.vacation_days_per_year ?? 20;
        const yearStart = `${d.year}-01-01`;
        const yearEnd = d.yearEnd;
        if (d.activePhases.length > 0) {
            body = d.activePhases.map(p => {
                const phaseStart = new Date(Math.max(new Date(p.start_date + 'T12:00:00'), new Date(yearStart + 'T12:00:00')));
                const phaseEnd = new Date(Math.min(
                    p.end_date ? new Date(p.end_date + 'T12:00:00') : new Date(yearEnd + 'T12:00:00'),
                    new Date(yearEnd + 'T12:00:00')
                ));
                const monthlyDays = totalDaysPerYear / 12;
                let phaseDays = 0;
                for (let m = phaseStart.getMonth(); m <= phaseEnd.getMonth(); m++) {
                    const dim = new Date(d.year, m + 1, 0).getDate();
                    const first = m === phaseStart.getMonth() ? phaseStart.getDate() : 1;
                    const last  = m === phaseEnd.getMonth()   ? phaseEnd.getDate()   : dim;
                    phaseDays += monthlyDays * ((last - first + 1) / dim);
                }
                if (p.hours_per_vacation_day === 0) phaseDays = 0;
                return `<div style="padding:0.4rem 0; border-bottom:1px solid var(--color-border);">
                    <span style="color:var(--color-text-light);">${fmt(phaseStart.toISOString().split('T')[0])} – ${fmt(phaseEnd.toISOString().split('T')[0])}</span><br>
                    ${totalDaysPerYear}/12 × Tage = <strong>${f2(phaseDays)} Tage</strong>
                    <span style="color:var(--color-text-light); font-size:0.8rem;">(${p.hours_per_vacation_day} Std/UT${p.notes ? ' · ' + p.notes : ''})</span>
                </div>`;
            }).join('');
        } else {
            const anteilig = _vacEmp?.start_date && new Date(_vacEmp.start_date + 'T12:00:00').getFullYear() === d.year
                ? ` (anteilig ab ${fmt(_vacEmp.start_date)})` : '';
            body = `<div>${totalDaysPerYear} Tage/Jahr${anteilig}</div>`;
        }
        body += `<div style="margin-top:0.75rem; font-weight:700;">Gesamt: ${f2(d.entitlement)} Tage / ${f2(d.entitlementH)} Std</div>`;

    } else if (type === 'carryover') {
        title = 'Übertrag Vorjahr';
        body = `<div style="display:grid; grid-template-columns:auto 1fr; gap:0.25rem 1rem;">
            <span style="color:var(--color-text-light);">Tage</span><strong>${f2(d.carryover)}</strong>
            <span style="color:var(--color-text-light);">Stunden</span><strong>${f2(d.carryoverH)}</strong>
        </div>
        <div style="margin-top:0.75rem; font-size:0.8rem; color:var(--color-text-light);">Werte aus Mitarbeiter-Stammdaten — direkt addiert, keine Umrechnung.</div>`;

    } else if (type === 'genommen') {
        title = 'Genommen – Einträge';
        if (!d.usedEntries.length) {
            body = '<div style="color:var(--color-text-light);">Keine Einträge.</div>';
        } else {
            body = d.usedEntries.map(r => {
                const typeLabel = r.type === 'payout' ? '💰' : r.type === 'manual' ? '✏️' : '🏖';
                const hrs = r.deducted_hours != null ? ` / ${r.deducted_hours} Std` : '';
                return `<div style="display:flex; justify-content:space-between; padding:0.35rem 0; border-bottom:1px solid var(--color-border); font-size:0.85rem;">
                    <span>${typeLabel} ${fmt(r.start_date)}</span>
                    <span style="font-weight:600;">${f2(Math.round((r.deducted_days||0)*100)/100)} T${hrs}</span>
                </div>`;
            }).join('');
            body += `<div style="margin-top:0.75rem; font-weight:700;">Gesamt: ${f2(d.used)} Tage / ${f2(d.usedH)} Std</div>`;
        }

    } else if (type === 'uebrig') {
        title = 'Übrig – Formel';
        const remColor = d.remaining <= 3 ? '#E57373' : 'var(--color-primary)';
        body = `<div style="display:grid; grid-template-columns:auto 1fr auto; gap:0.35rem 0.75rem; align-items:baseline;">
            <span style="color:var(--color-text-light);">Jahresanspruch</span><span></span><span><strong>${f2(d.entitlement)} T</strong> / ${f2(d.entitlementH)} Std</span>
            <span style="color:var(--color-text-light);">+ Übertrag</span><span></span><span><strong>${f2(d.carryover)} T</strong> / ${f2(d.carryoverH)} Std</span>
            <span style="color:var(--color-text-light);">− Genommen</span><span></span><span><strong>${f2(d.used)} T</strong> / ${f2(d.usedH)} Std</span>
        </div>
        <div style="margin-top:0.75rem; padding-top:0.6rem; border-top:2px solid var(--color-border); font-weight:700; font-size:1.05rem; color:${remColor};">
            = ${f2(d.remaining)} Tage / ${f2(d.remainingH)} Std
        </div>`;
    }

    document.getElementById('vac-explain-title').textContent = title;
    document.getElementById('vac-explain-body').innerHTML = body;
    document.getElementById('vac-explain-modal').classList.add('active');
}

function closeVacExplainModal() {
    document.getElementById('vac-explain-modal').classList.remove('active');
}

let signaturePad = null;
let terminationSignaturePad = null;

function openVacationModal() {
    document.getElementById('vacation-modal').classList.add('open');
    document.getElementById('vacation-error').style.display = 'none';
    initSignaturePad();
}

function closeVacationModal() {
    document.getElementById('vacation-modal').classList.remove('open');
}

function initSignaturePad() {
    const canvas = document.getElementById('signature-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = 120;
    let drawing = false;

    canvas.addEventListener('pointerdown', e => { drawing = true; ctx.beginPath(); ctx.moveTo(e.offsetX, e.offsetY); });
    canvas.addEventListener('pointermove', e => { if (!drawing) return; ctx.lineTo(e.offsetX, e.offsetY); ctx.stroke(); });
    canvas.addEventListener('pointerup', () => drawing = false);
}

function clearSignature() {
    const canvas = document.getElementById('signature-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function initTerminationSignaturePad() {
    const canvas = document.getElementById('termination-signature-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = 120;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let drawing = false;
    // remove old listeners by cloning
    const fresh = canvas.cloneNode(true);
    canvas.parentNode.replaceChild(fresh, canvas);
    const ctx2 = fresh.getContext('2d');
    fresh.addEventListener('pointerdown', e => { drawing = true; ctx2.beginPath(); ctx2.moveTo(e.offsetX, e.offsetY); });
    fresh.addEventListener('pointermove', e => { if (!drawing) return; ctx2.lineTo(e.offsetX, e.offsetY); ctx2.stroke(); });
    fresh.addEventListener('pointerup', () => drawing = false);
    fresh.addEventListener('pointerleave', () => drawing = false);
}

function clearTerminationSignature() {
    const canvas = document.getElementById('termination-signature-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

async function submitVacation() {
    const type = document.getElementById('vacation-type').value;
    const errorDiv = document.getElementById('vacation-error');
    errorDiv.style.display = 'none';

    let start, end, payoutHours, deductedDays;

    if (type === 'payout') {
        payoutHours = parseFloat(document.getElementById('vacation-payout-hours').value) || 0;
        if (payoutHours <= 0) {
            errorDiv.textContent = 'Bitte Urlaubsstunden eingeben.';
            errorDiv.style.display = 'block';
            return;
        }
        const today = new Date().toISOString().split('T')[0];
        start = today;
        end = today;
    } else {
        start = document.getElementById('vacation-start').value;
        end = document.getElementById('vacation-end').value;
        if (!start || !end) {
            errorDiv.textContent = 'Bitte Start- und Enddatum auswählen.';
            errorDiv.style.display = 'block';
            return;
        }
    }

    // ERST Supabase speichern
    const { error } = await db.from('vacation_requests').insert({
    user_id: currentEmployee.user_id,
    employee_id: currentEmployee.id,
    start_date: start,
    end_date: end,
    reason: type === 'payout' ? `Auszahlung: ${payoutHours} Std` : null,
    status: 'pending',
    type: type
        });

    if (error) {
        errorDiv.textContent = 'Fehler: ' + error.message;
        errorDiv.style.display = 'block';
        return;
    }

    // DANN PDF
    const canvas = document.getElementById('signature-canvas');
    let signature = null;
    try { signature = canvas.toDataURL('image/png'); } catch(e) {}
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Urlaubsantrag', 20, 20);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('Mitarbeiter:', 20, 40);
    doc.setFont('helvetica', 'bold');
    doc.text(currentEmployee.name, 70, 40);
    doc.setFont('helvetica', 'normal');
    doc.text('Datum des Antrags:', 20, 52);
    doc.text(new Date().toLocaleDateString('de-DE'), 70, 52);
    doc.text('Art:', 20, 64);
    doc.text(type === 'payout' ? 'Auszahlung' : 'Urlaub', 70, 64);
    if (type === 'payout') {
        doc.text('Stunden:', 20, 76);
        doc.text(`${payoutHours} Std`, 70, 76);
        if (signature) {
            doc.text('Unterschrift:', 20, 100);
            doc.addImage(signature, 'PNG', 20, 105, 60, 25);
        }
    } else {
        doc.text('Von:', 20, 76);
        doc.text(formatDate(start), 70, 76);
        doc.text('Bis:', 20, 88);
        doc.text(formatDate(end), 70, 88);
        if (signature) {
            doc.text('Unterschrift:', 20, 122);
            doc.addImage(signature, 'PNG', 20, 127, 60, 25);
        }
    }
    // PDF in Supabase Storage speichern
    const pdfBlob = doc.output('blob');
    const fileName = `${currentEmployee.user_id}/${currentEmployee.id}_${start}_${Date.now()}.pdf`;
    const { data: uploadData, error: uploadError } = await db.storage
        .from('vacation-pdfs')
        .upload(fileName, pdfBlob, { contentType: 'application/pdf' });

    if (!uploadError) {
        // PDF URL in vacation_requests speichern
        const { data: latest } = await db
            .from('vacation_requests')
            .select('id')
            .eq('employee_id', currentEmployee.id)
            .eq('start_date', start)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(); 

        if (latest) {
            await db.from('vacation_requests')
                .update({ pdf_url: fileName })
                .eq('id', latest.id);
        }
    }

    // Lokal speichern
    doc.save(`Urlaubsantrag_${currentEmployee.name}_${start}.pdf`);
    closeVacationModal();
    setTimeout(() => loadVacations(), 500);
}

function toggleVacationFields() {
    const type = document.getElementById('vacation-type').value;
    document.getElementById('vacation-date-fields').style.display = type === 'payout' ? 'none' : 'block';
    document.getElementById('vacation-payout-fields').style.display = type === 'payout' ? 'block' : 'none';
}

// ── VERFÜGBARKEIT ─────────────────────────────────────────
async function renderAvailGrid(year, month) {
    const container = document.getElementById('avail-grid');
    container.innerHTML = '';

    // Urlaubstage laden (auch monatsübergreifende)
    const monthStart = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const monthEnd = `${year}-${String(month+1).padStart(2,'0')}-${new Date(year, month+1, 0).getDate()}`;
    const { data: vacations } = await db
        .from('vacation_requests')
        .select('start_date, end_date')
        .eq('employee_id', currentEmployee.id)
        .eq('status', 'approved')
        .lte('start_date', monthEnd)
        .gte('end_date', monthStart);

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = new Date(year, month, 1).getDay();
    const offset = firstWeekday === 0 ? 6 : firstWeekday - 1;

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
        const entry = selectedAvailDays[d] || null;
        const status = entry ? entry.status : null;

        const div = document.createElement('div');
        div.className = 'avail-day';
        div.style.flexDirection = 'column';
        div.style.fontSize = '0.75rem';
        div.style.gap = '2px';

        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isVacation = (vacations || []).some(v => v.start_date <= dateStr && v.end_date >= dateStr);

        if (isVacation) div.style.background = '#D0E8FF';
        else if (status === 'school') div.style.background = '#E8D0FF';
        else if (status === 'full') div.style.background = '#D8F0D8';
        else if (status === 'partial') div.style.background = '#FFF3CC';
        else if (status === 'off') div.style.background = '#FFD9D9';

        const timeLabel = (status === 'partial' && entry.from)
            ? `<span style="font-size:0.6rem">${entry.from}-${entry.to}</span>`
            : '';

        const timeHtml = (status === 'partial' && entry?.from)
            ? `<span style="font-size:0.6rem; line-height:1.2;">${entry.from}</span><span style="font-size:0.6rem; line-height:1.2;">${entry.to}</span>`
            : '';
        const commentTriangle = entry?.comment
            ? `<div style="position:absolute; top:0; left:0; width:0; height:0; border-top:8px solid #2C3E50; border-right:8px solid transparent;"></div>`
            : '';
        div.style.position = 'relative';
        div.innerHTML = `${commentTriangle}<span>${d}</span>${timeHtml}`;
        div.onclick = () => openAvailModal(d);
        container.appendChild(div);
    }
}

let currentAvailDay = null;

function openAvailModal(day) {
    currentAvailDay = day;
    document.getElementById('avail-modal-title').textContent = `${day}. – Verfügbarkeit`;
    document.getElementById('avail-time-fields').style.display = 'none';

    // Schule-Button nur für Azubis
    document.getElementById('avail-school-btn').style.display = 
        currentEmployee.is_apprentice ? 'block' : 'none';

    // Bestehenden Kommentar laden
    const entry = selectedAvailDays[day];
    document.getElementById('avail-comment').value = entry?.comment || '';

    // Bestehende Zeiten laden falls partial
    if (entry?.status === 'partial' && entry.from) {
        document.getElementById('avail-time-fields').style.display = 'block';
        document.getElementById('avail-from').value = entry.from;
        document.getElementById('avail-to').value = entry.to || '16:00';
    }

    document.getElementById('avail-modal').classList.add('open');
}

function closeAvailModal() {
    document.getElementById('avail-modal').classList.remove('open');
    currentAvailDay = null;
}

function setAvailStatus(status) {
    // Alle Buttons zurücksetzen
    document.querySelectorAll('#avail-modal .btn-secondary').forEach(btn => {
        btn.style.outline = 'none';
    });

    // Gewählten Button markieren
    const colors = { full: '#a0c8a0', partial: '#d4c070', off: '#d4a0a0' };
    event.currentTarget.style.outline = `2px solid ${colors[status]}`;

    document.getElementById('avail-time-fields').style.display = status === 'partial' ? 'block' : 'none';
    document.getElementById('avail-confirm-btn').style.display = status === 'partial' ? 'none' : 'block';

    if (!selectedAvailDays[currentAvailDay]) selectedAvailDays[currentAvailDay] = {};
    selectedAvailDays[currentAvailDay].status = status;
}

async function confirmAvail() {
    const status = selectedAvailDays[currentAvailDay]?.status;
    const comment = document.getElementById('avail-comment').value.trim();
    selectedAvailDays[currentAvailDay] = { status, ...(comment ? { comment } : {}) };
    await renderAvailGrid(availDate.getFullYear(), availDate.getMonth());
    closeAvailModal();
}

async function confirmPartialAvail() {
    const from = document.getElementById('avail-from').value;
    const to = document.getElementById('avail-to').value;
    const comment = document.getElementById('avail-comment').value.trim();
    selectedAvailDays[currentAvailDay] = { status: 'partial', from, to, ...(comment ? { comment } : {}) };
    await renderAvailGrid(availDate.getFullYear(), availDate.getMonth());
    closeAvailModal();
}

async function clearAvailDay() {
    delete selectedAvailDays[currentAvailDay];
    await renderAvailGrid(availDate.getFullYear(), availDate.getMonth());
    closeAvailModal();
}

async function loadAvailability() {
    const year = availDate.getFullYear();
    const month = availDate.getMonth();
    const monthStr = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const monthNames = ['Januar','Februar','März','April','Mai','Juni',
                        'Juli','August','September','Oktober','November','Dezember'];
    document.getElementById('avail-month-label').textContent = `${monthNames[month]} ${year}`;

    const { data } = await db
        .from('availability')
        .select('*')
        .eq('employee_id', currentEmployee.id)
        .eq('month', monthStr)
        .maybeSingle();

    selectedAvailDays = (data && !Array.isArray(data.available_days)) ? data.available_days : {};
    await renderAvailGrid(year, month);
}

async function saveAvailability() {
    const year = availDate.getFullYear();
    const month = availDate.getMonth();
    const monthStr = `${year}-${String(month+1).padStart(2,'0')}-01`;

    const { data: existing } = await db
        .from('availability')
        .select('id')
        .eq('employee_id', currentEmployee.id)
        .eq('month', monthStr)
        .maybeSingle();

    if (existing) {
        await db.from('availability').update({
            available_days: selectedAvailDays
        }).eq('id', existing.id);
    } else {
        await db.from('availability').insert({
            user_id: currentEmployee.user_id,
            employee_id: currentEmployee.id,
            month: monthStr,
            available_days: selectedAvailDays
        });
    }
    alert('Verfügbarkeit gespeichert! ✅');
}

function changeAvailMonth(dir) {
    availDate.setMonth(availDate.getMonth() + dir);
    loadAvailability();
}

// ── LOHNABRECHNUNG ────────────────────────────────────────
async function loadPayroll() {
    const { data: docs } = await db
        .from('payroll_documents')
        .select('*')
        .eq('employee_id', currentEmployee.id)
        .order('month', { ascending: false });

    const container = document.getElementById('payroll-list');

    if (!docs || docs.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Abrechnungen vorhanden.</p></div>';
        return;
    }

    container.innerHTML = docs.map(d => `
        <div class="list-item">
            <div class="list-item-info">
                <h4>${formatMonthYear(d.month)}</h4>
                <p>Lohnabrechnung</p>
            </div>
            <a href="${d.file_url}" target="_blank" class="btn-small btn-approve">
                PDF öffnen
            </a>
        </div>
    `).join('');
}

// ── SCHICHTTAUSCH ─────────────────────────────────────────
async function loadSwaps() {
    // Zukünftige Schichten laden
    const today = new Date().toISOString().split('T')[0];
    const { data: shifts } = await db
        .from('shifts')
        .select('*')
        .eq('employee_id', currentEmployee.id)
        .gte('shift_date', today)
        .order('shift_date');

    const shiftsList = document.getElementById('swap-shifts-list');

    if (!shifts || shifts.length === 0) {
        shiftsList.innerHTML = '<div class="empty-state"><p>Keine Schichten vorhanden.</p></div>';
    } else {
        shiftsList.innerHTML = shifts.map(s => `
            <div class="list-item" onclick="openShiftActionModal('${s.id}', '${s.shift_date}', '${s.start_time}', '${s.end_time}')">
                <div class="list-item-info">
                    <h4>${formatDate(s.shift_date)}</h4>
                    <p>${s.start_time.slice(0,5)} – ${s.end_time.slice(0,5)} Uhr</p>
                </div>
                <span style="color:var(--color-text-light); font-size:0.85rem;">›</span>
            </div>
        `).join('');
    }

    // Meine Requests laden
    const { data: swaps } = await db
        .from('shift_swaps')
        .select('*, shifts!shift_id(shift_date, start_time, end_time), target:shifts!target_shift_id(shift_date, start_time, end_time), to_emp:employees_planit!to_employee_id(name)')
        .eq('from_employee_id', currentEmployee.id)
        .order('created_at', { ascending: false });

    const requestsList = document.getElementById('swap-requests-list');
    if (!swaps || swaps.length === 0) {
        requestsList.innerHTML = '<div class="empty-state"><p>Keine Requests vorhanden.</p></div>';
    } else {
        requestsList.innerHTML = swaps.map(s => {
            const myShift = s.shifts;
            const theirShift = s.target;
            const colleague = s.to_emp;
            const colleagueStatus = s.to_employee_status === 'pending' ? 'Wartet auf Kollege' : s.to_employee_status === 'accepted' ? 'Kollege ✓' : 'Kollege ✗';
            const adminStatus = s.status === 'pending' ? 'Wartet auf Admin' : s.status === 'approved' ? 'Genehmigt' : 'Abgelehnt';
            return `
                <div class="list-item" style="flex-direction:column; align-items:flex-start; gap:0.5rem;">
                    <div style="display:flex; justify-content:space-between; width:100%;">
                        <h4 style="font-size:0.95rem;">${colleague?.name || '—'}</h4>
                        <span class="badge badge-${s.status}">${adminStatus}</span>
                    </div>
                    <div style="font-size:0.85rem; color:var(--color-text-light);">
                        Meine Schicht: ${myShift ? formatDate(myShift.shift_date) + ' ' + myShift.start_time.slice(0,5) + ' – ' + myShift.end_time.slice(0,5) : '—'}
                    </div>
                    <div style="font-size:0.85rem; color:var(--color-text-light);">
                        Ihre Schicht: ${theirShift ? formatDate(theirShift.shift_date) + ' ' + theirShift.start_time.slice(0,5) + ' – ' + theirShift.end_time.slice(0,5) : '—'}
                    </div>
                    <span style="font-size:0.75rem; color:var(--color-text-light);">${colleagueStatus}</span>
                </div>`;
        }).join('');
    }

    // Meine Abgabe-Requests laden
    const { data: handovers } = await db
        .from('shift_handovers')
        .select('*, shifts(shift_date, start_time, end_time), to_emp:employees_planit!to_employee_id(name)')
        .eq('from_employee_id', currentEmployee.id)
        .order('created_at', { ascending: false });

    const handoverList = document.getElementById('handover-requests-list');
    if (!handovers || handovers.length === 0) {
        handoverList.innerHTML = '<div style="color:var(--color-text-light); font-size:0.85rem;">Keine Abgabe-Requests.</div>';
    } else {
        handoverList.innerHTML = handovers.map(h => {
            const status = h.status === 'pending' ? 'Ausstehend' : h.status === 'approved' ? 'Genehmigt' : 'Abgelehnt';
            return `
                <div class="list-item" style="flex-direction:column; align-items:flex-start; gap:0.5rem;">
                    <div style="display:flex; justify-content:space-between; width:100%;">
                        <h4 style="font-size:0.95rem;">→ ${h.to_emp?.name || '—'}</h4>
                        <span class="badge badge-${h.status}">${status}</span>
                    </div>
                    <div style="font-size:0.85rem; color:var(--color-text-light);">
                        ${h.shifts ? formatDate(h.shifts.shift_date) + ' ' + h.shifts.start_time.slice(0,5) + ' – ' + h.shifts.end_time.slice(0,5) : '—'}
                    </div>
                </div>`;
        }).join('');
    }

    // Eingehende Requests laden
    const { data: incomingSwaps } = await db
        .from('shift_swaps')
        .select('*, shifts!shift_id(shift_date, start_time, end_time), target:shifts!target_shift_id(shift_date, start_time, end_time), from_emp:employees_planit!from_employee_id(name)')
        .eq('to_employee_id', currentEmployee.id)
        .eq('to_employee_status', 'pending')
        .order('created_at', { ascending: false });

    const incomingList = document.getElementById('swap-incoming-list');
    if (!incomingSwaps || incomingSwaps.length === 0) {
        incomingList.innerHTML = '<div style="color:var(--color-text-light); font-size:0.85rem;">Keine eingehenden Requests.</div>';
    } else {
        incomingList.innerHTML = incomingSwaps.map(s => {
            const myShift = s.target;
            const theirShift = s.shifts;
            const colleague = s.from_emp;
            return `
                <div class="list-item" style="flex-direction:column; align-items:flex-start; gap:0.5rem;">
                    <div style="font-weight:700; font-size:0.95rem;">${colleague?.name || '—'} möchte tauschen</div>
                    <div style="font-size:0.85rem; color:var(--color-text-light);">
                        Ihre Schicht: ${theirShift ? formatDate(theirShift.shift_date) + ' ' + theirShift.start_time.slice(0,5) + ' – ' + theirShift.end_time.slice(0,5) : '—'}
                    </div>
                    <div style="font-size:0.85rem; color:var(--color-text-light);">
                        Meine Schicht: ${myShift ? formatDate(myShift.shift_date) + ' ' + myShift.start_time.slice(0,5) + ' – ' + myShift.end_time.slice(0,5) : '—'}
                    </div>
                    <div style="display:flex; gap:0.5rem; margin-top:0.25rem;">
                        <button class="btn-text btn-approve" onclick="respondSwap('${s.id}', 'accepted')">✓ Akzeptieren</button>
                        <button class="btn-text btn-reject" onclick="respondSwap('${s.id}', 'rejected')">✕ Ablehnen</button>
                    </div>
                </div>`;
        }).join('');
    }

    // Schichten die abgegeben werden (eigene Abteilung)
    const { data: handoverShifts, error: handoverError } = await db
        .from('shifts')
        .select('*, employees_planit!shifts_employee_id_fkey(name)')
        .eq('handover_requested', true)
        .neq('employee_id', currentEmployee.id)
        .gte('shift_date', new Date().toISOString().split('T')[0])
        .order('shift_date');

    const handoverShiftsList = document.getElementById('handover-shifts-list');
    if (!handoverShifts || handoverShifts.length === 0) {
        handoverShiftsList.innerHTML = '<div style="color:var(--color-text-light); font-size:0.85rem;">Keine Schichten zur Übernahme.</div>';
    } else {
        handoverShiftsList.innerHTML = handoverShifts.map(s => `
            <div class="list-item" style="flex-direction:column; align-items:flex-start; gap:0.5rem;">
                <div>
                    <div style="font-weight:700; font-size:0.95rem;">${s.employees_planit?.name || '—'} gibt ab</div>
                    <div style="font-size:0.85rem; color:var(--color-text-light);">
                        ${formatDate(s.shift_date)} | ${s.start_time.slice(0,5)} – ${s.end_time.slice(0,5)} Uhr
                    </div>
                </div>
                <button class="btn-text btn-approve" onclick="applyForHandover('${s.id}')">Ich übernehme</button>
            </div>
        `).join('');
    }
}

async function applyForHandover(shiftId) {
    const { error } = await db.from('shift_handovers').insert({
        user_id: currentEmployee.user_id,
        shift_id: shiftId,
        from_employee_id: null,
        to_employee_id: currentEmployee.id,
        status: 'pending'
    });
    if (!error) {
        alert('Du hast dich für die Schicht gemeldet!');
        await loadSwaps();
    }
}

async function respondSwap(swapId, response) {
    const { error } = await db
        .from('shift_swaps')
        .update({ to_employee_status: response })
        .eq('id', swapId);

    if (!error) await loadSwaps();
}

async function openSwapModal(shiftId, date, start, end) {
    selectedSwapShift = shiftId;
    document.getElementById('swap-shift-info').textContent = 
        `${formatDate(date)} | ${start.slice(0,5)} – ${end.slice(0,5)} Uhr`;

    // Kollegen laden
    const { data: colleagues } = await db
        .from('employees_planit')
        .select('id, name')
        .eq('user_id', currentEmployee.user_id)
        .eq('is_active', true)
        .neq('id', currentEmployee.id);

    const select = document.getElementById('swap-colleague');
    select.innerHTML = colleagues
        ? colleagues.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
        : '<option>Keine Kollegen gefunden</option>';

    document.getElementById('swap-modal').classList.add('open');
    document.getElementById('swap-error').style.display = 'none';
}

let selectedActionShift = null;

function openShiftActionModal(shiftId, date, start, end) {
    selectedActionShift = { id: shiftId, date, start, end };
    document.getElementById('shift-action-info').textContent = 
        `${formatDate(date)} | ${start.slice(0,5)} – ${end.slice(0,5)} Uhr`;
    document.getElementById('shift-action-modal').classList.add('active');
}

function openSwapFromAction() {
    document.getElementById('shift-action-modal').classList.remove('active');
    openSwapModal(selectedActionShift.id, selectedActionShift.date, selectedActionShift.start, selectedActionShift.end);
}

async function openHandoverFromAction() {
    document.getElementById('shift-action-modal').classList.remove('active');
    if (!confirm('⚠️ Wenn niemand deine Schicht übernimmt oder der Admin ablehnt, musst du trotzdem erscheinen. Bist du sicher?')) return;
    
    const { error } = await db.from('shifts')
        .update({ handover_requested: true })
        .eq('id', selectedActionShift.id);
    console.log('handover update error:', error, 'shiftId:', selectedActionShift.id);
    if (!error) {
        alert('Abgabe-Request wurde gesendet. Deine Kollegen werden informiert.');
        await loadSwaps();
    }
}

async function loadColleagueShifts() {
    const colleagueId = document.getElementById('swap-colleague').value;
    const select = document.getElementById('swap-target-shift');
    select.innerHTML = '<option value="">Wird geladen...</option>';
    
    if (!colleagueId) {
        select.innerHTML = '<option value="">— Kollege wählen —</option>';
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const { data: shifts } = await db
        .from('shifts')
        .select('*')
        .eq('employee_id', colleagueId)
        .eq('user_id', currentEmployee.user_id)
        .gte('shift_date', today)
        .order('shift_date');

    if (!shifts || shifts.length === 0) {
        select.innerHTML = '<option value="">Keine Schichten gefunden</option>';
        return;
    }

    select.innerHTML = shifts.map(s =>
        `<option value="${s.id}">${formatDate(s.shift_date)} | ${s.start_time.slice(0,5)} – ${s.end_time.slice(0,5)} Uhr</option>`
    ).join('');
}

function closeSwapModal() {
    document.getElementById('swap-modal').classList.remove('open');
}

async function submitSwap() {
    const toEmployee = document.getElementById('swap-colleague').value;
    const targetShiftId = document.getElementById('swap-target-shift').value;
    const errorDiv = document.getElementById('swap-error');
    errorDiv.style.display = 'none';

    if (!targetShiftId) {
        errorDiv.textContent = 'Bitte eine Schicht des Kollegen auswählen.';
        errorDiv.style.display = 'block';
        return;
    }

    const { error } = await db.from('shift_swaps').insert({
        user_id: currentEmployee.user_id,
        shift_id: selectedSwapShift,
        from_employee_id: currentEmployee.id,
        to_employee_id: toEmployee,
        target_shift_id: targetShiftId,
        status: 'pending',
        to_employee_status: 'pending'
    });

    if (error) {
        errorDiv.textContent = 'Fehler beim Senden.';
        errorDiv.style.display = 'block';
        return;
    }
    closeSwapModal();
    await loadSwaps();
}

// ── ÜBERSICHT ─────────────────────────────────────────────
async function loadOverview() {
    const now = overviewDate;
    const today = new Date().toISOString().split('T')[0];
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${new Date(now.getFullYear(), now.getMonth()+1, 0).getDate()}`;
    const monthNames = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
    const dayNames = ['So','Mo','Di','Mi','Do','Fr','Sa'];

    document.getElementById('overview-month').textContent = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
    document.getElementById('overview-open-month').textContent = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;

    const [
        { data: sickLeave },
        { data: termination },
        { data: shifts },
        { data: sickShifts },
        { data: mySickLeave },
    ] = await Promise.all([
        db.from('sick_leaves').select('start_date, end_date')
            .eq('employee_id', currentEmployee.id)
            .gte('end_date', today).order('start_date').limit(1).maybeSingle(),
        db.from('planit_terminations').select('id, created_at, requested_date, status')
            .eq('employee_id', currentEmployee.id)
            .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        db.from('shifts').select('*')
            .eq('employee_id', currentEmployee.id)
            .gte('shift_date', monthStart).lte('shift_date', monthEnd).order('shift_date'),
        db.from('shifts').select('*')
            .eq('user_id', currentEmployee.user_id)
            .eq('is_open', true).eq('open_note', 'Krankmeldung')
            .gte('shift_date', monthStart).lte('shift_date', monthEnd).order('shift_date'),
        db.from('sick_leaves').select('start_date, end_date')
            .eq('employee_id', currentEmployee.id)
            .gte('end_date', monthStart).lte('start_date', monthEnd).maybeSingle(),
    ]);

    const sickCard = document.getElementById('sick-leave-card');
    if (sickLeave) {
        sickCard.style.display = 'block';
        sickCard.innerHTML = `
            <div style="background:#FFE8D0; border-radius:12px; padding:1rem; margin-bottom:1rem; display:flex; align-items:center; gap:0.75rem;">
                <span style="font-size:1.5rem;">🤒</span>
                <div>
                    <div style="font-weight:700; font-size:0.95rem;">Du bist krank gemeldet</div>
                    <div style="font-size:0.85rem; color:#E07040;">${formatDate(sickLeave.start_date)} – ${formatDate(sickLeave.end_date)}</div>
                </div>
            </div>`;
    } else {
        sickCard.style.display = 'none';
    }

    const terminationCard = document.getElementById('termination-info-card');
    if (termination) {
        const submittedDate = new Date(termination.created_at).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
        const lastDay = termination.requested_date ? new Date(termination.requested_date + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) : '–';
        const badgeColor = termination.status === 'approved' ? '#2d7a2d' : termination.status === 'rejected' ? 'var(--color-danger)' : '#B8860B';
        const badgeBg = termination.status === 'approved' ? '#E6F4E6' : termination.status === 'rejected' ? '#FFE8E8' : '#FFF3CD';
        const badgeLabel = termination.status === 'approved' ? 'Genehmigt' : termination.status === 'rejected' ? 'Abgelehnt' : 'Ausstehend';
        terminationCard.style.display = 'block';
        terminationCard.innerHTML = `
            <div class="card" style="margin-bottom:1rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                    <div style="font-weight:700; font-size:0.95rem;">Kündigung eingereicht</div>
                    <span style="font-size:0.78rem; font-weight:700; color:${badgeColor}; background:${badgeBg}; border-radius:6px; padding:0.2rem 0.55rem;">${badgeLabel}</span>
                </div>
                ${termination.status === 'approved' ? `<div style="font-size:0.9rem; font-weight:600; color:#2d7a2d; margin-bottom:0.4rem;">Letzter Arbeitstag: ${lastDay}</div>` : ''}
                <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                    <div>
                        <div style="font-size:0.85rem; color:var(--color-text-light); margin-bottom:0.2rem;">Eingereicht am: ${submittedDate}</div>
                        <div style="font-size:0.85rem; color:var(--color-text-light);">Gewünschter letzter Arbeitstag: <strong>${lastDay}</strong></div>
                    </div>
                    <button class="btn-small btn-delete btn-icon" onclick="deleteOwnTermination('${termination.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
                </div>
            </div>`;
    } else {
        terminationCard.style.display = 'none';
    }


    const mySickShifts = (sickShifts || []).filter(s => 
        mySickLeave && s.shift_date >= mySickLeave.start_date && s.shift_date <= mySickLeave.end_date
    );

    const listEl = document.getElementById('overview-shifts-list');
    listEl.innerHTML = '';

    // Krankmeldungs-Schichten rosa hinzufügen
    mySickShifts.forEach(s => {
        const d = new Date(s.shift_date + 'T12:00:00');
        const row = document.createElement('div');
        row.style.cssText = `display:flex; align-items:center; gap:1rem; padding:0.75rem; border-radius:12px; margin-bottom:0.5rem; background:#FFF0F0;`;
        row.innerHTML = `
            <div style="min-width:2.5rem; text-align:center;">
                <div style="font-size:1.3rem; font-weight:700; line-height:1; color:#C97E7E;">${d.getDate()}</div>
                <div style="font-size:0.7rem; color:var(--color-text-light);">${dayNames[d.getDay()]}</div>
            </div>
            <div style="flex:1; background:white; border-radius:10px; padding:0.6rem 0.75rem;">
                <div style="font-weight:700; font-size:0.95rem; color:#C97E7E;">${s.start_time.slice(0,5)} – ${s.end_time.slice(0,5)}</div>
                <div style="font-size:0.8rem; color:#C97E7E;">Krankmeldung</div>
            </div>
        `;
        listEl.appendChild(row);
    });

    const allShifts = shifts || [];

    if (allShifts.length === 0) {
        listEl.innerHTML = '<div style="color:var(--color-text-light); font-size:0.9rem;">Keine Schichten diesen Monat</div>';
    } else {
        const makeRow = (s, highlighted) => {
            const d = new Date(s.shift_date + 'T12:00:00');
            const isPast = s.shift_date < today;
            const innerBg = isPast ? '#C9A24D' : 'white';
            const innerBorder = highlighted ? `box-shadow:0 0 0 2px var(--color-primary);` : '';
            const row = document.createElement('button');
            row.style.cssText = `display:flex; align-items:center; gap:1rem; padding:0.75rem; border-radius:12px; margin-bottom:0.5rem; background:var(--color-gray); cursor:pointer; width:100%; border:none; text-align:left; touch-action:manipulation;`;
            row.innerHTML = `
                <div style="min-width:2.5rem; text-align:center;">
                    <div style="font-size:1.3rem; font-weight:700; line-height:1; color:#2C3E50;">${d.getDate()}</div>
                    <div style="font-size:0.7rem; color:var(--color-text-light);">${dayNames[d.getDay()]}</div>
                </div>
                <div style="flex:1; background:${innerBg}; border-radius:10px; padding:0.6rem 0.75rem; ${innerBorder}">
                    <div style="font-weight:${highlighted ? '800' : '700'}; font-size:0.95rem; color:#2C3E50;">${s.start_time.slice(0,5)} – ${s.end_time.slice(0,5)}</div>
                    ${s.notes ? `<div style="font-size:0.8rem; color:var(--color-text-light);">${s.notes}</div>` : ''}
                </div>
            `;
            row.onclick = () => openColleaguesModal(s);
            return row;
        };

        // Nächste/aktuelle Schicht finden — erste mit Datum >= heute
        const nextIdx = allShifts.findIndex(s => s.shift_date >= today);
        // Mitte: 1 vergangene davor + nächste + 1 zukünftige danach
        const centerIdx = nextIdx >= 0 ? nextIdx : allShifts.length - 1;
        const visibleStart = Math.max(0, centerIdx - 1);
        const visibleEnd   = Math.min(allShifts.length, visibleStart + 3);
        const visible = allShifts.slice(visibleStart, visibleEnd);
        const hidden  = [...allShifts.slice(0, visibleStart), ...allShifts.slice(visibleEnd)];

        visible.forEach((s, i) => {
            listEl.appendChild(makeRow(s, visibleStart + i === centerIdx));
        });

        if (hidden.length > 0) {
            const moreContainer = document.createElement('div');
            moreContainer.id = 'overview-shifts-more';
            moreContainer.style.display = 'none';
            // Vergangene oben einfügen, restliche unten
            const pastHidden  = allShifts.slice(0, visibleStart);
            const futureHidden = allShifts.slice(visibleEnd);
            pastHidden.forEach(s => {
                const row = makeRow(s, false);
                listEl.insertBefore(row, listEl.firstChild);
            });
            futureHidden.forEach(s => moreContainer.appendChild(makeRow(s, false)));
            listEl.appendChild(moreContainer);

            const btn = document.createElement('button');
            btn.className = 'btn-secondary';
            btn.style.cssText = 'width:100%; margin-top:0.25rem; font-size:1rem; padding:0.4rem;';
            btn.textContent = '▼';
            let expanded = false;
            btn.onclick = () => {
                expanded = !expanded;
                moreContainer.style.display = expanded ? 'block' : 'none';
                // Vergangene Zeilen oben ein-/ausblenden
                const pastRows = listEl.querySelectorAll('[data-past]');
                pastRows.forEach(r => r.style.display = expanded ? 'flex' : 'none');
                btn.textContent = expanded ? '▲' : '▼';
            };
            // Vergangene Zeilen markieren und initial verstecken
            const addedPastRows = Array.from(listEl.children).slice(0, pastHidden.length);
            addedPastRows.forEach(r => { r.dataset.past = '1'; r.style.display = 'none'; });
            listEl.appendChild(btn);
        }
    }

    // Offene Schichten laden (eigene Abteilung)
    const { data: openShifts } = await db
        .from('shifts')
        .select('*')
        .eq('user_id', currentEmployee.user_id)
        .eq('is_open', true)
        .is('employee_id', null)
        .gte('shift_date', monthStart)
        .lte('shift_date', monthEnd)
        .order('shift_date');
    
    const filteredOpenShifts = (openShifts || []).filter(s => {
        if (s.open_note === 'Krankmeldung' && mySickLeave && 
            s.shift_date >= mySickLeave.start_date && s.shift_date <= mySickLeave.end_date) {
            return false;
        }
        return true;
    });

    const [{ data: hygieneEmp }, { data: hygieneRestaurant }] = await Promise.all([
        db.from('employees_planit')
            .select('hygiene_erste, hygiene_letzte, hygiene_gueltig_monate')
            .eq('id', currentEmployee.id)
            .maybeSingle(),
        db.from('planit_restaurants')
            .select('hygiene_link_erst, hygiene_link_erneuerung')
            .eq('user_id', currentEmployee.user_id)
            .maybeSingle(),
    ]);

    const openEl = document.getElementById('overview-open-list');
    openEl.innerHTML = '';

    if (!filteredOpenShifts || filteredOpenShifts.length === 0) {
        openEl.innerHTML = '<div style="color:var(--color-text-light); font-size:0.9rem;">Keine offenen Schichten</div>';
    } else {
        filteredOpenShifts.forEach(s => {
            const d = new Date(s.shift_date + 'T12:00:00');
            const row = document.createElement('div');
            row.style.cssText = `display:flex; align-items:center; gap:1rem; padding:0.75rem; border-radius:12px; margin-bottom:0.5rem; background:#FFF0F0;`;
            row.innerHTML = `
                <div style="min-width:2.5rem; text-align:center;">
                    <div style="font-size:1.3rem; font-weight:700; line-height:1; color:#C97E7E;">${d.getDate()}</div>
                    <div style="font-size:0.7rem; color:var(--color-text-light);">${dayNames[d.getDay()]}</div>
                </div>
                <div style="flex:1; background:white; border-radius:10px; padding:0.6rem 0.75rem;">
                    <div style="font-weight:700; font-size:0.95rem; color:#C97E7E;">${s.start_time.slice(0,5)} – ${s.end_time.slice(0,5)}</div>
                </div>
            `;
            openEl.appendChild(row);
        });
    }

    const hygieneCard = document.getElementById('hygiene-info-card');
    const hygieneErste = hygieneEmp?.hygiene_erste || null;
    const hygieneLetzte = hygieneEmp?.hygiene_letzte || null;
    const hygieneMonate = hygieneEmp?.hygiene_gueltig_monate ?? 12;

    const linkErst = hygieneRestaurant?.hygiene_link_erst || null;
    const linkErneuerung = hygieneRestaurant?.hygiene_link_erneuerung || null;

    if (hygieneErste || hygieneLetzte) {
        const basis = hygieneLetzte || hygieneErste;
        const naechste = new Date(basis + 'T00:00:00');
        naechste.setMonth(naechste.getMonth() + hygieneMonate);
        const naechsteStr = naechste.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
        const todayMs = new Date(); todayMs.setHours(0,0,0,0);
        const diff = (naechste - todayMs) / (1000 * 60 * 60 * 24);
        console.log('hygiene status:', diff, hygieneErste, hygieneLetzte);

        let badgeBg, badgeColor, badgeText;
        if (diff < 0) {
            badgeBg = '#FFE8E8'; badgeColor = '#C0392B';
            badgeText = 'Abgelaufen — bitte sofort erneuern';
        } else if (diff < 14) {
            badgeBg = '#FFF3CD'; badgeColor = '#856404';
            badgeText = 'Bitte bald erneuern';
        } else {
            badgeBg = '#D4EDDA'; badgeColor = '#155724';
            badgeText = 'Gültig';
        }

        console.log('hygiene:', hygieneErste, hygieneLetzte, linkErst, linkErneuerung);
        let actionBtn = '';
        if (!hygieneErste && linkErst) {
            actionBtn = `<a href="${linkErst}" target="_blank" rel="noopener" style="display:inline-block; margin-top:0.75rem; padding:0.45rem 1rem; background:var(--color-primary); color:#fff; border-radius:8px; font-size:0.85rem; font-weight:600; text-decoration:none;">Erstbelehrung</a>`;
        } else if (diff < 14 && linkErneuerung) {
            actionBtn = `<a href="${linkErneuerung}" target="_blank" rel="noopener" style="display:inline-block; margin-top:0.75rem; padding:0.45rem 1rem; background:var(--color-primary); color:#fff; border-radius:8px; font-size:0.85rem; font-weight:600; text-decoration:none;">Jetzt erneuern</a>`;
        }

        hygieneCard.innerHTML = `
            <div class="card" style="margin-bottom:1rem; margin-top:1rem;">
                <div style="font-weight:700; font-size:0.95rem; margin-bottom:0.5rem;">Hygieneschutzbelehrung</div>
                <div style="font-size:0.85rem; color:var(--color-text-light); margin-bottom:0.5rem;">Nächste Erneuerung: <strong>${naechsteStr}</strong></div>
                <span style="font-size:0.8rem; font-weight:600; color:${badgeColor}; background:${badgeBg}; border-radius:6px; padding:0.2rem 0.55rem;">${badgeText}</span>
                ${actionBtn}
            </div>`;
    } else if (linkErst) {
        hygieneCard.innerHTML = `
            <div class="card" style="margin-bottom:1rem; margin-top:1rem;">
                <div style="font-weight:700; font-size:0.95rem; margin-bottom:0.5rem;">Hygieneschutzbelehrung</div>
                <a href="${linkErst}" target="_blank" rel="noopener" style="display:inline-block; margin-top:0.25rem; padding:0.45rem 1rem; background:var(--color-primary); color:#fff; border-radius:8px; font-size:0.85rem; font-weight:600; text-decoration:none;">Erstbelehrung</a>
            </div>`;
    } else {
        hygieneCard.innerHTML = '';
    }
}

function changeOverviewMonth(dir) {
    overviewDate.setMonth(overviewDate.getMonth() + dir);
    loadOverview();
}

// ── HELPER ────────────────────────────────────────────────
function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('de-DE', {
        day: 'numeric', month: 'long', year: 'numeric'
    });
}

function formatMonthYear(dateStr) {
    return new Date(dateStr).toLocaleDateString('de-DE', {
        month: 'long', year: 'numeric'
    });
}

// ── PROFIL ────────────────────────────────────────────────
function loadProfil() {
    document.getElementById('profil-name').textContent = currentEmployee.name;
    document.getElementById('profil-number').textContent = currentEmployee.employee_number;
}

async function changePassword() {
    const newPass = document.getElementById('new-password').value;
    const confirmPass = document.getElementById('confirm-password').value;
    const errorDiv = document.getElementById('profil-error');
    const successDiv = document.getElementById('profil-success');

    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';

    if (!newPass || !confirmPass) {
        errorDiv.textContent = 'Bitte beide Felder ausfüllen.';
        errorDiv.style.display = 'block';
        return;
    }
    if (newPass !== confirmPass) {
        errorDiv.textContent = 'Passwörter stimmen nicht überein.';
        errorDiv.style.display = 'block';
        return;
    }
    if (newPass.length < 4) {
        errorDiv.textContent = 'Passwort muss mindestens 4 Zeichen haben.';
        errorDiv.style.display = 'block';
        return;
    }

    const { error } = await db
        .from('employees_planit')
        .update({ password_hash: newPass })
        .eq('id', currentEmployee.id);

    if (error) {
        errorDiv.textContent = 'Fehler beim Speichern.';
        errorDiv.style.display = 'block';
        return;
    }

    successDiv.textContent = 'Passwort erfolgreich geändert! ✅';
    successDiv.style.display = 'block';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';
}

// ============================================
// MEINE STUNDEN
// ============================================
let stundenDate = new Date();

function changeStundenMonth(dir) {
    stundenDate.setMonth(stundenDate.getMonth() + dir);
    loadMeineStunden();
}

async function loadMeineStunden() {
    const session = JSON.parse(localStorage.getItem('planit_employee'));
    if (!session) return;

    const year = stundenDate.getFullYear();
    const month = stundenDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    const label = stundenDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    document.getElementById('stunden-month-label').textContent = label;

    const firstDay = `${monthStr}-01`;
    const lastDay = new Date(year, month + 1, 0).toISOString().split('T')[0];

    // Schichten laden
    const { data: shifts, error } = await db
        .from('shifts')
        .select('*')
        .eq('employee_id', session.id)
        .gte('shift_date', firstDay)
        .lte('shift_date', lastDay)
        .order('shift_date', { ascending: true });

    if (error || !shifts) {
        document.getElementById('stunden-list').innerHTML = '<div class="empty-state"><p>Fehler beim Laden.</p></div>';
        return;
    }

    // Geplante Stunden berechnen
    let totalMinutes = 0;
    shifts.forEach(s => {
        const [sh, sm] = s.start_time.split(':').map(Number);
        const [eh, em] = s.end_time.split(':').map(Number);
        totalMinutes += (eh * 60 + em) - (sh * 60 + sm) - (s.break_minutes || 0);
    });
    const ph = Math.floor(totalMinutes / 60);
    const pm = String(totalMinutes % 60).padStart(2, '0');

    // Geleistete Stunden laden
    const { data: approved } = await db
        .from('approved_hours')
        .select('*')
        .eq('employee_id', session.id)
        .eq('month', monthStr)
        .maybeSingle();

    // Stundenkonto laden
    const { data: actualEntry } = await db
        .from('actual_hours')
        .select('*')
        .eq('employee_id', session.id)
        .eq('month', monthStr)
        .maybeSingle();
    
    // Anzeige Stundenkonto
    const approvedMinutes = approved ? approved.approved_minutes : null;
    const actualMinutes = actualEntry ? actualEntry.actual_minutes : null;
    const carryOver = actualEntry ? (actualEntry.carry_over_minutes || 0) : 0;
    const diffMinutes = actualMinutes !== null && approvedMinutes !== null
        ? actualMinutes - approvedMinutes + carryOver
        : null;

    const fmtMin = (m) => `${Math.floor(Math.abs(m)/60)}h ${String(Math.abs(m)%60).padStart(2,'0')}m`;
    const diffColor = diffMinutes === null ? 'var(--color-text-light)' : diffMinutes > 0 ? '#2d7a2d' : diffMinutes < 0 ? 'var(--color-red)' : 'var(--color-text-light)';
    const diffDisplay = diffMinutes !== null ? `${diffMinutes >= 0 ? '+' : '-'}${fmtMin(diffMinutes)}` : '–';
    const carryDisplay = `${carryOver >= 0 ? '+' : '-'}${fmtMin(carryOver)}`;

    document.getElementById('stunden-total').innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:1rem; margin-bottom:1rem;">
            <div>
                <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.25rem;">ABGERECHNET</div>
                <div style="font-weight:600;">${approvedMinutes !== null ? fmtMin(approvedMinutes) : '–'}</div>
            </div>
            <div>
                <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.25rem;">GEARBEITET</div>
                <div style="font-weight:600;">${actualMinutes !== null ? fmtMin(actualMinutes) : '–'}</div>
            </div>
            <div>
                <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.25rem;">VORMONAT</div>
                <div style="font-weight:600;">${carryDisplay}</div>
            </div>
        </div>
        <div style="padding-top:0.75rem; border-top:1px solid var(--color-border);">
            <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.25rem;">SALDO</div>
            <div style="font-weight:700; font-size:1.3rem; color:${diffColor};">${diffDisplay}</div>
        </div>`;

    document.getElementById('stunden-count').textContent = shifts.length;

    if (shifts.length === 0) {
        document.getElementById('stunden-list').innerHTML = '<div class="empty-state"><p>Keine Schichten in diesem Monat.</p></div>';
        return;
    }

    const weekdays = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
    const html = shifts.map(s => {
        const date = new Date(s.shift_date + 'T00:00:00');
        const day = date.getDate();
        const wd = weekdays[date.getDay()];
        const start = s.start_time.slice(0, 5);
        const end = s.end_time.slice(0, 5);
        const noteText = s.notes ? `<div style="font-size:0.8rem; color:var(--color-text-light);">${s.notes}</div>` : '';
        return `
        <div style="display:flex; align-items:center; gap:1rem; margin-bottom:0.75rem;">
            <div style="min-width:2.5rem; text-align:center;">
                <div style="font-size:1.3rem; font-weight:700; color:var(--color-text-light);">${day}</div>
                <div style="font-size:0.75rem; color:var(--color-text-light);">${wd}</div>
            </div>
            <div class="card" style="flex:1; margin-bottom:0; padding:0.75rem 1rem;">
                <div style="font-weight:600;">${start} – ${end} Uhr</div>
                ${noteText}
            </div>
        </div>`;
    }).join('');

    document.getElementById('stunden-list').innerHTML = html;
}

async function openRequestModal(shift) {
    const date = new Date(shift.shift_date + 'T00:00:00').toLocaleDateString('de-DE', {day:'numeric', month:'long'});
    document.getElementById('request-modal-info').textContent =
        `${date} · ${shift.start_time.slice(0,5)} – ${shift.end_time.slice(0,5)} Uhr`;
    document.getElementById('request-modal-note').textContent = shift.open_note || '';
    document.getElementById('request-shift-id').value = shift.id;
    document.getElementById('request-modal-status').textContent = '';
    document.getElementById('request-modal-buttons').style.display = 'block';

    // Prüfen ob Mitarbeiter schon geantwortet hat
    const session = JSON.parse(localStorage.getItem('planit_employee'));
    const { data: existing } = await db
        .from('open_shift_requests')
        .select('id, status')
        .eq('shift_id', shift.id)
        .eq('employee_id', session.id)
        .maybeSingle();

    if (existing) {
        const statusText = existing.status === 'yes' ? '✅ Du hast Ja gesagt' :
                           existing.status === 'no' ? '❌ Du hast Nein gesagt' :
                           existing.status === 'approved' ? '✅ Du wurdest eingeteilt' : '⏳ Ausstehend';
        document.getElementById('request-modal-status').textContent = statusText;
        document.getElementById('request-modal-buttons').style.display = 'none';
    }

    document.getElementById('request-modal').classList.add('active');
}

function closeRequestModal() {
    document.getElementById('request-modal').classList.remove('active');
}

async function submitShiftRequest(answer) {
    const session = JSON.parse(localStorage.getItem('planit_employee'));
    const shiftId = document.getElementById('request-shift-id').value;

    // Prüfen ob schon Request existiert
    const { data: existing } = await db
        .from('open_shift_requests')
        .select('id')
        .eq('shift_id', shiftId)
        .eq('employee_id', session.id)
        .maybeSingle();

    if (existing) {
        // Update bestehenden Request
        await db.from('open_shift_requests')
            .update({ status: answer })
            .eq('id', existing.id);
    } else {
        // Neuen Request erstellen
        await db.from('open_shift_requests').insert({
            shift_id: shiftId,
            employee_id: session.id,
            user_id: session.user_id,
            status: answer
        });
    }

    closeRequestModal();
    await loadWeekGrid();
}

async function loadMyRequests() {
    const session = JSON.parse(localStorage.getItem('planit_employee'));
    if (!session) return;

    const { data: requests, error } = await db
        .from('open_shift_requests')
        .select('*, shifts(shift_date, start_time, end_time, department)')
        .eq('employee_id', session.id)
        .order('created_at', { ascending: false })
        .limit(10);

    if (error || !requests || requests.length === 0) {
        document.getElementById('my-requests-list').innerHTML = '<div class="empty-state"><p>Keine Requests vorhanden.</p></div>';
        return;
    }

    const html = requests.map(r => {
        const date = new Date(r.shifts.shift_date + 'T00:00:00').toLocaleDateString('de-DE', {day:'numeric', month:'long'});
        const time = `${r.shifts.start_time.slice(0,5)} – ${r.shifts.end_time.slice(0,5)} Uhr`;
        const dept = r.shifts.department || '';
        let statusHtml = '';
        if (r.status === 'pending') statusHtml = '<span style="color:#C9A24D; font-weight:600;">⏳ Ausstehend</span>';
        if (r.status === 'approved') statusHtml = '<span style="color:var(--color-green); font-weight:600;">✓ Genehmigt</span>';
        if (r.status === 'rejected') statusHtml = '<span style="color:var(--color-red); font-weight:600;">✕ Abgelehnt</span>';
        return `
        <div class="card" style="margin-bottom:0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:600;">${date}</div>
                    <div style="font-size:0.85rem; color:var(--color-text-light);">${time} · ${dept}</div>
                </div>
                <div>${statusHtml}</div>
            </div>
        </div>`;
    }).join('');

    document.getElementById('my-requests-list').innerHTML = html;
}

function toggleVacationDetails() {
    const details = document.getElementById('vacation-details');
    const toggle = document.getElementById('vacation-toggle');
    const isOpen = details.style.display !== 'none';
    details.style.display = isOpen ? 'none' : 'block';
    toggle.textContent = isOpen ? '▶' : '▼';
}

function changeEmpTrinkgeldMonth(dir) {
    empTrinkgeldDate.setMonth(empTrinkgeldDate.getMonth() + dir);
    loadEmpTrinkgeld();
}

async function loadEmpTrinkgeld() {
    const year = empTrinkgeldDate.getFullYear();
    const month = empTrinkgeldDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const label = empTrinkgeldDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    document.getElementById('emp-trinkgeld-month-label').textContent = label;

    const container = document.getElementById('emp-trinkgeld-content');

    const { data: result } = await db
        .from('tip_results')
        .select('*')
        .eq('user_id', currentEmployee.user_id)
        .eq('employee_id', currentEmployee.id)
        .eq('month', monthStr)
        .maybeSingle();

    if (!result) {
        container.innerHTML = '<div class="empty-state"><p>Keine Daten vorhanden.</p></div>';
        return;
    }

    const total = parseFloat(result.amount_card) + parseFloat(result.amount_cash);
    container.innerHTML = `
        <div class="card" style="margin-bottom:1rem;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1rem;">
                <div>
                    <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.25rem;">KARTE</div>
                    <div style="font-weight:600;">${parseFloat(result.amount_card).toFixed(2)} €</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.25rem;">BAR</div>
                    <div style="font-weight:600;">${parseFloat(result.amount_cash).toFixed(2)} €</div>
                </div>
            </div>
            <div style="border-top:1px solid var(--color-border); padding-top:0.75rem;">
                <div style="font-size:0.75rem; color:var(--color-text-light); margin-bottom:0.25rem;">GESAMT</div>
                <div style="font-weight:700; font-size:1.3rem; color:var(--color-primary);">${total.toFixed(2)} €</div>
            </div>
        </div>`;
}

async function checkTrinkgeldVisibility() {
    const { data: config } = await db
        .from('tip_config')
        .select('show_to_employees')
        .eq('user_id', currentEmployee.user_id)
        .maybeSingle();

    const menuItem = document.getElementById('trinkgeld-menu-item');
    if (menuItem) {
        menuItem.style.display = config?.show_to_employees ? 'flex' : 'none';
    }
}

// ── INVENTUR (MITARBEITER) ────────────────────────────────

async function checkInventurVisibility() {
    const menuItem = document.getElementById('inventur-emp-menu-item');
    if (!menuItem) return;
    const { data } = await db
        .from('employees_planit')
        .select('can_do_inventory')
        .eq('id', currentEmployee.id)
        .maybeSingle();
    menuItem.style.display = data?.can_do_inventory ? 'flex' : 'none';
}

let empInventurDate = new Date();

function updateEmpInventurDateLabel() {
    document.getElementById('emp-inventur-date').value = empInventurDate.toISOString().split('T')[0];
}

function changeEmpInventurDate(dir) {
    empInventurDate.setDate(empInventurDate.getDate() + dir);
    loadEmpInventur();
}

function onEmpInventurDateChange() {
    const val = document.getElementById('emp-inventur-date').value;
    if (!val) return;
    empInventurDate = new Date(val + 'T12:00:00');
    loadEmpInventur();
}

async function loadEmpInventur() {
    updateEmpInventurDateLabel();
    const date = empInventurDate.toISOString().split('T')[0];

    const { data: suppliers } = await db
        .from('planit_suppliers')
        .select('*, planit_inventory_items(*)')
        .eq('user_id', currentEmployee.user_id)
        .order('created_at', { ascending: true });

    const { data: entries } = await db
        .from('planit_inventory_entries')
        .select('*')
        .eq('user_id', currentEmployee.user_id)
        .eq('entry_date', date);

    renderEmpInventur(suppliers, entries);
}

function renderEmpInventur(suppliers, entries) {
    const container = document.getElementById('emp-inventur-list');

    if (!suppliers || suppliers.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Keine Waren konfiguriert.</p></div>';
        return;
    }

    container.innerHTML = suppliers.map(s => {
        const items = (s.planit_inventory_items || []).sort((a, b) => (a.inventory_position ?? 0) - (b.inventory_position ?? 0));
        if (items.length === 0) return '';
        return `
        <div style="margin-bottom:0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; padding:0.75rem 1rem; background:var(--color-gray); border-radius:12px; margin-bottom:0.25rem;" onclick="toggleEmpInventurSupplier('${s.id}')">
                <div style="font-size:0.85rem; font-weight:700; color:var(--color-primary); letter-spacing:0.05em;">${s.name.toUpperCase()}</div>
                <span id="emp-inventur-supplier-toggle-${s.id}" style="color:var(--color-text-light);">▶</span>
            </div>
            <div id="emp-inventur-supplier-body-${s.id}" style="display:none;">
            <div class="card" style="padding:0;">
                <div style="display:grid; grid-template-columns:1fr 5rem 5rem 5rem; gap:0.5rem; padding:0.5rem 0.75rem; border-bottom:2px solid var(--color-border);">
                    <div style="font-size:0.75rem; font-weight:700; color:var(--color-text-light);">WARE</div>
                    <div style="font-size:0.75rem; font-weight:700; color:var(--color-text-light); text-align:center;">SOLL</div>
                    <div style="font-size:0.75rem; font-weight:700; color:var(--color-text-light); text-align:center;">IST</div>
                    <div style="font-size:0.75rem; font-weight:700; color:var(--color-text-light); text-align:center;">BESTELL</div>
                </div>
                ${items.map(item => {
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
                            onchange="updateEmpOrderValue(this)"
                            style="text-align:center; padding:0.3rem; border-radius:6px; border:1px solid var(--color-border); font-size:0.85rem; width:100%;">
                        <div id="emp-order-${item.id}" style="text-align:center; font-size:0.9rem; font-weight:600; color:${order > 0 ? 'var(--color-red)' : 'var(--color-green)'};">
                            ${order !== '' ? order : '–'}
                        </div>
                    </div>`;
                }).join('')}
            </div>
            </div>
        </div>`;
    }).join('');
}

function toggleEmpInventurSupplier(supplierId) {
    const body = document.getElementById(`emp-inventur-supplier-body-${supplierId}`);
    const toggle = document.getElementById(`emp-inventur-supplier-toggle-${supplierId}`);
    const isOpen = body.style.display === 'block';
    body.style.display = isOpen ? 'none' : 'block';
    toggle.textContent = isOpen ? '▶' : '▼';
}

function updateEmpOrderValue(input) {
    const actual = parseFloat(input.value) || 0;
    const target = parseFloat(input.dataset.target) || 0;
    const order = Math.max(0, target - actual);
    const orderDiv = document.getElementById(`emp-order-${input.dataset.itemId}`);
    if (orderDiv) {
        orderDiv.textContent = order;
        orderDiv.style.color = order > 0 ? 'var(--color-red)' : 'var(--color-green)';
    }
}

async function saveEmpInventur() {
    const date = empInventurDate.toISOString().split('T')[0];
    const inputs = document.querySelectorAll('#emp-inventur-list input[data-item-id]');
    for (const input of inputs) {
        const actual = parseFloat(input.value);
        if (isNaN(actual)) continue;
        await db.from('planit_inventory_entries').upsert({
            user_id: currentEmployee.user_id,
            item_id: input.dataset.itemId,
            entry_date: date,
            actual_amount: actual
        }, { onConflict: 'user_id,item_id,entry_date' });
    }
}

async function submitEmpInventur() {
    await saveEmpInventur();
    const date = empInventurDate.toISOString().split('T')[0];
    await db.from('planit_inventory_submissions').insert({
        user_id: currentEmployee.user_id,
        employee_id: currentEmployee.id,
        submission_date: date,
        submitted_at: new Date().toISOString()
    });
    alert('Inventur wurde abgeschlossen und gespeichert!');
}
// ── KOLLEGEN-MODAL ────────────────────────────────────────
const _colleaguesCache = {};

async function openColleaguesModal(shift) {
    const dateStr = shift.shift_date;
    const myDept = shift.department || currentEmployee.department;

    const d = new Date(dateStr + 'T12:00:00');
    const dayNames = ['So','Mo','Di','Mi','Do','Fr','Sa'];
    const label = `${d.getDate()}. ${d.toLocaleDateString('de-DE', { month: 'long' })} — ${dayNames[d.getDay()]}`;

    document.getElementById('colleagues-modal-title').textContent = label;
    document.getElementById('colleagues-modal').classList.add('open');

    let dayShifts;
    if (_colleaguesCache[dateStr]) {
        dayShifts = _colleaguesCache[dateStr];
    } else {
        document.getElementById('colleagues-modal-body').innerHTML = '<div style="color:var(--color-text-light); font-size:0.9rem;">Lädt…</div>';
        const { data } = await db
            .from('shifts')
            .select('start_time, end_time, department, employees_planit!shifts_employee_id_fkey(name)')
            .eq('user_id', currentEmployee.user_id)
            .eq('shift_date', dateStr)
            .eq('is_open', false)
            .neq('employee_id', currentEmployee.id);
        dayShifts = data || [];
        _colleaguesCache[dateStr] = dayShifts;
    }

    const colleagues = dayShifts.filter(s => (s.department || currentEmployee.department) === myDept);

    const body = document.getElementById('colleagues-modal-body');
    if (colleagues.length === 0) {
        body.innerHTML = '<div style="color:var(--color-text-light); font-size:0.9rem;">Keine Kollegen an diesem Tag in deiner Abteilung.</div>';
        return;
    }

    colleagues.sort((a, b) => a.start_time.localeCompare(b.start_time));
    body.innerHTML = colleagues.map(s => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0; border-bottom:1px solid var(--color-border);">
            <div style="font-weight:600; font-size:0.95rem;">${s.employees_planit?.name || '—'}</div>
            <div style="font-size:0.85rem; color:var(--color-text-light);">${s.start_time.slice(0,5)} – ${s.end_time.slice(0,5)}</div>
        </div>
    `).join('');
}

function closeColleaguesModal() {
    document.getElementById('colleagues-modal').classList.remove('open');
}

// ── KÜNDIGUNG ─────────────────────────────────────────────
async function previewTermination() {
    const street = document.getElementById('termination-street').value.trim();
    const zip    = document.getElementById('termination-zip').value.trim();
    const city   = document.getElementById('termination-city').value.trim();
    const date   = document.getElementById('termination-date').value;
    const reason = document.getElementById('termination-reason').value.trim();
    const errorDiv = document.getElementById('termination-error');
    errorDiv.style.display = 'none';

    if (!street || !zip || !city || !date) {
        errorDiv.textContent = 'Bitte Straße, PLZ, Ort und Datum ausfüllen.';
        errorDiv.style.display = 'block';
        return;
    }

    const [{ data: restaurant }, { data: emp }] = await Promise.all([
        db.from('planit_restaurants').select('*').eq('user_id', currentEmployee.user_id).maybeSingle(),
        db.from('employees_planit').select('name').eq('id', currentEmployee.id).maybeSingle(),
    ]);

    const empName = emp?.name || currentEmployee.name || '';
    const restName = restaurant?.name || '[Restaurant-Name]';
    const restStreet = restaurant?.street || '';
    const restZip = restaurant?.zip || '';
    const restCity = restaurant?.city || '';
    const restAddress = [restStreet, `${restZip} ${restCity}`.trim()].filter(Boolean).join('\n');

    const lastDay = new Date(date + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
    const todayStr = new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

    const textBefore = [
        `${empName}`,
        `${street}`,
        `${zip} ${city}`,
        ``,
        `${restName}`,
        restAddress,
        ``,
        ``,
        `${city}, ${todayStr}`,
        ``,
        `Betreff: Kündigung meines Arbeitsverhältnisses`,
        ``,
        `Sehr geehrte Damen und Herren,`,
        ``,
        `hiermit kündige ich mein Arbeitsverhältnis mit ${restName} fristgemäß zum ${lastDay}.`,
        reason ? `\nGrund: ${reason}` : '',
        ``,
        `Ich bitte um eine schriftliche Bestätigung des Kündigungseingangs sowie des letzten Arbeitstages.`,
        ``,
        `Mit freundlichen Grüßen`,
    ].filter(l => l !== undefined).join('\n');

    const textAfter = `\n_________________________\n${empName}`;

    // Unterschrift auslesen
    const sigCanvas = document.getElementById('termination-signature-canvas');
    let sigDataUrl = null;
    try {
        const dataUrl = sigCanvas.toDataURL('image/png');
        const blank = document.createElement('canvas');
        blank.width = sigCanvas.width; blank.height = sigCanvas.height;
        if (dataUrl !== blank.toDataURL('image/png')) sigDataUrl = dataUrl;
    } catch(e) {}

    // Preview-Body aufbauen: Text vor Unterschrift, Bild, Text nach Unterschrift
    const body = document.getElementById('termination-preview-body');
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    body.innerHTML =
        `<span style="white-space:pre-wrap;">${esc(textBefore)}</span>` +
        (sigDataUrl ? `<br><img src="${sigDataUrl}" style="max-width:180px; display:block; margin:2rem 0 0;">` : ``) +
        `<span style="white-space:pre-wrap;">${esc(textAfter)}</span>`;

    document.getElementById('termination-preview-signature').style.display = 'none';

    document.getElementById('termination-preview-modal').classList.add('active');
}

async function openTerminationModal() {
    document.getElementById('termination-modal').classList.add('active');
    document.getElementById('termination-notice').style.display = 'none';
    document.getElementById('termination-error').style.display = 'none';
    setTimeout(initTerminationSignaturePad, 50);

    const today = new Date();
    const day = today.getDate();
    const nextMonth = today.getMonth() + 1; // 0-based → nächster Monat
    const year = today.getFullYear();
    const monthNames = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

    let minDate;
    if (day <= 15) {
        // 1.–15.: Mindesttermin = 15. des nächsten Monats
        minDate = new Date(year, nextMonth, 15);
    } else {
        // 16.–31.: Mindesttermin = letzter Tag des nächsten Monats
        minDate = new Date(year, nextMonth + 1, 0);
    }

    const label = `${minDate.getDate()}. ${monthNames[minDate.getMonth()]} ${minDate.getFullYear()}`;
    const notice = document.getElementById('termination-notice');
    notice.textContent = `Frühestmöglicher letzter Arbeitstag: ${label}`;
    notice.style.display = 'block';
}

async function submitTermination() {
    const street = document.getElementById('termination-street').value.trim();
    const zip    = document.getElementById('termination-zip').value.trim();
    const city   = document.getElementById('termination-city').value.trim();
    const date   = document.getElementById('termination-date').value;
    const reason = document.getElementById('termination-reason').value.trim();
    const errorDiv = document.getElementById('termination-error');
    errorDiv.style.display = 'none';

    if (!street || !zip || !city || !date) {
        errorDiv.textContent = 'Bitte Straße, PLZ, Ort und Datum ausfüllen.';
        errorDiv.style.display = 'block';
        return;
    }

    // Mindesttermin prüfen (nicht blockierend)
    const today = new Date();
    const day = today.getDate();
    const nextMonth = today.getMonth() + 1;
    const minDate = day <= 15
        ? new Date(today.getFullYear(), nextMonth, 15)
        : new Date(today.getFullYear(), nextMonth + 1, 0);
    const minDateStr = minDate.toISOString().split('T')[0];

    if (date < minDateStr) {
        const { data: emp } = await db.from('employees_planit').select('notice_period_weeks').eq('id', currentEmployee.id).maybeSingle();
        const weeks = emp?.notice_period_weeks || 4;
        const monthNames = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
        errorDiv.textContent = `Hinweis: Das gewählte Datum liegt vor dem frühestmöglichen Termin (${minDate.getDate()}. ${monthNames[minDate.getMonth()]} ${minDate.getFullYear()}). Kündigungsfrist laut Vertrag: ${weeks} Wochen. Der Antrag wird trotzdem eingereicht.`;
        errorDiv.style.display = 'block';
    }

    const { data: inserted, error } = await db.from('planit_terminations').insert({
        user_id: currentEmployee.user_id,
        employee_id: currentEmployee.id,
        street,
        zip,
        city,
        requested_date: date,
        reason: reason || null,
        status: 'pending',
    }).select('id').single();

    if (error) {
        errorDiv.textContent = 'Fehler beim Speichern. Bitte erneut versuchen.';
        errorDiv.style.display = 'block';
        return;
    }

    // PDF generieren
    try {
        const previewBody = document.getElementById('termination-preview-body');
        const fullText = previewBody ? previewBody.textContent : '';
        const splitMarker = 'Mit freundlichen Grüßen';
        const splitIdx = fullText.indexOf(splitMarker);
        const textBefore = splitIdx >= 0 ? fullText.substring(0, splitIdx + splitMarker.length) : fullText;
        const textAfter  = splitIdx >= 0 ? fullText.substring(splitIdx + splitMarker.length).trim() : '';

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const lh = 5;
        let y = 20;

        const linesBefore = doc.splitTextToSize(textBefore, 170);
        doc.text(linesBefore, 20, y);
        y += linesBefore.length * lh + 4;

        // Unterschrift
        const sigCanvas = document.getElementById('termination-signature-canvas');
        if (sigCanvas) {
            try {
                const dataUrl = sigCanvas.toDataURL('image/png');
                const blank = document.createElement('canvas');
                blank.width = sigCanvas.width; blank.height = sigCanvas.height;
                if (dataUrl !== blank.toDataURL('image/png')) {
                    doc.addImage(dataUrl, 'PNG', 20, y, 60, 25);
                    y += 28;
                }
            } catch(e) {}
        }

        if (textAfter) {
            const linesAfter = doc.splitTextToSize(textAfter, 170);
            doc.text(linesAfter, 20, y);
        }

        const pdfBlob = doc.output('blob');
        const fileName = `${currentEmployee.user_id}/${currentEmployee.id}_${date}.pdf`;
        const { error: uploadError } = await db.storage
            .from('termination-pdfs')
            .upload(fileName, pdfBlob, { contentType: 'application/pdf' });

        if (!uploadError && inserted?.id) {
            await db.from('planit_terminations').update({ pdf_url: fileName }).eq('id', inserted.id);
        }
    } catch(pdfErr) {
        console.error('PDF-Generierung fehlgeschlagen:', pdfErr);
    }

    document.getElementById('termination-preview-modal').classList.remove('active');
    document.getElementById('termination-modal').classList.remove('active');
    alert('Deine Kündigung wurde eingereicht. Die Verwaltung wird sich bei dir melden.');
}

async function deleteOwnTermination(id) {
    if (!confirm('Kündigungsantrag wirklich zurückziehen?')) return;
    await db.from('planit_terminations').delete().eq('id', id);
    loadOverview();
}
