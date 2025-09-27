export const config = {
  tables: {
    notificationConfigs: process.env.NOTIFICATION_CONFIGS_TABLE || '',
    discoveredStreams: process.env.DISCOVERED_STREAMS_TABLE || '',
  },
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID || '',
    clientSecret: process.env.TWITCH_CLIENT_SECRET || '',
    baseUrl: 'https://api.twitch.tv/helix',
    authUrl: 'https://id.twitch.tv/oauth2/token',
  },
  discord: {
    color: 0x9146ff,
  },
  cleanup: {
    streamTtlDays: 7,
    maxFailureCount: 10,
    failureTimeoutDays: 7,
  },
  cors: {
    allowedOrigins: [
      'https://yourusername.github.io',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ],
  },
};