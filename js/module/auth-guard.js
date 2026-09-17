import { supabase, authReady } from '../supabase.js';

export async function requireAuth(allowedRoles = []) {
    try {
        await authReady;

        // =========================================
        // 1. SUPABASE
        // =========================================
        if (!supabase) {
            console.error('❌ Supabase tidak tersedia.');
            window.location.replace('/admin.html');
            return null;
        }

        // =========================================
        // 2. CHECK LOGIN
        // =========================================
        const {
            data: { session },
            error: sessionError
        } = await supabase.auth.getSession();

        if (sessionError) {
            console.error(
                '❌ Session error:',
                sessionError
            );

            window.location.replace('/admin.html');
            return null;
        }

        if (!session?.user) {
            console.log('⚠️ User belum login.');

            window.location.replace('/admin.html');
            return null;
        }

        const user = session.user;

        console.log('✅ LOGIN USER:', user.email);

        // =========================================
        // 3. AMBIL USER DARI USERSETUP
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

            window.location.replace('/admin.html');
            return null;
        }

        if (!userSetup) {
            console.error(
                '❌ User tidak ditemukan di usersetup:',
                user.email
            );

            await supabase.auth.signOut();

            window.location.replace('/admin.html');
            return null;
        }

        // =========================================
        // 4. AMBIL ROLE
        // =========================================
        const role = String(userSetup.role || '')
            .trim()
            .toLowerCase();

        console.log('👤 Username:', userSetup.username);
        console.log('🔐 Role:', role);

        if (!role) {
            console.error(
                '❌ User tidak memiliki role.'
            );

            await supabase.auth.signOut();

            window.location.replace('/admin.html');
            return null;
        }

        // =========================================
        // 5. CHECK ROLE HALAMAN
        // =========================================
        const normalizedAllowedRoles =
            allowedRoles.map(role =>
                String(role).trim().toLowerCase()
            );

        if (
            normalizedAllowedRoles.length > 0 &&
            !normalizedAllowedRoles.includes(role)
        ) {
            console.warn(
                `⛔ Role "${role}" tidak memiliki akses.`
            );

            // Redirect berdasarkan role
            if (role === 'kasir') {

                console.log(
                    '➡️ Redirect ke kasir.html'
                );

                window.location.replace('/kasir.html');

            } else if (role === 'admin') {

                console.log(
                    '➡️ Redirect ke index.html'
                );

                window.location.replace('/index.html');

            } else {

                console.warn(
                    '⚠️ Role tidak dikenali:',
                    role
                );

                await supabase.auth.signOut();

                window.location.replace('/admin.html');
            }

            return null;
        }

        // =========================================
        // 6. SEMUA VALID
        // =========================================
        console.log(
            '✅ AUTH & ROLE VALID'
        );

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

        window.location.replace('/admin.html');

        return null;
    }
}
