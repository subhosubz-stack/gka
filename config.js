(function () {
  const { protocol, hostname, port } = window.location;
  const isSeparateStaticServer =
    port === '5500' ||
    port === '5173' ||
    (hostname === '127.0.0.1' && port !== '3000' && port !== '5000' && port !== '');

  const apiPort = '3000';
  const API_BASE_URL = isSeparateStaticServer
    ? `${protocol}//${hostname}:${apiPort}/api`
    : '/api';

  window.GKA_CONFIG = { API_BASE_URL };
})();

if (typeof console !== 'undefined') {
  console.log('GKA API_BASE_URL:', window.GKA_CONFIG?.API_BASE_URL);
}
