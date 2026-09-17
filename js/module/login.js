import { supabase, authReady } from '../supabase.js';

const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');

const loginButton = document.getElementById('loginButton');
const loginButtonText = document.getElementById('loginButtonText');
const loginSpinner = document.getElementById('loginSpinner');

const loginError = document.getElementById('loginError');
const loginErrorText = document.getElementById('loginErrorText');

const authLoading = document.getElementById('authLoading');
const loginScreen = document.getElementById('loginScreen');


// =====================================================
// HELPER
// =====================================================

function showError(message) {
    loginErrorText.textContent = message;
    loginError.classList.remove('hidden');
}

function hideError() {
    loginError.classList.add('hidden');
    loginErrorText.textContent = '';
}

function setLoading(loading) {

    loginButton.disabled = loading;

    if (loading) {
        loginButtonText.classList.add('hidden-force');
        loginSpinner.classList.remove('hidden-force');
    } else {
        loginButtonText.classList.remove('hidden-force');
        loginSpinner.classList.add('hidden-force');
    }
}


// =====================================================
// TOGGLE PASSWORD
// =====================================================

document
    .getElementById('togglePassword')
    ?.addEventListener('click', () => {

        const icon =
            document.getElementById('togglePasswordIcon');

        if (loginPassword.type === 'password') {

            loginPassword.type = 'text';

            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');

        } else {

            loginPassword.type = 'password';

            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    });


// =====================================================
// CEK SESSION YANG SUDAH ADA
// =====================================================

async function checkExistingSession() {

    try {

        await authReady;

        if (!supabase) {
            throw new Error('Supabase tidak tersedia.');
        }

        const {
            data: { session },
            error
        } = await supabase.auth.getSession();

        if (error) {
            throw error;
        }

        if (session?.user) {

            console.log(
                '✅ Session sudah ada:',
                session.user.email
            );

            await redirectByRole(session.user);

            return;
        }

    } catch (error) {

        console.error(
            '❌ Gagal mengecek session:',
            error
        );
    }

    // Tidak login → tampilkan login
    authLoading.classList.add('hidden-force');
    loginScreen.classList.remove('hidden-force');
}


// =====================================================
// LOGIN
// =====================================================

loginForm?.addEventListener('submit', async (e) => {

    e.preventDefault();

    hideError();

    const email =
        loginEmail.value.trim().toLowerCase();

    const password =
        loginPassword.value;

    if (!email || !password) {
        showError('Email dan password wajib diisi.');
        return;
    }

    try {

        await authReady;

        if (!supabase) {
            throw new Error(
                'Supabase tidak tersedia.'
            );
        }

        setLoading(true);

        console.log(
            'Mencoba login:',
            email
        );

        // =============================================
        // SUPABASE AUTH
        // =============================================

        const {
            data,
            error
        } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            throw error;
        }

        if (!data?.user) {
            throw new Error(
                'Login berhasil tetapi data user tidak ditemukan.'
            );
        }

        console.log(
            '✅ LOGIN BERHASIL:',
            data.user.email
        );

        // =============================================
        // CEK ROLE
        // =============================================

        await redirectByRole(data.user);

    } catch (error) {

        console.error(
            '❌ LOGIN ERROR:',
            error
        );

        let message =
            'Login gagal. Periksa email dan password.';

        if (error?.message) {

            if (
                error.message
                    .toLowerCase()
                    .includes('invalid login credentials')
            ) {
                message =
                    'Email atau password salah.';
            } else {
                message = error.message;
            }
        }

        showError(message);

        setLoading(false);
    }
});


// =====================================================
// CEK ROLE DAN REDIRECT
// =====================================================

async function redirectByRole(user) {

    console.log(
        '🔍 Mencari role:',
        user.email
    );

    const {
        data: userSetup,
        error
    } = await supabase
        .from('usersetup')
        .select('username, role')
        .eq('username', user.email)
        .maybeSingle();

    if (error) {

        console.error(
            '❌ Error usersetup:',
            error
        );

        throw new Error(
            'Gagal membaca data akses pengguna.'
        );
    }

    if (!userSetup) {

        await supabase.auth.signOut();

        throw new Error(
            'Akun berhasil login tetapi belum memiliki akses ke sistem.'
        );
    }

    const role =
        String(userSetup.role || '')
            .trim()
            .toLowerCase();

    console.log(
        '👤 Username:',
        userSetup.username
    );

    console.log(
        '🔐 Role:',
        role
    );


    // =============================================
    // REDIRECT BERDASARKAN ROLE
    // =============================================

    if (role === 'admin') {

        console.log(
            '➡️ Redirect ADMIN'
        );

        window.location.replace('./admin.html');

        return;
    }


    if (role === 'kasir') {

        console.log(
            '➡️ Redirect KASIR'
        );

        window.location.replace('./kasir.html');

        return;
    }


    // Role tidak dikenal
    await supabase.auth.signOut();

    throw new Error(
        `Role "${role}" belum memiliki akses aplikasi.`
    );
}


// =====================================================
// START
// =====================================================

checkExistingSession();
