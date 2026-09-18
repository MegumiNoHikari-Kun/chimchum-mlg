import { supabase, authReady } from '../supabase.js';

export async function requireAuth(allowedRoles = []) {
    try {
        // =========================================
        // 1. TUNGGU SUPABASE SIAP
        // =========================================
        await authReady;

        if (!supabase) {
            console.error('❌ Supabase tidak tersedia.');
            window.location.replace('/login.html');
            return null;
        }

        // =========================================
        // 2. CEK SESSION LOGIN
        // =========================================
        const {
            data: { session },
            error: sessionError
        } = await supabase.auth.getSession();

        if (sessionError) {
            console.error('❌ Session error:', sessionError);

            window.location.replace('/login.html');
            return null;
        }

        // =========================================
        // 3. BELUM LOGIN
        // =========================================
        if (!session?.user) {
            console.log('⚠️ User belum login → login.html');

            window.location.replace('/login.html');
            return null;
        }

        const user = session.user;

        // console.log('✅ LOGIN USER:', user.email);

        // =========================================
        // 4. AMBIL DATA USERSETUP
        // =========================================
        const {
            data: userSetup,
            error: userSetupError
        } = await supabase
            .from('usersetup')
            .select('username, role')
            .eq('username', user.email)
            .maybeSingle();

        if (userSetupError) {
            console.error(
                '❌ Gagal membaca usersetup:',
                userSetupError
            );

            window.location.replace('/login.html');
            return null;
        }

        // =========================================
        // 5. USER TIDAK ADA DI USERSETUP
        // =========================================
        if (!userSetup) {
            console.error(
                '❌ User tidak ditemukan di usersetup:',
                user.email
            );

            await supabase.auth.signOut();

            window.location.replace('/login.html');
            return null;
        }

        // =========================================
        // 6. AMBIL ROLE
        // =========================================
        const role = String(userSetup.role || '')
            .trim()
            .toLowerCase();

        // console.log('👤 Username:', userSetup.username);
        // console.log('🔐 Role:', role);

        // =========================================
        // 7. ROLE KOSONG
        // =========================================
        if (!role) {
            console.error('❌ User tidak memiliki role.');

            await supabase.auth.signOut();

            window.location.replace('/login.html');
            return null;
        }

        // =========================================
        // 8. NORMALISASI ROLE YANG DIIZINKAN
        // =========================================
        const normalizedAllowedRoles = allowedRoles.map(role =>
            String(role)
                .trim()
                .toLowerCase()
        );

        // =========================================
        // 9. CEK ROLE UNTUK HALAMAN INI
        // =========================================
        if (
            normalizedAllowedRoles.length > 0 &&
            !normalizedAllowedRoles.includes(role)
        ) {
            console.warn(
                `⛔ Role "${role}" tidak memiliki akses ke halaman ini.`
            );

            // -----------------------------------------
            // KASIR → KASIR
            // -----------------------------------------
            if (role === 'kasir') {
                // console.log('➡️ Redirect ke kasir.html');

                window.location.replace('/kasir.html');
                return null;
            }

            // -----------------------------------------
            // ADMIN → ADMIN
            // -----------------------------------------
            if (role === 'admin') {
                // console.log('➡️ Redirect ke admin.html');

                window.location.replace('/admin.html');
                return null;
            }

            // -----------------------------------------
            // ROLE TIDAK DIKENALI
            // -----------------------------------------
            console.warn(
                '⚠️ Role tidak dikenali:',
                role
            );

            await supabase.auth.signOut();

            window.location.replace('/login.html');
            return null;
        }

        // =========================================
        // 10. AUTH & ROLE VALID
        // =========================================
        // console.log('✅ AUTH & ROLE VALID');

        return {
            session,
            user,
            userSetup,
            role
        };

    } catch (error) {

        console.error(
            '❌ Auth guard error:',
            error
        );

        // Error apa pun → kembali ke login
        window.location.replace('/login.html');

        return null;
    }
}
