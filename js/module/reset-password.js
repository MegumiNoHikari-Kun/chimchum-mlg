import { supabase, authReady } from '../supabase.js';

const $ = (id) => document.getElementById(id);
const resetModal = $('resetModal');
const resetForm = $('resetForm');
const resetAlert = $('resetAlert');
const submitBtn = $('submitResetBtn');

const modalTitle = $('modalTitle');
const emailSection = $('emailSection');
const newPasswordSection = $('newPasswordSection');

// Cek otomatis apakah URL mengandung token recovery dari email (hash fragment)
window.addEventListener('DOMContentLoaded', async () => {
    await authReady;

    // Supabase secara otomatis membaca hash token (#access_token=...) jika dihalaman login
    const { data: { session } } = await supabase.auth.getSession();
    
    // Cek apakah URL mengandung type=recovery atau hash token aktif
    const hash = window.location.hash;
    if (hash.includes('type=recovery') || hash.includes('access_token')) {
        // Jika user kembali dari email dan token valid, langsung buka modal "Buat Password Baru"
        modalTitle.innerHTML = '<i class="fa-solid fa-lock text-orange-500"></i> Buat Password Baru';
        emailSection.classList.add('hidden');
        newPasswordSection.classList.remove('hidden');
        submitBtn.textContent = 'Simpan Password Baru';
        resetModal.classList.remove('hidden');
        $('resetNewPassword').focus();
    }
});

// Listener bawaan Supabase Auth untuk recovery
supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
        modalTitle.innerHTML = '<i class="fa-solid fa-lock text-orange-500"></i> Buat Password Baru';
        emailSection.classList.add('hidden');
        newPasswordSection.classList.remove('hidden');
        submitBtn.textContent = 'Simpan Password Baru';
        resetModal.classList.remove('hidden');
        $('resetNewPassword').focus();
    }
});
