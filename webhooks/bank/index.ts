import crypto from 'crypto'
import type { FastifyPluginAsync } from 'fastify'
import fastifyRawBody from 'fastify-raw-body'
import { verifyBankSignature } from './verifySignature'
import { getTransactionDetails } from '../../lib/bank'
import { announceBankTransaction } from '../../discordBot/announce'

const SIGNATURE_HEADER = 'mercury-signature'

const ZAC_COUNTERPARTY_ALIASES = new Set<string>([
  'Mercury - Checking ••7255',
])

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

function resolveCounterpartyName(
  tx:
    | Awaited<ReturnType<typeof getTransactionDetails>>
    | undefined,
): string | null {
  if (!tx) {
    return null
  }

  if (tx.kind === 'internalTransfer') {
    return 'Zac'
  }

  if (
    tx.counterpartyName &&
    ZAC_COUNTERPARTY_ALIASES.has(tx.counterpartyName)
  ) {
    return 'Zac'
  }

  return tx.counterpartyName
}

const bankWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  const secret = process.env.BANK_WEBHOOK_SECRET

  if (!secret) {
    throw new Error(
      'BANK_WEBHOOK_SECRET env var must be set to register the bank webhook route',
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
            rawBodySha256: crypto
              .createHash('sha256')
              .update(rawBody)
              .digest('hex'),
            hasSignatureHeader: typeof headerValue === 'string',
            signatureHeaderLength: headerValue?.length ?? 0,
            timestamp: verification.timestamp,
            expectedSignature: verification.expected,
            computedSignature: verification.computed,
          },
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

      if (status !== 'pending' && status !== 'sent') {
        return { ok: true }
      }

      if (typeof amount !== 'number') {
        return { ok: true }
      }

      let tx:
        | Awaited<ReturnType<typeof getTransactionDetails>>
        | undefined

      if (event.resourceId) {
        tx = await getTransactionDetails(event.resourceId ?? '')
        if (tx.accountId !== process.env.BANK_ACCOUNT_ID) {
          return { ok: true }
        }
      }

      const direction = amount >= 0 ? 'receive' : 'spend'
      const magnitude = Math.abs(amount).toFixed(2)
      const counterpartyName = resolveCounterpartyName(tx)

      void announceBankTransaction(
        {
          direction,
          magnitude,
          counterpartyName,
        },
        request.log,
      ).catch((err) => {
        request.log.warn(
          {
            err: err instanceof Error ? err.message : String(err),
          },
          'bank announcement threw unexpectedly',
        )
      })

      return { ok: true }
    },
  )
}

export default bankWebhookPlugin
