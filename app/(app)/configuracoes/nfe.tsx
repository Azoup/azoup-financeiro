import { Card } from '@/components/Card';
import { NfseEnumField } from '@/components/configuracoes/NfseEnumField';
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
  verificarConvenioMunicipioIbge,
} from '@/services/nfeConfigService';
import { fetchPerfilCobranca, upsertPerfilCobranca } from '@/services/perfilCobrancaService';
import { colors, radius, spacing } from '@/theme/colors';
import type { PerfilCobrancaInput } from '@/types/contasReceber';
import type { NfeConfig } from '@/types/notaFiscal';
import { showAppToast } from '@/utils/appToast';
import { avaliarProntidaoNfe } from '@/utils/nfeProntidao';
import {
  OP_SIMP_NAC_OPCOES,
  REG_ESP_TRIB_OPCOES,
  TP_RET_ISSQN_OPCOES,
  TRIB_ISSQN_OPCOES,
} from '@/utils/nfseTributacao';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
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
  const [codTribMun, setCodTribMun] = useState('001');
  const [codNbs, setCodNbs] = useState('106043000');
  const [descricao, setDescricao] = useState('Serviço de mensalidade');
  const [opSimpNac, setOpSimpNac] = useState(3);
  const [regEspTrib, setRegEspTrib] = useState(0);
  const [tribIssqn, setTribIssqn] = useState(1);
  const [tpRetIssqn, setTpRetIssqn] = useState(1);
  const [chaveConfigurada, setChaveConfigurada] = useState(false);
  const [chaveSetup, setChaveSetup] = useState('');
  const [busyChave, setBusyChave] = useState(false);
  const [convenioOk, setConvenioOk] = useState<boolean | null>(null);
  const [convenioMsg, setConvenioMsg] = useState<string | null>(null);
  const [busyConvenio, setBusyConvenio] = useState(false);

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
      setCodTribMun(
        c.codigo_tributacao_municipal?.trim() ||
          (c.codigo_ibge_emitente === '3501608' ? '001' : c.codigo_ibge_emitente === '3550308' ? '' : ''),
      );
      setCodNbs(c.codigo_nbs ?? '106043000');
      setDescricao(c.descricao_servico_padrao);
      setOpSimpNac(Number(c.op_simp_nac ?? 3));
      setRegEspTrib(Number(c.reg_esp_trib ?? 0));
      setTribIssqn(Number(c.trib_issqn ?? 1));
      setTpRetIssqn(Number(c.tp_ret_issqn ?? 1));
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

  const verificarIbge = async () => {
    if (!ibge.trim()) {
      showAppToast('error', 'Informe o código IBGE antes de verificar.');
      return;
    }
    setBusyConvenio(true);
    setConvenioMsg(null);
    try {
      const res = await verificarConvenioMunicipioIbge(ibge);
      setConvenioOk(res.ok);
      setConvenioMsg(
        res.ok
          ? `Município ${res.ibge} habilitado no emissor nacional (produção).`
          : res.message ?? 'Município não habilitado no Sistema Nacional NFS-e.',
      );
      if (res.ok) {
        showAppToast('success', 'Município habilitado para NFS-e nacional.', `IBGE ${res.ibge}`);
      } else {
        showAppToast('error', 'Município não habilitado no emissor nacional.', 'Veja os detalhes na seção Município.');
      }
    } catch (e) {
      setConvenioOk(false);
      setConvenioMsg((e as Error).message);
      showAppToast('error', (e as Error).message);
    } finally {
      setBusyConvenio(false);
    }
  };

  const escolherCertificado = async () => {
    try {
      const file = await pickCertificadoFile();
      if (!file) return;
      setPendingCertFile(file);
      setCertFileName(file.name);
      showAppToast('success', 'Certificado selecionado', `${file.name} — informe a senha e clique em Salvar tudo.`);
    } catch (e) {
      showAppToast('error', (e as Error).message);
    }
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
        codigo_tributacao_municipal: codTribMun,
        codigo_nbs: codNbs,
        ncm_servico: '00000000',
        cfop_padrao: '5933',
        cst_icms: '102',
        csosn: '102',
        descricao_servico_padrao: descricao,
        natureza_operacao: 'Prestação de serviço',
        op_simp_nac: Math.min(4, Math.max(1, opSimpNac)) as 1 | 2 | 3 | 4,
        reg_esp_trib: regEspTrib,
        trib_issqn: Math.min(4, Math.max(1, tribIssqn)) as 1 | 2 | 3 | 4,
        tp_ret_issqn: Math.min(3, Math.max(1, tpRetIssqn)) as 1 | 2 | 3,
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
            text2: prontidao.pronto ? 'Pronto para emitir em produção.' : undefined,
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
          text2: certOk ? 'Pronto para emitir em produção.' : 'Envie o certificado A1 quando for emitir.',
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
        parâmetros do serviço. Ambiente: produção (NFS-e com valor fiscal).
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
            ? 'Tudo configurado. Pode gerar mensalidade + NFS-e em produção.'
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
            {'\n\n'}
            Se ainda não rodou: execute no Supabase SQL Editor o arquivo{' '}
            <Text style={styles.mono}>033_certificado_sem_rpc.sql</Text>.
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
          {certOk
            ? 'Certificado A1 já está salvo no servidor. Você pode trocar o arquivo abaixo se precisar.'
            : 'Envie o arquivo .pfx ou .p12 do certificado A1 da empresa.'}
        </Text>
        {certOk && !pendingCertFile ? (
          <View style={styles.certStatusOk}>
            <Ionicons name="shield-checkmark" size={22} color={colors.success} />
            <Text style={styles.certStatusOkTxt}>Certificado ativo no servidor</Text>
          </View>
        ) : null}
        {pendingCertFile ? (
          <View style={styles.certStatusPending}>
            <Ionicons name="document-attach" size={22} color={colors.petroleum} />
            <View style={{ flex: 1 }}>
              <Text style={styles.certStatusPendingTitle}>Arquivo selecionado</Text>
              <Text style={styles.certStatusPendingName} numberOfLines={2}>
                {certFileName ?? pendingCertFile.name}
              </Text>
              <Text style={styles.certStatusPendingHint}>Informe a senha abaixo e clique em Salvar tudo.</Text>
            </View>
            <Pressable
              accessibilityLabel="Remover arquivo selecionado"
              onPress={() => {
                setPendingCertFile(null);
                setCertFileName(null);
              }}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={22} color={colors.gray400} />
            </Pressable>
          </View>
        ) : null}
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
        <Text style={styles.h}>3. Município e numeração (produção)</Text>
        <View style={styles.homologBadge}>
          <Text style={styles.homologBadgeTxt}>Ambiente: produção — NFS-e com valor fiscal</Text>
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
          onChangeText={(t) => {
            setIbge(t);
            setConvenioOk(null);
            setConvenioMsg(null);
          }}
          keyboardType="number-pad"
          placeholder="7 dígitos — ex.: 3501608"
        />
        <Text style={styles.fieldHint}>
          Código da cidade do prestador (IBGE, 7 dígitos).
          {'\n'}
          • Americana = 3501608 → WebService ABRASF TipLan (nfse.americana.sp.gov.br)
          {'\n'}
          • São Paulo capital = 3550308 → Paulistana (somente com CCM da capital)
          {'\n'}
          Azoup está em Americana: use 3501608, IM 69842 e cTribMun 001.
        </Text>
        <PrimaryButton
          title={busyConvenio ? 'Verificando município…' : 'Verificar adesão do município'}
          variant="secondary"
          onPress={() => void verificarIbge()}
          loading={busyConvenio}
          disabled={!ibge.trim() || !certOk}
        />
        {!certOk ? (
          <Text style={styles.fieldHint}>Envie o certificado A1 antes de verificar o município na SEFIN.</Text>
        ) : null}
        {convenioMsg ? (
          <View style={[styles.convenioBox, convenioOk ? styles.convenioOk : styles.convenioWarn]}>
            <Text style={styles.convenioTxt}>{convenioMsg}</Text>
          </View>
        ) : null}
        <FormTextInput
          label="Inscrição municipal (IM / CCM)"
          value={inscricaoMunicipal}
          onChangeText={setInscricaoMunicipal}
          placeholder="Americana: IM da prefeitura — ex.: 69842"
        />
        <Text style={styles.fieldHint}>
          Em Americana informe a inscrição municipal do cadastro (ex.: 69842). CCM de São Paulo capital só se o
          IBGE for 3550308.
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.h}>4. Regime tributário (prestador)</Text>
        <Text style={styles.sub}>
          Deve ser igual ao cadastro da empresa no portal da prefeitura. Erro L327 indica divergência aqui.
        </Text>
        <NfseEnumField
          label="Situação no Simples Nacional (opSimpNac)"
          hint="Confira em nfse.americana.sp.gov.br › perfil da empresa. ME/EPP costuma ser opção 3."
          value={opSimpNac}
          options={OP_SIMP_NAC_OPCOES}
          onChange={setOpSimpNac}
        />
        <NfseEnumField
          label="Regime especial de tributação (regEspTrib)"
          value={regEspTrib}
          options={REG_ESP_TRIB_OPCOES}
          onChange={setRegEspTrib}
        />
        <NfseEnumField
          label="Tributação do ISSQN (tribISSQN)"
          value={tribIssqn}
          options={TRIB_ISSQN_OPCOES}
          onChange={setTribIssqn}
        />
        <NfseEnumField
          label="Retenção do ISSQN (tpRetISSQN)"
          value={tpRetIssqn}
          options={TP_RET_ISSQN_OPCOES}
          onChange={setTpRetIssqn}
        />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.h}>5. Serviço na NFS-e (mensalidade)</Text>
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
          label="Código de tributação municipal (cTribMun)"
          value={codTribMun}
          onChangeText={setCodTribMun}
          keyboardType="number-pad"
          placeholder="Americana: até 3 dígitos — ex.: 001"
          maxLength={5}
        />
        <Text style={styles.fieldHint}>
          Americana: cTribMun até 3 dígitos (ex.: 001). São Paulo capital: código de serviço municipal 4–5 dígitos.
          Confirme com a contabilidade/prefeitura.
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
  certStatusOk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#e8f5e9',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#a5d6a7',
  },
  certStatusOkTxt: { fontSize: 14, fontWeight: '700', color: colors.success, flex: 1 },
  certStatusPending: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#e3f2fd',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#90caf9',
  },
  certStatusPendingTitle: { fontSize: 12, fontWeight: '800', color: colors.petroleum, marginBottom: 2 },
  certStatusPendingName: { fontSize: 14, fontWeight: '700', color: colors.gray800 },
  certStatusPendingHint: { fontSize: 11, color: colors.gray600, marginTop: 4, lineHeight: 15 },
  certHint: { fontSize: 11, color: colors.gray600, lineHeight: 16, marginTop: -spacing.sm },
  mono: { fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, fontSize: 11 },
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
  boldHint: { fontWeight: '700', color: colors.gray800 },
  convenioBox: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
  },
  convenioOk: { backgroundColor: '#e8f5e9', borderColor: '#a5d6a7' },
  convenioWarn: { backgroundColor: '#fff3e0', borderColor: '#ffcc80' },
  convenioTxt: { fontSize: 12, color: colors.gray800, lineHeight: 17 },
  footer: { fontSize: 11, color: colors.gray400, marginTop: spacing.sm, textAlign: 'center' },
});
