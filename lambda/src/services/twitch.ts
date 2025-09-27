import { TwitchStream, TwitchCategory, TwitchApiResponse } from '../types';
import { config } from '../config';

export class TwitchService {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await fetch(config.twitch.authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.twitch.clientId,
        client_secret: config.twitch.clientSecret,
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get Twitch access token: ${response.status}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // 1 minute buffer

    return this.accessToken;
  }

  async getStreamsByGameIds(gameIds: string[]): Promise<TwitchStream[]> {
    if (gameIds.length === 0) return [];

    const token = await this.getAccessToken();
    const gameIdParams = gameIds.map(id => `game_id=${id}`).join('&');
    const url = `${config.twitch.baseUrl}/streams?${gameIdParams}&first=100`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Client-Id': config.twitch.clientId,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch streams: ${response.status}`);
    }

    const data = await response.json() as TwitchApiResponse<TwitchStream>;
    return data.data;
  }

  async searchCategories(query: string): Promise<TwitchCategory[]> {
    if (!query.trim()) return [];

    const token = await this.getAccessToken();
    const url = `${config.twitch.baseUrl}/search/categories?query=${encodeURIComponent(query)}&first=10`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Client-Id': config.twitch.clientId,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to search categories: ${response.status}`);
    }

    const data = await response.json() as TwitchApiResponse<TwitchCategory>;
    return data.data;
  }

  async validateCategory(gameId: string): Promise<TwitchCategory | null> {
    const token = await this.getAccessToken();
    const url = `${config.twitch.baseUrl}/games?id=${gameId}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Client-Id': config.twitch.clientId,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as TwitchApiResponse<TwitchCategory>;
    return data.data[0] || null;
  }
}