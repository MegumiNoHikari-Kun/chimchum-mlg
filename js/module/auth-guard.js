import { supabase, authReady } from '../supabase.js';

export async function requireAuth(allowedRoles = []) {
    try {
        await authReady;

        // =========================================
        // 1. SUPABASE HARUS TERSEDIA
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
                '❌ Gagal mendapatkan session:',
                sessionError
            );

            window.location.replace('/admin.html');
            return null;
        }

        // BELUM LOGIN
        if (!session?.user) {
            console.log('⚠️ User belum login.');

            window.location.replace('/admin.html');
            return null;
        }

        const user = session.user;

        console.log('✅ User login:', user.email);

        // =========================================
        // 3. CHECK PROFILE / ROLE
        // =========================================
        const {
            data: profile,
            error: profileError
        } = await supabase
            .from('profiles')
            .select('id, name, role')
            .eq('id', user.id)
            .maybeSingle();

        if (profileError) {
            console.error(
                '❌ Gagal mengambil profile:',
                profileError
            );

            window.location.replace('/admin.html');
            return null;
        }

        if (!profile) {
            console.error(
                '❌ Profile user tidak ditemukan.'
            );

            await supabase.auth.signOut();

            window.location.replace('/admin.html');
            return null;
        }

        const role = String(profile.role || '')
            .trim()
            .toLowerCase();

        console.log('👤 User:', user.email);
        console.log('🔐 Role:', role);

        // =========================================
        // 4. CHECK ROLE
        // =========================================

        // Tidak ada role yang diizinkan
        if (
            allowedRoles.length > 0 &&
            !allowedRoles.includes(role)
        ) {
            console.warn(
                `⛔ Role "${role}" tidak memiliki akses ke halaman ini.`
            );

            // Redirect berdasarkan ROLE user
            switch (role) {

                case 'kasir':
                    console.log(
                        '➡️ Redirect user kasir ke kasir.html'
                    );

                    window.location.replace('/kasir.html');
                    break;

                case 'admin':
                    console.log(
                        '➡️ Redirect user admin ke index.html'
                    );

                    window.location.replace('/index.html');
                    break;

                default:
                    console.warn(
                        '⚠️ Role tidak dikenali:',
                        role
                    );

                    await supabase.auth.signOut();

                    window.location.replace('/admin.html');
                    break;
            }

            return null;
        }

        // =========================================
        // 5. AUTH + ROLE VALID
        // =========================================
        console.log(
            `✅ Authentication & authorization OK: ${role}`
        );

        return {
            session,
            user,
            profile,
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
