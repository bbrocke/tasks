import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigError =
  !url || !key
    ? 'The app is missing its Supabase environment variables.'
    : null

export const supabase = supabaseConfigError ? null : createClient(url, key)
