/** ID token verification and the allowlist. */

function clientId_() {
  // The web-app OAuth client id (Task 1 Step 2). Hardcoded rather than a
  // Script Property because the Apps Script REST API has no endpoint to set
  // script properties from outside the editor.
  return '788807437641-8e5qjroej7n22it1e8m1f095817u33sr.apps.googleusercontent.com';
}

function isAllowed_(email) {
  const t = table_('allowed_users');
  for (let i = 0; i < t.rows.length; i++) {
    const r = t.rows[i];
    if (String(r[t.index.email]).trim().toLowerCase() !== email) continue;
    const active = r[t.index.active];
    return active === true || String(active).trim().toUpperCase() === 'TRUE';
  }
  return false;
}

/**
 * Verifies a Google ID token and returns {email, name}, or throws.
 * Verified tokens are cached for 5 minutes, so a revoked user keeps
 * access for at most that long.
 */
function verifyToken_(idToken) {
  if (!idToken) throw new Error('not signed in');

  const cache = CacheService.getScriptCache();
  const key = 'tok:' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('session expired');

  const info = JSON.parse(res.getContentText());
  // aud is the check that stops a token minted for some other app being replayed here.
  if (info.aud !== clientId_()) throw new Error('token not for this app');
  if (String(info.email_verified) !== 'true') throw new Error('email not verified');
  if (Number(info.exp) * 1000 <= Date.now()) throw new Error('session expired');

  const email = String(info.email).toLowerCase();
  if (!isAllowed_(email)) throw new Error('not authorised: ' + email);

  const user = { email: email, name: info.name || '' };
  cache.put(key, JSON.stringify(user), 300);
  return user;
}
