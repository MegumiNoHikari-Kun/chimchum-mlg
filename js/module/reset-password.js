import { supabase, authReady } from '../supabase.js';

const $ = (id) => document.getElementById(id);

const resetModal = $('resetModal');
const openBtn = $('openResetModal');
const closeBtn = $('closeResetModal');
const cancelBtn = $('cancelResetBtn');
const resetForm = $('resetForm');
const resetAlert = $('resetAlert');
const submitBtn = $('submitResetBtn');

const modalTitle = $('modalTitle');
const emailSection = $('emailSection');
const newPasswordSection = $('newPasswordSection');

let isRecoveryMode = false;

// Buka Modal untuk Kirim Email Lupa Password
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
    // Bersihkan hash dari URL jika ada agar tidak looping
    if (window.location.hash.includes('recovery') || window.location.hash.includes('access_token')) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

closeBtn?.addEventListener('click', closeModal);
cancelBtn?.addEventListener('click', closeModal);

function setupModalView() {
    if (isRecoveryMode) {
        if (modalTitle) modalTitle.innerHTML = '<i class="fa-solid fa-lock text-orange-500"></i> Buat Password Baru';
        if (emailSection) emailSection.classList.add('hidden');
        if (newPasswordSection) newPasswordSection.classList.remove('hidden');
        if (submitBtn) submitBtn.textContent = 'Simpan Password Baru';
    } else {
        if (modalTitle) modalTitle.innerHTML = '<i class="fa-solid fa-rotate-right text-orange-500"></i> Reset Password Akun';
        if (emailSection) emailSection.classList.remove('hidden');
        if (newPasswordSection) newPasswordSection.classList.add('hidden');
        if (submitBtn) submitBtn.textContent = 'Kirim Instruksi ke Email';
    }
}

function showResetAlert(message, type = 'success') {
    if (!resetAlert) return;
    resetAlert.classList.remove('hidden', 'bg-emerald-50', 'text-emerald-700', 'bg-red-50', 'text-red-700');
    if (type === 'success') {
        resetAlert.classList.add('bg-emerald-50', 'text-emerald-700');
        resetAlert.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i> ${message}`;
    } else {
        resetAlert.classList.add('bg-red-50', 'text-red-700');
        resetAlert.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1"></i> ${message}`;
    }
}

// Deteksi otomatis saat halaman dimuat jika user kembali dari link email Supabase
window.addEventListener('DOMContentLoaded', async () => {
    try {
        await authReady;
        
        // Cek hash fragment di URL (Supabase membawa token recovery di hash)
        const hash = window.location.hash;
        if (hash.includes('type=recovery') || hash.includes('access_token')) {
            isRecoveryMode = true;
            setupModalView();
            resetModal.classList.remove('hidden');
            const newPassInput = $('resetNewPassword');
            if (newPassInput) newPassInput.focus();
        }
    } catch (err) {
        console.error("Error cek recovery session:", err);
    }
});

// Listener Supabase Auth event recovery
supabase.auth.onAuthStateChange(async (event) => {
    if (event === 'PASSWORD_RECOVERY') {
        isRecoveryMode = true;
        setupModalView();
        resetModal.classList.remove('hidden');
        const newPassInput = $('resetNewPassword');
        if (newPassInput) newPassInput.focus();
    }
});

// Proses Submit Form (Kirim Email ATAU Update Password Baru)
resetForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log("1. Tombol submit ditekan. Mode Recovery:", isRecoveryMode);

    try {
        await authReady;
        submitBtn.disabled = true;

        if (!isRecoveryMode) {
            // === TAHAP 1: KIRIM EMAIL ===
            const email = $('resetEmail').value.trim();
            console.log("2. Mengirim instruksi reset ke email:", email);
            submitBtn.textContent = 'Mengirim...';

            const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + window.location.pathname // Mengarah ke halaman bersih
            });

            console.log("3. Respon Supabase reset email:", { data, error });
            if (error) throw error;

            showResetAlert('Instruksi reset telah dikirim! Cek inbox atau folder spam email Anda.', 'success');
            setTimeout(() => {
                closeModal();
            }, 4000);

        } else {
            // === TAHAP 2: SIMPAN PASSWORD BARU ===
            const newPassword = $('resetNewPassword').value;
            console.log("2. Menyimpan password baru...");
            
            if (!newPassword || newPassword.length < 6) {
                throw new Error('Password minimal harus 6 karakter.');
            }

            submitBtn.textContent = 'Menyimpan...';

            // Update password di Supabase Auth
            const { error: updateAuthError } = await supabase.auth.updateUser({
                password: newPassword
            });

            if (updateAuthError) throw updateAuthError;

            // Sinkronisasi update password ke tabel usersetup
            const { data: { user } } = await supabase.auth.getUser();
            if (user && user.email) {
                await supabase
                    .from('usersetup')
                    .update({ password: newPassword })
                    .ilike('username', user.email);
            }

            console.log("3. Password berhasil diperbarui di Auth & Database.");
            showResetAlert('Password berhasil diubah! Silakan login dengan password baru.', 'success');

            setTimeout(() => {
                closeModal();
                window.location.hash = ''; // Hapus hash token dari URL
                window.location.reload();   // Refresh ke halaman login normal
            }, 2000);
        }

    } catch (error) {
        console.error("❌ ERROR TERTANGKAP:", error);
        showResetAlert(error.message || 'Terjadi kesalahan sistem.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isRecoveryMode ? 'Simpan Password Baru' : 'Kirim Instruksi ke Email';
    }
});
