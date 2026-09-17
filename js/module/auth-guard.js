import { supabase, authReady } from '../supabase.js';

export async function requireAuth(allowedRoles = []) {
    try {
        await authReady;

        if (!supabase) {
            console.error('User SB tidak tersedia.');
            window.location.replace('admin.html');
            return null;
        }

        const {
            data: { session },
            error: sessionError
        } = await supabase.auth.getSession();

        if (sessionError || !session?.user) {
            console.log('User belum login.');
            window.location.replace('admin.html');
            return null;
        }

        const user = session.user;

        // Ambil role user
        const {
            data: profile,
            error: profileError
        } = await supabase
            .from('profiles')
            .select('id, name, role')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            console.error('Profile user tidak ditemukan:', profileError);

            await supabase.auth.signOut();
            window.location.replace('admin.html');
            return null;
        }

        const role = profile.role;

        console.log('✅ Login:', user.email);
        console.log('👤 Role:', role);

        // =====================================
        // CEK ROLE
        // =====================================
        if (
            allowedRoles.length > 0 &&
            !allowedRoles.includes(role)
        ) {
            console.warn(
                `User dengan role "${role}" tidak memiliki akses.`
            );

            // Arahkan ke halaman sesuai role
            if (role === 'kasir') {
                window.location.replace('kasir.html');
            } else if (role === 'admin') {
                 window.location.replace('admin.html');
            } else {
               window.location.replace('index.html');
            }

            return null;
        }

        return {
            session,
            user,
            profile,
            role
        };

    } catch (error) {
        console.error('Auth guard error:', error);

        window.location.replace('index.html');
        return null;
    }
}
