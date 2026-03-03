import { useCallback } from 'react';
import { encodeFunctionData } from 'viem';
import { formatMoves } from './usePublishGame';
import { chessLedgerAbi, CHESS_LEDGER_ADDRESS } from '../contracts/chessLedgerAbi';
import { PASSKEY_SERVER_URL } from '../config';

// --- Helpers (ported from demo.html) ---

function bufToHex(buf) {
  return '0x' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  hex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function parseDERSignature(signatureBytes) {
  const sig = new Uint8Array(signatureBytes);
  let offset = 0;

  if (sig[offset++] !== 0x30) throw new Error('Invalid DER: missing SEQUENCE tag');
  let totalLen = sig[offset++];
  if (totalLen & 0x80) {
    const numLenBytes = totalLen & 0x7f;
    offset += numLenBytes;
  }

  // R
  if (sig[offset++] !== 0x02) throw new Error('Invalid DER: missing INTEGER tag for r');
  const rLen = sig[offset++];
  let rBytes = sig.slice(offset, offset + rLen);
  offset += rLen;
  while (rBytes.length > 32 && rBytes[0] === 0x00) rBytes = rBytes.slice(1);
  if (rBytes.length < 32) {
    const padded = new Uint8Array(32);
    padded.set(rBytes, 32 - rBytes.length);
    rBytes = padded;
  }

  // S
  if (sig[offset++] !== 0x02) throw new Error('Invalid DER: missing INTEGER tag for s');
  const sLen = sig[offset++];
  let sBytes = sig.slice(offset, offset + sLen);
  while (sBytes.length > 32 && sBytes[0] === 0x00) sBytes = sBytes.slice(1);
  if (sBytes.length < 32) {
    const padded = new Uint8Array(32);
    padded.set(sBytes, 32 - sBytes.length);
    sBytes = padded;
  }

  return { r: bufToHex(rBytes), s: bufToHex(sBytes) };
}

// --- Hook ---

export function usePasskeyPublish({ account, credentialId, rawId }) {
  const publishGame = useCallback(async (game) => {
    if (!account || !rawId) {
      return { published: false, reason: 'passkey-not-authenticated' };
    }
    if (!CHESS_LEDGER_ADDRESS) {
      return { published: false, reason: 'no-contract-address' };
    }

    try {
      // 1. Encode ChessLedger.publishGame calldata
      const movesString = formatMoves(game.moveHistory || []);
      const calldata = encodeFunctionData({
        abi: chessLedgerAbi,
        functionName: 'publishGame',
        args: [game.id, game.result, movesString, game.engineColor],
      });

      // 2. Get challenge from server
      const challengeResp = await fetch(`${PASSKEY_SERVER_URL}/api/get-challenge-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyAddr: account,
          target: CHESS_LEDGER_ADDRESS,
          value: '0',
          data: calldata,
        }),
      });
      const challengeData = await challengeResp.json();
      if (!challengeResp.ok) throw new Error(challengeData.error || 'Failed to get challenge');

      const challengeBytes = hexToBytes(challengeData.challenge);

      // 3. Sign with passkey (raw challenge bytes — NOT base64)
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: challengeBytes,
          rpId: location.hostname,
          allowCredentials: [{ type: 'public-key', id: rawId }],
          userVerification: 'preferred',
          timeout: 60000,
        },
      });

      // 4. Extract signature fields
      const authenticatorData = bufToHex(assertion.response.authenticatorData);
      const clientDataJSON = new TextDecoder().decode(assertion.response.clientDataJSON);
      const { r, s } = parseDERSignature(new Uint8Array(assertion.response.signature));
      const typeIndex = clientDataJSON.indexOf('"type":"webauthn.get"');
      const challengeIndex = clientDataJSON.indexOf('"challenge":"');

      // 5. Submit signed transaction
      const submitResp = await fetch(`${PASSKEY_SERVER_URL}/api/submit-execution-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyAddr: account,
          target: CHESS_LEDGER_ADDRESS,
          value: '0',
          data: calldata,
          auth: { authenticatorData, clientDataJSON, challengeIndex, typeIndex, r, s },
        }),
      });
      const txData = await submitResp.json();
      if (!submitResp.ok) throw new Error(txData.error || 'Failed to submit transaction');

      return { published: true, txHash: txData.txHash };
    } catch (err) {
      console.error('Passkey publish failed:', err);
      return { published: false, reason: 'tx-failed', error: err };
    }
  }, [account, credentialId, rawId]);

  return { publishGame };
}
