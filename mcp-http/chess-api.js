import { config } from './config.js';

// Thin client for chess server's /api/internal/* (service-authed) and public APIs.

const internalHeaders = () => ({
  'Content-Type': 'application/json',
  'X-Service-Auth': config.mcpServiceSecret,
});

async function postInternal(path, body) {
  const resp = await fetch(`${config.chessServerUrl}/api/internal${path}`, {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!resp.ok) {
    const err = new Error(data.error || `chess server ${path} returned ${resp.status}`);
    err.status = resp.status;
    err.body = data;
    throw err;
  }
  return data;
}

export const chessApi = {
  resolvePasskey: (passkeyAddress) =>
    postInternal('/passkey-resolve', { passkeyAddress }),

  createAgent: (parent_user_id, username) =>
    postInternal('/agent-create', { parent_user_id, username }),

  rotateAgentToken: (agent_user_id) =>
    postInternal('/agent-token', { agent_user_id }),

  // Used by the consent UI; included here for completeness — actual call happens from the UI.
  issueConsentToken: (params) =>
    postInternal('/issue-consent-token', params),

  // Game APIs — called per-tool with a specific agent's chess token.
  chessRequest: async (path, { method = 'GET', token, body } = {}) => {
    const resp = await fetch(`${config.chessServerUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!resp.ok) {
      const err = new Error(data.error || `chess server ${path} returned ${resp.status}`);
      err.status = resp.status;
      err.body = data;
      throw err;
    }
    return data;
  },
};
