import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Konfigurasi Kredensial Supabase ChimChum Malang
const SUPABASE_URL = 'https://wnftkpopbgtupdxruqsj.supabase.co'; // Ganti dengan URL Supabase Anda
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduZnRrcG9wYmd0dXBkeHJ1cXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNDk4NzIsImV4cCI6MjA5ODkyNTg3Mn0.HWEY7E3FUZQ6bPOC-0XhXxUZF6119N5POhrVF934RwE'; // Ganti dengan Anon/Public Key Anda

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

// Promise wrapper untuk memastikan status autentikasi/koneksi siap digunakan di modul lain
export const authReady = new Promise((resolve) => {
    supabase.auth.getSession().then(({ data: { session } }) => {
        resolve(session);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
        resolve(session);
    });
});
