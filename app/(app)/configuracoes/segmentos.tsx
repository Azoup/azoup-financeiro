import { Card } from '@/components/Card';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { buildSegmentosExport } from '@/utils/exportReportBuilders';
import { FormTextInput } from '@/components/FormTextInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import {
  deleteSegmentoCliente,
  fetchSegmentosCliente,
  insertSegmentoCliente,
} from '@/services/segmentoClienteService';
import { colors, radius, spacing } from '@/theme/colors';
import type { SegmentoClienteRow } from '@/types/models';
import { CONSULTA, useHardwareBackToConsulta } from '@/utils/navigationConsulta';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

export default function SegmentosConfigScreen() {
  useHardwareBackToConsulta(CONSULTA.configuracoes);
  const [rows, setRows] = useState<SegmentoClienteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [nome, setNome] = useState('');
  const [saving, setSaving] = useState(false);
  const [excluirAlvo, setExcluirAlvo] = useState<SegmentoClienteRow | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchSegmentosCliente();
      setRows(list);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openNovo = () => {
    setCodigo('');
    setNome('');
    setModalOpen(true);
  };

  const onSalvarNovo = async () => {
    setSaving(true);
    try {
      await insertSegmentoCliente({ codigo, nome });
      Toast.show({ type: 'success', text1: 'Segmento cadastrado.' });
      setModalOpen(false);
      await load();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!excluirAlvo) return;
    setExcluindo(true);
    try {
      await deleteSegmentoCliente(excluirAlvo.codigo);
      Toast.show({ type: 'success', text1: 'Segmento excluído.' });
      setExcluirAlvo(null);
      await load();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <View style={styles.root}>
      <ExportReportButtons disabled={loading} getReport={() => buildSegmentosExport(rows)} />
      <Text style={styles.hint}>
        O código é salvo no cadastro do cliente (único). Use letras e números; ao digitar, caracteres inválidos são
        removidos ao salvar.
      </Text>
      <PrimaryButton title="Novo segmento" onPress={openNovo} style={styles.btnTop} />

      {loading ? (
        <ActivityIndicator color={colors.orange} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.codigo}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Card style={styles.rowCard}>
              <View style={styles.rowMain}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.nome}>{item.nome}</Text>
                  <Text style={styles.codigo}>{item.codigo}</Text>
                </View>
                <Pressable
                  accessibilityLabel={`Excluir segmento ${item.codigo}`}
                  onPress={() => setExcluirAlvo(item)}
                  style={styles.trash}
                >
                  <Ionicons name="trash-outline" size={22} color={colors.danger} />
                </Pressable>
              </View>
            </Card>
          )}
          ListEmptyComponent={<Text style={styles.empty}>Nenhum segmento cadastrado.</Text>}
        />
      )}

      <Modal
        visible={excluirAlvo != null}
        animationType="fade"
        transparent
        onRequestClose={() => {
          if (!excluindo) setExcluirAlvo(null);
        }}
      >
        <Pressable
          style={styles.modalBg}
          onPress={() => {
            if (!excluindo) setExcluirAlvo(null);
          }}
        >
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Excluir segmento</Text>
            <Text style={styles.excluirMsg}>
              Remover “{excluirAlvo?.nome}” ({excluirAlvo?.codigo})? Não será possível se houver clientes usando este
              código.
            </Text>
            <View style={styles.modalActions}>
              <PrimaryButton
                title="Cancelar"
                variant="ghost"
                disabled={excluindo}
                onPress={() => setExcluirAlvo(null)}
                style={styles.modalBtn}
              />
              <PrimaryButton
                title="Excluir"
                variant="danger"
                loading={excluindo}
                onPress={confirmarExclusao}
                style={styles.modalBtn}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <Pressable style={styles.modalBg} onPress={() => setModalOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Novo segmento</Text>
            <FormTextInput
              label="Código"
              value={codigo}
              onChangeText={setCodigo}
              placeholder="Ex.: CONDOMINIO"
              autoCapitalize="characters"
            />
            <FormTextInput
              label="Nome"
              value={nome}
              onChangeText={setNome}
              placeholder="Ex.: Condomínio"
            />
            <View style={styles.modalActions}>
              <PrimaryButton
                title="Cancelar"
                variant="ghost"
                onPress={() => setModalOpen(false)}
                style={styles.modalBtn}
              />
              <PrimaryButton
                title="Salvar"
                onPress={onSalvarNovo}
                loading={saving}
                style={styles.modalBtn}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.gray50,
    padding: spacing.md,
  },
  hint: {
    fontSize: 13,
    color: colors.gray600,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  btnTop: {
    marginBottom: spacing.md,
  },
  listContent: {
    paddingBottom: spacing.xl * 2,
  },
  rowCard: {
    marginBottom: spacing.sm,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  nome: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.petroleum,
  },
  codigo: {
    marginTop: 4,
    fontSize: 13,
    color: colors.gray600,
    fontWeight: '600',
  },
  trash: {
    padding: spacing.sm,
    borderRadius: radius.md,
  },
  empty: {
    textAlign: 'center',
    color: colors.gray400,
    marginTop: spacing.xl,
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(13,13,26,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.petroleum,
    marginBottom: spacing.md,
  },
  excluirMsg: {
    fontSize: 14,
    color: colors.gray600,
    lineHeight: 21,
    marginBottom: spacing.md,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  modalBtn: {
    flex: 1,
  },
});
