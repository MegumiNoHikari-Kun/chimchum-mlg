import { supabase, authReady } from '../supabase.js';

// ====================== STATE ======================
let usersData = [];
let usersSupabaseClient = null;
let usersIsDemoMode = false;

// ====================== INIT ======================
async function initUserSetup() {
    try {
        await authReady;
        if (supabase) {
            usersSupabaseClient = supabase;
            await loadUsersFromSupabase();
        } else {
            usersIsDemoMode = true;
            loadMockUsers();
        }
    } catch (err) {
        console.warn("⚠️ [USER DEBUG] Init error, falling back to demo:", err);
        usersIsDemoMode = true;
        loadMockUsers();
    }
}

async function loadUsersFromSupabase() {
    try {
        const { data, error } = await usersSupabaseClient
            .from('usersetup')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("❌ [USER DEBUG] Error fetching usersetup:", error);
            showModal("Gagal Memuat", error.message, "❌");
            return;
        }
        usersData = data || [];
        renderUsersTable();
    } catch (e) {
        console.error("❌ [USER DEBUG] Supabase fetch exception:", e);
        loadMockUsers();
    }
}

function loadMockUsers() {
    usersData = [
        { id: 'usr_1', username: 'admin', password: 'admin123', role: 'admin', created_at: new Date().toISOString() },
        { id: 'usr_2', username: 'kasir1', password: 'kasir123', role: 'kasir', created_at: new Date().toISOString() }
    ];
    renderUsersTable();
}

// ====================== RENDER TABLE ======================
window.renderUsersTable = function() {
    const query = (document.getElementById('userSearch')?.value || '').toLowerCase();
    const tbody = document.getElementById('usersetup-table-tbody');
    if (!tbody) return;

    const filtered = usersData.filter(u => (u.username || '').toLowerCase().includes(query));

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400">Tidak ada user ditemukan.</td></tr>`;
        return;
    }

    const roleColors = {
        admin: 'bg-rose-50 text-rose-700 border-rose-200',
        owner: 'bg-violet-50 text-violet-700 border-violet-200',
        kasir: 'bg-amber-50 text-amber-700 border-amber-200',
        staff: 'bg-emerald-50 text-emerald-700 border-emerald-200'
    };

    tbody.innerHTML = filtered.map(u => {
        const roleClass = roleColors[u.role] || 'bg-slate-100 text-slate-600 border-slate-200';
        const createdDisplay = u.created_at ? formatUserDate(u.created_at) : '-';

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 text-slate-400 font-mono text-[11px]">${escapeUserHtml(String(u.id).slice(0, 8))}</td>
                <td class="p-3 font-semibold text-slate-800">${escapeUserHtml(u.username)}</td>
                <td class="p-3">
                    <span class="inline-block px-2.5 py-0.5 rounded-full font-semibold text-[10px] border ${roleClass}">
                        ${escapeUserHtml(u.role || '-')}
                    </span>
                </td>
                <td class="p-3 text-slate-500">${createdDisplay}</td>
                <td class="p-3 text-right space-x-2">
                    <button onclick="editUser('${u.id}')" class="text-orange-600 hover:text-orange-800 font-semibold px-2.5 py-1 bg-orange-50 rounded-lg">Edit</button>
                    <button onclick="deleteUser('${u.id}')" class="text-rose-600 hover:text-rose-800 font-semibold px-2.5 py-1 bg-rose-50 rounded-lg">Hapus</button>
                </td>
            </tr>
        `;
    }).join('');
};

function formatUserDate(iso) {
    try {
        const d = new Date(iso);
        return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
        return iso;
    }
}

// ====================== MODAL OPEN/CLOSE ======================
window.openUserModal = function() {
    resetUserForm();
    document.getElementById('userModalTitle').innerText = "Tambah User";
    document.getElementById('user-password-hint').innerText = "";
    document.getElementById('user-password').required = true;
    document.getElementById('userModal').classList.remove('hidden');
};

window.closeUserModal = function() {
    document.getElementById('userModal').classList.add('hidden');
};

window.toggleUserPasswordVisibility = function() {
    const input = document.getElementById('user-password');
    const eye = document.getElementById('user-password-eye');
    if (input.type === 'password') {
        input.type = 'text';
        eye.className = 'fa-solid fa-eye-slash';
    } else {
        input.type = 'password';
        eye.className = 'fa-solid fa-eye';
    }
};

window.resetUserForm = function() {
    const form = document.getElementById('userForm');
    if (form) form.reset();
    document.getElementById('user-edit-id').value = '';
    document.getElementById('user-role').value = 'staff';
};

// ====================== CREATE / UPDATE ======================
window.handleUserSubmit = async function(e) {
    e.preventDefault();

    const id = document.getElementById('user-edit-id').value;
    const username = document.getElementById('user-username').value.trim();
    const password = document.getElementById('user-password').value;
    const role = document.getElementById('user-role').value;
    const isEditing = !!id;

    if (!username) {
        showModal("Perhatian", "Username wajib diisi.", "⚠️");
        return;
    }
    if (!isEditing && !password) {
        showModal("Perhatian", "Password wajib diisi untuk user baru.", "⚠️");
        return;
    }

    // Cek duplikat username (kecuali user yang sedang diedit)
    const duplicate = usersData.find(u =>
        u.username.toLowerCase() === username.toLowerCase() && String(u.id) !== String(id)
    );
    if (duplicate) {
        showModal("Gagal", "Username sudah digunakan, silakan pilih username lain.", "❌");
        return;
    }

    const payload = { username, role };
    if (password) payload.password = password; // hanya update password kalau diisi

    try {
        if (usersSupabaseClient && !usersIsDemoMode) {
            if (isEditing) {
                const { error } = await usersSupabaseClient
                    .from('usersetup')
                    .update(payload)
                    .eq('id', id);
                if (error) throw error;
            } else {
                const { error } = await usersSupabaseClient
                    .from('usersetup')
                    .insert([payload]);
                if (error) throw error;
            }
            await loadUsersFromSupabase();
        } else {
            if (isEditing) {
                usersData = usersData.map(u => String(u.id) === String(id) ? { ...u, ...payload } : u);
            } else {
                usersData.push({
                    id: 'usr_' + Date.now(),
                    ...payload,
                    created_at: new Date().toISOString()
                });
            }
            renderUsersTable();
        }

        closeUserModal();
        showModal("Sukses", `User berhasil ${isEditing ? 'diperbarui' : 'ditambahkan'}!`, "✅");
    } catch (err) {
        console.error("❌ [USER DEBUG] Gagal simpan user:", err);
        showModal("Gagal", err.message || "Terjadi kesalahan saat menyimpan user.", "❌");
    }
};

// ====================== EDIT ======================
window.editUser = function(id) {
    const u = usersData.find(u => String(u.id) === String(id));
    if (!u) return;

    document.getElementById('user-edit-id').value = u.id;
    document.getElementById('user-username').value = u.username;
    document.getElementById('user-password').value = '';
    document.getElementById('user-password').required = false;
    document.getElementById('user-password-hint').innerText = "(kosongkan jika tidak ingin mengganti)";
    document.getElementById('user-role').value = u.role || 'staff';
    document.getElementById('userModalTitle').innerText = "Edit User";
    document.getElementById('userModal').classList.remove('hidden');
};

// ====================== DELETE ======================
window.deleteUser = async function(id) {
    const u = usersData.find(u => String(u.id) === String(id));
    if (!confirm(`Hapus user "${u ? u.username : id}"? Tindakan ini tidak bisa dibatalkan.`)) return;

    try {
        if (usersSupabaseClient && !usersIsDemoMode) {
            const { error } = await usersSupabaseClient.from('usersetup').delete().eq('id', id);
            if (error) throw error;
            await loadUsersFromSupabase();
        } else {
            usersData = usersData.filter(u => String(u.id) !== String(id));
            renderUsersTable();
        }
        showModal("Terhapus", "User berhasil dihapus.", "🗑️");
    } catch (err) {
        console.error("❌ [USER DEBUG] Gagal hapus user:", err);
        showModal("Gagal", err.message || "Terjadi kesalahan saat menghapus user.", "❌");
    }
};

// ====================== HELPERS ======================
function escapeUserHtml(str) {
    return String(str || '')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Panggil ini saat tab "usersetup" dibuka (tambahkan di window.switchTab kamu:
// if (tabName === 'usersetup') renderUsersTable();)
document.addEventListener('DOMContentLoaded', initUserSetup);
