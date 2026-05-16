import { TextChannel, NewsChannel, ThreadChannel } from 'discord.js';
import { openEndedEngagementQuestions } from '../messages/openEndedEngagement';
import { getRandomMembers } from '../utils/members';
import crypto from 'crypto';

export async function sendOpenEndedQuestion(channel: TextChannel | NewsChannel | ThreadChannel): Promise<void> {
    const randomQuestionIndex = crypto.randomInt(0, openEndedEngagementQuestions.length);
    const question = openEndedEngagementQuestions[randomQuestionIndex];

    const tagPeopleThisTime = Math.random() < 0.5

    if (!('guild' in channel) || !channel.guild || !tagPeopleThisTime) {
        await channel.send(`
Hey nerds

${question}
        `.trim());
        return
    }
    
    const randomMembers = await getRandomMembers(channel.guild, 3);
    const memberTags = randomMembers.map(id => `<@${id}>`).join(' ');
    
    await channel.send(`
Hey ${memberTags} (randomly selected nerds) !!!

${question}
`.trim())

}
