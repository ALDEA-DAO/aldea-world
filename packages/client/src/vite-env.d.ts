/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_ALMA_AUTH_ISSUER?: string;
  readonly VITE_ALMA_AUTH_CLIENT_ID?: string;
  readonly VITE_ALMA_API_URL?: string;
  readonly VITE_TURNKEY_API_URL?: string;
  readonly VITE_AA_MODE?: "smart" | "eoa";
  readonly VITE_EFFECTSTREAM_API_URL?: string;
  readonly VITE_EFFECTSTREAM_MQTT_URL?: string;
  readonly VITE_MUD_INDEXER_URL?: string;
  readonly VITE_BUILD_GIT_COMMIT?: string;
  readonly VITE_BUILD_SEMVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
