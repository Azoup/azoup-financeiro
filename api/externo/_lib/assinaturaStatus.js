function normStatus(status) {
  return `${status ?? ''}`.trim().toLowerCase();
}

function classificarStatusAssinatura(row) {
  const s = normStatus(row?.status);
  if (!s) return 'outro';
  if (s.includes('cancel') || s.includes('encerr') || s.includes('inativ')) return 'cancelada';
  if (s.includes('trial') || s.includes('teste')) return 'trial';
  if (s.includes('inadimpl') || s.includes('vencid') || s.includes('atrasad') || s.includes('past_due')) {
    return 'inadimplente';
  }
  if (s.includes('ativo') || s.includes('ativa') || s === 'active' || s.includes('active')) {
    return 'ativa';
  }
  return 'outro';
}

function prioridadeAssinatura(row) {
  const g = classificarStatusAssinatura(row);
  if (g === 'ativa') return 100;
  if (g === 'trial') return 90;
  if (g === 'inadimplente') return 70;
  if (g === 'outro') return 50;
  return 10;
}

module.exports = {
  classificarStatusAssinatura,
  prioridadeAssinatura,
};
