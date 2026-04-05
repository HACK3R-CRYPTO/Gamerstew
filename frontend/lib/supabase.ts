import { createClient } from '@supabase/supabase-js';

// Server-side only — these env vars have no NEXT_PUBLIC_ prefix
// so they are NEVER sent to the browser
const supabaseUrl  = process.env.SUPABASE_URL!;
const supabaseKey  = process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);
