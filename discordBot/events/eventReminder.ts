import {
  GuildScheduledEvent,
  GuildScheduledEventStatus,
  GuildScheduledEventEntityType,
  NewsChannel,
  PublicThreadChannel,
  PrivateThreadChannel,
  TextChannel,
} from 'discord.js'

const NY_TZ = 'America/New_York'
const DIGEST_WINDOW_DAYS = 28

type SendableChannel =
  | TextChannel
  | NewsChannel
  | PublicThreadChannel<boolean>
  | PrivateThreadChannel

async function getUpcomingEvents(
  channel: SendableChannel,
  withinDays?: number,
): Promise<GuildScheduledEvent[]> {
  const events = await channel.guild.scheduledEvents.fetch()
  const now = Date.now()
  const windowEnd =
    withinDays === undefined
      ? Infinity
      : now + withinDays * 24 * 60 * 60 * 1000

  return [...events.values()]
    .filter((event) => {
      return (
        event.status === GuildScheduledEventStatus.Scheduled &&
        event.scheduledStartTimestamp !== null &&
        event.scheduledStartTimestamp > now &&
        event.scheduledStartTimestamp <= windowEnd
      )
    })
    .sort((a, b) => {
      return (
        (a.scheduledStartTimestamp ?? 0) -
        (b.scheduledStartTimestamp ?? 0)
      )
    })
}

async function getNextEvent(
  channel: SendableChannel,
): Promise<GuildScheduledEvent | null> {
  const upcoming = await getUpcomingEvents(channel)

  if (upcoming.length === 0) {
    return null
  }

  return upcoming[0]
}

function nyDateKey(timestamp: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp))
}

function dayGap(nowTs: number, eventTs: number): number {
  const nowKey = nyDateKey(nowTs)
  const eventKey = nyDateKey(eventTs)

  const nowMidnight = Date.parse(`${nowKey}T00:00:00Z`)
  const eventMidnight = Date.parse(`${eventKey}T00:00:00Z`)

  return Math.round(
    (eventMidnight - nowMidnight) / (24 * 60 * 60 * 1000),
  )
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(timestamp))
}

function formatWeekday(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    weekday: 'long',
  }).format(new Date(timestamp))
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    month: 'long',
    day: 'numeric',
  }).format(new Date(timestamp))
}

function resolveLocation(
  event: GuildScheduledEvent,
): string | null {
  if (
    event.entityType === GuildScheduledEventEntityType.External &&
    event.entityMetadata?.location
  ) {
    return event.entityMetadata.location
  }

  if (event.channel?.name) {
    return event.channel.name
  }

  return null
}

function buildReminder(
  event: GuildScheduledEvent,
  gap: number,
): string | null {
  const startTs = event.scheduledStartTimestamp

  if (startTs === null) {
    return null
  }

  const name = `**${event.name}**`
  const time = formatTime(startTs)
  const bell = '🔔 REMINDER!!! 🔔'

  let headline: string

  if (gap === 0) {
    headline = `@here ${bell} Today at ${time} is our ${name}!!!`
  } else if (gap === 1) {
    headline =
      `@here ${bell} **TOMORROW** at ${time} is our ${name}!!!`
  } else if (gap === 3) {
    const weekday = formatWeekday(startTs)
    headline =
      `@here ${bell} Our ${name} event is on ${weekday}` +
      ` at ${time}!!!!!`
  } else {
    return null
  }

  const lines = [headline]
  const description = event.description?.trim()

  if (description) {
    lines.push(`📝 ${description}`)
  }

  const location = resolveLocation(event)

  if (location) {
    lines.push(`📍 ${location}`)
  }

  return lines.join('\n')
}

export async function sendEventReminder(
  channel: SendableChannel,
): Promise<void> {
  const event = await getNextEvent(channel)

  if (!event || event.scheduledStartTimestamp === null) {
    return
  }

  const gap = dayGap(Date.now(), event.scheduledStartTimestamp)
  const content = buildReminder(event, gap)

  if (!content) {
    return
  }

  const message = await channel.send(content)

  await message.react('👍')
}

function buildEventLine(
  event: GuildScheduledEvent,
): string | null {
  const startTs = event.scheduledStartTimestamp

  if (startTs === null) {
    return null
  }

  const name = `**${event.name}**`
  const weekday = formatWeekday(startTs)
  const date = formatDate(startTs)
  const time = formatTime(startTs)

  return `• ${name} — ${weekday}, ${date} at ${time}`
}

export async function sendUpcomingEventsAnnouncement(
  channel: SendableChannel,
): Promise<void> {
  const events = await getUpcomingEvents(
    channel,
    DIGEST_WINDOW_DAYS,
  )

  const lines = events
    .map((event) => buildEventLine(event))
    .filter((line): line is string => line !== null)

  if (lines.length === 0) {
    return
  }

  const header = '📅 **Upcoming Events** (next 28 days)'
  const content = `${header}\n\n${lines.join('\n')}`

  await channel.send(content)
}
