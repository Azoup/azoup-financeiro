export const TEXTO_PENDENCIA_ATE_12 = [
  'Olá! Tudo bem? 😊',
  '',
  'Identificamos que há um boleto pendente referente aos serviços da Azoup.',
  '',
  'Pedimos, por gentileza, que verifique a pendência e, caso o pagamento já tenha sido realizado, desconsidere esta mensagem.',
  '',
  'Se precisar de uma segunda via ou tiver alguma dúvida, entre em contato com nosso atendimento pelo WhatsApp: (19) 98111-1724 ou e-mail financeiro@azoup.com.br',
  '',
  'Agradecemos pela atenção e parceria!',
  '',
  'Equipe Azoup Tecnologia',
].join('\n');

export const TEXTO_PENDENCIA_13 = [
  'Olá! Tudo bem? 😊',
  '',
  'Identificamos que há um boleto pendente referente aos serviços da Azoup.',
  '',
  'Pedimos que regularize o pagamento em até 3 dias, para evitar o bloqueio do acesso ao sistema por falta de pagamento.',
  '',
  'Caso o pagamento já tenha sido realizado, por favor, desconsidere esta mensagem.',
  '',
  'Se precisar de uma segunda via, tiver dúvidas sobre o boleto ou necessitar de auxílio para regularização, entre em contato conosco pelo WhatsApp: (19) 98111-1724 ou e-mail: financeiro@azoup.com.br',
  '',
  'Contamos com sua colaboração para evitar qualquer interrupção na utilização do sistema.',
  '',
  'Equipe Azoup Tecnologia',
].join('\n');

export function diasEmAbertoBoleto(dataVencimento: string | null | undefined): number {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const venc = String(dataVencimento || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venc) || !/^\d{4}-\d{2}-\d{2}$/.test(hoje)) return 0;
  const [yh, mh, dh] = hoje.split('-').map((n) => Number(n));
  const [yv, mv, dv] = venc.split('-').map((n) => Number(n));
  const diff = Math.round((Date.UTC(yh, mh - 1, dh) - Date.UTC(yv, mv - 1, dv)) / 86400000);
  return diff > 0 ? diff : 0;
}

/** Mesmo texto do e-mail de pendência: até 12 dias um, a partir de 13 outro. */
export function mensagemPendenciaBoleto(dataVencimento: string | null | undefined): string {
  return diasEmAbertoBoleto(dataVencimento) >= 13 ? TEXTO_PENDENCIA_13 : TEXTO_PENDENCIA_ATE_12;
}
