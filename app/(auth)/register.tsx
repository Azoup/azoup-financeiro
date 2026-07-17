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

export default function RegisterScreen() {
  const { signUp, configured } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!configured) {
      Toast.show({ type: 'error', text1: 'Configure o Supabase antes.' });
      return;
    }
    if (!email.trim() || password.length < 6) {
      Toast.show({
        type: 'error',
        text1: 'E-mail válido e senha com pelo menos 6 caracteres.',
      });
      return;
    }
    setLoading(true);
    const { error } = await signUp(email.trim(), password);
    setLoading(false);
    if (error) {
      Toast.show({ type: 'error', text1: error.message });
      return;
    }
    Toast.show({
      type: 'success',
      text1: 'Conta criada. Verifique o e-mail se a confirmação estiver ativa no Supabase.',
    });
    router.replace('/(auth)/login');
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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
            placeholder="Mínimo 6 caracteres"
            placeholderTextColor={colors.gray400}
            value={password}
            onChangeText={setPassword}
          />
          <PrimaryButton title="Cadastrar" variant="brand" onPress={onSubmit} loading={loading} />
          <Pressable onPress={() => router.push('/(auth)/login')}>
            <Text style={styles.link}>Já tenho conta</Text>
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
  },
  link: {
    marginTop: spacing.lg,
    textAlign: 'center',
    color: colors.orange,
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
});
