import { CronJob } from 'cron'
import dotenv from 'dotenv-safe'
import { Client, Events, IntentsBitField } from 'discord.js';
import { replies } from './messages/replies'
import { isGuildTextChannel } from './utils/channels'
import { sendOpenEndedQuestion } from './engagement/openEnded'
import { sendMultipleChoiceQuestion } from './engagement/multipleChoice'

dotenv.config({
    example: './.env.example'
})

const MAIN_CHANNEL_ID = "862860519900053533"

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessageReactions
    ]
});

const token = process.env.TOKEN;

function getRandomReply(): string {
    const randomIndex = Math.floor(Math.random() * replies.length);
    return replies[randomIndex];
}

function containsCIA(str: string): boolean {
   return /\bCIA\b/i.test(str);
}

client.once(Events.ClientReady, async () => {
    console.log('Bot is online!');
    const channel = client.channels.cache.get(MAIN_CHANNEL_ID)

    if (channel && channel.isTextBased() && channel.isSendable()) {
      await channel.send(getRandomReply());
    }

    new CronJob(
        '0 29 18 * * 2,4,6', // Every Tuesday, Thursday, and Saturday at 6:29 PM CST
        async () => {
            // Fetch the channel using the saved channel ID
            const channel = client.channels.cache.get(MAIN_CHANNEL_ID);
            
            if (channel && channel.isTextBased() && channel.isSendable() && isGuildTextChannel(channel)) {
                // Randomly choose between multiple choice or open-ended question
                const useOpenEnded = Math.random() < 0.5;
                
                if (useOpenEnded) {
                    await sendOpenEndedQuestion(channel);
                } else {
                    await sendMultipleChoiceQuestion(channel);
                }
            } else {
                console.log('Channel not found or the bot does not have access to it.');
            }
        },
        null,
        true
    )

    new CronJob(

        // every sunday
        '0 0 12 * * 0', // Every Sunday at 12:00 PM CST
        async () => {
          const channel = client.channels.cache.get(MAIN_CHANNEL_ID)
          if (channel && channel.isTextBased() && 'send' in channel) {
            await channel.send(`
Hey friends, **the BEST way to support the meetup is to ATTEND our events** 😎

If you WANT to support is other ways, please see our website: https://wilmingtonio.org/
`)
          }
        },
        null,
        true
    )
});

client.on(Events.Error, (err) => {
    const now = new Date()
    console.error(now.toLocaleDateString(), 'Got error', err)
})

client.on(Events.ShardError, (err) => {
    const now = new Date()
    console.error(now.toLocaleDateString(), 'Got shared error', err)
})

client.on(Events.MessageCreate, async message => {
   if (message.content === '!terry') {
       message.channel.send(getRandomReply());
   }

   if (message.content === '!meetup') {
       message.channel.send('https://wilmingtonio.org/')
   }

   if (message.content === '!test' && message.author.id === '185862369174487040') {
       const channel = message.channel;
       if (channel && channel.isTextBased() && channel.isSendable() && isGuildTextChannel(channel)) {
           const useOpenEnded = Math.random() < 0.5;
           
           if (useOpenEnded) {
               await sendOpenEndedQuestion(channel);
           } else {
               await sendMultipleChoiceQuestion(channel);
           }
       }
   }

   if (containsCIA(message.content)) {
       message.react('👀')
   }

   if (message.author.id === '1032407444523077712') {
     message.react('🇫🇷')
   }

   if (['193846431004622848', '314929056422297602'].includes(message.author.id)) {
     message.react('🇦🇱')
   }
});


client.login(token)
