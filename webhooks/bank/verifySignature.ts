import crypto from 'crypto'

const MAX_TIMESTAMP_DRIFT_SECONDS = 5 * 60

export type VerifyResult =
  | { ok: true }
  | {
      ok: false
      reason: 'missing-header' | 'stale-timestamp' | 'bad-signature'
      timestamp?: string
      expected?: string
      computed?: string
    }

export function verifyBankSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): VerifyResult {
  if (!signatureHeader) {
    return { ok: false, reason: 'missing-header' }
  }

  const parts = signatureHeader.split(',')
  const timestamp = parts[0]?.split('=')[1]
  const expected = parts[1]?.split('=')[1]

  if (!timestamp || !expected) {
    return { ok: false, reason: 'bad-signature' }
  }

  const timestampNum = Number(timestamp)

  if (Number.isFinite(timestampNum)) {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const drift = Math.abs(nowSeconds - timestampNum)

    if (drift > MAX_TIMESTAMP_DRIFT_SECONDS) {
      return { ok: false, reason: 'stale-timestamp', timestamp }
    }
  }

  const computed = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')

  const expectedBuf = Buffer.from(expected, 'hex')
  const computedBuf = Buffer.from(computed, 'hex')

  if (
    expectedBuf.length !== computedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, computedBuf)
  ) {
    return {
      ok: false,
      reason: 'bad-signature',
      timestamp,
      expected,
      computed,
    }
  }

  return { ok: true }
}
