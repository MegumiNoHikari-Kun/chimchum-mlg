// js/supabase.js
// Initialize Supabase Client using CDN global variable `supabase`

const SUPABASE_URL = 'https://wnftkpopbgtupdxruqsj.supabase.co'; // Ganti dengan URL Supabase Anda
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduZnRrcG9wYmd0dXBkeHJ1cXNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNDk4NzIsImV4cCI6MjA5ODkyNTg3Mn0.HWEY7E3FUZQ6bPOC-0XhXxUZF6119N5POhrVF934RwE'; // Ganti dengan Anon/Public Key Anda

// Create client with fallback local storage checking if needed
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const authReady = Promise.resolve(true);
