import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';


const SUPABASE_URL = 'https://wnftkpopbgtupdxruqsj.supabase.co'; // Ganti dengan URL Supabase Anda
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduZnRrcG9wYmd0dXBkeHJ1cXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNDk4NzIsImV4cCI6MjA5ODkyNTg3Mn0.HWEY7E3FUZQ6bPOC-0XhXxUZF6119N5POhrVF934RwE'; // Ganti dengan Anon/Public Key Anda

export const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: 'implicit'
        }
    }
);

export const authReady = (async () => {

    try {
        const {
            data,
            error
        } = await supabase.auth.getSession();

        if (error) {

            console.error(
                'Supabase getSession error:',
                error
            );

            return null;
        }

        const session = data?.session || null;

        // console.log(
        //     'Supabase session:',
        //     session
        // );

        return session;

    } catch (error) {

        console.error(
            'Supabase auth initialization error:',
            error
        );

        return null;
    }

})();


/*
|--------------------------------------------------------------------------
| AUTH STATE LISTENER
|--------------------------------------------------------------------------
| Menampilkan perubahan session di Console.
|--------------------------------------------------------------------------
*/

supabase.auth.onAuthStateChange(
    (event, session) => {

        // console.log(
        //     'Supabase Auth State:',
        //     event,
        //     session
        // );

    }
);
