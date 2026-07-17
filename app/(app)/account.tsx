import { Card } from '@/components/Card';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { buildAccountExport } from '@/utils/exportReportBuilders';
import { fonts } from '@/theme/typography';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function AccountScreen() {
  const { user, signOut } = useAuth();
  const { theme, isDark, toggleTheme } = useTheme();
  const router = useRouter();

  const leave = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        screen: { flex: 1, backgroundColor: theme.background },
        content: { padding: 16, gap: 12 },
        settingsRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 4,
        },
        settingsBody: { flex: 1, minWidth: 0 },
        settingsTitle: {
          fontFamily: fonts.bold,
          fontSize: 15,
          color: theme.text,
        },
        settingsSub: {
          marginTop: 3,
          fontFamily: fonts.regular,
          fontSize: 12,
          color: theme.textMuted,
          lineHeight: 17,
        },
        label: {
          fontFamily: fonts.semibold,
          fontSize: 12,
          color: theme.textSecondary,
          marginBottom: 6,
        },
        email: {
          fontFamily: fonts.semibold,
          fontSize: 16,
          color: theme.text,
          marginBottom: 10,
        },
        hint: {
          fontFamily: fonts.regular,
          fontSize: 13,
          color: theme.textMuted,
          lineHeight: 19,
          marginBottom: 16,
        },
      }),
    [theme],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ExportReportButtons getReport={() => buildAccountExport(user?.email ?? '—')} />
      <Card>
        <Pressable style={styles.settingsRow} onPress={() => router.push('/(app)/configuracoes')}>
          <Ionicons name="settings-outline" size={20} color={theme.text} />
          <View style={styles.settingsBody}>
            <Text style={styles.settingsTitle}>Configurações</Text>
            <Text style={styles.settingsSub}>Segmentos, NFS-e e beneficiário.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
        </Pressable>
      </Card>

      <Card>
        <Pressable style={styles.settingsRow} onPress={toggleTheme}>
          <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={20} color={theme.text} />
          <View style={styles.settingsBody}>
            <Text style={styles.settingsTitle}>{isDark ? 'Modo claro' : 'Modo escuro'}</Text>
            <Text style={styles.settingsSub}>Alterna o tema do sistema (Azoup).</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
        </Pressable>
      </Card>

      <Card>
        <Text style={styles.label}>E-mail</Text>
        <Text style={styles.email}>{user?.email ?? '—'}</Text>
        <Text style={styles.hint}>
          Os dados ficam protegidos por autenticação e políticas RLS no Supabase.
        </Text>
        <PrimaryButton title="Sair" variant="danger" onPress={leave} />
      </Card>
    </ScrollView>
  );
}
