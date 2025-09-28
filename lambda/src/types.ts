export interface NotificationConfig {
  pk: string;
  sk: string;
  webhook_url: string;
  game_id: string;
  game_name: string;
  required_tags?: string[];  // Only notify if stream has ALL these tags
  required_language?: string;  // Only notify if stream language matches (empty/null = any)
  minimum_viewers?: number;  // Only notify if stream has at least this many viewers
  created_at: string;
  last_success?: string;
  failure_count: number;
  updated_at: string;
}

export interface DiscoveredStream {
  stream_id: string;
  user_id: string;
  game_id: string;
  discovered_at: string;
  ttl: number;
}

export interface TwitchStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: string;
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  thumbnail_url: string;
  tag_ids: string[];
  tags: string[];
  is_mature: boolean;
}

export interface TwitchCategory {
  id: string;
  name: string;
  box_art_url: string;
}

export interface TwitchApiResponse<T> {
  data: T[];
  pagination?: {
    cursor?: string;
  };
}

export interface StatusInfo {
  last_poll_time?: string;
  time_since_last_poll: string;
  notification_configs_count: number;
  notifications_sent_24h: number;
  failed_notifications_24h: number;
  twitch_api_error?: string;
}

export interface DiscordWebhookPayload {
  embeds: Array<{
    title: string;
    description: string;
    url: string;
    color: number;
    thumbnail: {
      url: string;
    };
    fields: Array<{
      name: string;
      value: string;
      inline: boolean;
    }>;
    timestamp: string;
  }>;
}

export interface LambdaFunctionUrlEvent {
  version: string;
  routeKey: string;
  rawPath: string;
  rawQueryString: string;
  headers: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  requestContext: {
    http: {
      method: string;
      path: string;
      protocol: string;
      sourceIp: string;
      userAgent: string;
    };
  };
  body?: string;
  isBase64Encoded: boolean;
}