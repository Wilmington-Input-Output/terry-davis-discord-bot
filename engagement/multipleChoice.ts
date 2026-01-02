import { TextChannel, NewsChannel, ThreadChannel, MessageReaction, User } from 'discord.js';
import { engagementQuestions } from '../messages/engagement';
import crypto from 'crypto';

const reactionEmojis = ['🇦', '🇧', '🇨', '🇩'];

let lastEngagementIndices: number[] = [];

function getRandomEngagementIndex(): number {
    if (lastEngagementIndices.length >= engagementQuestions.length) {
        lastEngagementIndices = [];
    }

    let engagementIndex = crypto.randomInt(0, engagementQuestions.length);
    while (lastEngagementIndices.includes(engagementIndex)) {
        engagementIndex = crypto.randomInt(0, engagementQuestions.length);
    }

    lastEngagementIndices.push(engagementIndex);

    return engagementIndex;
}

export async function sendMultipleChoiceQuestion(channel: TextChannel | NewsChannel | ThreadChannel): Promise<void> {
    const { question, answers } = engagementQuestions[getRandomEngagementIndex()];
    const message = await channel.send(`
Hey nerds

${question}

${answers.map((answer, index) => `${reactionEmojis[index]} ${answer}`).join('\n')}

Dont see your answer? Share with us!
    `.trim());
    
    for (const reaction of reactionEmojis) {
        await message.react(reaction);
    }

    const filter = (reaction: MessageReaction, user: User) => {
        return !user.bot && reactionEmojis.includes(reaction.emoji.name || '');
    };

    const collector = message.createReactionCollector({ filter, time: 48 * 60 * 60 * 1000 }); // 48 hours
    const reactingUsers: Set<string> = new Set();

    collector.on('collect', async (reaction, user) => {
        try {
          console.log("Got reaction:", reaction.emoji.name, " from user:", user.displayName)
            if (!reactingUsers.has(user.id)) {
                reactingUsers.add(user.id);

                if (reactingUsers.size === 2) {
                    const emojiName = reaction.emoji.name;
                    if (emojiName && reactionEmojis.includes(emojiName)) {
                        const answerIndex = reactionEmojis.indexOf(emojiName);
                        const answerChosen = answers[answerIndex] ?? 'your answer';
                        await channel.send(`Nice <@${user.id}>! Can you share why you chose ${answerChosen}?`);
                        collector.stop();
                    }
                }
            }
        } catch (error) {
            console.error('Error in reaction collector:', error);
        }
    });

    collector.on('end', (collected, reason) => {
        console.log(`Reaction collector ended. Reason: ${reason}, Collected: ${collected.size}`);
    });
}

