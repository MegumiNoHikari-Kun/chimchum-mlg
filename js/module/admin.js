import { supabase, authReady } from '../supabase.js';


// =====================================================
// ELEMENTS
// =====================================================

const adminApp =
    document.getElementById('adminApp');

const sidebarToggle =
    document.getElementById('sidebarToggle');

const sidebarToggleIcon =
    document.getElementById('sidebarToggleIcon');

const adminSidebar =
    document.getElementById('adminSidebar');

const logoutButton =
    document.getElementById('logoutButton');

const currentUserEmail =
    document.getElementById('currentUserEmail');

const moduleFrame =
    document.getElementById('moduleFrame');

const moduleLoading =
    document.getElementById('moduleLoading');


// =====================================================
// STATE
// =====================================================

let sidebarOpen = true;


// =====================================================
// SHOW ADMIN APPLICATION
// =====================================================

function showAdminApp() {

    if (!adminApp) {

        console.error(
            '❌ Element #adminApp tidak ditemukan.'
        );

        return;

    }

    adminApp.classList.remove(
        'hidden-force'
    );

}


// =====================================================
// SIDEBAR
// =====================================================

function updateSidebar() {

    if (!adminSidebar || !sidebarToggleIcon) {
        return;
    }

    if (sidebarOpen) {

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


// =====================================================
// SIDEBAR TOGGLE
// =====================================================

if (sidebarToggle) {

    sidebarToggle.addEventListener(
        'click',
        function () {

            sidebarOpen = !sidebarOpen;

            updateSidebar();

        }
    );

}


// =====================================================
// LOAD MODULE
// =====================================================

window.loadModule = function (
    moduleName,
    btnElement = null
) {

    if (!moduleFrame) {

        console.error(
            '❌ moduleFrame tidak ditemukan.'
        );

        return;

    }


    // =========================================
    // RESET ACTIVE BUTTON
    // =========================================

    document
        .querySelectorAll('.nav-btn')
        .forEach(function (btn) {

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


    // =========================================
    // CARI BUTTON
    // =========================================

    if (!btnElement) {

        const buttons =
            document.querySelectorAll('.nav-btn');

        buttons.forEach(function (btn) {

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


    // =========================================
    // AKTIFKAN BUTTON
    // =========================================

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


    // =========================================
    // LOADING
    // =========================================

    if (moduleLoading) {

        moduleLoading.classList.remove(
            'opacity-0'
        );

    }


    // =========================================
    // LOAD IFRAME
    // =========================================

    const target =
        moduleName + '.html';

    console.log(
        '📦 Loading admin module:',
        target
    );

    moduleFrame.src = target;

};


// =====================================================
// IFRAME LOAD
// =====================================================

if (moduleFrame) {

    moduleFrame.addEventListener(
        'load',
        function () {

            if (moduleLoading) {

                moduleLoading.classList.add(
                    'opacity-0'
                );

            }

            console.log(
                '✅ Module loaded:',
                moduleFrame.src
            );

        }
    );

}


// =====================================================
// LOGOUT
// =====================================================

if (logoutButton) {

    logoutButton.addEventListener(
        'click',
        async function () {

            const confirmed =
                confirm(
                    'Apakah Anda yakin ingin logout?'
                );

            if (!confirmed) {
                return;
            }


            try {

                logoutButton.disabled = true;

                logoutButton.classList.add(
                    'opacity-70',
                    'cursor-not-allowed'
                );


                await authReady;


                const {
                    error
                } =
                    await supabase.auth.signOut();


                if (error) {
                    throw error;
                }


                console.log(
                    '✅ Logout berhasil.'
                );


                window.location.replace(
                    '/login.html'
                );


            } catch (error) {

                console.error(
                    '❌ LOGOUT ERROR:',
                    error
                );


                alert(
                    'Gagal logout:\n\n' +
                    (
                        error?.message ||
                        error
                    )
                );


                logoutButton.disabled = false;

                logoutButton.classList.remove(
                    'opacity-70',
                    'cursor-not-allowed'
                );

            }

        }
    );

}


// =====================================================
// INITIALIZATION
// =====================================================

async function initAdmin() {

    try {

        // =========================================
        // SUPABASE READY
        // =========================================

        await authReady;


        // =========================================
        // GET SESSION
        // =========================================

        const {
            data,
            error
        } =
            await supabase.auth.getSession();


        if (error) {

            console.error(
                '❌ Gagal mengambil session:',
                error
            );

            window.location.replace(
                '/login.html'
            );

            return;

        }


        // =========================================
        // SESSION TIDAK ADA
        // =========================================

        if (!data?.session?.user) {

            console.warn(
                '⚠️ Session tidak tersedia.'
            );

            window.location.replace(
                '/login.html'
            );

            return;

        }


        // =========================================
        // TAMPILKAN ADMIN APP
        // =========================================

        showAdminApp();


        // =========================================
        // USER
        // =========================================

        const user =
            data.session.user;

        const email =
            user.email || 'Admin';


        console.log(
            '✅ Admin session aktif:',
            email
        );


        // =========================================
        // TAMPILKAN EMAIL
        // =========================================

        if (currentUserEmail) {

            currentUserEmail.textContent =
                email;

        }


        // =========================================
        // DEFAULT MODULE
        // =========================================

        loadModule(
            'pesanan'
        );


    } catch (error) {

        console.error(
            '❌ ADMIN INIT ERROR:',
            error
        );

        window.location.replace(
            '/login.html'
        );

    }

}


// =====================================================
// START
// =====================================================

initAdmin();
