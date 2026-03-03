import { useState, useEffect, useCallback } from 'react';
import { PASSKEY_SERVER_URL } from '../config';
const LS_KEYS = {
  credentialId: 'passkey_credentialId',
  rawId: 'passkey_rawId',
  account: 'passkey_account',
};

function bufToHex(buf) {
  return '0x' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function base64urlEncode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function usePasskeyAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [account, setAccount] = useState(null);
  const [username, setUsername] = useState(null);
  const [credentialId, setCredentialId] = useState(null);
  const [rawId, setRawId] = useState(null);

  // Restore session from localStorage on mount
  useEffect(() => {
    const storedCredId = localStorage.getItem(LS_KEYS.credentialId);
    const storedRawId = localStorage.getItem(LS_KEYS.rawId);
    const storedAccount = localStorage.getItem(LS_KEYS.account);
    if (storedCredId && storedRawId && storedAccount) {
      const parsed = JSON.parse(storedAccount);
      setCredentialId(storedCredId);
      setRawId(base64urlDecode(storedRawId));
      setAccount(parsed.address);
      setUsername(parsed.username);
      setIsAuthenticated(true);
    }
  }, []);

  const persistSession = useCallback((credId, rawIdBuf, address, user) => {
    localStorage.setItem(LS_KEYS.credentialId, credId);
    localStorage.setItem(LS_KEYS.rawId, base64urlEncode(rawIdBuf));
    localStorage.setItem(LS_KEYS.account, JSON.stringify({ address, username: user }));
    setCredentialId(credId);
    setRawId(rawIdBuf);
    setAccount(address);
    setUsername(user);
    setIsAuthenticated(true);
  }, []);

  const signup = useCallback(async (name) => {
    if (!name || !name.trim()) throw new Error('Username required');
    const trimmed = name.trim();

    // 1. Create passkey credential
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credential = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Login.com Smart Account', id: location.hostname },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: trimmed,
          displayName: trimmed,
        },
        challenge,
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 = P-256
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'preferred',
        },
        timeout: 60000,
      },
    });

    // 2. Extract public key (X, Y)
    const publicKeyBytes = new Uint8Array(credential.response.getPublicKey());
    let rawKey;
    if (publicKeyBytes.length === 65 && publicKeyBytes[0] === 0x04) {
      rawKey = publicKeyBytes;
    } else {
      const spkiOffset = publicKeyBytes.length - 65;
      rawKey = publicKeyBytes.slice(spkiOffset);
    }
    if (rawKey[0] !== 0x04) throw new Error('Expected uncompressed public key (0x04 prefix)');

    const pubKeyX = bufToHex(rawKey.slice(1, 33));
    const pubKeyY = bufToHex(rawKey.slice(33, 65));
    const credId = base64urlEncode(credential.rawId);

    // 3. Register on server (deploys smart account)
    const resp = await fetch(`${PASSKEY_SERVER_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialId: credId, pubKeyX, pubKeyY, username: trimmed }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Registration failed');

    // 4. Persist session
    persistSession(credId, credential.rawId, data.address, trimmed);
    return { address: data.address, txHash: data.txHash };
  }, [persistSession]);

  const login = useCallback(async () => {
    // 1. Discoverable credential assertion
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: location.hostname,
        allowCredentials: [],
        userVerification: 'preferred',
        timeout: 60000,
      },
    });

    const credId = base64urlEncode(assertion.rawId);

    // 2. Look up account on server
    const resp = await fetch(`${PASSKEY_SERVER_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialId: credId }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Login failed');

    // 3. Persist session
    persistSession(credId, assertion.rawId, data.accountAddress, data.username);
    return { address: data.accountAddress, username: data.username };
  }, [persistSession]);

  const logout = useCallback(() => {
    localStorage.removeItem(LS_KEYS.credentialId);
    localStorage.removeItem(LS_KEYS.rawId);
    localStorage.removeItem(LS_KEYS.account);
    setCredentialId(null);
    setRawId(null);
    setAccount(null);
    setUsername(null);
    setIsAuthenticated(false);
  }, []);

  return { isAuthenticated, account, username, credentialId, rawId, signup, login, logout };
}
