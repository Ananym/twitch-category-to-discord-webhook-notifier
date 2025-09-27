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
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const notificationsSent24h = configs.filter(config =>
      config.last_success && new Date(config.last_success) > twentyFourHoursAgo
    ).length;

    const failedNotifications24h = configs.filter(config =>
      config.failure_count > 0 &&
      config.updated_at &&
      new Date(config.updated_at) > twentyFourHoursAgo
    ).length;

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
      notifications_sent_24h: notificationsSent24h,
      failed_notifications_24h: failedNotifications24h,
    };
  }
}