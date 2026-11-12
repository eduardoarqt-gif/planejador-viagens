/* Configuração da licença do Dudoo Trips (produto "trips"). Mesmas regras do Lite e do Arq (DUDOO ADM/nucleo_licenca).
   OBRIGATORIA: false = o app abre sem licença (mostra só o estado em Licença); true = sem licença válida só abre a tela de ativação.
   Para ligar a exigência: mude para true, suba a versão e publique (só depois de instalar a sua licença interna em cada aparelho). */
export const LICENCA_CFG = {
  OBRIGATORIA: false,
  PRODUTO: "trips",
  VERSAO_FORMATO: 1,
  TOLERANCIA_DIAS: 15,
  AVISO_VENCENDO_DIAS: 10,
  /* Wix: o mesmo site do Lite e do Arq. Os endpoints do Trips ainda NÃO existem (fase 4); sem eles, a ativação é por arquivo ou texto da licença. */
  URL_BASE: "https://www.eduardoschmidt.arq.br/_functions",
  ENDPOINT_RENOVACAO: "dudoo_trips_licenca",
  ENDPOINT_ATIVACAO: "dudoo_trips_ativar",
  ENDPOINTS_NO_AR: false,
  TIMEOUT_MS: 8000
};
