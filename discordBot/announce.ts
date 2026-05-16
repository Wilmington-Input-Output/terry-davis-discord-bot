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

function formatMessage(
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

export async function announceBankTransaction(
  input: BankTransactionAnnouncement,
  logger: AnnounceLogger,
): Promise<void> {
  const client = getClient()

  if (!client || !client.isReady()) {
    logger.warn(
      { reason: 'client-not-ready' },
      'bank announcement skipped',
    )
    return
  }

  const homeChannelId = process.env.HOME_CHANNEL_ID

  if (!homeChannelId) {
    logger.warn(
      { reason: 'missing-home-channel-id' },
      'bank announcement skipped',
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
      'bank announcement skipped',
    )
    return
  }

  try {
    await channel.send(formatMessage(input))
  } catch (err) {
    logger.warn(
      {
        reason: 'send-failed',
        err: err instanceof Error ? err.message : String(err),
      },
      'bank announcement failed',
    )
  }
}
