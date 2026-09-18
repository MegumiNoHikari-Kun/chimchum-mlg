import { supabase, authReady } from '../supabase.js';

const $ = (id) => document.getElementById(id);

const resetModal = $('resetModal');
const openBtn = $('openResetModal');
const closeBtn = $('closeResetModal');
const cancelBtn = $('cancelResetBtn');
const resetForm = $('resetForm');
const resetAlert = $('resetAlert');
const submitBtn = $('submitResetBtn');

// Ubah judul modal secara dinamis tergantung mode (Kirim Email vs Input Password Baru)
const modalTitle = $('modalTitle');
const emailSection = $('emailSection');
const newPasswordSection = $('newPasswordSection');
let isRecoveryMode = false;

// Buka modal "Lupa Password" (Kirim Email)
openBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    isRecoveryMode = false;
    setupModalView();
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

function setupModalView() {
    if (isRecoveryMode) {
        modalTitle.innerHTML = '<i class="fa-solid fa-lock text-orange-500"></i> Buat Password Baru';
        emailSection.classList.add('hidden');
        newPasswordSection.classList.remove('hidden');
        submitBtn.textContent = 'Simpan Password Baru';
    } else {
        modalTitle.innerHTML = '<i class="fa-solid fa-rotate-right text-orange-500"></i> Reset Password Akun';
        emailSection.classList.remove('hidden');
        newPasswordSection.classList.add('hidden');
        submitBtn.textContent = 'Kirim Instruksi ke Email';
    }
}

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

// Tangkap Event saat user klik link dari email (Supabase mengarahkan balik dengan membawa token recovery)
(async function initRecoveryListener() {
    await authReady;

    supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            isRecoveryMode = true;
            setupModalView();
            resetModal.classList.remove('hidden');
            $('resetNewPassword').focus();
        }
    });
})();

// Submit Form (Bisa berupa Kirim Email atau Update Password Baru)
resetForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
        await authReady;

        if (!isRecoveryMode) {
            // === TAHAP 1: KIRIM EMAIL RESET ===
            const email = $('resetEmail').value.trim();
            if (!email) {
                showResetAlert('Email wajib diisi.', 'error');
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Mengirim...';

            // Kirim link reset via Supabase Auth
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.href // Mengarah kembali ke halaman login ini
            });

            if (error) throw error;

            showResetAlert('Instruksi reset telah dikirim! Silakan cek inbox/spam email Anda.', 'success');
            setTimeout(() => {
                closeModal();
            }, 4000);

        } else {
            // === TAHAP 2: SIMPAN PASSWORD BARU ===
            const newPassword = $('resetNewPassword').value;
            if (!newPassword || newPassword.length < 6) {
                showResetAlert('Password minimal harus 6 karakter.', 'error');
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Menyimpan...';

            // Update password di Supabase Auth
            const { error } = await supabase.auth.updateUser({
                password: newPassword
            });

            if (error) throw error;

            // (Opsional) Jika Anda juga ingin sync update password ke tabel usersetup
            // Kita bisa ambil user session saat ini lalu update tabel usersetup miliknya
            const { data: { user } } = await supabase.auth.getUser();
            if (user && user.email) {
                await supabase
                    .from('usersetup')
                    .update({ password: newPassword })
                    .ilike('username', user.email);
            }

            showResetAlert('Password berhasil diubah! Silakan login dengan password baru.', 'success');
            
            setTimeout(() => {
                closeModal();
                window.location.href = 'login.html'; // Clear sesi recovery
            }, 2000);
        }

    } catch (error) {
        console.error('Reset error:', error);
        showResetAlert(error.message || 'Terjadi kesalahan sistem.', 'error');
    } finally {
        submitBtn.disabled = false;
        if (!isRecoveryMode) {
            submitBtn.textContent = 'Kirim Instruksi ke Email';
        } else {
            submitBtn.textContent = 'Simpan Password Baru';
        }
    }
});
