import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = Constants.expoConfig?.extra as
  | { supabaseUrl?: string; supabaseAnonKey?: string }
  | undefined;

/** Metro pode embutir string vazia no bundle; `??` não cai no extra — usamos trim + || */
function pickConfigValue(envValue: string | undefined, extraValue: string | undefined): string {
  const fromEnv = envValue?.trim();
  if (fromEnv) return fromEnv;
  const fromExtra = extraValue?.trim();
  if (fromExtra) return fromExtra;
  return '';
}

const supabaseUrl = pickConfigValue(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  extra?.supabaseUrl,
);
const supabaseAnonKey = pickConfigValue(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  extra?.supabaseAnonKey,
);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/** Na web, localStorage direto evita falhas intermitentes do AsyncStorage com o auth do Supabase. */
const authStorage =
  Platform.OS === 'web'
    ? {
        getItem: (key: string) => {
          if (typeof localStorage === 'undefined') return Promise.resolve(null);
          return Promise.resolve(localStorage.getItem(key));
        },
        setItem: (key: string, value: string) => {
          if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
          return Promise.resolve();
        },
        removeItem: (key: string) => {
          if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
          return Promise.resolve();
        },
      }
    : AsyncStorage;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
