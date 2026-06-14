import { CronJob } from 'cron'
import { Client, Events, IntentsBitField } from 'discord.js'
import { replies } from './messages/replies'
import { isGuildTextChannel } from './utils/channels'
import { sendOpenEndedQuestion } from './engagement/openEnded'
import { sendMultipleChoiceQuestion } from './engagement/multipleChoice'
import {
  sendEventReminder,
  sendUpcomingEventsAnnouncement,
} from './events/eventReminder'

let client: Client | undefined
let engagementCron: CronJob | undefined
let supportCron: CronJob | undefined
let reminderCron: CronJob | undefined
let digestCron: CronJob | undefined

function getRandomReply(): string {
  const randomIndex = Math.floor(Math.random() * replies.length)
  return replies[randomIndex]
}

function containsCIA(str: string): boolean {
  return /\bCIA\b/i.test(str)
}

function buildWelcomeMessage(userId: string): string {
  return `Welcome <@${userId}>! 👋👋

What brings you to our Discord?

Are you a student? Are you into apps, cybersecurity, linux, c++? just learning? new to town?

Please introduce yourself! 😎`
}

export async function startDiscordBot(): Promise<void> {
  const token = process.env.TOKEN

  if (!token) {
    throw new Error(
      'TOKEN env var is required to start the Discord bot',
    )
  }

  const homeChannelId = process.env.HOME_CHANNEL_ID

  if (!homeChannelId) {
    throw new Error(
      'HOME_CHANNEL_ID env var is required to start the Discord bot',
    )
  }

  client = new Client({
    intents: [
      IntentsBitField.Flags.Guilds,
      IntentsBitField.Flags.GuildMessages,
      IntentsBitField.Flags.MessageContent,
      IntentsBitField.Flags.GuildMembers,
      IntentsBitField.Flags.GuildMessageReactions,
      IntentsBitField.Flags.GuildScheduledEvents,
    ],
  })

  client.once(Events.ClientReady, async () => {
    console.log('Bot is online!')
    const channel = client?.channels.cache.get(homeChannelId)

    if (channel && channel.isTextBased() && channel.isSendable()) {
      // stop sending messages on restart
      // await channel.send(getRandomReply())
    }

    engagementCron = new CronJob(
      '0 29 18 * * 2,4,6',
      async () => {
        const channel = client?.channels.cache.get(homeChannelId)

        if (
          channel &&
          channel.isTextBased() &&
          channel.isSendable() &&
          isGuildTextChannel(channel)
        ) {
          const useOpenEnded = Math.random() < 0.5

          if (useOpenEnded) {
            await sendOpenEndedQuestion(channel)
          } else {
            await sendMultipleChoiceQuestion(channel)
          }
        } else {
          console.log(
            'Channel not found or the bot does not have access to it.',
          )
        }
      },
      null,
      true,
    )

    supportCron = new CronJob(
      '0 0 12 * * 0',
      async () => {
        const channel = client?.channels.cache.get(homeChannelId)

        if (channel && channel.isTextBased() && 'send' in channel) {
          await channel.send(
            `Hey friends, **the BEST way to support the meetup is to ATTEND our events** 😎

If you WANT to support is other ways, please see our NEW supporter link: https://buymeacoffee.com/wilmingtonio`,
          )
        }
      },
      null,
      true,
    )

    reminderCron = new CronJob(
      '0 0 11 * * *',
      async () => {
        const channel = client?.channels.cache.get(homeChannelId)

        if (
          !channel ||
          !channel.isTextBased() ||
          !channel.isSendable() ||
          !isGuildTextChannel(channel)
        ) {
          console.log(
            'Event reminder skipped: home channel not sendable.',
          )
          return
        }

        try {
          await sendEventReminder(channel)
        } catch (err) {
          console.error('Failed to send event reminder', err)
        }
      },
      null,
      true,
      'America/New_York',
    )

    digestCron = new CronJob(
      '0 0 9 * * 0',
      async () => {
        const channel = client?.channels.cache.get(homeChannelId)

        if (
          !channel ||
          !channel.isTextBased() ||
          !channel.isSendable() ||
          !isGuildTextChannel(channel)
        ) {
          console.log(
            'Upcoming events digest skipped: home channel not sendable.',
          )
          return
        }

        try {
          await sendUpcomingEventsAnnouncement(channel)
        } catch (err) {
          console.error('Failed to send upcoming events digest', err)
        }
      },
      null,
      true,
      'America/New_York',
    )
  })

  client.on(Events.Error, (err) => {
    const now = new Date()
    console.error(now.toLocaleDateString(), 'Got error', err)
  })

  client.on(Events.ShardError, (err) => {
    const now = new Date()
    console.error(now.toLocaleDateString(), 'Got shared error', err)
  })

  client.on(Events.MessageCreate, async (message) => {
    if (message.content === '!terry') {
      message.channel.send(getRandomReply())
    }

    if (message.content === '!meetup') {
      message.channel.send('https://wilmingtonio.org/')
    }

    if (
      message.content === '!test' &&
      message.author.id === '185862369174487040'
    ) {
      const channel = message.channel

      if (
        channel &&
        channel.isTextBased() &&
        channel.isSendable() &&
        isGuildTextChannel(channel)
      ) {
        const useOpenEnded = Math.random() < 0.5

        if (useOpenEnded) {
          await sendOpenEndedQuestion(channel)
        } else {
          await sendMultipleChoiceQuestion(channel)
        }
      }
    }

    if (
      message.content === '!testwelcome' &&
      message.author.id === '185862369174487040'
    ) {
      const channel = message.channel

      if (
        channel &&
        channel.isTextBased() &&
        channel.isSendable() &&
        isGuildTextChannel(channel)
      ) {
        await channel.send(buildWelcomeMessage(message.author.id))
      }
    }

    if (
      message.content === '!testreminder' &&
      message.author.id === '185862369174487040'
    ) {
      const channel = message.channel

      if (
        channel &&
        channel.isTextBased() &&
        channel.isSendable() &&
        isGuildTextChannel(channel)
      ) {
        await sendEventReminder(channel)
      }
    }

    if (
      message.content === '!testevents' &&
      message.author.id === '185862369174487040'
    ) {
      const channel = message.channel

      if (
        channel &&
        channel.isTextBased() &&
        channel.isSendable() &&
        isGuildTextChannel(channel)
      ) {
        await sendUpcomingEventsAnnouncement(channel)
      }
    }

    if (containsCIA(message.content)) {
      message.react('👀')
    }

    if (message.author.id === '1032407444523077712') {
      message.react('🇫🇷')
    }

    if (
      ['193846431004622848', '314929056422297602'].includes(
        message.author.id,
      )
    ) {
      message.react('🇦🇱')
    }
  })

  client.on(Events.GuildMemberAdd, async (member) => {
    if (member.user.bot) {
      return
    }

    const channel = client?.channels.cache.get(homeChannelId)

    if (
      !channel ||
      !channel.isTextBased() ||
      !channel.isSendable() ||
      !isGuildTextChannel(channel)
    ) {
      console.log(
        'Welcome skipped: home channel not found or not sendable.',
      )
      return
    }

    try {
      await channel.send(buildWelcomeMessage(member.id))
    } catch (err) {
      console.error('Failed to send welcome message', err)
    }
  })

  await client.login(token)
}

export async function stopDiscordBot(): Promise<void> {
  engagementCron?.stop()
  supportCron?.stop()
  reminderCron?.stop()
  digestCron?.stop()
  engagementCron = undefined
  supportCron = undefined
  reminderCron = undefined
  digestCron = undefined

  if (client) {
    await client.destroy()
    client = undefined
  }
}

export function getClient(): Client | undefined {
  return client
}
