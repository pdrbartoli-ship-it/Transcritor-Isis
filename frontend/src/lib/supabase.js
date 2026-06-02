import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://hgmwngasnltlrqlwimdj.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnbXduZ2Fzbmx0bHJxbHdpbWRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTU0NTcsImV4cCI6MjA5NTk5MTQ1N30.d936pnaq2YLJ54NvNNKddUP62TPJhtbUMz2PdbSi6Sc'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
