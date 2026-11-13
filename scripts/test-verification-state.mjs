import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificationStatus } from '../src/login/verification.js';
test('verification labels distinguish unverified, shared levels and a private level', () => {
  assert.equal(verificationStatus({}).label, 'Not verified');
  assert.equal(verificationStatus({ kyc_level: 'L2' }).label, 'Not verified');
  assert.equal(
    verificationStatus({ verified_human: true, kyc_level: 'L1' }).label,
    'L1 verified'
  );
  assert.equal(
    verificationStatus({ verified_human: true, kyc_level: 'L2' }).label,
    'L2 verified'
  );
  assert.equal(
    verificationStatus({ verified_human: true }).label,
    'Verified human · Level not shared'
  );
  assert.equal(
    verificationStatus({ verified_human: true, kyc_level: 'invented' }).label,
    'Verified human · Level not shared'
  );
});
