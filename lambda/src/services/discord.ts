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
            name: '👥 Viewers',
            value: stream.viewer_count.toLocaleString(),
            inline: true,
          },
          {
            name: '🌐 Language',
            value: stream.language.toUpperCase(),
            inline: true,
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