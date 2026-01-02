import { TextChannel, NewsChannel, ThreadChannel } from 'discord.js';
import { openEndedEngagementQuestions } from '../messages/openEndedEngagement';
import { getRandomMembers } from '../utils/members';
import crypto from 'crypto';

export async function sendOpenEndedQuestion(channel: TextChannel | NewsChannel | ThreadChannel): Promise<void> {
    const randomQuestionIndex = crypto.randomInt(0, openEndedEngagementQuestions.length);
    const question = openEndedEngagementQuestions[randomQuestionIndex];

    if (!('guild' in channel) || !channel.guild) {
        await channel.send(`
Hey nerds

${question}

What do you think?
        `.trim());
        return
    }
    
    const randomMembers = await getRandomMembers(channel.guild, 3);
    const memberTags = randomMembers.map(id => `<@${id}>`).join(' ');
    
    await channel.send(`
Hey nerds

${question}

${memberTags} - what do you think?`.trim());

}

