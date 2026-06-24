import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { colors, radius, spacing } from '@/theme/colors';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

export default function LoginScreen() {
  const { signIn, configured } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      Toast.show({ type: 'error', text1: 'Preencha e-mail e senha.' });
      return;
    }
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) {
      Toast.show({ type: 'error', text1: error.message });
      return;
    }
    Toast.show({ type: 'success', text1: 'Bem-vindo!' });
    router.replace('/(app)/dashboard');
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.logo}>Sistema Jessica</Text>
          <Text style={styles.sub}>Gestão de clientes e mensalidades</Text>
        </View>

        {!configured ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {Platform.OS === 'web'
                ? 'Supabase não configurado neste deploy. Na Vercel: Settings → Environment Variables → adicione EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY → faça Redeploy.'
                : 'Crie um arquivo .env na raiz com EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY (valores do painel do Supabase).'}
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>E-mail</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="voce@empresa.com"
            placeholderTextColor={colors.gray400}
            value={email}
            onChangeText={setEmail}
          />
          <Text style={styles.label}>Senha</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={colors.gray400}
            value={password}
            onChangeText={setPassword}
          />
          <PrimaryButton title="Entrar" onPress={onSubmit} loading={loading} style={styles.btn} />
          <Pressable onPress={() => router.push('/(auth)/register')}>
            <Text style={styles.link}>Não tem conta? Cadastre-se</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.gray50,
  },
  scroll: {
    flexGrow: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  hero: {
    marginBottom: spacing.xl,
  },
  logo: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.petroleum,
  },
  sub: {
    marginTop: spacing.sm,
    fontSize: 15,
    color: colors.gray600,
  },
  banner: {
    backgroundColor: 'rgba(232, 106, 36, 0.15)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: {
    color: colors.petroleumDark,
    fontSize: 13,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.gray100,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    marginBottom: spacing.md,
    color: colors.gray800,
  },
  btn: {
    marginTop: spacing.sm,
  },
  link: {
    marginTop: spacing.lg,
    textAlign: 'center',
    color: colors.orange,
    fontWeight: '600',
    fontSize: 15,
  },
});
