/**
 * Redireciona chamadas axios da nfewizard (SEFIN nacional) para API municipal.
 * Funciona em runtime na Vercel — não depende de patch em node_modules.
 */
async function installMunicipalAxiosRedirect(wizard, urlOverrides) {
  if (!wizard || !urlOverrides) {
    return () => undefined;
  }

  await wizard.loadEnvironmentPromise;
  const axios = wizard.axios;
  if (!axios?.interceptors?.request) {
    return () => undefined;
  }

  const id = axios.interceptors.request.use((config) => {
    const url = String(config.url ?? '');
    if (!/sefin\.(producaorestrita\.)?nfse\.gov\.br/i.test(url)) {
      return config;
    }

    const body = config.data;
    if (!body || typeof body !== 'object') {
      return config;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'dpsXmlGZipB64') && urlOverrides.NFSe_Autorizacao) {
      config.url = urlOverrides.NFSe_Autorizacao;
      return config;
    }

    if (
      Object.prototype.hasOwnProperty.call(body, 'pedidoRegistroEventoXmlGZipB64') &&
      urlOverrides.NFSe_Eventos
    ) {
      config.url = urlOverrides.NFSe_Eventos;
      return config;
    }

    return config;
  });

  return () => {
    try {
      axios.interceptors.request.eject(id);
    } catch {
      /* ignore */
    }
  };
}

module.exports = { installMunicipalAxiosRedirect };
