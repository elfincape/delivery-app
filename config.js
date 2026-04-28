const SUPABASE_URL = 'https://hoiiaysfrcjkvgallmee.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_lhWYbCsXygBIiprEOkCvkA_teBdX9R1';
const STORAGE_BUCKET = 'photos';
const ADMIN_PASSWORD = '0000';

// CDN 라이브러리에서 createClient만 가져와서 사용
const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);