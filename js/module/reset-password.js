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
    console.log("1. Tombol submit ditekan, form dicegat."); // Cek apakah event jalan

    const email = $('resetEmail').value.trim();
    console.log("2. Email yang dimasukkan:", email); // Cek apakah input terbaca

    try {
        console.log("3. Menunggu authReady...");
        await authReady;
        console.log("4. authReady selesai. Memanggil Supabase...");

        // Panggil supabase
        const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.href
        });

        console.log("5. Respon Supabase diterima:", { data, error });

        if (error) {
            throw error;
        }

        showResetAlert('Instruksi reset telah dikirim!', 'success');

    } catch (error) {
        console.error("❌ ERROR TERTANGKAP:", error);
        showResetAlert(error.message || 'Terjadi kesalahan sistem.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Kirim Instruksi ke Email';
    }
});
