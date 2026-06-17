import { Card } from '@/components/Card';
import { FormTextInput } from '@/components/FormTextInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import {
  ensureNfeConfig,
  fetchCertificadoAtivo,
  pickCertificadoFile,
  uploadCertificadoA1,
  upsertNfeConfig,
} from '@/services/nfeConfigService';
import { fetchPerfilCobranca, upsertPerfilCobranca } from '@/services/perfilCobrancaService';
import { colors, radius, spacing } from '@/theme/colors';
import type { PerfilCobrancaInput } from '@/types/contasReceber';
import type { NfeConfig } from '@/types/notaFiscal';
import { avaliarProntidaoNfe } from '@/utils/nfeProntidao';
import { labelAmbienteNfe } from '@/utils/nfeStatus';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

function emptyEmitente(): PerfilCobrancaInput {
  return {
    razao_social: '',
    documento: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    cep: '',
    cooperativa_nome: null,
    codigo_beneficiario_agencia: null,
    telefone_suporte: null,
    instrucoes_cobranca: '',
    local_pagamento: 'PAGÁVEL PREFERENCIALMENTE NOS CANAIS DO SEU BANCO',
    mensagem_padrao_pagador: null,
  };
}

export default function NfeConfigScreen() {
  const { user } = useAuth();
  const [config, setConfig] = useState<NfeConfig | null>(null);
  const [certOk, setCertOk] = useState(false);
  const [certFileName, setCertFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [senhaCert, setSenhaCert] = useState('');
  const [pendingCertFile, setPendingCertFile] = useState<{
    uri: string;
    name: string;
    mimeType?: string;
  } | null>(null);

  const [emitente, setEmitente] = useState<PerfilCobrancaInput>(emptyEmitente());
  const [serie, setSerie] = useState('1');
  const [proximoNumero, setProximoNumero] = useState('1');
  const [ambiente, setAmbiente] = useState<'1' | '2'>('2');
  const [ie, setIe] = useState('');
  const [ibge, setIbge] = useState('');
  const [ncm, setNcm] = useState('00000000');
  const [cfop, setCfop] = useState('5933');
  const [descricao, setDescricao] = useState('Serviço de mensalidade');

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [c, perfil, cert] = await Promise.all([
        ensureNfeConfig(user.id),
        fetchPerfilCobranca(user.id),
        fetchCertificadoAtivo(user.id),
      ]);
      setConfig(c);
      setSerie(c.serie);
      setProximoNumero(String(c.proximo_numero));
      setAmbiente(String(c.ambiente) as '1' | '2');
      setIe(c.inscricao_estadual);
      setIbge(c.codigo_ibge_emitente);
      setNcm(c.ncm_servico);
      setCfop(c.cfop_padrao);
      setDescricao(c.descricao_servico_padrao);
      setCertOk(Boolean(cert));
      if (perfil) {
        setEmitente({
          razao_social: perfil.razao_social,
          documento: perfil.documento,
          logradouro: perfil.logradouro,
          numero: perfil.numero,
          complemento: perfil.complemento,
          bairro: perfil.bairro,
          cidade: perfil.cidade,
          uf: perfil.uf,
          cep: perfil.cep,
          cooperativa_nome: perfil.cooperativa_nome,
          codigo_beneficiario_agencia: perfil.codigo_beneficiario_agencia,
          telefone_suporte: perfil.telefone_suporte,
          instrucoes_cobranca: perfil.instrucoes_cobranca,
          local_pagamento: perfil.local_pagamento,
          mensagem_padrao_pagador: perfil.mensagem_padrao_pagador,
        });
      }
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const prontidao = useMemo(
    () =>
      avaliarProntidaoNfe(
        {
          razao_social: emitente.razao_social,
          documento: emitente.documento,
          logradouro: emitente.logradouro,
          cidade: emitente.cidade,
          uf: emitente.uf,
          cep: emitente.cep,
        },
        {
          codigo_ibge_emitente: ibge,
          inscricao_estadual: ie,
          ncm_servico: ncm,
          cfop_padrao: cfop,
        },
        certOk || Boolean(pendingCertFile),
      ),
    [emitente, ibge, ie, ncm, cfop, certOk, pendingCertFile],
  );

  const patchEmitente = (p: Partial<PerfilCobrancaInput>) => setEmitente((v) => ({ ...v, ...p }));

  const escolherCertificado = async () => {
    const file = await pickCertificadoFile();
    if (!file) return;
    setPendingCertFile(file);
    setCertFileName(file.name);
  };

  const salvarTudo = async () => {
    if (!user?.id) return;
    if (!emitente.razao_social.trim() || !emitente.documento.trim()) {
      Toast.show({ type: 'error', text1: 'Preencha razão social e CNPJ/CPF do emitente.' });
      return;
    }
    if (!ibge.trim()) {
      Toast.show({ type: 'error', text1: 'Informe o código IBGE do município.' });
      return;
    }

    setBusy(true);
    try {
      await upsertPerfilCobranca(user.id, {
        ...emitente,
        instrucoes_cobranca:
          emitente.instrucoes_cobranca?.trim() ||
          'Documento fiscal emitido conforme legislação vigente.',
        cooperativa_nome: emitente.cooperativa_nome?.trim() || null,
        codigo_beneficiario_agencia: emitente.codigo_beneficiario_agencia?.trim() || null,
        telefone_suporte: emitente.telefone_suporte?.trim() || null,
        mensagem_padrao_pagador: emitente.mensagem_padrao_pagador?.trim() || null,
      });

      await upsertNfeConfig(user.id, {
        serie,
        proximo_numero: Math.max(1, parseInt(proximoNumero, 10) || 1),
        ambiente: Number(ambiente) as 1 | 2,
        inscricao_estadual: ie.trim() || 'ISENTO',
        regime_tributario: 1,
        codigo_ibge_emitente: ibge,
        ncm_servico: ncm,
        cfop_padrao: cfop,
        cst_icms: '102',
        csosn: '102',
        descricao_servico_padrao: descricao,
        natureza_operacao: 'Prestação de serviço',
      });

      if (pendingCertFile) {
        if (!senhaCert.trim()) {
          Toast.show({ type: 'error', text1: 'Informe a senha do certificado A1.' });
          setBusy(false);
          return;
        }
        await uploadCertificadoA1(user.id, pendingCertFile, senhaCert);
        setPendingCertFile(null);
        setSenhaCert('');
        setCertOk(true);
      }

      Toast.show({
        type: 'success',
        text1: 'Configuração de NF-e salva.',
        text2: prontidao.pronto || pendingCertFile ? 'Pronto para emitir em homologação/produção.' : undefined,
      });
      await load();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.lead}>
        Configure aqui tudo para emitir NF-e de mensalidade: emitente, certificado digital A1 e parâmetros fiscais.
        Use homologação (ambiente 2) antes de ir para produção.
      </Text>

      <Card style={[styles.card, prontidao.pronto ? styles.cardOk : styles.cardWarn]}>
        <Text style={styles.h}>Prontidão para emitir</Text>
        {prontidao.itens.map((item) => (
          <View key={item.id} style={styles.checkRow}>
            <Ionicons
              name={item.ok ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={item.ok ? colors.success : colors.gray400}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.checkLabel, item.ok && styles.checkLabelOk]}>{item.label}</Text>
              {!item.ok && item.hint ? <Text style={styles.checkHint}>{item.hint}</Text> : null}
            </View>
          </View>
        ))}
        <Text style={styles.prontoResumo}>
          {prontidao.pronto
            ? 'Tudo configurado. Pode gerar mensalidade + NF-e.'
            : 'Complete os itens pendentes e clique em Salvar tudo.'}
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.h}>1. Emitente (empresa na nota)</Text>
        <Text style={styles.sub}>Mesmos dados usados nos carnês; aparecem como emitente na NF-e.</Text>
        <FormTextInput
          label="Razão social"
          value={emitente.razao_social}
          onChangeText={(t) => patchEmitente({ razao_social: t })}
        />
        <FormTextInput
          label="CNPJ ou CPF"
          value={emitente.documento}
          onChangeText={(t) => patchEmitente({ documento: t })}
        />
        <FormTextInput label="Logradouro" value={emitente.logradouro} onChangeText={(t) => patchEmitente({ logradouro: t })} />
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <FormTextInput label="Número" value={emitente.numero} onChangeText={(t) => patchEmitente({ numero: t })} />
          </View>
          <View style={{ flex: 1 }}>
            <FormTextInput label="Bairro" value={emitente.bairro} onChangeText={(t) => patchEmitente({ bairro: t })} />
          </View>
        </View>
        <View style={styles.row2}>
          <View style={{ flex: 2 }}>
            <FormTextInput label="Cidade" value={emitente.cidade} onChangeText={(t) => patchEmitente({ cidade: t })} />
          </View>
          <View style={{ flex: 1 }}>
            <FormTextInput
              label="UF"
              value={emitente.uf}
              onChangeText={(t) => patchEmitente({ uf: t })}
              maxLength={2}
              autoCapitalize="characters"
            />
          </View>
        </View>
        <FormTextInput label="CEP" value={emitente.cep} onChangeText={(t) => patchEmitente({ cep: t })} />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.h}>2. Certificado digital A1</Text>
        <Text style={styles.sub}>
          Status:{' '}
          {certOk
            ? 'Certificado ativo no servidor'
            : pendingCertFile
              ? `Arquivo selecionado: ${certFileName}`
              : 'Nenhum certificado — obrigatório para enviar à SEFAZ'}
        </Text>
        <Pressable style={styles.fileBtn} onPress={() => void escolherCertificado()}>
          <Ionicons name="folder-open-outline" size={22} color={colors.petroleum} />
          <Text style={styles.fileBtnTxt}>
            {pendingCertFile || certOk ? 'Trocar arquivo .pfx / .p12' : 'Selecionar certificado .pfx / .p12'}
          </Text>
        </Pressable>
        <FormTextInput
          label="Senha do certificado"
          value={senhaCert}
          onChangeText={setSenhaCert}
          secureTextEntry
          placeholder="Obrigatória ao enviar novo certificado"
        />
        <Text style={styles.certHint}>
          A senha é gravada de forma segura no servidor (Vercel). O arquivo fica no Storage do Supabase.
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.h}>3. Numeração e ambiente SEFAZ</Text>
        <FormTextInput label="Série" value={serie} onChangeText={setSerie} />
        <FormTextInput
          label="Próximo número da NF-e"
          value={proximoNumero}
          onChangeText={setProximoNumero}
          keyboardType="number-pad"
        />
        <FormTextInput
          label="Ambiente (1 = Produção, 2 = Homologação)"
          value={ambiente}
          onChangeText={(t) => setAmbiente((t === '1' ? '1' : '2') as '1' | '2')}
          keyboardType="number-pad"
        />
        <Text style={styles.ambiente}>{labelAmbienteNfe(Number(ambiente))}</Text>
        <FormTextInput
          label="Inscrição estadual"
          value={ie}
          onChangeText={setIe}
          placeholder="ISENTO ou número da IE"
        />
        <FormTextInput
          label="Código IBGE do município (emitente)"
          value={ibge}
          onChangeText={setIbge}
          keyboardType="number-pad"
          placeholder="7 dígitos — ex.: 3550308"
        />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.h}>4. Serviço na nota (mensalidade)</Text>
        <FormTextInput label="NCM" value={ncm} onChangeText={setNcm} keyboardType="number-pad" />
        <FormTextInput label="CFOP" value={cfop} onChangeText={setCfop} keyboardType="number-pad" />
        <FormTextInput label="Descrição do item" value={descricao} onChangeText={setDescricao} />
      </Card>

      <PrimaryButton title="Salvar tudo" onPress={() => void salvarTudo()} loading={busy} />
      {config ? (
        <Text style={styles.footer}>Última atualização fiscal: {new Date(config.updated_at).toLocaleString('pt-BR')}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.gray50 },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.gray50 },
  lead: { fontSize: 13, color: colors.gray600, lineHeight: 18, marginBottom: spacing.md },
  card: { marginBottom: spacing.md },
  cardOk: { borderColor: colors.success, borderWidth: 1 },
  cardWarn: { borderColor: colors.orange, borderWidth: 1 },
  h: { fontSize: 16, fontWeight: '800', color: colors.petroleum, marginBottom: spacing.xs },
  sub: { fontSize: 12, color: colors.gray600, marginBottom: spacing.md, lineHeight: 17 },
  checkRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginBottom: spacing.sm },
  checkLabel: { fontSize: 13, color: colors.gray800, lineHeight: 18 },
  checkLabelOk: { color: colors.gray600 },
  checkHint: { fontSize: 11, color: colors.gray600, marginTop: 2 },
  prontoResumo: {
    marginTop: spacing.sm,
    fontSize: 13,
    fontWeight: '700',
    color: colors.petroleum,
  },
  row2: { flexDirection: 'row', gap: spacing.sm },
  fileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.white,
  },
  fileBtnTxt: { fontSize: 14, fontWeight: '600', color: colors.petroleum, flex: 1 },
  certHint: { fontSize: 11, color: colors.gray600, lineHeight: 16, marginTop: -spacing.sm },
  ambiente: {
    fontSize: 12,
    color: colors.petroleum,
    fontWeight: '600',
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  footer: { fontSize: 11, color: colors.gray400, marginTop: spacing.sm, textAlign: 'center' },
});
