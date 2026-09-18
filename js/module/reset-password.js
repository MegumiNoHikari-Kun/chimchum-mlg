import { supabase, authReady } from '../supabase.js';

const $ = (id) => document.getElementById(id);

const resetModal = $('resetModal');
const openBtn = $('openResetModal');
const closeBtn = $('closeResetModal');
const cancelBtn = $('cancelResetBtn');
const resetForm = $('resetForm');
const resetAlert = $('resetAlert');
const submitBtn = $('submitResetBtn');

// Tampilkan / Sembunyikan Modal
openBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    resetModal.classList.remove('hidden');
    $('resetEmail').focus();
});

function closeModal() {
    resetModal.classList.add('hidden');
    resetForm.reset();
    resetAlert.classList.add('hidden');
}

closeBtn?.addEventListener('click', closeModal);
cancelBtn?.addEventListener('click', closeModal);

// Tampilkan alert di dalam modal
function showResetAlert(message, type = 'success') {
    resetAlert.classList.remove('hidden', 'bg-emerald-50', 'text-emerald-700', 'bg-red-50', 'text-red-700');
    if (type === 'success') {
        resetAlert.classList.add('bg-emerald-50', 'text-emerald-700');
        resetAlert.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i> ${message}`;
    } else {
        resetAlert.classList.add('bg-red-50', 'text-red-700');
        resetAlert.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1"></i> ${message}`;
    }
}

// Proses Reset Password (Auth + Tabel usersetup)
resetForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('resetEmail').value.trim();
    const newPassword = $('resetNewPassword').value;

    if (!email || !newPassword) {
        showResetAlert('Email dan password baru wajib diisi.', 'error');
        return;
    }

    if (newPassword.length < 6) {
        showResetAlert('Password minimal harus 6 karakter.', 'error');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Memproses...';

    try {
        await authReady;

        // 1. Update password di Supabase Auth (Memerlukan Admin API / fungsi khusus backend, 
        // tapi jika menggunakan frontend mandiri, kita lakukan update berdasarkan pencarian data tabel atau langsung update user aktif)
        
        // Cek apakah user ada di tabel usersetup terlebih dahulu
        const { data: dbUser, error: dbError } = await supabase
            .from('usersetup')
            .select('*')
            .ilike('username', email)
            .maybeSingle();

        if (dbError) throw dbError;

        if (!dbUser) {
            throw new Error('Email atau username tidak ditemukan dalam sistem database.');
        }

        // 2. Update password langsung di tabel usersetup
        const { error: updateTableError } = await supabase
            .from('usersetup')
            .update({ password: newPassword })
            .eq('id', dbUser.id);

        if (updateTableError) throw updateTableError;

        showResetAlert('Password berhasil direset! Silakan login kembali.', 'success');
        
        setTimeout(() => {
            closeModal();
        }, 2000);

    } catch (error) {
        console.error('Reset password error:', error);
        showResetAlert(error.message || 'Terjadi kesalahan saat mereset password.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reset Sekarang';
    }
});
