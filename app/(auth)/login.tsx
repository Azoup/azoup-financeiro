import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { colors, radius, shadows, spacing } from '@/theme/colors';
import { fonts } from '@/theme/typography';
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
  const [focusField, setFocusField] = useState<'email' | 'pass' | null>(null);

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
      <View style={styles.bgDecor} pointerEvents="none" />
      <View style={styles.bgOrb} pointerEvents="none" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.brandMark}>AZOUP</Text>
          <Text style={styles.logo}>Sistema Jessica</Text>
          <Text style={styles.sub}>Gestão financeira, clientes e NFS-e em um só lugar</Text>
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
            style={[styles.input, focusField === 'email' && styles.inputFocused]}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="voce@empresa.com"
            placeholderTextColor={colors.gray400}
            value={email}
            onChangeText={setEmail}
            onFocus={() => setFocusField('email')}
            onBlur={() => setFocusField(null)}
          />
          <Text style={styles.label}>Senha</Text>
          <TextInput
            style={[styles.input, focusField === 'pass' && styles.inputFocused]}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={colors.gray400}
            value={password}
            onChangeText={setPassword}
            onFocus={() => setFocusField('pass')}
            onBlur={() => setFocusField(null)}
          />
          <PrimaryButton title="Entrar" variant="brand" onPress={onSubmit} loading={loading} style={styles.btn} />
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
  bgDecor: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.gray50,
  },
  bgOrb: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: colors.orangeSoft,
  },
  scroll: {
    flexGrow: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  hero: {
    marginBottom: spacing.xl,
  },
  brandMark: {
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 3,
    color: colors.orange,
    marginBottom: spacing.sm,
  },
  logo: {
    fontFamily: fonts.extrabold,
    fontSize: 32,
    letterSpacing: -0.6,
    color: colors.petroleum,
  },
  sub: {
    marginTop: spacing.sm,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.gray600,
    maxWidth: 320,
  },
  banner: {
    backgroundColor: colors.orangeMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(232, 106, 36, 0.25)',
  },
  bannerText: {
    fontFamily: fonts.regular,
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
    ...shadows.md,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    fontFamily: fonts.regular,
    marginBottom: spacing.md,
    color: colors.gray800,
    backgroundColor: colors.white,
  },
  inputFocused: {
    borderColor: colors.orange,
  },
  btn: {
    marginTop: spacing.sm,
  },
  link: {
    marginTop: spacing.lg,
    textAlign: 'center',
    color: colors.orange,
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
});
