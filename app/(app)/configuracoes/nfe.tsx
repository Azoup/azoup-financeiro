import { Card } from '@/components/Card';
import { NfseEnumField } from '@/components/configuracoes/NfseEnumField';
import { FormTextInput } from '@/components/FormTextInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/context/AuthContext';
import {
  definirChaveCertificado,
  fetchCertificadoChaveConfigurada,
  pickCertificadoFile,
  verificarConvenioMunicipioIbge,
} from '@/services/nfeConfigService';
import {
  MAX_NFSE_EMITENTES,
  createEmitente,
  deleteEmitente,
  emitenteLabel,
  ensureEmitentes,
  fetchCertificadoAtivoEmitente,
  setEmitentePadrao,
  updateEmitente,
  uploadCertificadoA1Emitente,
} from '@/services/nfseEmitenteService';
import { colors, radius, spacing } from '@/theme/colors';
import type { NfseEmitente } from '@/types/notaFiscal';
import { showAppToast } from '@/utils/appToast';
import { avaliarProntidaoEmitente } from '@/utils/nfeProntidao';
import {
  OP_SIMP_NAC_OPCOES,
  REGIME_TRIBUTARIO_OPCOES,
  REG_ESP_TRIB_OPCOES,
  SITUACAO_PIS_COFINS_OPCOES,
  TIPO_APURACAO_OPCOES,
  TP_RET_ISSQN_OPCOES,
  TRIB_ISSQN_OPCOES,
  defaultsRegimeNormal,
  isRegimeNormal,
  isRegimeSimples,
  opSimpNacParaRegime,
  regimeCurto,
  type RegimeTributario,
  type TipoApuracaoNormal,
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

type FormState = {
  nome: string;
  razao_social: string;
  documento: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  serie: string;
  proximo_numero: string;
  ibge: string;
  inscricao_municipal: string;
  inscricao_estadual: string;
  natureza_operacao: string;
  codigo_cnae: string;
  codTribNac: string;
  codTribMun: string;
  codNbs: string;
  descricao: string;
  regimeTributario: RegimeTributario;
  tipoApuracao: TipoApuracaoNormal;
  situacaoPisCofins: string;
  aliquotaIss: string;
  aliquotaPis: string;
  aliquotaCofins: string;
  indOp: string;
  cstIbsCbs: string;
  cClassTrib: string;
  aliquotaIbsUf: string;
  aliquotaIbsMun: string;
  aliquotaCbs: string;
  opSimpNac: number;
  regEspTrib: number;
  tribIssqn: number;
  tpRetIssqn: number;
};

function formFromEmitente(e: NfseEmitente): FormState {
  const regime = Math.min(3, Math.max(1, Number(e.regime_tributario ?? 1))) as RegimeTributario;
  return {
    nome: e.nome || 'Emitente',
    razao_social: e.razao_social,
    documento: e.documento,
    logradouro: e.logradouro,
    numero: e.numero,
    complemento: e.complemento,
    bairro: e.bairro,
    cidade: e.cidade,
    uf: e.uf,
    cep: e.cep,
    serie: e.serie,
    proximo_numero: String(e.proximo_numero),
    ibge: e.codigo_ibge_emitente,
    inscricao_municipal: e.inscricao_municipal ?? '',
    inscricao_estadual: e.inscricao_estadual ?? '',
    natureza_operacao: e.natureza_operacao ?? 'Prestação de serviço',
    codigo_cnae: e.codigo_cnae ?? '',
    codTribNac: e.codigo_tributacao_nacional ?? '010701',
    codTribMun:
      e.codigo_tributacao_municipal?.trim() ||
      (e.codigo_ibge_emitente === '3501608' ? '001' : ''),
    codNbs: e.codigo_nbs ?? '115013000',
    descricao: e.descricao_servico_padrao,
    regimeTributario: regime,
    tipoApuracao: e.tipo_apuracao === 'real' ? 'real' : 'presumido',
    situacaoPisCofins: (e.situacao_pis_cofins || (Number(e.regime_tributario) === 3 ? '01' : '00'))
      .padStart(2, '0')
      .slice(0, 2),
    aliquotaIss: String(e.aliquota_iss ?? 0),
    aliquotaPis: String(e.aliquota_pis ?? 0),
    aliquotaCofins: String(e.aliquota_cofins ?? 0),
    indOp: e.ind_op ?? '100501',
    cstIbsCbs: e.cst_ibs_cbs ?? '000',
    cClassTrib: e.c_class_trib ?? '000001',
    aliquotaIbsUf: String(e.aliquota_ibs_uf ?? 0.1),
    aliquotaIbsMun: String(e.aliquota_ibs_mun ?? 0),
    aliquotaCbs: String(e.aliquota_cbs ?? 0.9),
    opSimpNac: Number(e.op_simp_nac ?? 3),
    regEspTrib: Number(e.reg_esp_trib ?? 0),
    tribIssqn: Number(e.trib_issqn ?? 1),
    tpRetIssqn: Number(e.tp_ret_issqn ?? 1),
  };
}

export default function NfeConfigScreen() {
  const { user } = useAuth();
  const [emitentes, setEmitentes] = useState<NfseEmitente[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [certOk, setCertOk] = useState(false);
  const [certFileName, setCertFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [senhaCert, setSenhaCert] = useState('');
  const [pendingCertFile, setPendingCertFile] = useState<{
    uri: string;
    name: string;
    mimeType?: string;
    webFile?: File;
  } | null>(null);
  const [chaveConfigurada, setChaveConfigurada] = useState(false);
  const [chaveSetup, setChaveSetup] = useState('');
  const [busyChave, setBusyChave] = useState(false);
  const [convenioOk, setConvenioOk] = useState<boolean | null>(null);
  const [convenioMsg, setConvenioMsg] = useState<string | null>(null);
  const [busyConvenio, setBusyConvenio] = useState(false);

  const selected = useMemo(
    () => emitentes.find((e) => e.id === selectedId) ?? null,
    [emitentes, selectedId],
  );

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [list, chaveOk] = await Promise.all([
        ensureEmitentes(user.id),
        fetchCertificadoChaveConfigurada().catch(() => false),
      ]);
      setEmitentes(list);
      setChaveConfigurada(chaveOk);
      setSelectedId((prev) => {
        const pick = list.find((e) => e.id === prev) ?? list.find((e) => e.padrao) ?? list[0] ?? null;
        if (pick) {
          setForm(formFromEmitente(pick));
          void fetchCertificadoAtivoEmitente(user.id, pick.id).then((cert) => setCertOk(Boolean(cert)));
        } else {
          setForm(null);
          setCertOk(false);
        }
        return pick?.id ?? null;
      });
      setPendingCertFile(null);
      setSenhaCert('');
      setCertFileName(null);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load inicial
  }, [user?.id]);

  const selectEmitente = async (id: string) => {
    if (!user?.id) return;
    const e = emitentes.find((x) => x.id === id);
    if (!e) return;
    setSelectedId(id);
    setForm(formFromEmitente(e));
    setPendingCertFile(null);
    setSenhaCert('');
    setCertFileName(null);
    setConvenioOk(null);
    setConvenioMsg(null);
    const cert = await fetchCertificadoAtivoEmitente(user.id, id);
    setCertOk(Boolean(cert));
  };

  const prontidao = useMemo(
    () =>
      avaliarProntidaoEmitente(
        form
          ? {
              razao_social: form.razao_social,
              documento: form.documento,
              logradouro: form.logradouro,
              cidade: form.cidade,
              uf: form.uf,
              cep: form.cep,
              codigo_ibge_emitente: form.ibge,
              codigo_tributacao_nacional: form.codTribNac,
              codigo_nbs: form.codNbs,
              descricao_servico_padrao: form.descricao,
              regime_tributario: form.regimeTributario,
              codigo_cnae: form.codigo_cnae,
              inscricao_municipal: form.inscricao_municipal,
            }
          : null,
        certOk || Boolean(pendingCertFile),
      ),
    [form, certOk, pendingCertFile],
  );

  const patch = (p: Partial<FormState>) => setForm((v) => (v ? { ...v, ...p } : v));

  const verificarIbge = async () => {
    if (!form?.ibge.trim()) {
      showAppToast('error', 'Informe o código IBGE antes de verificar.');
      return;
    }
    setBusyConvenio(true);
    setConvenioMsg(null);
    try {
      const res = await verificarConvenioMunicipioIbge(form.ibge);
      setConvenioOk(res.ok);
      setConvenioMsg(
        res.ok
          ? `Município ${res.ibge} habilitado no emissor nacional (produção).`
          : res.message ?? 'Município não habilitado no Sistema Nacional NFS-e.',
      );
    } catch (e) {
      setConvenioOk(false);
      setConvenioMsg((e as Error).message);
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
      showAppToast('success', 'Certificado selecionado', `${file.name} — informe a senha e Salvar.`);
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
      Toast.show({ type: 'success', text1: 'Chave de segurança definida.' });
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setBusyChave(false);
    }
  };

  const adicionarEmitente = async () => {
    if (!user?.id) return;
    if (emitentes.length >= MAX_NFSE_EMITENTES) {
      Toast.show({ type: 'error', text1: 'Máximo de 2 CNPJs.' });
      return;
    }
    setBusy(true);
    try {
      const primeiro = emitentes[0];
      const primeiroSimples = primeiro
        ? isRegimeSimples(Number(primeiro.regime_tributario ?? 1)) ||
          Number(primeiro.op_simp_nac ?? 3) !== 1
        : true;
      // 2º CNPJ nasce no regime oposto ao primeiro (Simples ↔ Normal).
      const regimeNovo: RegimeTributario = primeiroSimples ? 3 : 1;
      const opSimpNovo = opSimpNacParaRegime(regimeNovo);
      const normalDefaults = regimeNovo === 3 ? defaultsRegimeNormal('presumido') : null;

      const placeholder = `9${String(Date.now()).slice(-13)}`;
      const created = await createEmitente(user.id, {
        nome: primeiroSimples ? 'Emitente Regime Normal' : 'Emitente Simples Nacional',
        documento: placeholder,
        razao_social: 'Preencher razão social',
        padrao: false,
        regime_tributario: regimeNovo,
        op_simp_nac: opSimpNovo,
        ...(normalDefaults
          ? {
              tipo_apuracao: normalDefaults.tipo_apuracao,
              situacao_pis_cofins: normalDefaults.situacao_pis_cofins,
              aliquota_iss: normalDefaults.aliquota_iss,
              aliquota_pis: normalDefaults.aliquota_pis,
              aliquota_cofins: normalDefaults.aliquota_cofins,
              cst_icms: normalDefaults.cst_icms,
              csosn: normalDefaults.csosn,
              codigo_tributacao_nacional: normalDefaults.codigo_tributacao_nacional,
              codigo_tributacao_municipal: normalDefaults.codigo_tributacao_municipal,
              codigo_nbs: normalDefaults.codigo_nbs,
              descricao_servico_padrao: normalDefaults.descricao_servico_padrao,
            }
          : { tipo_apuracao: null }),
      });
      Toast.show({
        type: 'info',
        text1: '2º emitente criado',
        text2: primeiroSimples
          ? 'Pré-definido como Regime Normal · Lucro Presumido. Complete CNAE, IE, ISS e salve.'
          : 'Pré-definido como Simples Nacional. Ajuste CNPJ, A1 e salve.',
      });
      const list = await ensureEmitentes(user.id);
      setEmitentes(list);
      setSelectedId(created.id);
      setForm(formFromEmitente(created));
      setCertOk(false);
      setPendingCertFile(null);
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const salvarTudo = async () => {
    if (!user?.id || !form || !selectedId) return;
    if (!form.razao_social.trim() || !form.documento.trim()) {
      Toast.show({ type: 'error', text1: 'Preencha razão social e CNPJ/CPF do emitente.' });
      return;
    }
    if (!form.ibge.trim()) {
      Toast.show({ type: 'error', text1: 'Informe o código IBGE do município.' });
      return;
    }
    if (pendingCertFile && !senhaCert.trim()) {
      Toast.show({ type: 'error', text1: 'Informe a senha do certificado A1.' });
      return;
    }
    if (pendingCertFile && !chaveConfigurada) {
      Toast.show({ type: 'error', text1: 'Defina a chave de segurança do certificado antes.' });
      return;
    }

    setBusy(true);
    try {
      await updateEmitente(user.id, selectedId, {
        nome: form.nome,
        razao_social: form.razao_social,
        documento: form.documento,
        logradouro: form.logradouro,
        numero: form.numero,
        complemento: form.complemento,
        bairro: form.bairro,
        cidade: form.cidade,
        uf: form.uf,
        cep: form.cep,
        serie: form.serie,
        proximo_numero: Math.max(1, parseInt(form.proximo_numero, 10) || 1),
        codigo_ibge_emitente: form.ibge,
        inscricao_municipal: form.inscricao_municipal,
        inscricao_estadual: form.inscricao_estadual,
        natureza_operacao: form.natureza_operacao,
        codigo_cnae: form.codigo_cnae,
        codigo_tributacao_nacional: form.codTribNac,
        codigo_tributacao_municipal: form.codTribMun,
        codigo_nbs: form.codNbs,
        descricao_servico_padrao: form.descricao,
        regime_tributario: form.regimeTributario,
        tipo_apuracao: isRegimeNormal(form.regimeTributario) ? form.tipoApuracao : null,
        situacao_pis_cofins: form.situacaoPisCofins,
        aliquota_iss: Number(String(form.aliquotaIss).replace(',', '.')) || 0,
        aliquota_pis: Number(String(form.aliquotaPis).replace(',', '.')) || 0,
        aliquota_cofins: Number(String(form.aliquotaCofins).replace(',', '.')) || 0,
        ind_op: form.indOp,
        cst_ibs_cbs: form.cstIbsCbs,
        c_class_trib: form.cClassTrib,
        aliquota_ibs_uf: Number(String(form.aliquotaIbsUf).replace(',', '.')) || 0,
        aliquota_ibs_mun: Number(String(form.aliquotaIbsMun).replace(',', '.')) || 0,
        aliquota_cbs: Number(String(form.aliquotaCbs).replace(',', '.')) || 0,
        op_simp_nac: Math.min(4, Math.max(1, form.opSimpNac)) as 1 | 2 | 3 | 4,
        reg_esp_trib: form.regEspTrib,
        trib_issqn: Math.min(4, Math.max(1, form.tribIssqn)) as 1 | 2 | 3 | 4,
        tp_ret_issqn: Math.min(3, Math.max(1, form.tpRetIssqn)) as 1 | 2 | 3,
      });

      if (pendingCertFile) {
        await uploadCertificadoA1Emitente(user.id, selectedId, pendingCertFile, senhaCert);
        setPendingCertFile(null);
        setSenhaCert('');
        setCertOk(true);
      }

      Toast.show({
        type: 'success',
        text1: 'Emitente salvo.',
        text2: prontidao.pronto ? 'Pronto para emitir com este CNPJ.' : undefined,
      });
      const list = await ensureEmitentes(user.id);
      setEmitentes(list);
      const cur = list.find((e) => e.id === selectedId);
      if (cur) setForm(formFromEmitente(cur));
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const tornarPadrao = async () => {
    if (!user?.id || !selectedId) return;
    try {
      await setEmitentePadrao(user.id, selectedId);
      Toast.show({ type: 'success', text1: 'Emitente definido como padrão.' });
      await load();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
    }
  };

  const excluir = async () => {
    if (!user?.id || !selectedId) return;
    try {
      await deleteEmitente(user.id, selectedId);
      Toast.show({ type: 'success', text1: 'Emitente removido.' });
      setSelectedId(null);
      await load();
    } catch (e) {
      Toast.show({ type: 'error', text1: (e as Error).message });
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
        Cadastre até 2 CNPJs emitentes. Um pode ser Simples Nacional e o outro Regime Normal — cada um com
        dados fiscais e certificado A1 próprios. Na emissão da NFS-e você escolhe qual CNPJ usar.
      </Text>

      <Card style={styles.card}>
        <Text style={styles.h}>Emitentes (CNPJs)</Text>
        <View style={styles.tabs}>
          {emitentes.map((e) => {
            const on = e.id === selectedId;
            const regime = Number(e.regime_tributario ?? 1);
            return (
              <Pressable
                key={e.id}
                style={[styles.tab, on && styles.tabOn]}
                onPress={() => void selectEmitente(e.id)}
              >
                <Text style={[styles.tabTxt, on && styles.tabTxtOn]} numberOfLines={2}>
                  {e.nome}
                  {e.padrao ? ' ★' : ''}
                </Text>
                <Text style={[styles.tabSub, on && styles.tabTxtOn]} numberOfLines={1}>
                  {emitenteLabel(e).split(' · ')[1] || e.documento}
                </Text>
                <View
                  style={[
                    styles.regimeBadge,
                    isRegimeSimples(regime) ? styles.regimeBadgeSimples : styles.regimeBadgeNormal,
                  ]}
                >
                  <Text
                    style={[
                      styles.regimeBadgeTxt,
                      isRegimeSimples(regime)
                        ? styles.regimeBadgeTxtSimples
                        : styles.regimeBadgeTxtNormal,
                    ]}
                  >
                    {regimeCurto(regime, e.tipo_apuracao)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.tabActions}>
          {emitentes.length < MAX_NFSE_EMITENTES ? (
            <PrimaryButton title="Adicionar 2º CNPJ" variant="secondary" onPress={() => void adicionarEmitente()} />
          ) : null}
          {selected && !selected.padrao ? (
            <PrimaryButton title="Definir como padrão" variant="ghost" onPress={() => void tornarPadrao()} />
          ) : null}
          {selected && !selected.padrao && emitentes.length > 1 ? (
            <PrimaryButton title="Excluir este CNPJ" variant="danger" onPress={() => void excluir()} />
          ) : null}
        </View>
      </Card>

      {!form || !selectedId ? (
        <Card style={styles.card}>
          <Text style={styles.sub}>
            Nenhum emitente encontrado. Rode as migrations{' '}
            <Text style={styles.mono}>037_nfse_emitente.sql</Text> e{' '}
            <Text style={styles.mono}>038_nfse_emitente_regime_normal.sql</Text> e{' '}
            <Text style={styles.mono}>041_nfse_ibs_cbs.sql</Text> no Supabase e
            recarregue.
          </Text>
          <PrimaryButton title="Recarregar" onPress={() => void load()} />
        </Card>
      ) : (
        <>
          <Card style={[styles.card, prontidao.pronto ? styles.cardOk : styles.cardWarn]}>
            <Text style={styles.h}>Prontidão — {form.nome}</Text>
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
          </Card>

          <Card style={styles.card}>
            <Text style={styles.h}>1. Prestador</Text>
            <FormTextInput label="Nome / rótulo" value={form.nome} onChangeText={(t) => patch({ nome: t })} />
            <FormTextInput
              label="Razão social"
              value={form.razao_social}
              onChangeText={(t) => patch({ razao_social: t })}
            />
            <FormTextInput
              label="CNPJ ou CPF"
              value={form.documento}
              onChangeText={(t) => patch({ documento: t })}
            />
            <FormTextInput
              label="Logradouro"
              value={form.logradouro}
              onChangeText={(t) => patch({ logradouro: t })}
            />
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <FormTextInput label="Número" value={form.numero} onChangeText={(t) => patch({ numero: t })} />
              </View>
              <View style={{ flex: 1 }}>
                <FormTextInput label="Bairro" value={form.bairro} onChangeText={(t) => patch({ bairro: t })} />
              </View>
            </View>
            <View style={styles.row2}>
              <View style={{ flex: 2 }}>
                <FormTextInput label="Cidade" value={form.cidade} onChangeText={(t) => patch({ cidade: t })} />
              </View>
              <View style={{ flex: 1 }}>
                <FormTextInput
                  label="UF"
                  value={form.uf}
                  onChangeText={(t) => patch({ uf: t })}
                  maxLength={2}
                  autoCapitalize="characters"
                />
              </View>
            </View>
            <FormTextInput label="CEP" value={form.cep} onChangeText={(t) => patch({ cep: t })} />
          </Card>

          {!chaveConfigurada ? (
            <Card style={[styles.card, styles.cardWarn]}>
              <Text style={styles.h}>Chave de segurança do certificado</Text>
              <Text style={styles.sub}>
                Defina uma chave longa (mín. 16 caracteres) uma vez. Rode também{' '}
                <Text style={styles.mono}>033_certificado_sem_rpc.sql</Text> se ainda não rodou.
              </Text>
              <FormTextInput
                label="Chave de segurança"
                value={chaveSetup}
                onChangeText={setChaveSetup}
                secureTextEntry
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
            <Text style={styles.h}>2. Certificado A1 deste CNPJ</Text>
            <Text style={styles.sub}>Cada emitente precisa do próprio .pfx.</Text>
            {certOk && !pendingCertFile ? (
              <View style={styles.certStatusOk}>
                <Ionicons name="shield-checkmark" size={22} color={colors.success} />
                <Text style={styles.certStatusOkTxt}>Certificado ativo neste emitente</Text>
              </View>
            ) : null}
            {pendingCertFile ? (
              <View style={styles.certStatusPending}>
                <Ionicons name="document-attach" size={22} color={colors.petroleum} />
                <Text style={{ flex: 1 }}>{certFileName ?? pendingCertFile.name}</Text>
              </View>
            ) : null}
            <Pressable style={styles.fileBtn} onPress={() => void escolherCertificado()}>
              <Ionicons name="folder-open-outline" size={22} color={colors.petroleum} />
              <Text style={styles.fileBtnTxt}>Selecionar .pfx / .p12</Text>
            </Pressable>
            <FormTextInput
              label="Senha do certificado"
              value={senhaCert}
              onChangeText={setSenhaCert}
              secureTextEntry
            />
          </Card>

          <Card style={styles.card}>
            <Text style={styles.h}>3. Município e numeração</Text>
            <FormTextInput label="Série do RPS" value={form.serie} onChangeText={(t) => patch({ serie: t })} />
            <FormTextInput
              label="Próximo número do RPS"
              value={form.proximo_numero}
              onChangeText={(t) => patch({ proximo_numero: t })}
              keyboardType="number-pad"
            />
            <FormTextInput
              label="Código IBGE"
              value={form.ibge}
              onChangeText={(t) => {
                patch({ ibge: t });
                setConvenioOk(null);
              }}
              keyboardType="number-pad"
            />
            <PrimaryButton
              title="Verificar adesão do município"
              variant="secondary"
              onPress={() => void verificarIbge()}
              loading={busyConvenio}
              disabled={!form.ibge.trim()}
            />
            {convenioMsg ? (
              <View style={[styles.convenioBox, convenioOk ? styles.convenioOk : styles.convenioWarn]}>
                <Text style={styles.convenioTxt}>{convenioMsg}</Text>
              </View>
            ) : null}
            <FormTextInput
              label="Inscrição municipal"
              value={form.inscricao_municipal}
              onChangeText={(t) => patch({ inscricao_municipal: t })}
            />
          </Card>

          <Card style={styles.card}>
            <Text style={styles.h}>4. Regime tributário</Text>
            <Text style={styles.sub}>
              No Regime Normal escolha Lucro Presumido ou Lucro Real e preencha IE, CNAE, ISS e
              PIS/COFINS — necessários para a NFS-e do 2º CNPJ.
            </Text>
            <NfseEnumField
              label="Regime do emitente (CRT)"
              hint="Use Simples em um CNPJ e Regime Normal no outro, se for o caso."
              value={form.regimeTributario}
              options={REGIME_TRIBUTARIO_OPCOES}
              onChange={(v) => {
                const regime = v as RegimeTributario;
                if (isRegimeNormal(regime)) {
                  const d = defaultsRegimeNormal(form.tipoApuracao || 'presumido');
                  patch({
                    regimeTributario: regime,
                    opSimpNac: d.op_simp_nac,
                    tipoApuracao: d.tipo_apuracao,
                    situacaoPisCofins: d.situacao_pis_cofins,
                    aliquotaIss: String(d.aliquota_iss),
                    aliquotaPis: String(d.aliquota_pis),
                    aliquotaCofins: String(d.aliquota_cofins),
                    codTribNac: d.codigo_tributacao_nacional,
                    codTribMun: d.codigo_tributacao_municipal,
                    codNbs: d.codigo_nbs,
                    descricao: d.descricao_servico_padrao,
                  });
                } else {
                  patch({
                    regimeTributario: regime,
                    opSimpNac: opSimpNacParaRegime(regime, form.opSimpNac),
                    tipoApuracao: 'presumido',
                  });
                }
              }}
            />

            {isRegimeNormal(form.regimeTributario) ? (
              <>
                <Text style={styles.sectionLabel}>Apuração do Regime Normal</Text>
                <NfseEnumField
                  label="Tipo de apuração (IRPJ/CSLL)"
                  hint={
                    TIPO_APURACAO_OPCOES.find((o) => o.value === form.tipoApuracao)?.hint ??
                    'Lucro Presumido ou Lucro Real.'
                  }
                  value={form.tipoApuracao}
                  options={TIPO_APURACAO_OPCOES.map((o) => ({ value: o.value, label: o.label }))}
                  showValuePrefix={false}
                  onChange={(v) => {
                    const apuracao = v as TipoApuracaoNormal;
                    const d = defaultsRegimeNormal(apuracao);
                    patch({
                      tipoApuracao: apuracao,
                      aliquotaPis: String(d.aliquota_pis),
                      aliquotaCofins: String(d.aliquota_cofins),
                    });
                  }}
                />
                <FormTextInput
                  label="Inscrição estadual (IE)"
                  value={form.inscricao_estadual}
                  onChangeText={(t) => patch({ inscricao_estadual: t })}
                  placeholder="Número da IE ou ISENTO"
                  autoCapitalize="characters"
                />
                <FormTextInput
                  label="CNAE principal (7 dígitos)"
                  value={form.codigo_cnae}
                  onChangeText={(t) => patch({ codigo_cnae: t })}
                  keyboardType="number-pad"
                  maxLength={7}
                  placeholder="Ex.: 6209100"
                />
                <FormTextInput
                  label="Natureza da operação"
                  value={form.natureza_operacao}
                  onChangeText={(t) => patch({ natureza_operacao: t })}
                />
                <NfseEnumField
                  label="Situação tributária PIS/COFINS (NFS-e)"
                  hint="Regime Normal: use 01 (alíquota básica). Evite 00 — a TipLan pode rejeitar no schema (X160)."
                  value={form.situacaoPisCofins}
                  options={SITUACAO_PIS_COFINS_OPCOES}
                  showValuePrefix={false}
                  onChange={(v) => patch({ situacaoPisCofins: String(v) })}
                />
                <View style={styles.row2}>
                  <View style={{ flex: 1 }}>
                    <FormTextInput
                      label="Alíquota ISS (%)"
                      value={form.aliquotaIss}
                      onChangeText={(t) => patch({ aliquotaIss: t })}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <FormTextInput
                      label="Alíquota PIS (%)"
                      value={form.aliquotaPis}
                      onChangeText={(t) => patch({ aliquotaPis: t })}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <FormTextInput
                      label="Alíquota COFINS (%)"
                      value={form.aliquotaCofins}
                      onChangeText={(t) => patch({ aliquotaCofins: t })}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
                <View style={styles.lockedBox}>
                  <Text style={styles.lockedTitle}>Situação no Simples Nacional</Text>
                  <Text style={styles.lockedValue}>Não optante (1) — fixo no Regime Normal</Text>
                  <Text style={styles.lockedHint}>
                    Não precisa escolher: a NFS-e TipLan envia OptanteSimplesNacional = 2 (não).
                    Confira só se o portal Americana também está em Tributação Normal neste CNPJ.
                  </Text>
                </View>
              </>
            ) : (
              <NfseEnumField
                label="Situação no Simples Nacional (NFS-e)"
                value={form.opSimpNac}
                options={OP_SIMP_NAC_OPCOES}
                onChange={(v) => {
                  const next: Partial<FormState> = { opSimpNac: v };
                  if (v === 1 && form.regimeTributario !== 3) next.regimeTributario = 3;
                  if (v !== 1 && form.regimeTributario === 3) next.regimeTributario = 1;
                  patch(next);
                }}
              />
            )}

            <NfseEnumField
              label="Regime especial de tributação"
              value={form.regEspTrib}
              options={REG_ESP_TRIB_OPCOES}
              onChange={(v) => patch({ regEspTrib: v })}
            />
            <NfseEnumField
              label="Tributação ISSQN"
              value={form.tribIssqn}
              options={TRIB_ISSQN_OPCOES}
              onChange={(v) => patch({ tribIssqn: v })}
            />
            <NfseEnumField
              label="Retenção ISSQN"
              value={form.tpRetIssqn}
              options={TP_RET_ISSQN_OPCOES}
              onChange={(v) => patch({ tpRetIssqn: v })}
            />
          </Card>

          <Card style={styles.card}>
            <Text style={styles.h}>5. Serviço</Text>
            <FormTextInput
              label="Código LC 116 (cTribNac)"
              value={form.codTribNac}
              onChangeText={(t) => patch({ codTribNac: t })}
              placeholder={form.regimeTributario === 3 ? '010501' : '010701'}
            />
            <Text style={styles.sub}>
              {form.regimeTributario === 3
                ? 'Empresa 2: 01.05 ou 010501 — Licenciamento / cessão de uso de software.'
                : 'Ex.: 010701 → ItemListaServico 01.07. Não use 001 nem 000001.'}
            </Text>
            <FormTextInput
              label="Código municipal (cTribMun)"
              value={form.codTribMun}
              onChangeText={(t) => patch({ codTribMun: t })}
              placeholder={form.regimeTributario === 3 ? '01.05' : '01.07'}
              maxLength={5}
            />
            <Text style={styles.sub}>
              TipLan Americana: mesmo subitem da LC 116 (ex.: 01.05).
            </Text>
            <FormTextInput
              label="NBS"
              value={form.codNbs}
              onChangeText={(t) => patch({ codNbs: t })}
              placeholder={form.regimeTributario === 3 ? '1.1103.22.00' : '115013000'}
              maxLength={14}
            />
            <Text style={styles.sub}>
              {form.regimeTributario === 3
                ? 'Empresa 2: 1.1103.22.00 — Licenciamento de direitos de uso de software.'
                : '9 dígitos NBS (pode colar com pontos).'}
            </Text>
            <FormTextInput
              label="Descrição do serviço"
              value={form.descricao}
              onChangeText={(t) => patch({ descricao: t })}
            />
          </Card>

          <Card style={styles.card}>
            <Text style={styles.h}>6. Reforma tributária — IBS / CBS</Text>
            <Text style={styles.sub}>
              Campos exigidos na NFS-e (ADN/DPS) a partir da reforma. Valores de teste 2026:
              IBS-UF 0,10% · IBS-Mun 0% · CBS 0,90%.
            </Text>
            <FormTextInput
              label="IndOp (indicador da operação)"
              value={form.indOp}
              onChangeText={(t) => patch({ indOp: t.replace(/\D/g, '').slice(0, 10) })}
              keyboardType="number-pad"
              placeholder="100501"
            />
            <FormTextInput
              label="CST IBS/CBS"
              value={form.cstIbsCbs}
              onChangeText={(t) => patch({ cstIbsCbs: t.replace(/\D/g, '').slice(0, 3) })}
              keyboardType="number-pad"
              placeholder="000"
            />
            <Text style={styles.lockedHint}>000 — Tributação integral</Text>
            <FormTextInput
              label="cClassTrib"
              value={form.cClassTrib}
              onChangeText={(t) => patch({ cClassTrib: t.replace(/\D/g, '').slice(0, 6) })}
              keyboardType="number-pad"
              placeholder="000001"
            />
            <Text style={styles.lockedHint}>
              000001 — Situações tributadas integralmente pelo IBS e CBS
            </Text>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <FormTextInput
                  label="Alíquota IBS — UF (%)"
                  value={form.aliquotaIbsUf}
                  onChangeText={(t) => patch({ aliquotaIbsUf: t })}
                  keyboardType="decimal-pad"
                  placeholder="0.10"
                />
              </View>
              <View style={{ flex: 1 }}>
                <FormTextInput
                  label="Alíquota IBS — Município (%)"
                  value={form.aliquotaIbsMun}
                  onChangeText={(t) => patch({ aliquotaIbsMun: t })}
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
              </View>
              <View style={{ flex: 1 }}>
                <FormTextInput
                  label="Alíquota CBS (%)"
                  value={form.aliquotaCbs}
                  onChangeText={(t) => patch({ aliquotaCbs: t })}
                  keyboardType="decimal-pad"
                  placeholder="0.90"
                />
              </View>
            </View>
          </Card>

          <PrimaryButton title="Salvar este emitente" onPress={() => void salvarTudo()} loading={busy} />
        </>
      )}
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
  sectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.petroleum,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  lockedHint: {
    fontSize: 11,
    color: colors.gray600,
    marginTop: 4,
    lineHeight: 16,
  },
  lockedBox: {
    backgroundColor: colors.infoSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.petroleum + '22',
  },
  lockedTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.petroleum,
    marginBottom: 4,
  },
  lockedValue: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.petroleum,
  },
  sub: { fontSize: 12, color: colors.gray600, marginBottom: spacing.md, lineHeight: 17 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  tab: {
    flexGrow: 1,
    minWidth: '45%',
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    padding: spacing.sm,
    backgroundColor: colors.white,
  },
  tabOn: { borderColor: colors.orange, backgroundColor: 'rgba(232, 106, 36, 0.08)' },
  tabTxt: { fontSize: 14, fontWeight: '700', color: colors.petroleum },
  tabTxtOn: { color: colors.petroleum },
  tabSub: { fontSize: 11, color: colors.gray600, marginTop: 2 },
  regimeBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  regimeBadgeSimples: { backgroundColor: colors.successSoft },
  regimeBadgeNormal: { backgroundColor: colors.infoSoft },
  regimeBadgeTxt: { fontSize: 10, fontWeight: '800' },
  regimeBadgeTxtSimples: { color: colors.success },
  regimeBadgeTxtNormal: { color: colors.petroleum },
  tabActions: { gap: spacing.sm, marginTop: spacing.sm },
  checkRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginBottom: spacing.sm },
  checkLabel: { fontSize: 13, color: colors.gray800, lineHeight: 18 },
  checkLabelOk: { color: colors.gray600 },
  checkHint: { fontSize: 11, color: colors.gray600, marginTop: 2 },
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
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#e3f2fd',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  mono: { fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, fontSize: 11 },
  convenioBox: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
  },
  convenioOk: { backgroundColor: '#e8f5e9', borderColor: '#a5d6a7' },
  convenioWarn: { backgroundColor: '#fff3e0', borderColor: '#ffcc80' },
  convenioTxt: { fontSize: 12, color: colors.gray800, lineHeight: 17 },
});
