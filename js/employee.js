let currentEmployee = null;
let calendarDate = new Date();
let availDate = new Date();
let myShifts = [];
let selectedSwapShift = null;
let selectedAvailDays = {};

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
    
    const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate()+n); return r.toISOString().split('T')[0]; };
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
    if (tab === 'schichtplan') loadWeekGrid();
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
        .select('*, employees_planit(name)')
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

    renderWeekGrid(days, shifts || [], colleagues || []);
}

function renderWeekGrid(days, shifts, colleagues) {
    const grid = document.getElementById('emp-week-grid');
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
    colleagues.forEach(emp => {
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
            cell.className = 'week-cell' + (shift ? (shift.is_open ? ' open-shift' : ' has-shift') : '');
            if (shift && isOwn && !shift.is_open) cell.style.background = 'var(--color-primary)';
            cell.textContent = shift ? `${shift.start_time.slice(0,5)}\n${shift.end_time.slice(0,5)}` : '';
            cell.style.whiteSpace = 'pre';
            grid.appendChild(cell);
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
        item.appendChild(document.createTextNode(empId === currentEmployee.id ? 'Ich' : name.split(' ')[0]));
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
    const start = document.getElementById('vacation-start').value;
    const end = document.getElementById('vacation-end').value;
    const days = document.getElementById('vacation-days').value;
    const errorDiv = document.getElementById('vacation-error');

    errorDiv.style.display = 'none';

    if (!start || !end) {
        errorDiv.textContent = 'Bitte Start- und Enddatum auswählen.';
        errorDiv.style.display = 'block';
        return;
    }
    if (!days) {
        errorDiv.textContent = 'Bitte Anzahl Urlaubstage eingeben.';
        errorDiv.style.display = 'block';
        return;
    }

    // ERST Supabase speichern
    const { error } = await db.from('vacation_requests').insert({
        user_id: currentEmployee.user_id,
        employee_id: currentEmployee.id,
        start_date: start,
        end_date: end,
        reason: `${days} Tage`,
        status: 'pending'
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
    doc.text('Von:', 20, 64);
    doc.text(formatDate(start), 70, 64);
    doc.text('Bis:', 20, 76);
    doc.text(formatDate(end), 70, 76);
    doc.text('Urlaubstage:', 20, 88);
    doc.text(days + ' Tage', 70, 88);
    if (signature) {
        doc.text('Unterschrift:', 20, 110);
        doc.addImage(signature, 'PNG', 20, 115, 60, 25);
    }
    doc.save(`Urlaubsantrag_${currentEmployee.name}_${start}.pdf`);
    
    closeVacationModal();
    setTimeout(() => loadVacations(), 500);
}

// ── VERFÜGBARKEIT ─────────────────────────────────────────
function renderAvailGrid(year, month) {
    const container = document.getElementById('avail-grid');
    container.innerHTML = '';

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

        if (status === 'full') div.style.background = '#C8E6C9';
        else if (status === 'partial') div.style.background = '#FFF9C4';
        else if (status === 'off') div.style.background = '#FFCDD2';

        const timeLabel = (status === 'partial' && entry.from)
            ? `<span style="font-size:0.6rem">${entry.from}-${entry.to}</span>`
            : '';

        div.innerHTML = `<span>${d}</span><span style="font-size:0.9rem">${status === 'full' ? '🟢' : status === 'partial' ? '🟡' : status === 'off' ? '🔴' : ''}</span>${timeLabel}`;
        div.onclick = () => openAvailModal(d);
        container.appendChild(div);
    }
}

let currentAvailDay = null;

function openAvailModal(day) {
    currentAvailDay = day;
    document.getElementById('avail-modal-title').textContent = `${day}. – Verfügbarkeit`;
    document.getElementById('avail-time-fields').style.display = 'none';
    document.getElementById('avail-modal').classList.add('open');
}

function closeAvailModal() {
    document.getElementById('avail-modal').classList.remove('open');
    currentAvailDay = null;
}

function setAvailStatus(status) {
    if (status === 'partial') {
        document.getElementById('avail-time-fields').style.display = 'block';
        return;
    }
    selectedAvailDays[currentAvailDay] = { status };
    renderAvailGrid(availDate.getFullYear(), availDate.getMonth());
    closeAvailModal();
}

function confirmPartialAvail() {
    const from = document.getElementById('avail-from').value;
    const to = document.getElementById('avail-to').value;
    selectedAvailDays[currentAvailDay] = { status: 'partial', from, to };
    renderAvailGrid(availDate.getFullYear(), availDate.getMonth());
    closeAvailModal();
}

function clearAvailDay() {
    delete selectedAvailDays[currentAvailDay];
    renderAvailGrid(availDate.getFullYear(), availDate.getMonth());
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
    renderAvailGrid(year, month);
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
            <div class="list-item" onclick="openSwapModal('${s.id}', '${s.shift_date}', '${s.start_time}', '${s.end_time}')">
                <div class="list-item-info">
                    <h4>${formatDate(s.shift_date)}</h4>
                    <p>${s.start_time.slice(0,5)} – ${s.end_time.slice(0,5)} Uhr</p>
                </div>
                <span style="color:var(--color-text-light); font-size:0.85rem;">Tauschen →</span>
            </div>
        `).join('');
    }

    // Meine Requests laden
    const { data: swaps } = await db
        .from('shift_swaps')
        .select('*')
        .eq('from_employee_id', currentEmployee.id)
        .order('created_at', { ascending: false });

    const requestsList = document.getElementById('swap-requests-list');

    if (!swaps || swaps.length === 0) {
        requestsList.innerHTML = '<div class="empty-state"><p>Keine Requests vorhanden.</p></div>';
    } else {
        requestsList.innerHTML = swaps.map(s => `
            <div class="list-item">
                <div class="list-item-info">
                    <h4>Tausch-Request</h4>
                    <p>${formatDate(s.created_at)}</p>
                </div>
                <span class="badge badge-${s.status}">
                    ${s.status === 'pending' ? 'Ausstehend' : s.status === 'approved' ? 'Genehmigt' : 'Abgelehnt'}
                </span>
            </div>
        `).join('');
    }
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

function closeSwapModal() {
    document.getElementById('swap-modal').classList.remove('open');
}

async function submitSwap() {
    const toEmployee = document.getElementById('swap-colleague').value;
    const errorDiv = document.getElementById('swap-error');

    const { error } = await db.from('shift_swaps').insert({
        user_id: currentEmployee.user_id,
        shift_id: selectedSwapShift,
        from_employee_id: currentEmployee.id,
        to_employee_id: toEmployee,
        status: 'pending'
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
    const today = new Date().toISOString().split('T')[0];

    // Alle zukünftigen Schichten laden
    const { data: shifts } = await db
        .from('shifts')
        .select('*')
        .eq('employee_id', currentEmployee.id)
        .gte('shift_date', today)
        .order('shift_date')
        .limit(5);

    const todayShift = shifts ? shifts.find(s => s.shift_date === today) : null;
    const nextShift = shifts ? shifts.find(s => s.shift_date > today) : null;

    const todayEl = document.getElementById('today-shift-info');
    const nextEl = document.getElementById('next-shift-info');

    if (todayShift) {
        todayEl.textContent = `${todayShift.start_time.slice(0,5)} – ${todayShift.end_time.slice(0,5)} Uhr`;
    } else {
        todayEl.textContent = 'Keine Schicht heute';
    }

    if (nextShift) {
        nextEl.textContent = `${formatDate(nextShift.shift_date)} | ${nextShift.start_time.slice(0,5)} – ${nextShift.end_time.slice(0,5)} Uhr`;
    } else {
        nextEl.textContent = '–';
    }
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

    // Anzeige
    if (approved) {
        const ah = Math.floor(approved.approved_minutes / 60);
        const am = String(approved.approved_minutes % 60).padStart(2, '0');
        document.getElementById('stunden-total').innerHTML = `
                <span style="color:var(--color-primary);">${ph}h ${pm}m</span>
                <span style="color:var(--color-text-light); font-size:1rem;"> Geplant</span>
                <br>
                <span style="font-weight:700;">${ah}h ${am}m</span>
                <span style="color:var(--color-text-light); font-size:1rem;"> Geleistet</span>`;
    } else {
        document.getElementById('stunden-total').textContent = `${ph}h ${pm}m`;
    }

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