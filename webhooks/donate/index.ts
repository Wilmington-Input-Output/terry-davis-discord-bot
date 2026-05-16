import crypto from 'crypto'
import type { FastifyPluginAsync } from 'fastify'
import fastifyRawBody from 'fastify-raw-body'
import { verifyDonateSignature } from './verifySignature'
import {
  announceDonation,
  type DonationAnnouncement,
} from '../../discordBot/announce'

const SIGNATURE_HEADER = 'x-signature-sha256'

type DonationCreatedEvent = {
  type: 'donation.created'
  data?: {
    amount?: number
    currency?: string
    supporter_name?: string | null
  }
}

type RecurringDonationStartedEvent = {
  type: 'recurring_donation.started'
  data?: {
    amount?: number
    currency?: string
    duration_type?: string
    supporter_name?: string | null
  }
}

type MembershipStartedEvent = {
  type: 'membership.started'
  data?: {
    amount?: number
    currency?: string
    duration_type?: string
    membership_level_name?: string | null
    supporter_name?: string | null
  }
}

type DonateWebhookEvent =
  | DonationCreatedEvent
  | RecurringDonationStartedEvent
  | MembershipStartedEvent
  | { type?: string }

function formatAmount(
  amount: number,
  currency: string | undefined,
): string {
  const safeCurrency =
    currency && currency.trim().length > 0 ? currency : 'USD'

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: safeCurrency,
    }).format(amount)
  } catch {
    return `$${amount.toFixed(2)}`
  }
}

function buildAnnouncement(
  event: DonateWebhookEvent,
): DonationAnnouncement | null {
  if (event.type === 'donation.created') {
    const typedEvent = event as DonationCreatedEvent
    const data = typedEvent.data

    if (!data || typeof data.amount !== 'number') {
      return null
    }

    return {
      kind: 'donation',
      formattedAmount: formatAmount(data.amount, data.currency),
      supporterName: data.supporter_name,
    }
  }

  if (event.type === 'recurring_donation.started') {
    const typedEvent = event as RecurringDonationStartedEvent
    const data = typedEvent.data

    if (!data || typeof data.amount !== 'number') {
      return null
    }

    return {
      kind: 'recurring',
      formattedAmount: formatAmount(data.amount, data.currency),
      periodLabel: data.duration_type ?? 'month',
      supporterName: data.supporter_name,
    }
  }

  if (event.type === 'membership.started') {
    const typedEvent = event as MembershipStartedEvent
    const data = typedEvent.data

    if (!data || typeof data.amount !== 'number') {
      return null
    }

    return {
      kind: 'membership',
      formattedAmount: formatAmount(data.amount, data.currency),
      periodLabel: data.duration_type ?? 'month',
      tierName: data.membership_level_name,
      supporterName: data.supporter_name,
    }
  }

  return null
}

const donateWebhookPlugin: FastifyPluginAsync = async (
  fastify,
) => {
  const secret = process.env.DONATE_WEBHOOK_SECRET

  if (!secret) {
    throw new Error(
      'DONATE_WEBHOOK_SECRET env var must be set to register'
      + ' the donate webhook route',
    )
  }

  await fastify.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    encoding: 'utf8',
    runFirst: true,
  })

  fastify.post(
    '/webhooks/donate',
    { config: { rawBody: true } },
    async (request, reply) => {
      const rawBody =
        typeof request.rawBody === 'string' ? request.rawBody : ''
      const signatureHeader = request.headers[SIGNATURE_HEADER]
      const headerValue = Array.isArray(signatureHeader)
        ? signatureHeader[0]
        : signatureHeader

      const verification = verifyDonateSignature(
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
            expectedSignature: verification.expected,
            computedSignature: verification.computed,
          },
          'donate webhook rejected',
        )
        return reply.callNotFound()
      }

      const event = request.body as DonateWebhookEvent
      const announcement = buildAnnouncement(event)

      if (!announcement) {
        return { ok: true }
      }

      void announceDonation(announcement, request.log).catch(
        (err) => {
          request.log.warn(
            {
              err:
                err instanceof Error ? err.message : String(err),
            },
            'donate announcement threw unexpectedly',
          )
        },
      )

      return { ok: true }
    },
  )
}

export default donateWebhookPlugin
