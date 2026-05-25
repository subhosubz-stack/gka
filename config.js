(function () {
  const { protocol, hostname, port } = window.location;
  const isLocal = hostname === '127.0.0.1' || hostname === 'localhost';
  const isSeparateStaticServer =
    port === '5500' ||
    port === '5173' ||
    (isLocal && port !== '3000' && port !== '5000' && port !== '');

  // Local dev: Express serves HTML + API on one port (default 3000)
  const devApiPort = '3000';
  let API_BASE_URL = '/api';

  if (isSeparateStaticServer) {
    API_BASE_URL = `${protocol}//${hostname}:${devApiPort}/api`;
  } else if (isLocal && port === '5000') {
    // .env often has PORT=5000 but dev server may run on 3000 — prefer 3000 API
    API_BASE_URL = `${protocol}//${hostname}:${devApiPort}/api`;
  }

  window.GKA_CONFIG = { API_BASE_URL, DEV_API_PORT: devApiPort };
})();

if (typeof console !== 'undefined') {
  console.log('GKA API_BASE_URL:', window.GKA_CONFIG?.API_BASE_URL);
}
