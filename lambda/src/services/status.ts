import { DatabaseService } from './database';
import { StatusInfo } from '../types';

export class StatusService {
  private db: DatabaseService;

  constructor() {
    this.db = new DatabaseService();
  }

  async updateLastPollTime(): Promise<void> {
    const now = new Date().toISOString();
    // Store last poll time in DynamoDB
    await this.db.saveStatusData('last_poll_time', now);
  }

  async getStatus(): Promise<StatusInfo> {
    const configs = await this.db.getNotificationConfigs();
    const counts = await this.db.getNotificationCounts24h();
    const now = new Date();

    // Get last poll time from database
    const lastPollTime = await this.db.getStatusData('last_poll_time');

    let timeSinceLastPoll: string;
    if (lastPollTime) {
      const pollTime = new Date(lastPollTime);
      const minutesAgo = Math.floor((now.getTime() - pollTime.getTime()) / (1000 * 60));

      if (minutesAgo < 1) {
        timeSinceLastPoll = 'Just now';
      } else if (minutesAgo < 60) {
        timeSinceLastPoll = `${minutesAgo}m ago`;
      } else {
        const hoursAgo = Math.floor(minutesAgo / 60);
        timeSinceLastPoll = `${hoursAgo}h ago`;
      }
    } else {
      timeSinceLastPoll = 'Never';
    }

    return {
      last_poll_time: lastPollTime || undefined,
      time_since_last_poll: timeSinceLastPoll,
      notification_configs_count: configs.length,
      notifications_sent_24h: counts.sent,
      failed_notifications_24h: counts.failed,
    };
  }
}