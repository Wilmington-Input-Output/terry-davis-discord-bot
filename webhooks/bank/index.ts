import type { FastifyPluginAsync } from 'fastify'
import { verifyBankSignature } from './verifySignature'

const SIGNATURE_HEADER = 'mercury-signature'

type WebhookEvent = {
  id?: string
  resourceType?: string
  resourceId?: string
  operationType?: string
  mergePatch?: {
    amount?: number
    bankDescription?: string | null
    status?: string
  }
}

const bankWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  const secret = process.env.BANK_WEBHOOK_SECRET

  if (!secret) {
    throw new Error(
      'BANK_WEBHOOK_SECRET env var must be set to register ' +
      'the bank webhook route',
    )
  }

  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body, done) => {
      const raw = typeof body === 'string' ? body : body.toString()
      ;(request as unknown as { rawBody: string }).rawBody = raw

      try {
        const parsed = raw.length === 0 ? {} : JSON.parse(raw)
        done(null, parsed)
      } catch (err) {
        done(err as Error, undefined)
      }
    },
  )

  fastify.post('/webhooks/bank', async (request, reply) => {
    const rawBody =
      (request as unknown as { rawBody?: string }).rawBody ?? ''
    const signatureHeader = request.headers[SIGNATURE_HEADER]
    const headerValue = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader

    const verification = verifyBankSignature(
      rawBody,
      headerValue,
      secret,
    )

    if (!verification.ok) {
      request.log.warn(
        { reason: verification.reason },
        'bank webhook rejected',
      )
      return reply.callNotFound()
    }

    const event = request.body as WebhookEvent

    if (
      event?.resourceType !== 'transaction' ||
      event?.operationType !== 'create'
    ) {
      return { ok: true }
    }

    const status = event.mergePatch?.status
    const amount = event.mergePatch?.amount
    const bankDescription = event.mergePatch?.bankDescription

    if (status !== 'pending' && status !== 'sent') {
      return { ok: true }
    }

    if (typeof amount !== 'number') {
      return { ok: true }
    }

    const direction = amount >= 0 ? 'receive' : 'spend'
    const magnitude = Math.abs(amount).toFixed(2)

    console.log(
      `Bank transaction (${status}) ${direction} $${magnitude} — ${bankDescription ?? '(no description)'}`,
    )

    return { ok: true }
  })
}

export default bankWebhookPlugin
