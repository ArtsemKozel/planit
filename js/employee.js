let currentEmployee = null;
let calendarDate = new Date();
let availDate = new Date();
let myShifts = [];
let selectedSwapShift = null;
let selectedAvailDays = {};
let overviewDate = new Date();

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

    const { data: vacations } = await db
        .from('vacation_requests')
        .select('*, employees_planit(name)')
        .eq('user_id', currentEmployee.user_id)
        .eq('status', 'approved')
        .lte('start_date', lastDay)
        .gte('end_date', firstDay);

    renderVacationCalendar(year, month, vacations || []);
}

function renderVacationCalendar(year, month, vacations) {
    const container = document.getElementById('vac-calendar');
    container.innerHTML = '';

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = new Date(year, month, 1).getDay();
    const offset = firstWeekday === 0 ? 6 : firstWeekday - 1;

    // Farben pro Mitarbeiter
    const colors = ['#C9A24D','#7EB8C9','#A8C97E','#C97E9A','#9A7EC9','#C9A87E','#7EC9B8'];
    const empColors = {};
    let colorIdx = 0;

    vacations.forEach(v => {
        const empId = v.employee_id;
        if (!empColors[empId]) {
            if (empId === currentEmployee.id) {
                empColors[empId] = '#C9A24D';
            } else {
                // skip gold for others
                const c = colors.filter(x => x !== '#C9A24D')[colorIdx % (colors.length - 1)];
                empColors[empId] = c;
                colorIdx++;
            }
        }
    });

    // Wochentag-Header
    const dayHeaders = ['Mo','Di','Mi','Do','Fr','Sa','So'];
    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    dayHeaders.forEach(d => {
        const h = document.createElement('div');
        h.className = 'calendar-day-header';
        h.textContent = d;
        grid.appendChild(h);
    });

    // Leere Felder vor dem 1.
    for (let i = 0; i < offset; i++) {
        const empty = document.createElement('div');
        empty.className = 'calendar-day empty';
        grid.appendChild(empty);
    }

    // Tage
    for (let d = 1; d <= daysInMonth; d++) {
        const holidays = getBWHolidays(year);
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dayVacations = vacations.filter(v => v.start_date <= dateStr && v.end_date >= dateStr);

        const isHoliday = holidays.includes(dateStr);
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day' + (isHoliday ? ' holiday' : '');
        dayEl.style.position = 'relative';
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
        const empId = v.employee_id;
        const name = v.employees_planit?.name || '';
        if (legend.querySelector(`[data-emp="${empId}"]`)) return;
        const item = document.createElement('div');
        item.setAttribute('data-emp', empId);
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '4px';
        item.style.fontSize = '0.75rem';
        const dot = document.createElement('div');
        dot.style.width = '10px';
        dot.style.height = '10px';
        dot.style.borderRadius = '50%';
        dot.style.background = empColors[empId] || '#ccc';
        item.appendChild(dot);
        item.appendChild(document.createTextNode(empId === currentEmployee.id ? 'Ich' : name));
        legend.appendChild(item);
    });

    container.appendChild(legend);
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

async function loadVacationAccount() {
    const year = new Date().getFullYear();
    document.getElementById('vacation-year-label').textContent = year;

    // Mitarbeiter-Daten laden
    const { data: emp } = await db
        .from('employees_planit')
        .select('vacation_days_per_year, start_date, hours_per_vacation_day')
        .eq('id', currentEmployee.id)
        .maybeSingle();

    // Phasen laden
    const { data: phases, error: phasesError } = await db
        .from('employment_phases')
        .select('*')
        .eq('employee_id', currentEmployee.id)
        .order('start_date');

    const totalDays = emp?.vacation_days_per_year ?? 20;
    const hoursPerDay = emp?.hours_per_vacation_day || 8.0;
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    // Anspruch berechnen
    let entitlement = 0;
    let entitlementH = 0;
    const activePhases = (phases || []).filter(p =>
        p.start_date <= yearEnd && (!p.end_date || p.end_date >= yearStart)
    );

    if (activePhases.length > 0) {
        for (const phase of activePhases) {
            const phaseStartRaw = new Date(phase.start_date + 'T12:00:00');
            const yearStartDate = new Date(yearStart + 'T12:00:00');
            const phaseStart = phaseStartRaw > yearStartDate ? phaseStartRaw : yearStartDate;
            const phaseEndRaw = phase.end_date ? new Date(phase.end_date + 'T12:00:00') : new Date(yearEnd + 'T12:00:00');
            const yearEndDate = new Date(yearEnd + 'T12:00:00');
            const phaseEnd = phaseEndRaw < yearEndDate ? phaseEndRaw : yearEndDate;

            const startMonth = phaseStart.getMonth();
            const endMonth = phaseEnd.getMonth();
            const startDay = phaseStart.getDate();
            const endDay = phaseEnd.getDate();
            const daysInEndMonth = new Date(year, endMonth + 1, 0).getDate();
            const startFraction = startDay === 1 ? 1 : startDay <= 15 ? 1 : 0.5;
            const endFraction = endDay >= daysInEndMonth ? 1 : endDay >= 15 ? 1 : 0.5;

            let months = 0;
            if (startMonth === endMonth) {
                months = endFraction;
            } else {
                months = startFraction + (endMonth - startMonth - 1) + endFraction;
            }

            const phaseDays = phase.hours_per_vacation_day === 0 ? 0 : Math.round((months / 12) * (phase.vacation_days_per_year || 20) * 100) / 100;
            entitlement = Math.round((entitlement + phaseDays) * 100) / 100;
            entitlementH = Math.round((entitlementH + phaseDays * (phase.hours_per_vacation_day || 0)) * 100) / 100;
        }
    } else {
        entitlement = totalDays;
        if (emp?.start_date) {
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
        entitlementH = entitlement * hoursPerDay;
    }

    // Genehmigte Urlaubsanträge dieses Jahr laden
    const { data: requests } = await db
        .from('vacation_requests')
        .select('deducted_days')
        .eq('employee_id', currentEmployee.id)
        .eq('status', 'approved')
        .gte('start_date', `${year}-01-01`)
        .lte('end_date', `${year}-12-31`);

    const usedDays = (requests || []).reduce((sum, r) => sum + (r.deducted_days || 0), 0);
    const usedH = usedDays * hoursPerDay;
    const remaining = entitlement - usedDays;
    const remainingH = entitlementH - usedH;

    // vacation-account wird im Detail-Block angezeigt, nicht im Header
    // vacation-used und vacation-total werden nicht mehr im Header gebraucht

    const accountEl = document.getElementById('vacation-account');
    accountEl.style.color = remaining <= 3 ? '#E57373' :
        remaining <= 7 ? '#C9A24D' : 'var(--color-primary)';

    // Details füllen
    document.getElementById('vac-entitlement').innerHTML = `${entitlement.toFixed(2)} Tage<br><span style="font-size:0.75rem; color:var(--color-text-light);">${entitlementH.toFixed(2)} Std</span>`;
    document.getElementById('vac-carryover').innerHTML = `0.00 Tage<br><span style="font-size:0.75rem; color:var(--color-text-light);">0.00 Std</span>`;
    document.getElementById('vac-used-detail').innerHTML = `${usedDays.toFixed(2)} Tage<br><span style="font-size:0.75rem; color:var(--color-text-light);">${usedH.toFixed(2)} Std</span>`;
    document.getElementById('vac-remaining-detail').innerHTML = `${remaining.toFixed(2)} Tage<br><span style="font-size:0.75rem; color:var(--color-text-light);">${remainingH.toFixed(2)} Std</span>`;

    // Phasen-Info
    const phasesInfo = document.getElementById('vac-phases-info');
    if (activePhases.length > 0) {
        const formatShort = d => {
            const parts = d.split('-');
            return `${parts[2]}.${parts[1]}.${parts[0].slice(2)}`;
        };
        phasesInfo.innerHTML = activePhases.map(p =>
            `Std. pro UT: ${p.hours_per_vacation_day}h (${formatShort(p.start_date)} – ${p.end_date ? formatShort(p.end_date) : 'offen'})${p.notes ? ` · ${p.notes}` : ''}`
        ).join('<br>');
    } else {
        phasesInfo.innerHTML = `Std. pro UT: ${hoursPerDay}h`;
    }
}

let signaturePad = null;

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

    // Urlaubstage laden
    const monthStart = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const monthEnd = `${year}-${String(month+1).padStart(2,'0')}-${new Date(year, month+1, 0).getDate()}`;
    const { data: vacations, error: vacError } = await db
        .from('vacation_requests')
        .select('start_date, end_date')
        .eq('employee_id', currentEmployee.id)
        .eq('status', 'approved')
        .gte('start_date', monthStart)
        .lte('end_date', monthEnd);

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
        div.innerHTML = `<span>${d}</span>${timeHtml}`;
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

    // Krankmeldung prüfen
    const { data: sickLeave } = await db
        .from('sick_leaves')
        .select('start_date, end_date')
        .eq('employee_id', currentEmployee.id)
        .gte('end_date', today)
        .order('start_date')
        .limit(1)
        .maybeSingle();

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

    // Eigene Schichten laden
    const { data: shifts } = await db
        .from('shifts')
        .select('*')
        .eq('employee_id', currentEmployee.id)
        .gte('shift_date', monthStart)
        .lte('shift_date', monthEnd)
        .order('shift_date');

    // Krankmeldungs-Schichten laden
    const { data: sickShifts } = await db
        .from('shifts')
        .select('*')
        .eq('user_id', currentEmployee.user_id)
        .eq('is_open', true)
        .eq('open_note', 'Krankmeldung')
        .gte('shift_date', monthStart)
        .lte('shift_date', monthEnd)
        .order('shift_date');

    // Krankmeldung prüfen ob Schichten dazugehören
    const { data: mySickLeave } = await db
        .from('sick_leaves')
        .select('start_date, end_date')
        .eq('employee_id', currentEmployee.id)
        .gte('end_date', monthStart)
        .lte('start_date', monthEnd)
        .maybeSingle();

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

    if (!shifts || shifts.length === 0) {
        listEl.innerHTML = '<div style="color:var(--color-text-light); font-size:0.9rem;">Keine Schichten diesen Monat</div>';
    } else {
        shifts.forEach(s => {
            const d = new Date(s.shift_date + 'T12:00:00');
            const isToday = s.shift_date === today;
            const row = document.createElement('div');
            row.style.cssText = `display:flex; align-items:center; gap:1rem; padding:0.75rem; border-radius:12px; margin-bottom:0.5rem; background:${isToday ? '#FFF8E7' : 'var(--color-gray)'};`;
            row.innerHTML = `
                <div style="min-width:2.5rem; text-align:center;">
                    <div style="font-size:1.3rem; font-weight:700; line-height:1; color:${isToday ? 'var(--color-primary)' : 'inherit'};">${d.getDate()}</div>
                    <div style="font-size:0.7rem; color:var(--color-text-light);">${dayNames[d.getDay()]}</div>
                </div>
                <div style="flex:1; background:white; border-radius:10px; padding:0.6rem 0.75rem;">
                    <div style="font-weight:700; font-size:0.95rem;">${s.start_time.slice(0,5)} – ${s.end_time.slice(0,5)}</div>
                    ${s.notes ? `<div style="font-size:0.8rem; color:var(--color-text-light);">${s.notes}</div>` : ''}
                </div>
            `;
            listEl.appendChild(row);
        });
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