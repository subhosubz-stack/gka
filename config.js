(function () {
  const { protocol, hostname, port } = window.location;
  const isLocal = hostname === '127.0.0.1' || hostname === 'localhost';
  const isHosted =
    hostname.endsWith('.vercel.app') ||
    hostname.endsWith('.netlify.app') ||
    (protocol === 'https:' && !isLocal);
  const isSeparateStaticServer =
    !isHosted &&
    (port === '5500' ||
      port === '5173' ||
      (isLocal && port !== '3000' && port !== '5000' && port !== ''));

  // Local dev: Express serves HTML + API on one port (default 3000)
  const devApiPort = '3000';
  let API_BASE_URL = '/api';

  if (isSeparateStaticServer) {
    API_BASE_URL = `${protocol}//${hostname}:${devApiPort}/api`;
  } else if (isLocal && port === '5000') {
    API_BASE_URL = `${protocol}//${hostname}:${devApiPort}/api`;
  }

  window.GKA_CONFIG = { API_BASE_URL, DEV_API_PORT: devApiPort };
})();

if (typeof console !== 'undefined') {
  console.log('GKA API_BASE_URL:', window.GKA_CONFIG?.API_BASE_URL);
}
