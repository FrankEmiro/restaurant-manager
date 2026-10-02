const { getSetting, setSetting } = require('./security');

// Valore effettivo: variabile d'ambiente se presente, altrimenti impostazione salvata nel database.
const ENV_KEYS = new Set(['VAPI_API_KEY', 'PUBLIC_URL', 'VAPI_BASE_URL']);

function get(key, fallback = '') {
  if (ENV_KEYS.has(key) && process.env[key]) return process.env[key];
  const v = getSetting(key);
  return v == null || v === '' ? fallback : v;
}
function set(key, value) { setSetting(key, value ?? ''); }

module.exports = { get, set };
