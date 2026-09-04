import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Konfigurasi Kredensial Supabase ChimChum Malang
const SUPABASE_URL = 'https://wnftkpopbgtupdxruqsj.supabase.co'; // Ganti dengan URL Supabase Anda
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduZnRrcG9wYmd0dXBkeHJ1cXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNDk4NzIsImV4cCI6MjA5ODkyNTg3Mn0.HWEY7E3FUZQ6bPOC-0XhXxUZF6119N5POhrVF934RwE'; // Ganti dengan Anon/Public Key Anda
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Ekspor promise autentikasi agar modul tahu kapan sesi sudah siap
export const authReady = new Promise(async (resolve) => {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            // Coba sign in anonim jika diizinkan RLS atau biarkan publik
            await supabase.auth.signInAnonymously().catch(() => {});
        }
    } catch (e) {
        console.warn("Auth initialization note:", e);
    }
    resolve(true);
});
