const crypto = require('crypto');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function hmacSha256Hex(input, key) {
  return crypto.createHmac('sha256', String(key)).update(String(input)).digest('hex');
}

function normalizeChecks(inputChecks) {
  const checks = Array.isArray(inputChecks) ? inputChecks : [];
  return checks.map((check, index) => ({
    index,
    name: String(check?.name || `check-${index + 1}`).slice(0, 120),
    ok: !!check?.ok,
    statusCode: check?.statusCode == null ? null : Number(check.statusCode),
    latencyMs: check?.latencyMs == null ? null : Number(check.latencyMs),
    message: String(check?.message || '').slice(0, 1000)
  }));
}

function summarizeChecks(checks, durationMs = 0) {
  const failed = checks.filter((check) => !check.ok).length;
  return {
    status: failed === 0 ? 'pass' : 'fail',
    total: checks.length,
    failed,
    durationMs: Number(durationMs || 0)
  };
}

function buildVerificationPayload({ runId, workspaceId, userId, createdAt, summary, checks, source = 'manual', version = 2 }) {
  return {
    version,
    runId,
    workspaceId: workspaceId || null,
    userId: userId || null,
    createdAt,
    source,
    summary: summary || { status: 'unknown', total: 0, failed: 0, durationMs: 0 },
    checks: Array.isArray(checks) ? checks : []
  };
}

function computeEvidence(verificationPayload, { prevChainHash = null, signingKey = '', signingKeyVersion = null } = {}) {
  const payloadString = stableStringify(verificationPayload);
  const verifyHash = sha256Hex(payloadString);
  const chainHash = sha256Hex(`${prevChainHash || ''}:${verifyHash}`);
  const signature = signingKey ? hmacSha256Hex(chainHash, signingKey) : null;
  const keyVersion = signingKey ? (String(signingKeyVersion || '').trim() || 'v1') : null;

  return {
    verifyHash,
    prevChainHash: prevChainHash || null,
    chainHash,
    signature,
    keyVersion,
    algorithm: 'sha256',
    signatureAlgorithm: signingKey ? 'hmac-sha256' : null
  };
}

function buildVerificationState(details, { prevChainHash = null, signingKey = '', signingKeyVersion = null } = {}) {
  const payload = buildVerificationPayload({
    runId: details?.runId,
    workspaceId: details?.workspaceId,
    userId: details?.userId,
    createdAt: details?.createdAt,
    summary: details?.summary,
    checks: details?.checks,
    source: details?.source || 'manual',
    version: Number(details?.version || 1)
  });

  const computed = computeEvidence(payload, { prevChainHash, signingKey, signingKeyVersion });
  const storedEvidence = details?.evidence || {};
  const storedVerifyHash = details?.verifyHash || storedEvidence.verifyHash || null;
  const storedChainHash = storedEvidence.chainHash || null;
  const storedPrevChainHash = storedEvidence.prevChainHash || prevChainHash || null;
  const storedSignature = storedEvidence.signature || null;
  const storedKeyVersion = storedEvidence.keyVersion || null;

  const backfilled = !storedEvidence.chainHash || !storedVerifyHash;
  const signatureMatches = storedSignature ? (signingKey ? storedSignature === computed.signature : null) : null;
  const keyVersionMatches = storedSignature
    ? (storedKeyVersion ? storedKeyVersion === computed.keyVersion : true)
    : null;

  return {
    payload,
    evidence: {
      verifyHash: storedVerifyHash || computed.verifyHash,
      prevChainHash: storedPrevChainHash,
      chainHash: storedChainHash || computed.chainHash,
      signature: storedSignature,
      keyVersion: storedKeyVersion || computed.keyVersion,
      algorithm: storedEvidence.algorithm || computed.algorithm,
      signatureAlgorithm: storedEvidence.signatureAlgorithm || computed.signatureAlgorithm,
      backfilled,
      hashValid: storedVerifyHash ? storedVerifyHash === computed.verifyHash : true,
      chainValid: storedChainHash ? storedChainHash === computed.chainHash : true,
      signatureValid: storedSignature
        ? (signatureMatches == null ? null : Boolean(signatureMatches && keyVersionMatches))
        : null
    }
  };
}

module.exports = {
  normalizeChecks,
  summarizeChecks,
  buildVerificationPayload,
  computeEvidence,
  buildVerificationState
};