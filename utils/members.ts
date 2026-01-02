import { Guild } from 'discord.js';
import crypto from 'crypto';

export async function getRandomMembers(guild: Guild, count: number = 3): Promise<string[]> {
    try {
        // Fetch all members if not cached
        await guild.members.fetch();
        
        // Get all non-bot members
        const members = guild.members.cache
            .filter((member) => !member.user.bot)
            .map((member) => member.id);
        
        if (members.length === 0) {
            return [];
        }
        
        // Randomly select up to 'count' members
        const selected: string[] = [];
        const available = [...members];
        const selectCount = Math.min(count, available.length);
        
        for (let i = 0; i < selectCount; i++) {
            const randomIndex = crypto.randomInt(0, available.length);
            selected.push(available[randomIndex]);
            available.splice(randomIndex, 1);
        }
        
        return selected;
    } catch (error) {
        console.error('Error fetching members:', error);
        return [];
    }
}

