/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL do servidor Colyseus (ex.: wss://host/shattered-dominion-ws). Padrão: proxy /colyseus. */
  readonly VITE_WS_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
