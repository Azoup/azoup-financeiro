const {
  buildC6Payload,
  cleanupTemp,
  consultarBoletoC6Api,
  criarPixCobvC6Api,
  emitirBoletoC6Api,
  obterPdfBoletoC6Api,
} = require('./c6Client');
const { loadC6Credentials } = require('./c6Credentials');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function resolveClienteId(admin, boleto) {
  if (boleto.mensalidade_id) {
    const { data } = await admin.from('mensalidades').select('cliente_id').eq('id', boleto.mensalidade_id).maybeSingle();
    return data?.cliente_id ?? null;
  }
  if (boleto.venda_id) {
    const { data } = await admin.from('vendas').select('cliente_id').eq('id', boleto.venda_id).maybeSingle();
    return data?.cliente_id ?? null;
  }
  return null;
}

async function baixarESalvarPdfC6(admin, userId, boletoId, creds, c6Id, consultaRaw) {
  let pdfBuffer = null;

  const b64 =
    consultaRaw?.base64_pdf_file ??
    consultaRaw?.pdf_base64 ??
    consultaRaw?.pdf ??
    null;
  if (typeof b64 === 'string' && b64.length > 100) {
    pdfBuffer = Buffer.from(b64, 'base64');
  }

  if (!pdfBuffer) {
    let lastErr = null;
    for (let i = 0; i < 4; i += 1) {
      try {
        if (i > 0) await sleep(1500 * i);
        pdfBuffer = await obterPdfBoletoC6Api({
          config: creds.config,
          certPath: creds.certPath,
          keyPath: creds.keyPath,
          c6BoletoId: c6Id,
        });
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!pdfBuffer && lastErr) {
      // PDF pode demorar no CIP; linha digitável ainda valida o boleto
      console.warn('[c6] PDF ainda indisponível:', lastErr.message);
    }
  }

  if (!pdfBuffer?.length) return { pdfStoragePath: null, pdfUrl: null };

  const pdfStoragePath = `${userId}/boletos/${boletoId}.pdf`;
  const { error: upErr } = await admin.storage
    .from('boletos_c6')
    .upload(pdfStoragePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
  if (upErr) {
    console.warn('[c6] upload PDF:', upErr.message);
    return { pdfStoragePath: null, pdfUrl: null };
  }
  const { data: signed } = await admin.storage
    .from('boletos_c6')
    .createSignedUrl(pdfStoragePath, 60 * 60 * 24 * 30);
  return { pdfStoragePath, pdfUrl: signed?.signedUrl ?? null };
}

async function emitirUmBoletoC6(admin, userId, boletoId, emitenteIdHint) {
  const { data: boleto, error: bErr } = await admin
    .from('boletos_parcela_venda')
    .select('*')
    .eq('id', boletoId)
    .eq('user_id', userId)
    .single();
  if (bErr || !boleto) throw new Error('Boleto não encontrado.');

  if (
    boleto.status_registro === 'registrado' &&
    boleto.tipo_emissao === 'c6' &&
    boleto.c6_boleto_id &&
    (boleto.linha_digitavel || boleto.pdf_url)
  ) {
    return {
      success: true,
      boletoId,
      status_registro: 'registrado',
      linha_digitavel: boleto.linha_digitavel,
      codigo_barras: boleto.codigo_barras,
      nosso_numero_banco: boleto.nosso_numero_banco,
      c6_boleto_id: boleto.c6_boleto_id,
      pdf_url: boleto.pdf_url,
      message: 'Boleto já registrado no C6.',
    };
  }

  const emitenteId = emitenteIdHint || boleto.emitente_id;
  if (!emitenteId) {
    throw new Error('Emitente (CNPJ) não informado para emissão C6.');
  }

  const creds = await loadC6Credentials(admin, userId, emitenteId);

  const clienteId = await resolveClienteId(admin, boleto);
  if (!clienteId) throw new Error('Não foi possível identificar o cliente do boleto.');

  const { data: cliente, error: cliErr } = await admin.from('clientes').select('*').eq('id', clienteId).single();
  if (cliErr || !cliente) throw new Error(cliErr?.message ?? 'Cliente não encontrado.');

  await admin
    .from('boletos_parcela_venda')
    .update({
      tipo_emissao: 'c6',
      emitente_id: emitenteId,
      status_registro: 'pendente',
      mensagem_erro_registro: null,
    })
    .eq('id', boletoId);

  try {
    let c6;
    let payload;

    // Reconsulta se já tiver ID C6 sem linha/PDF
    if (boleto.c6_boleto_id && boleto.tipo_emissao === 'c6') {
      const consulta = await consultarBoletoC6Api({
        config: creds.config,
        certPath: creds.certPath,
        keyPath: creds.keyPath,
        c6BoletoId: boleto.c6_boleto_id,
      });
      const raw = consulta.resultado ?? {};
      c6 = {
        id: boleto.c6_boleto_id,
        linha_digitavel: raw.digitable_line ?? raw.linha_digitavel ?? boleto.linha_digitavel,
        codigo_barras: raw.bar_code ?? raw.barcode ?? boleto.codigo_barras,
        nosso_numero_banco:
          raw.our_number != null ? String(raw.our_number) : boleto.nosso_numero_banco,
        raw,
      };
      payload = { external_reference_id: boleto.c6_external_id };
    } else {
      payload = buildC6Payload({ boleto, config: creds.config, cliente });
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          if (attempt > 0) await sleep(2000 * attempt);
          c6 = await emitirBoletoC6Api({
            config: creds.config,
            certPath: creds.certPath,
            keyPath: creds.keyPath,
            payload,
          });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          const msg = String(e.message || '');
          // CIP / transitório
          if (!/400|422|timeout|ECONN|tempor|CIP|pending|process/i.test(msg) && attempt > 0) {
            break;
          }
        }
      }
      if (lastErr) throw lastErr;
    }

    if (!c6?.id) {
      throw new Error('C6 não retornou o ID do boleto registrado.');
    }

    // Enriquece linha digitável via consulta se a emissão não trouxe
    let consultaRaw = c6.raw;
    if (!c6.linha_digitavel || !c6.codigo_barras) {
      try {
        await sleep(1200);
        const consulta = await consultarBoletoC6Api({
          config: creds.config,
          certPath: creds.certPath,
          keyPath: creds.keyPath,
          c6BoletoId: c6.id,
        });
        consultaRaw = consulta.resultado ?? consultaRaw;
        c6.linha_digitavel =
          c6.linha_digitavel ||
          consultaRaw?.digitable_line ||
          consultaRaw?.linha_digitavel ||
          null;
        c6.codigo_barras =
          c6.codigo_barras || consultaRaw?.bar_code || consultaRaw?.barcode || null;
        if (consultaRaw?.our_number != null) {
          c6.nosso_numero_banco = String(consultaRaw.our_number);
        }
      } catch {
        /* mantém o que veio na emissão */
      }
    }

    const { pdfStoragePath, pdfUrl } = await baixarESalvarPdfC6(
      admin,
      userId,
      boletoId,
      creds,
      c6.id,
      consultaRaw,
    );

    if (!c6.linha_digitavel && !pdfUrl) {
      throw new Error(
        'C6 registrou o boleto, mas ainda sem linha digitável/PDF. Aguarde e use “Registrar no C6” novamente.',
      );
    }

    const updateRow = {
      tipo_emissao: 'c6',
      emitente_id: emitenteId,
      status_registro: 'registrado',
      linha_digitavel: c6.linha_digitavel,
      codigo_barras: c6.codigo_barras,
      nosso_numero_banco: c6.nosso_numero_banco,
      c6_boleto_id: c6.id,
      c6_external_id: payload.external_reference_id ?? boleto.c6_external_id,
      pdf_storage_path: pdfStoragePath,
      pdf_url: pdfUrl,
      data_registro: new Date().toISOString(),
      mensagem_erro_registro: null,
    };

    // PIX com vencimento (cobv) — cliente paga boleto OU Pix
    let pixInfo = null;
    try {
      const pix = await criarPixCobvC6Api({
        config: creds.config,
        certPath: creds.certPath,
        keyPath: creds.keyPath,
        valor: boleto.valor_documento,
        dataVencimento: boleto.data_vencimento,
        cliente,
        solicitacao: `Doc ${boleto.numero_documento || boletoId}`.slice(0, 140),
        txid: undefined,
      });
      pixInfo = {
        pix_txid: pix.txid,
        pix_copia_cola: pix.pixCopiaECola || pix.pix_copia_cola || null,
        pix_location: pix.loc?.location || pix.location || null,
        pix_status: pix.status || 'ATIVA',
        pix_criado_em: new Date().toISOString(),
      };
      Object.assign(updateRow, pixInfo);
    } catch (pixErr) {
      console.warn('[c6] Pix cobv não gerado:', pixErr.message);
    }

    await admin.from('boletos_parcela_venda').update(updateRow).eq('id', boletoId);
    await admin.from('historico_boleto_sicoob').insert({
      boleto_id: boletoId,
      acao: 'EMISSAO',
      usuario_id: userId,
      detalhes: pixInfo
        ? 'Boleto C6 + Pix (cobv) registrados.'
        : 'Boleto registrado via API C6 Bank (boleto real).',
      payload_resposta: c6.raw ?? null,
    });

    return {
      success: true,
      boletoId,
      status_registro: 'registrado',
      linha_digitavel: c6.linha_digitavel,
      codigo_barras: c6.codigo_barras,
      nosso_numero_banco: c6.nosso_numero_banco,
      c6_boleto_id: c6.id,
      pdf_url: pdfUrl,
      pix_txid: pixInfo?.pix_txid ?? null,
      pix_copia_cola: pixInfo?.pix_copia_cola ?? null,
      message: pixInfo
        ? 'Boleto e Pix C6 registrados.'
        : 'Boleto real registrado no C6.',
    };
  } catch (error) {
    const msg = error?.message ?? 'Falha na emissão C6.';
    await admin
      .from('boletos_parcela_venda')
      .update({
        tipo_emissao: 'c6',
        emitente_id: emitenteId,
        status_registro: 'erro',
        mensagem_erro_registro: msg,
      })
      .eq('id', boletoId);
    await admin.from('historico_boleto_sicoob').insert({
      boleto_id: boletoId,
      acao: 'ERRO',
      usuario_id: userId,
      detalhes: `[C6] ${msg}`,
    });
    throw new Error(msg);
  } finally {
    if (!creds.bundled) {
      cleanupTemp(creds.certPath);
      cleanupTemp(creds.keyPath);
    }
  }
}

module.exports = { emitirUmBoletoC6 };
