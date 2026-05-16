import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_TIMESTAMP_DRIFT_SECONDS = 5 * 60

export type VerifyResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'missing-header'
        | 'malformed-header'
        | 'stale-timestamp'
        | 'bad-signature'
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
  const timestampRaw = parts[0]?.split('=')[1]
  const signatureHex = parts[1]?.split('=')[1]

  if (!timestampRaw || !signatureHex) {
    return { ok: false, reason: 'malformed-header' }
  }

  const timestamp = Number(timestampRaw)

  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'malformed-header' }
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const drift = Math.abs(nowSeconds - timestamp)

  if (drift > MAX_TIMESTAMP_DRIFT_SECONDS) {
    return { ok: false, reason: 'stale-timestamp' }
  }

  const signedPayload = `${timestampRaw}.${rawBody}`
  const expected = createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex')

  const expectedBuf = Buffer.from(expected, 'hex')
  const receivedBuf = Buffer.from(signatureHex, 'hex')

  if (expectedBuf.length !== receivedBuf.length) {
    return { ok: false, reason: 'bad-signature' }
  }

  if (!timingSafeEqual(expectedBuf, receivedBuf)) {
    return { ok: false, reason: 'bad-signature' }
  }

  return { ok: true }
}
