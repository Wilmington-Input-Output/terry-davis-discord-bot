import { TextChannel, NewsChannel, ThreadChannel, DMChannel, PartialDMChannel, StageChannel, VoiceChannel, PublicThreadChannel, PrivateThreadChannel } from 'discord.js';

export function isGuildTextChannel(
    channel: DMChannel | PartialDMChannel | NewsChannel | StageChannel | TextChannel | PublicThreadChannel<boolean> | PrivateThreadChannel | VoiceChannel | null | undefined
): channel is TextChannel | NewsChannel | PublicThreadChannel<boolean> | PrivateThreadChannel {
    if (channel === null || channel === undefined) {
        return false;
    }
    return channel instanceof TextChannel || 
           channel instanceof NewsChannel || 
           channel instanceof ThreadChannel;
}

