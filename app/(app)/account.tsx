import { Card } from '@/components/Card';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { buildAccountExport } from '@/utils/exportReportBuilders';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { colors, radius, spacing } from '@/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function AccountScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const leave = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ExportReportButtons
        getReport={() => buildAccountExport(user?.email ?? '—')}
      />
      <Card>
        <Pressable
          style={styles.settingsRow}
          onPress={() => router.push('/(app)/configuracoes')}
        >
          <Ionicons name="settings-outline" size={22} color={colors.petroleum} />
          <View style={styles.settingsBody}>
            <Text style={styles.settingsTitle}>Configurações</Text>
            <Text style={styles.settingsSub}>Segmentos de cliente e outras opções.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.gray400} />
        </Pressable>
      </Card>

      <Card style={styles.cardAccount}>
        <Text style={styles.label}>E-mail</Text>
        <Text style={styles.email}>{user?.email ?? '—'}</Text>
        <Text style={styles.hint}>
          Os dados dos clientes ficam protegidos por autenticação e políticas RLS no Supabase.
        </Text>
        <PrimaryButton title="Sair" variant="danger" onPress={leave} style={styles.btn} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.gray50,
  },
  content: {
    padding: spacing.lg,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  settingsBody: {
    flex: 1,
    minWidth: 0,
  },
  settingsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.petroleum,
  },
  settingsSub: {
    marginTop: 4,
    fontSize: 13,
    color: colors.gray600,
    lineHeight: 18,
  },
  cardAccount: {
    marginTop: spacing.md,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  email: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.petroleum,
    marginBottom: spacing.md,
  },
  hint: {
    fontSize: 14,
    color: colors.gray600,
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
  btn: {
    marginTop: spacing.sm,
  },
});
