import type { FastifyPluginAsync } from 'fastify'
import fastifyRawBody from 'fastify-raw-body'
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
  const resourceId = process.env.BANK_RESOURCE_ID

  if (!secret) {
    throw new Error(
      'BANK_WEBHOOK_SECRET env var must be set to register the bank webhook route',
    )
  }

  if (!resourceId) {
    throw new Error(
      'BANK_RESOURCE_ID env var must be set to register the bank webhook route',
    )
  }

  await fastify.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    encoding: 'utf8',
    runFirst: true,
  })

  fastify.post(
    '/webhooks/bank',
    { config: { rawBody: true } },
    async (request, reply) => {
      const rawBody =
        typeof request.rawBody === 'string' ? request.rawBody : ''
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
          {
            reason: verification.reason,
            contentType: request.headers['content-type'],
            rawBodyLength: rawBody.length,
            hasSignatureHeader: typeof headerValue === 'string',
            signatureHeaderLength: headerValue?.length ?? 0,
          },
          'bank webhook rejected',
        )
        return reply.callNotFound()
      }

      const event = request.body as WebhookEvent

      if (event?.resourceId !== resourceId) {
        return { ok: true }
      }

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
    },
  )
}

export default bankWebhookPlugin
