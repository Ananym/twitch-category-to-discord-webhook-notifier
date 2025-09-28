import { TwitchStream, DiscordWebhookPayload } from '../types';
import { config } from '../config';

export class DiscordService {
  async sendNotification(webhookUrl: string, stream: TwitchStream): Promise<void> {
    const payload: DiscordWebhookPayload = {
      embeds: [{
        title: `🔴 ${stream.user_name} is now live playing ${stream.game_name}!`,
        description: stream.title,
        url: `https://twitch.tv/${stream.user_login}`,
        color: config.discord.color,
        thumbnail: {
          url: stream.thumbnail_url.replace('{width}', '320').replace('{height}', '180'),
        },
        fields: [
          {
            name: '\u200B',
            value: `${stream.viewer_count.toLocaleString()} ${stream.viewer_count === 1 ? 'viewer' : 'viewers'}${stream.tags && stream.tags.length > 0 ? ` | ${stream.tags.slice(0, 10).join(', ')}${stream.tags.length > 10 ? ` (+${stream.tags.length - 10} more)` : ''}` : ''}`,
            inline: false,
          },
        ],
        timestamp: stream.started_at,
      }],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
    }
  }

  async validateWebhook(webhookUrl: string): Promise<boolean> {
    try {
      const response = await fetch(webhookUrl, {
        method: 'GET',
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}