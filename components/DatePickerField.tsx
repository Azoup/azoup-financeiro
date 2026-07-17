import { colors, radius, spacing } from '@/theme/colors';
import { formatBRDate, parseISODate, toISODate } from '@/utils/date';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import React, { useCallback, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PrimaryButton } from '@/components/PrimaryButton';

type Props = {
  label: string;
  value: Date | null;
  onChange: (d: Date | null) => void;
  minimumDate?: Date;
  compact?: boolean;
};

export function DatePickerField({ label, value, onChange, minimumDate, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(value ?? new Date());
  const webInputRef = useRef<HTMLInputElement | null>(null);

  const display = formatBRDate(value);

  const openWebDatePicker = useCallback(() => {
    const el = webInputRef.current;
    if (!el) return;
    try {
      if (typeof el.showPicker === 'function') {
        void el.showPicker();
        return;
      }
    } catch {
      /* showPicker pode falhar fora de gesto do usuário em alguns browsers */
    }
    el.click();
  }, []);

  const openPicker = () => {
    const base = value ?? new Date();
    setDraft(base);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: base,
        mode: 'date',
        display: 'default',
        minimumDate,
        onChange: (event, d) => {
          if (event.type === 'set' && d) onChange(d);
        },
      });
      return;
    }
    setOpen(true);
  };

  if (Platform.OS === 'web') {
    const min = minimumDate ? toISODate(minimumDate) : undefined;
    const hiddenInputStyle: React.CSSProperties = {
      position: 'absolute',
      width: 1,
      height: 1,
      opacity: 0,
      overflow: 'hidden',
      clip: 'rect(0,0,0,0)',
      border: 0,
      padding: 0,
      margin: 0,
      pointerEvents: 'none',
    };
    return (
      <View style={[styles.wrap, compact && styles.wrapCompact]}>
        <Text style={[styles.label, compact && styles.labelCompact]}>{label}</Text>
        <Pressable
          style={[styles.field, styles.fieldPressable, compact && styles.fieldCompact]}
          onPress={openWebDatePicker}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <Text
            style={[styles.fieldText, compact && styles.fieldTextCompact, !value && styles.placeholder]}
            pointerEvents="none"
          >
            {value ? display : 'Selecionar data'}
          </Text>
          {React.createElement('input', {
            ref: (node: HTMLInputElement | null) => {
              webInputRef.current = node;
            },
            type: 'date',
            value: value ? toISODate(value) : '',
            min,
            tabIndex: -1,
            'aria-hidden': true,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              const v = e.target.value;
              if (!v) {
                onChange(null);
                return;
              }
              const d = parseISODate(v);
              if (d) onChange(d);
            },
            style: hiddenInputStyle,
          })}
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <Text style={[styles.label, compact && styles.labelCompact]}>{label}</Text>
      <Pressable
        onPress={openPicker}
        style={[styles.field, compact && styles.fieldCompact]}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      >
        <Text style={[styles.fieldText, compact && styles.fieldTextCompact, !value && styles.placeholder]}>
          {value ? display : 'Selecionar data'}
        </Text>
      </Pressable>

      {Platform.OS === 'ios' ? (
        <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
            <Pressable style={styles.modalCardCompact} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.modalTitle}>{label}</Text>
              <View style={styles.inlinePickerWrap}>
                <DateTimePicker
                  value={draft}
                  mode="date"
                  display="inline"
                  minimumDate={minimumDate}
                  onChange={(_e, d) => {
                    if (d) setDraft(d);
                  }}
                  themeVariant="light"
                  locale="pt-BR"
                />
              </View>
              <View style={styles.modalActions}>
                <PrimaryButton
                  title="Cancelar"
                  variant="ghost"
                  onPress={() => setOpen(false)}
                  style={styles.flex}
                />
                <PrimaryButton
                  title="OK"
                  onPress={() => {
                    onChange(draft);
                    setOpen(false);
                  }}
                  style={styles.flex}
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md,
  },
  wrapCompact: {
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
  },
  field: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    position: 'relative',
  },
  fieldCompact: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    minHeight: 34,
    justifyContent: 'center',
  },
  fieldPressable: {
    minHeight: 48,
  },
  fieldText: {
    fontSize: 16,
    color: colors.gray800,
  },
  fieldTextCompact: {
    fontSize: 13,
  },
  placeholder: {
    color: colors.gray400,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalCardCompact: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    maxHeight: '72%',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: spacing.xs,
  },
  inlinePickerWrap: {
    alignItems: 'center',
    marginVertical: spacing.xs,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
