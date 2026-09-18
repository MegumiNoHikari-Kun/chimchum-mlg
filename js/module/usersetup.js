import { supabase, authReady } from '../supabase.js';

let users = [];
let usingLocalStorage = false;
let isSaving = false;
let isDeleting = false;


// =========================================================
// DOM HELPER
// =========================================================

const $ = (id) => document.getElementById(id);


// =========================================================
// ESCAPE HTML
// =========================================================

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


// =========================================================
// FORMAT DATE
// =========================================================

function formatUserDate(iso) {
    try {
        const d = new Date(iso);
        return d.toLocaleString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return iso || '-';
    }
}


// =========================================================
// LOCAL STORAGE
// =========================================================

function saveLocalUsers() {
    try {
        localStorage.setItem(
            'local_usersetup',
            JSON.stringify(users)
        );
    } catch (error) {
        console.warn('LocalStorage gagal:', error);
    }
}


// =========================================================
// STATUS MESSAGE
// =========================================================

function showStatus(message, type = 'success') {
    const box = $('statusBox');
    if (!box) return;

    box.className = 'mb-5 rounded-xl px-4 py-3 text-xs border';

    if (type === 'success') {
        box.classList.add('bg-emerald-50', 'text-emerald-700', 'border-emerald-200');
        box.innerHTML = '<i class="fa-solid fa-circle-check mr-2"></i>' + escapeHtml(message);
    } else if (type === 'warning') {
        box.classList.add('bg-amber-50', 'text-amber-700', 'border-amber-200');
        box.innerHTML = '<i class="fa-solid fa-triangle-exclamation mr-2"></i>' + escapeHtml(message);
    } else {
        box.classList.add('bg-red-50', 'text-red-700', 'border-red-200');
        box.innerHTML = '<i class="fa-solid fa-circle-exclamation mr-2"></i>' + escapeHtml(message);
    }
}

function hideStatus() {
    $('statusBox')?.classList.add('hidden');
}


// =========================================================
// CONNECTION STATUS
// =========================================================

function setConnectionStatus(connected, localMode = false) {
    const element = $('connectionStatus');
    if (!element) return;

    if (localMode) {
        element.className = 'text-[10px] text-amber-600 hidden sm:block';
        element.innerHTML = '<i class="fa-solid fa-hard-drive mr-1"></i>Mode Local Storage';
        return;
    }

    if (connected) {
        element.className = 'text-[10px] text-emerald-600 hidden sm:block';
        element.innerHTML = '<i class="fa-solid fa-circle-check mr-1"></i>Terhubung ke Supabase';
    } else {
        element.className = 'text-[10px] text-red-600 hidden sm:block';
        element.innerHTML = '<i class="fa-solid fa-circle-xmark mr-1"></i>Supabase tidak terhubung';
    }
}


// =========================================================
// LOAD USERS
// =========================================================

async function loadUsers() {
    const tbody = $('userTable');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-10 text-slate-400">
                    <i class="fa-solid fa-circle-notch loading-spinner text-orange-500 mr-2"></i>
                    Memuat user...
                </td>
            </tr>
        `;
    }

    try {
        await authReady;

        const { data, error } = await supabase
            .from('usersetup')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        users = Array.isArray(data) ? data : [];
        usingLocalStorage = false;
        setConnectionStatus(true, false);
        saveLocalUsers();
        renderTable(users);

        console.log('USERS LOADED:', users);
    } catch (error) {
        console.error('Supabase load error:', error);

        let localData = [];
        try {
            const stored = localStorage.getItem('local_usersetup');
            localData = stored ? JSON.parse(stored) : [];
        } catch {
            localData = [];
        }

        users = Array.isArray(localData) && localData.length > 0 ? localData : [
            { id: 'usr_1', username: 'admin', role: 'admin', created_at: new Date().toISOString() },
            { id: 'usr_2', username: 'kasir1', role: 'kasir', created_at: new Date().toISOString() }
        ];

        usingLocalStorage = true;
        setConnectionStatus(false, true);
        renderTable(users);

        showStatus(
            'Supabase gagal mengambil data. Mode Local Storage digunakan. ' + getErrorMessage(error),
            'warning'
        );
    }
}


// =========================================================
// RENDER TABLE
// =========================================================

function renderTable(dataList) {
    const tbody = $('userTable');
    if (!tbody) return;

    const list = Array.isArray(dataList) ? dataList : [];
    $('userCount').textContent = `${list.length} user ditampilkan`;

    if (list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-12">
                    <div class="flex flex-col items-center">
                        <div class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                            <i class="fa-solid fa-users-slash text-slate-400"></i>
                        </div>
                        <p class="text-xs font-semibold text-slate-500">
                            Tidak ada user ditemukan
                        </p>
                        <p class="text-[10px] text-slate-400 mt-1">
                            Tambahkan user baru menggunakan form di atas.
                        </p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    const roleColors = {
        admin: 'bg-rose-50 text-rose-700 border-rose-200',
        owner: 'bg-violet-50 text-violet-700 border-violet-200',
        kasir: 'bg-amber-50 text-amber-700 border-amber-200',
        staff: 'bg-emerald-50 text-emerald-700 border-emerald-200'
    };

    tbody.innerHTML = list.map((u, index) => {
        const id = u?.id ?? '';
        const username = u?.username ?? '-';
        const role = u?.role ?? 'staff';
        const roleClass = roleColors[role] || 'bg-slate-100 text-slate-600 border-slate-200';
        const createdDisplay = u?.created_at ? formatUserDate(u.created_at) : '-';
        const rowNumber = index + 1;

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 text-center text-slate-500 font-medium">
                    ${rowNumber}
                </td>

                <td class="p-3 font-semibold text-slate-800">
                    ${escapeHtml(username)}
                </td>

                <td class="p-3">
                    <span class="inline-block px-2.5 py-0.5 rounded-full font-semibold text-[10px] border ${roleClass}">
                        ${escapeHtml(role)}
                    </span>
                </td>

                <td class="p-3 text-slate-500">
                    ${createdDisplay}
                </td>

                <td class="p-3">
                    <div class="flex gap-1">
                        <button
                            type="button"
                            data-action="edit"
                            data-id="${escapeHtml(id)}"
                            class="bg-sky-50 text-sky-600 hover:bg-sky-100 p-2 rounded-lg transition"
                            title="Edit"
                        >
                            <i class="fa-solid fa-pen"></i>
                        </button>

                        <button
                            type="button"
                            data-action="delete"
                            data-id="${escapeHtml(id)}"
                            class="bg-rose-50 text-rose-600 hover:bg-rose-100 p-2 rounded-lg transition"
                            title="Hapus"
                        >
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}


// =========================================================
// FILTER & SEARCH BAR INTERACTION
// =========================================================

const searchInput = $('u-search');
const clearButton = $('btnClearSearch');

function filterTable() {
    const keyword = searchInput.value.toLowerCase().trim();

    if (!keyword) {
        renderTable(users);
        return;
    }

    const filtered = users.filter(u => {
        const username = String(u?.username ?? '').toLowerCase();
        const role = String(u?.role ?? '').toLowerCase();
        return username.includes(keyword) || role.includes(keyword);
    });

    renderTable(filtered);
}

searchInput.addEventListener('input', () => {
    filterTable();
    if (searchInput.value.trim().length > 0) {
        clearButton.classList.remove('hidden');
    } else {
        clearButton.classList.add('hidden');
    }
});

clearButton.addEventListener('click', () => {
    searchInput.value = '';
    clearButton.classList.add('hidden');
    filterTable();
    searchInput.focus();
});


// =========================================================
// FORM DATA
// =========================================================

function getFormData() {
    const id = $('u-id').value.trim();
    const username = $('u-username').value.trim();
    const password = $('u-password').value;
    const role = $('u-role').value;
    const isEditing = !!id;

    if (!username) {
        throw new Error('Username wajib diisi.');
    }

    if (!isEditing && !password) {
        throw new Error('Password wajib diisi untuk user baru.');
    }

    if (password && password.length < 6) {
        throw new Error('Password minimal harus 6 karakter.');
    }

    const duplicate = users.find(u =>
        String(u?.username || '').toLowerCase() === username.toLowerCase() &&
        String(u?.id || '') !== String(id || '')
    );

    if (duplicate) {
        throw new Error('Username sudah digunakan, silakan pilih username lain.');
    }

    const payload = { username, role };
    if (password) {
        payload.password = password;
    }

    return payload;
}


// =========================================================
// RESET FORM
// =========================================================

function resetForm() {
    $('u-id').value = '';$('u-username').value = '';
    $('u-password').value = '';$('u-password').required = true;
    $('u-role').value = 'staff';

    $('password-required-star').classList.remove('hidden');$('passwordHint').classList.add('hidden');

    $('btnCancelEdit').classList.add('hidden');$('formTitle').innerHTML = '<i class="fa-solid fa-user-plus text-orange-500"></i> Tambah User';
    $('btnSaveText').textContent = 'Simpan User';
}


// =========================================================
// EDIT USER
// =========================================================

function editUser(id) {
    const user = users.find(item => String(item?.id) === String(id));
    if (!user) {
        showStatus('User tidak ditemukan di data aplikasi.', 'error');
        return;
    }

    $('u-id').value = user.id ?? '';
    $('u-username').value = user.username ?? '';
    $('u-password').value = '';$('u-password').required = false;
    $('u-role').value = user.role || 'staff';

    $('password-required-star').classList.add('hidden');$('passwordHint').classList.remove('hidden');

    $('btnCancelEdit').classList.remove('hidden');$('formTitle').innerHTML = '<i class="fa-solid fa-user-pen text-sky-500"></i> Edit User';
    $('btnSaveText').textContent = 'Update User';

    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => $('u-username').focus(), 200);
}


// =========================================================
// SAVE USER
// =========================================================

async function saveUser() {
    if (isSaving) return;
    isSaving = true;

    const button = $('btnSave');
    const buttonText = $('btnSaveText');

    button.disabled = true;
    buttonText.textContent = 'Menyimpan...';

    try {
        const id = $('u-id').value.trim();
        const payload = getFormData();
        const isEditing = !!id;

        if (usingLocalStorage) {
            if (isEditing) {
                const index = users.findIndex(item => String(item.id) === String(id));
                if (index === -1) throw new Error('User tidak ditemukan di Local Storage.');

                users[index] = { ...users[index], ...payload };
                showStatus('User berhasil diperbarui di Local Storage.', 'success');
            } else {
                users.unshift({
                    id: 'usr_' + Date.now(),
                    ...payload,
                    created_at: new Date().toISOString()
                });
                showStatus('User berhasil ditambahkan ke Local Storage.', 'success');
            }

            saveLocalUsers();
            renderTable(users);
            resetForm();
            return;
        }

        if (isEditing) {
            const { data: updatedRows, error: updateError } = await supabase
                .from('usersetup')
                .update(payload)
                .eq('id', id)
                .select('*');

            if (updateError) throw updateError;
            if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
                throw new Error('UPDATE gagal. ID tidak ditemukan atau RLS menolak akses.');
            }

            showStatus('User berhasil diperbarui di Supabase.', 'success');
        } else {
            const { data: insertedRows, error: insertError } = await supabase
                .from('usersetup')
                .insert([payload])
                .select('*');

            if (insertError) throw insertError;
            if (!Array.isArray(insertedRows) || insertedRows.length === 0) {
                throw new Error('INSERT gagal menghasilkan row baru.');
            }

            showStatus('User baru berhasil disimpan di Supabase.', 'success');
        }

        resetForm();
        await loadUsers();
    } catch (error) {
        console.error('SAVE USER ERROR:', error);
        showStatus(getErrorMessage(error), 'error');
    } finally {
        isSaving = false;
        button.disabled = false;
        buttonText.textContent = $('u-id').value.trim() ? 'Update User' : 'Simpan User';
    }
}


// =========================================================
// DELETE USER
// =========================================================

async function deleteUser(id) {
    if (isDeleting) return;

    const user = users.find(item => String(item?.id) === String(id));
    const username = user ? user.username : 'user ini';

    const confirmed = confirm(`Hapus user "${username}"?\n\nTindakan ini tidak dapat dibatalkan.`);
    if (!confirmed) return;

    isDeleting = true;

    try {
        if (usingLocalStorage) {
            users = users.filter(item => String(item.id) !== String(id));
            saveLocalUsers();
            renderTable(users);
            showStatus('User berhasil dihapus dari Local Storage.', 'success');
            return;
        }

        const { data: deletedRows, error: deleteError } = await supabase
            .from('usersetup')
            .delete()
            .eq('id', id)
            .select('*');

        if (deleteError) throw deleteError;
        if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
            throw new Error('DELETE gagal. ID tidak ditemukan atau ditolak RLS.');
        }

        showStatus('User berhasil dihapus dari Supabase.', 'success');
        await loadUsers();
    } catch (error) {
        console.error('DELETE USER ERROR:', error);
        showStatus(getErrorMessage(error), 'error');
    } finally {
        isDeleting = false;
    }
}


// =========================================================
// ERROR FORMATTER
// =========================================================

function getErrorMessage(error) {
    if (!error) return 'Unknown error';
    return error.message || error.error_description || error.details || error.hint || String(error);
}


// =========================================================
// EVENTS
// =========================================================

$('btnTogglePassword').addEventListener('click', () => {
    const input = $('u-password');
    const eye = $('eyeIcon');
    if (input.type === 'password') {
        input.type = 'text';
        eye.className = 'fa-solid fa-eye-slash';
    } else {
        input.type = 'password';
        eye.className = 'fa-solid fa-eye';
    }
});

$('btnSave').addEventListener('click', saveUser);
$('btnCancelEdit').addEventListener('click', resetForm);$('btnRefresh').addEventListener('click', async () => {
    hideStatus();
    await loadUsers();
});

$('userTable').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const id = button.dataset.id;

    if (!id) {
        showStatus('ID user kosong.', 'error');
        return;
    }

    if (action === 'edit') editUser(id);
    if (action === 'delete') deleteUser(id);
});


// =========================================================
// INITIALIZE
// =========================================================

(async function init() {
    try {
        await authReady;
        await loadUsers();
    } catch (error) {
        console.error('INITIALIZATION ERROR:', error);
        showStatus(getErrorMessage(error), 'error');
    }
})();
