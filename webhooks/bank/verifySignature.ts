import crypto from 'crypto'

const MAX_TIMESTAMP_DRIFT_SECONDS = 5 * 60

export type VerifyResult =
  | { ok: true }
  | {
      ok: false
      reason: 'missing-header' | 'stale-timestamp' | 'bad-signature'
    }

function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secretKey: string,
): boolean {
  // Parse the signature header (format: "t=<timestamp>,v1=<signature>")
  const parts = signatureHeader.split(',')
  const timestamp = parts[0]?.split('=')[1]
  const signature = parts[1]?.split('=')[1]

  if (!timestamp || !signature) {
    return false
  }

  // Construct the signed payload
  const signedPayload = `${timestamp}.${payload}`

  // Compute HMAC-SHA256 using the secret key directly
  const expectedSignature = crypto
    .createHmac('sha256', secretKey)
    .update(signedPayload)
    .digest('hex')

  // Use constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature),
  )
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
  const timestamp = Number(timestampRaw)

  if (Number.isFinite(timestamp)) {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const drift = Math.abs(nowSeconds - timestamp)

    if (drift > MAX_TIMESTAMP_DRIFT_SECONDS) {
      return { ok: false, reason: 'stale-timestamp' }
    }
  }

  let signatureValid = false

  try {
    signatureValid = verifyWebhookSignature(
      rawBody,
      signatureHeader,
      secret,
    )
  } catch {
    signatureValid = false
  }

  if (!signatureValid) {
    return { ok: false, reason: 'bad-signature' }
  }

  return { ok: true }
}
