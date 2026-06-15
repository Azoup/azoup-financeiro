import { ClientForm, getEmptyClienteForm } from '@/components/ClientForm';
import { ExportReportButtons } from '@/components/ExportReportButtons';
import { buildClientFormExport } from '@/utils/exportReportBuilders';
import { useAuth } from '@/context/AuthContext';
import { createCliente } from '@/services/clientsService';
import { colors, spacing } from '@/theme/colors';
import type { ClienteFormValues } from '@/types/models';
import { CONSULTA, goToConsulta, useHardwareBackToConsulta } from '@/utils/navigationConsulta';
import { StyleSheet, View } from 'react-native';
import Toast from 'react-native-toast-message';

export default function NewClientScreen() {
  const { user } = useAuth();
  useHardwareBackToConsulta(CONSULTA.clients);

  const onSubmit = async (values: ClienteFormValues) => {
    if (!user?.id) return;
    try {
      await createCliente(user.id, values);
      Toast.show({ type: 'success', text1: 'Cliente cadastrado com sucesso.' });
      goToConsulta(CONSULTA.clients);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    }
  };

  return (
    <View style={styles.screen}>
      <ExportReportButtons
        getReport={() => buildClientFormExport(getEmptyClienteForm(), 'Novo cliente')}
      />
      <ClientForm onSubmit={onSubmit} submitLabel="Salvar cliente" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.gray50,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
});
