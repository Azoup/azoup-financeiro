import { FormTextInput } from '@/components/FormTextInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { fetchAddressByCep } from '@/services/viacep';
import { colors, radius, spacing } from '@/theme/colors';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MaskInput from 'react-native-mask-input';
import Toast from 'react-native-toast-message';

export type AddressFields = {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

type Props = {
  value: AddressFields;
  onChange: (patch: Partial<AddressFields>) => void;
  compact?: boolean;
  hideTitle?: boolean;
};

export function AddressFormSection({ value, onChange, compact, hideTitle }: Props) {
  const [buscando, setBuscando] = useState(false);

  const buscarCep = async () => {
    setBuscando(true);
    try {
      const r = await fetchAddressByCep(value.cep);
      if (!r.ok) {
        Toast.show({ type: 'error', text1: r.message });
        return;
      }
      const d = r.cep.replace(/\D/g, '');
      const cepMasked = d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : value.cep;
      onChange({
        cep: cepMasked,
        logradouro: r.logradouro,
        bairro: r.bairro,
        cidade: r.localidade,
        uf: r.uf,
        complemento: value.complemento.trim() ? value.complemento : r.complemento || '',
      });
      Toast.show({ type: 'success', text1: 'CEP encontrado.' });
    } finally {
      setBuscando(false);
    }
  };

  const cepDigits = value.cep.replace(/\D/g, '');
  const podeBuscar = cepDigits.length === 8;

  return (
    <View style={[styles.block, compact && styles.blockCompact]}>
      {!hideTitle ? <Text style={[styles.section, compact && styles.sectionCompact]}>Endereço</Text> : null}

      <Text style={[styles.label, compact && styles.labelCompact]}>CEP</Text>
      <View style={styles.cepRow}>
        <MaskInput
          value={value.cep}
          onChangeText={(masked) => onChange({ cep: masked })}
          mask={[/\d/, /\d/, /\d/, /\d/, /\d/, '-', /\d/, /\d/, /\d/]}
          placeholder="00000-000"
          keyboardType="number-pad"
          style={[styles.mask, compact && styles.maskCompact, styles.cepInput]}
          placeholderTextColor={colors.gray400}
        />
        <PrimaryButton
          title={compact ? 'Buscar' : 'Buscar CEP'}
          variant="secondary"
          onPress={buscarCep}
          loading={buscando}
          disabled={!podeBuscar}
          style={[styles.cepBtn, compact && styles.cepBtnCompact]}
        />
      </View>

      <FormTextInput
        compact={compact}
        label="Logradouro"
        value={value.logradouro}
        onChangeText={(t) => onChange({ logradouro: t })}
        placeholder="Rua, avenida..."
      />
      <View style={styles.row2}>
        <View style={styles.flex1}>
          <FormTextInput
            compact={compact}
            label="Número"
            value={value.numero}
            onChangeText={(t) => onChange({ numero: t })}
            placeholder="Nº"
            keyboardType="default"
          />
        </View>
        <View style={styles.flex2}>
          <FormTextInput
            compact={compact}
            label="Complemento"
            value={value.complemento}
            onChangeText={(t) => onChange({ complemento: t })}
            placeholder="Apto, sala..."
          />
        </View>
      </View>
      <FormTextInput
        compact={compact}
        label="Bairro"
        value={value.bairro}
        onChangeText={(t) => onChange({ bairro: t })}
      />
      <View style={styles.row2}>
        <View style={styles.flex2}>
          <FormTextInput
            compact={compact}
            label="Cidade"
            value={value.cidade}
            onChangeText={(t) => onChange({ cidade: t })}
          />
        </View>
        <View style={styles.ufBox}>
          <FormTextInput
            compact={compact}
            label="UF"
            value={value.uf}
            onChangeText={(t) => onChange({ uf: t.toUpperCase().slice(0, 2) })}
            placeholder="SP"
            maxLength={2}
            autoCapitalize="characters"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: spacing.sm,
  },
  blockCompact: {
    marginTop: 0,
  },
  section: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.md,
  },
  sectionCompact: {
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray600,
    marginBottom: spacing.sm,
  },
  labelCompact: {
    fontSize: 11,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  cepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  mask: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.gray800,
    backgroundColor: colors.white,
  },
  maskCompact: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    fontSize: 14,
    minHeight: 40,
  },
  cepInput: {
    flex: 1,
  },
  cepBtn: {
    minWidth: 120,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  cepBtnCompact: {
    minWidth: 72,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  row2: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  flex1: {
    width: 100,
  },
  flex2: {
    flex: 1,
  },
  ufBox: {
    width: 72,
  },
});
