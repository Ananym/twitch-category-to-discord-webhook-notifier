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
    const allStreams: TwitchStream[] = [];

    // Make one request per unique game ID to get top 100 streams for each category
    const uniqueGameIds = [...new Set(gameIds)];
    console.log(`Making ${uniqueGameIds.length} individual requests for categories: ${uniqueGameIds.join(', ')}`);

    for (const gameId of uniqueGameIds) {
      try {
        const url = `${config.twitch.baseUrl}/streams?game_id=${gameId}&first=100`;

        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Client-Id': config.twitch.clientId,
          },
        });

        if (!response.ok) {
          console.error(`Failed to fetch streams for game ID ${gameId}: ${response.status}`);
          continue; // Skip this category but continue with others
        }

        const data = await response.json() as TwitchApiResponse<TwitchStream>;
        console.log(`Found ${data.data.length} streams for game ID ${gameId}`);
        allStreams.push(...data.data);

      } catch (error) {
        console.error(`Error fetching streams for game ID ${gameId}:`, error);
        // Continue with other categories even if one fails
      }
    }

    console.log(`Total streams found across all categories: ${allStreams.length}`);
    return allStreams;
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