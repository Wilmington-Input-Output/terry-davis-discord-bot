import crypto from 'crypto'

export type VerifyResult =
  | { ok: true }
  | {
      ok: false
      reason: 'missing-header' | 'bad-signature'
      expected?: string
      computed?: string
    }

export function verifyDonateSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): VerifyResult {
  if (!signatureHeader) {
    return { ok: false, reason: 'missing-header' }
  }

  const expected = signatureHeader.trim()
  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')

  const expectedBuf = Buffer.from(expected, 'hex')
  const computedBuf = Buffer.from(computed, 'hex')

  if (
    expectedBuf.length === 0 ||
    expectedBuf.length !== computedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, computedBuf)
  ) {
    return {
      ok: false,
      reason: 'bad-signature',
      expected,
      computed,
    }
  }

  return { ok: true }
}
