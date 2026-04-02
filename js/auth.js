const SUPABASE_URL = 'https://ulazvcrpasnhufzlywxf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsYXp2Y3JwYXNuaHVmemx5d3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5NTI3NzAsImV4cCI6MjA3NjUyODc3MH0.RDyhW1CILNSH2KL77ftx0vYlbwgNOQuNVgkYMcqhi0M';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── TAB WECHSEL ──────────────────────────────────────────
function switchLoginTab(tab) {
    const empLogin = document.getElementById('employee-login');
    const adminLogin = document.getElementById('admin-login');
    const tabs = document.querySelectorAll('.login-tab');

    if (tab === 'employee') {
        empLogin.style.display = 'block';
        adminLogin.style.display = 'none';
        tabs[0].classList.add('active');
        tabs[1].classList.remove('active');
    } else {
        empLogin.style.display = 'none';
        adminLogin.style.display = 'block';
        tabs[0].classList.remove('active');
        tabs[1].classList.add('active');
    }
}

// ── ADMIN LOGIN ───────────────────────────────────────────
async function loginAdmin() {
    const email = document.getElementById('admin-email').value.trim();
    const password = document.getElementById('admin-password').value;
    const errorDiv = document.getElementById('admin-error');

    errorDiv.style.display = 'none';

    if (!email || !password) {
        errorDiv.textContent = 'Bitte alle Felder ausfüllen.';
        errorDiv.style.display = 'block';
        return;
    }

    const { data, error } = await db.auth.signInWithPassword({ email, password });

    if (error) {
        errorDiv.textContent = 'Login fehlgeschlagen. Bitte prüfe Email und Passwort.';
        errorDiv.style.display = 'block';
        return;
    }

    window.location.href = 'admin.html';
}

// ── MITARBEITER LOGIN ─────────────────────────────────────
async function loginEmployee() {
    const loginCode = document.getElementById('emp-number').value.trim();
    const password = document.getElementById('emp-password').value;
    const errorDiv = document.getElementById('emp-error');
    errorDiv.style.display = 'none';

    if (!loginCode || !password) {
        errorDiv.textContent = 'Bitte alle Felder ausfüllen.';
        errorDiv.style.display = 'block';
        return;
    }

    const { data: employee, error } = await db
        .from('employees_planit')
        .select('*')
        .eq('login_code', loginCode)
        .eq('is_active', true)
        .maybeSingle();

    if (error || !employee) {
        errorDiv.textContent = 'Kürzel nicht gefunden.';
        errorDiv.style.display = 'block';
        return;
    }

    if (employee.password_hash !== password) {
        errorDiv.textContent = 'Passwort falsch.';
        errorDiv.style.display = 'block';
        return;
    }

    localStorage.setItem('planit_employee', JSON.stringify({
        id: employee.id,
        name: employee.name,
        login_code: employee.login_code,
        user_id: employee.user_id,
        is_apprentice: employee.is_apprentice || false,
        department: employee.department
    }));
    window.location.href = 'employee.html';
}

// ── SESSION CHECK FUNKTIONEN ──────────────────────────────
async function requireAdminSession() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
        window.location.href = 'index.html';
        return null;
    }
    return session;
}

function requireEmployeeSession() {
    const employee = localStorage.getItem('planit_employee');
    if (!employee) {
        window.location.href = 'index.html';
        return null;
    }
    return JSON.parse(employee);
}

// ── LOGOUT ────────────────────────────────────────────────
async function logout() {
    await db.auth.signOut();
    localStorage.removeItem('planit_employee');
    window.location.href = 'index.html';
}

// ── PULL TO REFRESH ───────────────────────────────────────
function initPullToRefresh() {}

document.addEventListener('DOMContentLoaded', initPullToRefresh);