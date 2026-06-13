import { TextChannel, NewsChannel, ThreadChannel } from 'discord.js';
import { openEndedEngagementQuestions } from '../messages/openEndedEngagement';
import crypto from 'crypto';

export async function sendOpenEndedQuestion(channel: TextChannel | NewsChannel | ThreadChannel): Promise<void> {
    const randomQuestionIndex = crypto.randomInt(0, openEndedEngagementQuestions.length);
    const question = openEndedEngagementQuestions[randomQuestionIndex];

    if (!('guild' in channel) || !channel.guild) {
        await channel.send(`
Hey nerds - anyone know the answer?

${question}
        `.trim());
        return
    }
}
