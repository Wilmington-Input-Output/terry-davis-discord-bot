import { getClient } from './index'
import { isGuildTextChannel } from './utils/channels'

const ORG_NAME = 'Wilmington Input Output'

type AnnounceLogger = {
  warn: (
    obj: Record<string, unknown>,
    msg: string,
  ) => void
}

export type BankTransactionAnnouncement = {
  direction: 'receive' | 'spend'
  magnitude: string
  counterpartyName: string | null | undefined
}

export type DonationAnnouncement =
  | {
      kind: 'donation'
      formattedAmount: string
      supporterName: string | null | undefined
    }
  | {
      kind: 'recurring'
      formattedAmount: string
      periodLabel: string
      supporterName: string | null | undefined
    }
  | {
      kind: 'membership'
      formattedAmount: string
      periodLabel: string
      tierName: string | null | undefined
      supporterName: string | null | undefined
    }

function formatBankMessage(
  input: BankTransactionAnnouncement,
): string {
  const isReceive = input.direction === 'receive'
  const emoji = isReceive ? '💰' : '💸'
  const verb = isReceive ? 'received' : 'spent'
  const head =
    `${emoji} **${ORG_NAME}** ${verb} **$${input.magnitude}**`

  if (
    !input.counterpartyName ||
    input.counterpartyName.trim().length === 0
  ) {
    return head
  }

  if (isReceive) {
    return `${head} from *${input.counterpartyName}*`
  }

  return `${head} *${input.counterpartyName}*`
}

function formatDonationMessage(
  input: DonationAnnouncement,
): string {
  const supporterTail =
    input.supporterName && input.supporterName.trim().length > 0
      ? ` from *${input.supporterName}*`
      : ''

  if (input.kind === 'donation') {
    return (
      `💰 **${ORG_NAME}** received a **${input.formattedAmount}**`
      + ` donation${supporterTail}!!!!!!!`
    )
  }

  if (input.kind === 'recurring') {
    return (
      `💰 **${ORG_NAME}** received a new`
      + ` **${input.formattedAmount}/${input.periodLabel}**`
      + ` recurring donation${supporterTail}!!!!!!!`
    )
  }

  const tierFragment =
    input.tierName && input.tierName.trim().length > 0
      ? ` *${input.tierName}*`
      : ''

  return (
    `💰 **${ORG_NAME}** received a new`
    + ` **${input.formattedAmount}/${input.periodLabel}**`
    + `${tierFragment} membership${supporterTail}!!!!!!!`
  )
}

async function postHomeChannelMessage(
  content: string,
  logger: AnnounceLogger,
): Promise<void> {
  const client = getClient()

  if (!client || !client.isReady()) {
    logger.warn(
      { reason: 'client-not-ready' },
      'home channel post skipped',
    )
    return
  }

  const homeChannelId = process.env.HOME_CHANNEL_ID

  if (!homeChannelId) {
    logger.warn(
      { reason: 'missing-home-channel-id' },
      'home channel post skipped',
    )
    return
  }

  const channel = client.channels.cache.get(homeChannelId)

  if (
    !channel ||
    !channel.isTextBased() ||
    !channel.isSendable() ||
    !isGuildTextChannel(channel)
  ) {
    logger.warn(
      {
        reason: 'home-channel-not-sendable',
        channelId: homeChannelId,
      },
      'home channel post skipped',
    )
    return
  }

  try {
    await channel.send(content)
  } catch (err) {
    logger.warn(
      {
        reason: 'send-failed',
        err: err instanceof Error ? err.message : String(err),
      },
      'home channel post failed',
    )
  }
}

export async function announceBankTransaction(
  input: BankTransactionAnnouncement,
  logger: AnnounceLogger,
): Promise<void> {
  await postHomeChannelMessage(formatBankMessage(input), logger)
}

export async function announceDonation(
  input: DonationAnnouncement,
  logger: AnnounceLogger,
): Promise<void> {
  await postHomeChannelMessage(
    formatDonationMessage(input),
    logger,
  )
}
