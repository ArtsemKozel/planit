let currentEmployee = null;
let calendarDate = new Date();
let availDate = new Date();
let myShifts = [];
let selectedSwapShift = null;
let selectedAvailDays = [];

// ── INIT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    currentEmployee = requireEmployeeSession();
    if (!currentEmployee) return;

    document.getElementById('employee-name').textContent = currentEmployee.name;

    await loadCalendar();
    renderCalendar(calendarDate.getFullYear(), calendarDate.getMonth(), myShifts);
    await loadVacations();
    await loadAvailability();
    await loadPayroll();
    await loadSwaps();
    await loadOverview();
});

// ── TAB WECHSEL ───────────────────────────────────────────
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.bottom-nav-item').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    const navBtn = document.getElementById('nav-' + tab);
    if (navBtn) navBtn.classList.add('active');
    if (tab === 'schichtplan') {
        setTimeout(() => renderCalendar(calendarDate.getFullYear(), calendarDate.getMonth(), myShifts), 50);
    }
}

// ── KALENDER ─────────────────────────────────────────────
async function loadCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();

    const monthNames = ['Januar','Februar','März','April','Mai','Juni',
                        'Juli','August','September','Oktober','November','Dezember'];
    document.getElementById('calendar-month-label').textContent = 
        `${monthNames[month]} ${year}`;

    // Schichten laden
    const firstDay = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const lastDay = `${year}-${String(month+1).padStart(2,'0')}-${new Date(year, month+1, 0).getDate()}`;

    const { data: shifts } = await db
        .from('shifts')
        .select('*')
        .eq('employee_id', currentEmployee.id)
        .gte('shift_date', firstDay)
        .lte('shift_date', lastDay);

    myShifts = shifts || [];
    if (document.getElementById('tab-schichtplan').classList.contains('active')) {
        renderCalendar(year, month, myShifts);
    }
}

function renderCalendar(year, month, shifts) {
    console.log('renderCalendar aufgerufen', year, month, shifts);
    const container = document.getElementById('calendar-days');
    container.innerHTML = '';

    const firstDay = new Date(year, month, 1);
    // Montag = 0
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    // Leere Zellen
    for (let i = 0; i < startOffset; i++) {
        const empty = document.createElement('div');
        empty.className = 'calendar-day empty';
        container.appendChild(empty);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const shift = shifts.find(s => s.shift_date === dateStr);

        const day = document.createElement('div');
        day.className = 'calendar-day';
        day.textContent = d;

        if (today.getDate() === d && today.getMonth() === month && today.getFullYear() === year) {
            day.classList.add('today');
        }

        if (shift) {
            day.classList.add('has-shift');
            day.onclick = () => showShiftDetail(shift, dateStr);
        }

        container.appendChild(day);
    }
}

function showShiftDetail(shift, dateStr) {
    const detail = document.getElementById('shift-detail');
    detail.style.display = 'block';

    document.getElementById('shift-detail-date').textContent = 
        new Date(dateStr).toLocaleDateString('de-DE', {weekday:'long', day:'numeric', month:'long'});
    document.getElementById('shift-detail-time').textContent = 
        `🕐 ${shift.start_time.slice(0,5)} – ${shift.end_time.slice(0,5)} Uhr`;
    document.getElementById('shift-detail-break').textContent = 
        shift.break_minutes ? `☕ Pause: ${shift.break_minutes} Min` : '';
    document.getElementById('shift-detail-notes').textContent = 
        shift.notes ? `📝 ${shift.notes}` : '';
}

function changeMonth(dir) {
    calendarDate.setMonth(calendarDate.getMonth() + dir);
    document.getElementById('shift-detail').style.display = 'none';
    loadCalendar();
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

    const canvas = document.getElementById('signature-canvas');
    const signature = canvas.toDataURL('image/png');

    // PDF generieren
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

    doc.text('Unterschrift:', 20, 110);
    doc.addImage(signature, 'PNG', 20, 115, 60, 25);

    doc.save(`Urlaubsantrag_${currentEmployee.name}_${start}.pdf`);

    // In Supabase speichern
    const { error } = await db.from('vacation_requests').insert({
        user_id: currentEmployee.user_id,
        employee_id: currentEmployee.id,
        start_date: start,
        end_date: end,
        reason: `${days} Tage`,
        status: 'pending'
    });

    if (error) {
        errorDiv.textContent = 'Fehler beim Senden.';
        errorDiv.style.display = 'block';
        return;
    }

    // E-Mail an Manager senden
    await db.functions.invoke('send-vacation-email', {
        body: {
            employeeName: currentEmployee.name,
            startDate: formatDate(start),
            endDate: formatDate(end),
            days: days,
            managerEmail: 'artsem86@gmail.com'
        }
    });

    closeVacationModal();
    await loadVacations();
}

// ── VERFÜGBARKEIT ─────────────────────────────────────────
async function loadAvailability() {
    const year = availDate.getFullYear();
    const month = availDate.getMonth();
    const monthStr = `${year}-${String(month+1).padStart(2,'0')}-01`;

    const monthNames = ['Januar','Februar','März','April','Mai','Juni',
                        'Juli','August','September','Oktober','November','Dezember'];
    document.getElementById('avail-month-label').textContent = 
        `${monthNames[month]} ${year}`;

    const { data } = await db
        .from('availability')
        .select('*')
        .eq('employee_id', currentEmployee.id)
        .eq('month', monthStr)
        .maybeSingle();

    selectedAvailDays = data ? data.available_days : [];
    renderAvailGrid(year, month);
}

function renderAvailGrid(year, month) {
    const container = document.getElementById('avail-grid');
    container.innerHTML = '';

    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
        const div = document.createElement('div');
        div.className = 'avail-day' + (selectedAvailDays.includes(d) ? ' selected' : '');
        div.textContent = d;
        div.onclick = () => toggleAvailDay(d, div);
        container.appendChild(div);
    }
}

function toggleAvailDay(day, el) {
    if (selectedAvailDays.includes(day)) {
        selectedAvailDays = selectedAvailDays.filter(d => d !== day);
        el.classList.remove('selected');
    } else {
        selectedAvailDays.push(day);
        el.classList.add('selected');
    }
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
        .single();

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