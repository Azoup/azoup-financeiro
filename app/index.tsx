import { useAuth } from '@/context/AuthContext';
import { colors } from '@/theme/colors';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export default function Index() {
  const { user, loading, configured } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) {
      router.replace('/(app)/dashboard');
    } else {
      router.replace('/(auth)/login');
    }
  }, [user, loading, router]);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.orange} />
      {!configured ? (
        <Text style={styles.hint}>Defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.gray50,
    padding: 24,
  },
  hint: {
    marginTop: 16,
    textAlign: 'center',
    color: colors.gray600,
    fontSize: 14,
  },
});
