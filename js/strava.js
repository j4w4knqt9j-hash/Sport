// Accès à l'API Strava (OAuth + récupération des activités), directement depuis le navigateur.
// L'ID et le secret de l'application restent sur l'appareil (localStorage), jamais dans le code.

const API = 'https://www.strava.com/api/v3';
const OAUTH = 'https://www.strava.com/oauth';
const KEY = 'trisuivi.auth';

export function redirectUri() {
  return location.origin + location.pathname;
}

export function getAuth() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}

function saveAuth(auth) {
  localStorage.setItem(KEY, JSON.stringify(auth));
}

export function setCredentials(clientId, clientSecret) {
  saveAuth({ ...getAuth(), clientId: clientId.trim(), clientSecret: clientSecret.trim() });
}

export function isConnected() {
  return Boolean(getAuth().refreshToken);
}

export function logout() {
  const { clientId, clientSecret } = getAuth();
  saveAuth({ clientId, clientSecret });
}

export function authorizeUrl() {
  const { clientId } = getAuth();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
  });
  return `${OAUTH}/authorize?${params}`;
}

async function tokenRequest(params) {
  const { clientId, clientSecret } = getAuth();
  const res = await fetch(`${OAUTH}/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
  });
  if (!res.ok) throw new Error(`Échec de l'authentification Strava (${res.status})`);
  const data = await res.json();
  const auth = {
    ...getAuth(),
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
  };
  if (data.athlete) auth.athlete = { firstname: data.athlete.firstname, lastname: data.athlete.lastname };
  saveAuth(auth);
  return auth;
}

export function exchangeCode(code) {
  return tokenRequest({ code, grant_type: 'authorization_code' });
}

async function accessToken() {
  let auth = getAuth();
  if (!auth.refreshToken) throw new Error('Non connecté à Strava');
  // le jeton d'accès dure 6 h, on le renouvelle une minute avant
  if (!auth.accessToken || auth.expiresAt - 60 < Date.now() / 1000) {
    auth = await tokenRequest({ refresh_token: auth.refreshToken, grant_type: 'refresh_token' });
  }
  return auth.accessToken;
}

// Détail des séries (laps) d'une activité : [[distance, temps en mouvement], ...]
export async function fetchLaps(id) {
  const token = await accessToken();
  const res = await fetch(`${API}/activities/${id}/laps`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Erreur Strava (${res.status})`);
  const laps = await res.json();
  return laps.map(l => [l.distance || 0, l.moving_time || 0]);
}

// Récupère toutes les activités postérieures à `after` (timestamp Unix), page par page
export async function fetchActivities(after = 0, onPage = () => {}) {
  const token = await accessToken();
  const all = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ per_page: 200, page, after });
    const res = await fetch(`${API}/athlete/activities?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) throw new Error('Limite de requêtes Strava atteinte, réessaie dans 15 min');
    if (res.status === 401) throw new Error('Accès refusé par Strava, reconnecte-toi');
    if (!res.ok) throw new Error(`Erreur Strava (${res.status})`);
    const batch = await res.json();
    all.push(...batch);
    onPage(all.length);
    if (batch.length < 200) break;
  }
  return all;
}
