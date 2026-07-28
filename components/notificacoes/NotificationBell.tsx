import { useAuth } from '@/context/AuthContext';
import { useNotificationsOptional } from '@/context/NotificationsContext';
import { useTheme } from '@/context/ThemeContext';
import {
  fetchNotificacoes,
  marcarNotificacaoLida,
  marcarTodasNotificacoesLidas,
  type Notificacao,
} from '@/services/notificacaoService';
import { fonts } from '@/theme/typography';
import { formatDateTimeBRFromISO } from '@/utils/date';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function NotificationBell() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const notif = useNotificationsOptional();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Notificacao[]>([]);

  const unread = notif?.unread ?? 0;

  const openPanel = async () => {
    if (!user?.id) return;
    setOpen(true);
    setLoading(true);
    try {
      await notif?.syncParalisados({ showAlert: false });
      const list = await fetchNotificacoes(user.id);
      setItems(list);
      await notif?.refreshUnread();
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const onMarkOne = async (n: Notificacao) => {
    if (!user?.id || n.lida) return;
    await marcarNotificacaoLida(user.id, n.id);
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, lida: true } : x)));
    await notif?.refreshUnread();
  };

  const onMarkAll = async () => {
    if (!user?.id) return;
    await marcarTodasNotificacoesLidas(user.id);
    setItems((prev) => prev.map((x) => ({ ...x, lida: true })));
    await notif?.refreshUnread();
  };

  return (
    <>
      <Pressable
        onPress={() => void openPanel()}
        accessibilityLabel="Notificações"
        style={styles.bellBtn}
        hitSlop={8}
      >
        <Ionicons name="notifications-outline" size={22} color={theme.headerText} />
        {unread > 0 ? (
          <View style={[styles.badge, { backgroundColor: theme.primary }]}>
            <Text style={styles.badgeTxt}>{unread > 99 ? '99+' : String(unread)}</Text>
          </View>
        ) : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[
              styles.panel,
              {
                backgroundColor: theme.surface,
                borderColor: theme.headerBorder,
                paddingTop: Math.max(12, insets.top),
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.panelHead}>
              <Text style={[styles.panelTitle, { color: theme.text }]}>Notificações</Text>
              <View style={styles.panelActions}>
                {unread > 0 ? (
                  <Pressable onPress={() => void onMarkAll()}>
                    <Text style={{ color: theme.primary, fontFamily: fonts.semibold, fontSize: 13 }}>
                      Marcar todas lidas
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Ionicons name="close" size={22} color={theme.textMuted} />
                </Pressable>
              </View>
            </View>

            {loading ? (
              <ActivityIndicator color={theme.primary} style={{ marginVertical: 24 }} />
            ) : items.length === 0 ? (
              <Text style={[styles.empty, { color: theme.textMuted }]}>
                Nenhuma notificação ainda.
              </Text>
            ) : (
              <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 24 }}>
                {items.map((n) => (
                  <Pressable
                    key={n.id}
                    style={[
                      styles.item,
                      {
                        borderColor: theme.headerBorder,
                        backgroundColor: n.lida ? theme.surface : theme.surfaceVariant,
                      },
                    ]}
                    onPress={() => void onMarkOne(n)}
                  >
                    <View style={styles.itemTop}>
                      {!n.lida ? (
                        <View style={[styles.dot, { backgroundColor: theme.primary }]} />
                      ) : null}
                      <Text style={[styles.itemTitle, { color: theme.text }]} numberOfLines={2}>
                        {n.titulo}
                      </Text>
                    </View>
                    <Text style={[styles.itemBody, { color: theme.textMuted }]}>{n.corpo}</Text>
                    <Text style={[styles.itemTime, { color: theme.textMuted }]}>
                      {formatDateTimeBRFromISO(n.created_at)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    marginRight: 14,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeTxt: { color: '#fff', fontSize: 10, fontFamily: fonts.bold },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 56,
    paddingHorizontal: 12,
  },
  panel: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  panelTitle: { fontFamily: fonts.bold, fontSize: 17 },
  panelActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  empty: { padding: 20, textAlign: 'center', fontSize: 14 },
  list: { paddingHorizontal: 12 },
  item: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  itemTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: 14 },
  itemBody: { fontSize: 13, lineHeight: 18 },
  itemTime: { fontSize: 11, marginTop: 4 },
});
