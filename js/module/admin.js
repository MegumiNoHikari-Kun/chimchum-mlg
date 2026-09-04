
const sidebarToggle =
    document.getElementById('sidebarToggle');

const sidebarToggleIcon =
    document.getElementById('sidebarToggleIcon');

const adminSidebar =
    document.getElementById('adminSidebar');

let sidebarOpen = true;


function updateSidebar() {

    if (sidebarOpen) {

        // Buka sidebar
        adminSidebar.classList.remove(
            'w-0',
            'border-r-0'
        );

        adminSidebar.classList.add(
            'w-72',
            'border-r'
        );

        sidebarToggleIcon.className =
            'fa-solid fa-bars';

    } else {

        // Tutup sidebar
        adminSidebar.classList.remove(
            'w-72',
            'border-r'
        );

        adminSidebar.classList.add(
            'w-0',
            'border-r-0'
        );

        sidebarToggleIcon.className =
            'fa-solid fa-bars-staggered';

    }

}


sidebarToggle.addEventListener(
    'click',
    function () {

        sidebarOpen = !sidebarOpen;

        updateSidebar();

    }
);

import { supabase } from '../supabase.js';


// =====================================================
// ELEMENTS
// =====================================================

const authLoading = document.getElementById('authLoading');

const loginScreen = document.getElementById('loginScreen');

const adminApp = document.getElementById('adminApp');

const loginForm = document.getElementById('loginForm');

const loginEmail = document.getElementById('loginEmail');

const loginPassword = document.getElementById('loginPassword');

const loginButton = document.getElementById('loginButton');

const loginButtonText = document.getElementById('loginButtonText');

const loginSpinner = document.getElementById('loginSpinner');

const loginError = document.getElementById('loginError');

const loginErrorText = document.getElementById('loginErrorText');

const togglePassword = document.getElementById('togglePassword');

const togglePasswordIcon = document.getElementById('togglePasswordIcon');

const logoutButton = document.getElementById('logoutButton');

const currentUserEmail = document.getElementById('currentUserEmail');

const moduleFrame = document.getElementById('moduleFrame');

const moduleLoading = document.getElementById('moduleLoading');


// =====================================================
// STATE
// =====================================================

let isAuthenticated = false;

let currentSession = null;


// =====================================================
// HELPER
// =====================================================

function showLoginError(message) {

    loginErrorText.textContent = message;

    loginError.classList.remove('hidden');

}


function hideLoginError() {

    loginError.classList.add('hidden');

    loginErrorText.textContent = '';

}


function setLoginLoading(loading) {

    loginButton.disabled = loading;

    loginButton.classList.toggle('opacity-70', loading);

    loginButton.classList.toggle('cursor-not-allowed', loading);

    if (loading) {

        loginButtonText.classList.add('hidden-force');

        loginSpinner.classList.remove('hidden-force');

    } else {

        loginButtonText.classList.remove('hidden-force');

        loginSpinner.classList.add('hidden-force');

    }

}


// =====================================================
// SHOW LOGIN
// =====================================================

function showLogin() {

    isAuthenticated = false;

    currentSession = null;

    adminApp.classList.add('hidden-force');

    loginScreen.classList.remove('hidden-force');

    authLoading.classList.add('hidden-force');

    currentUserEmail.textContent = '-';

    // Jangan biarkan iframe tetap menjalankan modul admin
    moduleFrame.src = 'about:blank';

}


// =====================================================
// SHOW ADMIN
// =====================================================

function showAdmin(session) {

    isAuthenticated = true;

    currentSession = session;

    loginScreen.classList.add('hidden-force');

    authLoading.classList.add('hidden-force');

    adminApp.classList.remove('hidden-force');

    currentUserEmail.textContent =
        session?.user?.email || 'Admin';

    console.log('Supabase session aktif:', session);

    // HANYA setelah login berhasil
    // iframe baru dimuat
    if (
        !moduleFrame.src ||
        moduleFrame.src.endsWith('about:blank')
    ) {

        loadModule('pesanan');

    }

}


// =====================================================
// CHECK SESSION
// =====================================================

async function checkSession() {

    try {

        console.log('Memeriksa Supabase session...');

        const {
            data,
            error
        } = await supabase.auth.getSession();

        if (error) {

            console.error(
                'getSession error:',
                error
            );

            showLogin();

            return;

        }

        const session = data?.session || null;

        if (session) {

            showAdmin(session);

        } else {

            showLogin();

        }

    } catch (error) {

        console.error(
            'SESSION CHECK ERROR:',
            error
        );

        showLogin();

    }

}


// =====================================================
// LOGIN
// =====================================================

loginForm.addEventListener(
    'submit',
    async function(event) {

        event.preventDefault();

        hideLoginError();

        const email =
            loginEmail.value.trim();

        const password =
            loginPassword.value;

        if (!email || !password) {

            showLoginError(
                'Email dan password wajib diisi.'
            );

            return;

        }

        setLoginLoading(true);

        try {

            console.log(
                'Mencoba login:',
                email
            );

            const {
                data,
                error
            } =
                await supabase.auth.signInWithPassword({
                    email: email,
                    password: password
                });

            if (error) {

                console.error(
                    'LOGIN ERROR:',
                    error
                );

                throw error;

            }

            if (!data?.session) {

                throw new Error(
                    'Login berhasil tetapi session Supabase tidak ditemukan.'
                );

            }

            console.log(
                'LOGIN BERHASIL:',
                data.session
            );

            loginPassword.value = '';

            showAdmin(data.session);

        } catch (error) {

            console.error(
                'LOGIN FAILED:',
                error
            );

            let message =
                error?.message ||
                'Login gagal.';

            if (
                message
                    .toLowerCase()
                    .includes('invalid login credentials')
            ) {

                message =
                    'Email atau password salah.';

            }

            showLoginError(message);

        } finally {

            setLoginLoading(false);

        }

    }
);


// =====================================================
// LOGOUT
// =====================================================

logoutButton.addEventListener(
    'click',
    async function() {

        const confirmed =
            confirm(
                'Apakah Anda yakin ingin logout?'
            );

        if (!confirmed) {
            return;
        }

        try {

            logoutButton.disabled = true;

            const {
                error
            } =
                await supabase.auth.signOut();

            if (error) {

                throw error;

            }

            console.log(
                'Logout berhasil.'
            );

            showLogin();

        } catch (error) {

            console.error(
                'LOGOUT ERROR:',
                error
            );

            alert(
                'Gagal logout: ' +
                (error?.message || error)
            );

        } finally {

            logoutButton.disabled = false;

        }

    }
);


// =====================================================
// TOGGLE PASSWORD
// =====================================================

togglePassword.addEventListener(
    'click',
    function() {

        const isPassword =
            loginPassword.type === 'password';

        loginPassword.type =
            isPassword
                ? 'text'
                : 'password';

        togglePasswordIcon.className =
            isPassword
                ? 'fa-solid fa-eye-slash'
                : 'fa-solid fa-eye';

    }
);


// =====================================================
// AUTH STATE CHANGE
// =====================================================

supabase.auth.onAuthStateChange(
    function(event, session) {

        console.log(
            'AUTH STATE:',
            event,
            session
        );

        if (session) {

            // Hindari memanggil showAdmin berulang
            if (!isAuthenticated) {

                showAdmin(session);

            } else {

                currentSession =
                    session;

                currentUserEmail.textContent =
                    session?.user?.email ||
                    'Admin';

            }

        } else {

            if (isAuthenticated) {

                showLogin();

            }

        }

    }
);


// =====================================================
// MODULE ROUTER
// =====================================================

window.loadModule = function(
    moduleName,
    btnElement = null
) {

    // Jangan izinkan module dibuka
    // kalau belum login
    if (!isAuthenticated) {

        console.warn(
            'Module diblokir karena user belum login.'
        );

        showLogin();

        return;

    }


    // Update active button
    document
        .querySelectorAll('.nav-btn')
        .forEach(function(btn) {

            btn.classList.remove(
                'bg-orange-500',
                'text-white',
                'shadow-sm',
                'shadow-orange-500/20'
            );

            btn.classList.add(
                'text-slate-600',
                'hover:bg-orange-50',
                'hover:text-orange-600'
            );

        });


    // Kalau dipanggil programmatically,
    // cari tombol berdasarkan moduleName
    if (!btnElement) {

        const buttons =
            document.querySelectorAll(
                '.nav-btn'
            );

        buttons.forEach(function(btn) {

            const onclick =
                btn.getAttribute('onclick') || '';

            if (
                onclick.includes(
                    "'" + moduleName + "'"
                )
            ) {

                btnElement = btn;

            }

        });

    }


    if (btnElement) {

        btnElement.classList.remove(
            'text-slate-600',
            'hover:bg-orange-50',
            'hover:text-orange-600'
        );

        btnElement.classList.add(
            'bg-orange-500',
            'text-white',
            'shadow-sm',
            'shadow-orange-500/20'
        );

    }


    // Loading
    moduleLoading.classList.remove(
        'opacity-0'
    );


    // Set iframe
    const target =
        moduleName + '.html';

    console.log(
        'Loading module:',
        target
    );

    moduleFrame.src = target;

};


// =====================================================
// IFRAME LOAD
// =====================================================

moduleFrame.addEventListener(
    'load',
    function() {

        moduleLoading.classList.add(
            'opacity-0'
        );

        // console.log(
        //     'Module loaded:',
        //     moduleFrame.src
        // );

    }
);


// =====================================================
// INITIALIZATION
// =====================================================

checkSession();
