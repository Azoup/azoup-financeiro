import { Card } from '@/components/Card';
import { FormTextInput } from '@/components/FormTextInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import {
  definirChaveCertificado,
  ensureNfeConfig,
  fetchCertificadoAtivo,
  fetchCertificadoChaveConfigurada,
  pickCertificadoFile,
  uploadCertificadoA1,
  upsertNfeConfig,
} from '@/services/nfeConfigService';
import { fetchPerfilCobranca, upsertPerfilCobranca } from '@/services/perfilCobrancaService';
import { colors, radius, spacing } from '@/theme/colors';
import type { PerfilCobrancaInput } from '@/types/contasReceber';
import type { NfeConfig } from '@/types/notaFiscal';
import { avaliarProntidaoNfe } from '@/utils/nfeProntidao';
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
  const [ibge, setIbge] = useState('');
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState('');
  const [codTribNac, setCodTribNac] = useState('010701');
  const [codNbs, setCodNbs] = useState('106043000');
  const [descricao, setDescricao] = useState('Serviço de mensalidade');
  const [chaveConfigurada, setChaveConfigurada] = useState(false);
  const [chaveSetup, setChaveSetup] = useState('');
  const [busyChave, setBusyChave] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [c, perfil, cert, chaveOk] = await Promise.all([
        ensureNfeConfig(user.id),
        fetchPerfilCobranca(user.id),
        fetchCertificadoAtivo(user.id),
        fetchCertificadoChaveConfigurada().catch(() => false),
      ]);
      setConfig(c);
      setSerie(c.serie);
      setProximoNumero(String(c.proximo_numero));
      setIbge(c.codigo_ibge_emitente);
      setInscricaoMunicipal(c.inscricao_municipal ?? '');
      setCodTribNac(c.codigo_tributacao_nacional ?? '010701');
      setCodNbs(c.codigo_nbs ?? '106043000');
      setDescricao(c.descricao_servico_padrao);
      setCertOk(Boolean(cert));
      setChaveConfigurada(chaveOk);
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
          codigo_tributacao_nacional: codTribNac,
          codigo_nbs: codNbs,
          descricao_servico_padrao: descricao,
        },
        certOk || Boolean(pendingCertFile),
      ),
    [emitente, ibge, codTribNac, codNbs, descricao, certOk, pendingCertFile],
  );

  const patchEmitente = (p: Partial<PerfilCobrancaInput>) => setEmitente((v) => ({ ...v, ...p }));

  const escolherCertificado = async () => {
    const file = await pickCertificadoFile();
    if (!file) return;
    setPendingCertFile(file);
    setCertFileName(file.name);
  };

  const salvarChaveCertificado = async () => {
    setBusyChave(true);
    try {
      await definirChaveCertificado(chaveSetup);
      setChaveConfigurada(true);
      setChaveSetup('');
      Toast.show({
        type: 'success',
        text1: 'Chave de segurança definida.',
        text2: 'Agora selecione o .pfx, informe a senha e clique em Salvar tudo.',
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setBusyChave(false);
    }
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
    if (pendingCertFile && !senhaCert.trim()) {
      Toast.show({
        type: 'error',
        text1: 'Informe a senha do certificado A1.',
        text2: 'Ela é obrigatória junto com o arquivo .pfx / .p12.',
      });
      return;
    }
    if (pendingCertFile && !chaveConfigurada) {
      Toast.show({
        type: 'error',
        text1: 'Defina a chave de segurança do certificado antes.',
        text2: 'Use a seção logo abaixo do prestador (mín. 16 caracteres).',
      });
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
        inscricao_estadual: '',
        regime_tributario: 1,
        codigo_ibge_emitente: ibge,
        inscricao_municipal: inscricaoMunicipal,
        codigo_tributacao_nacional: codTribNac,
        codigo_nbs: codNbs,
        ncm_servico: '00000000',
        cfop_padrao: '5933',
        cst_icms: '102',
        csosn: '102',
        descricao_servico_padrao: descricao,
        natureza_operacao: 'Prestação de serviço',
        op_simp_nac: 1,
        reg_esp_trib: 0,
        trib_issqn: 1,
        tp_ret_issqn: 1,
      });

      if (pendingCertFile) {
        try {
          await uploadCertificadoA1(user.id, pendingCertFile, senhaCert);
          setPendingCertFile(null);
          setSenhaCert('');
          setCertOk(true);
          Toast.show({
            type: 'success',
            text1: 'Configuração e certificado salvos.',
            text2: prontidao.pronto ? 'Pronto para emitir em homologação.' : undefined,
          });
        } catch (certErr) {
          Toast.show({
            type: 'error',
            text1: 'Certificado não foi salvo.',
            text2: (certErr as Error).message,
          });
        }
      } else {
        Toast.show({
          type: 'success',
          text1: 'Configuração de NFS-e salva.',
          text2: certOk ? 'Pronto para emitir em homologação.' : 'Envie o certificado A1 quando for emitir.',
        });
      }

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
        Configure a emissão de NFS-e (nota fiscal de serviço) para mensalidades: prestador, certificado A1 e
        parâmetros do serviço. Por enquanto, apenas ambiente de homologação.
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
            ? 'Tudo configurado. Pode gerar mensalidade + NFS-e em homologação.'
            : 'Complete os itens pendentes e clique em Salvar tudo.'}
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.h}>1. Prestador do serviço</Text>
        <Text style={styles.sub}>Dados da empresa que presta o serviço na NFS-e.</Text>
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

      {!chaveConfigurada ? (
        <Card style={[styles.card, styles.cardWarn]}>
          <Text style={styles.h}>Chave de segurança do certificado</Text>
          <Text style={styles.sub}>
            Antes de enviar o .pfx, invente uma senha longa (mín. 16 caracteres) para criptografar a senha do
            certificado no banco. Guarde essa chave — use a mesma em CERT_ENCRYPTION_KEY na Vercel ao emitir NFS-e.
          </Text>
          <FormTextInput
            label="Chave de segurança (definir uma vez)"
            value={chaveSetup}
            onChangeText={setChaveSetup}
            secureTextEntry
            placeholder="Ex.: MinhaEmpresa2026ChaveSecreta!"
          />
          <PrimaryButton
            title="Definir chave"
            onPress={() => void salvarChaveCertificado()}
            loading={busyChave}
            disabled={chaveSetup.trim().length < 16}
          />
        </Card>
      ) : null}

      <Card style={styles.card}>
        <Text style={styles.h}>2. Certificado digital A1</Text>
        <Text style={styles.sub}>
          Status:{' '}
          {certOk
            ? 'Certificado ativo no servidor'
            : pendingCertFile
              ? `Arquivo selecionado: ${certFileName}`
              : 'Nenhum certificado — obrigatório para enviar à prefeitura/SEFIN'}
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
          {chaveConfigurada
            ? 'Selecione o .pfx, informe a senha do certificado e clique em Salvar tudo.'
            : 'Defina a chave de segurança acima antes de enviar o certificado.'}
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.h}>3. Município e numeração (homologação)</Text>
        <View style={styles.homologBadge}>
          <Text style={styles.homologBadgeTxt}>Ambiente fixo: homologação (testes — sem valor fiscal)</Text>
        </View>
        <FormTextInput label="Série do RPS" value={serie} onChangeText={setSerie} />
        <FormTextInput
          label="Próximo número do RPS"
          value={proximoNumero}
          onChangeText={setProximoNumero}
          keyboardType="number-pad"
        />
        <FormTextInput
          label="Código IBGE do município"
          value={ibge}
          onChangeText={setIbge}
          keyboardType="number-pad"
          placeholder="7 dígitos — ex.: 3550308"
        />
        <Text style={styles.fieldHint}>
          Código da cidade onde o prestador está estabelecido (IBGE). Não é inscrição municipal — é o código do
          município. Ex.: São Paulo = 3550308, Campinas = 3509502.
        </Text>
        <FormTextInput
          label="Inscrição municipal (IM)"
          value={inscricaoMunicipal}
          onChangeText={setInscricaoMunicipal}
          placeholder="Número na prefeitura — se a sua cidade exigir"
        />
        <Text style={styles.fieldHint}>
          Cadastro da empresa na prefeitura (IM). Campo separado do código IBGE. Preencha se sua contabilidade ou a
          prefeitura exigir na NFS-e.
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.h}>4. Serviço na NFS-e (mensalidade)</Text>
        <Text style={styles.sub}>
          NFS-e de serviço não usa NCM nem CFOP (esses campos são de NF-e de produto). Informe o código do serviço
          conforme a Lista LC 116 e o NBS indicados pelo seu contador.
        </Text>
        <FormTextInput
          label="Código do serviço (LC 116 / cTribNac)"
          value={codTribNac}
          onChangeText={setCodTribNac}
          keyboardType="number-pad"
          placeholder="6 dígitos — ex.: 010701"
        />
        <Text style={styles.fieldHint}>
          Código nacional do serviço na Lei Complementar 116. Ex.: 010701 = desenvolvimento de programas sob
          encomenda; 171901 = contabilidade. Confirme com seu contador.
        </Text>
        <FormTextInput
          label="Código NBS (nomenclatura do serviço)"
          value={codNbs}
          onChangeText={setCodNbs}
          keyboardType="number-pad"
          placeholder="9 dígitos — ex.: 106043000"
        />
        <Text style={styles.fieldHint}>
          Nomenclatura Brasileira de Serviços (NBS), vinculada ao tipo de serviço. Também deve ser validada com a
          contabilidade.
        </Text>
        <FormTextInput
          label="Descrição do serviço (texto na nota)"
          value={descricao}
          onChangeText={setDescricao}
          placeholder="Ex.: Mensalidade de assessoria contábil — competência"
        />
        <Text style={styles.fieldHint}>
          Texto que aparece na NFS-e descrevendo o que foi prestado. A competência da mensalidade é acrescentada
          automaticamente na emissão.
        </Text>
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
  homologBadge: {
    backgroundColor: '#fff8e1',
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#ffe082',
  },
  homologBadgeTxt: { fontSize: 12, color: colors.gray800, fontWeight: '600' },
  fieldHint: {
    fontSize: 11,
    color: colors.gray600,
    lineHeight: 16,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  footer: { fontSize: 11, color: colors.gray400, marginTop: spacing.sm, textAlign: 'center' },
});
