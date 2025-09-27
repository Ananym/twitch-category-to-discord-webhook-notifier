import { ScheduledEvent } from 'aws-lambda';
import { DatabaseService } from '../services/database';
import { TwitchService } from '../services/twitch';
import { DiscordService } from '../services/discord';
import { StatusService } from '../services/status';
import { DiscoveredStream } from '../types';
import { config } from '../config';

const db = new DatabaseService();
const twitch = new TwitchService();
const discord = new DiscordService();
const status = new StatusService();

export async function scheduledHandler(event: ScheduledEvent): Promise<void> {
  console.log('Starting scheduled stream check...', event);

  try {
    await status.updateLastPollTime();
    const gameIds = await db.getUniqueGameIds();
    console.log(`Checking ${gameIds.length} categories for new streams`);

    if (gameIds.length === 0) {
      console.log('No categories configured, skipping stream check');
      return;
    }

    const streams = await twitch.getStreamsByGameIds(gameIds);
    console.log(`Found ${streams.length} live streams`);

    let newStreamsCount = 0;
    let notificationsSent = 0;
    let notificationsFailed = 0;

    for (const stream of streams) {
      const isDiscovered = await db.isStreamDiscovered(stream.id);

      if (!isDiscovered) {
        console.log(`New stream discovered: ${stream.user_name} playing ${stream.game_name} (${stream.viewer_count} viewers)`);

        const configs = await db.getNotificationConfigsByGameId(stream.game_id);
        console.log(`Checking ${configs.length} notification configs for ${stream.game_name}`);

        let shouldSendNotifications = false;
        const eligibleConfigs = [];

        for (const notificationConfig of configs) {
          // Check minimum viewers threshold
          const minViewers = notificationConfig.minimum_viewers || 1;
          if (stream.viewer_count < minViewers) {
            console.log(`Skipping notification for ${stream.user_name} - below minimum viewers threshold (${stream.viewer_count} < ${minViewers})`);
            continue;
          }

          // Check if stream matches required tags
          if (notificationConfig.required_tags && notificationConfig.required_tags.length > 0) {
            const hasAllRequiredTags = notificationConfig.required_tags.every(requiredTag =>
              stream.tags.some(streamTag => streamTag.toLowerCase() === requiredTag.toLowerCase())
            );

            if (!hasAllRequiredTags) {
              console.log(`Skipping notification for ${stream.user_name} - missing required tags: ${notificationConfig.required_tags.join(', ')}`);
              continue;
            }
          }

          eligibleConfigs.push(notificationConfig);
          shouldSendNotifications = true;
        }

        // Only save as discovered if at least one config meets the criteria
        if (shouldSendNotifications) {
          const discoveredStream: DiscoveredStream = {
            stream_id: stream.id,
            user_id: stream.user_id,
            game_id: stream.game_id,
            discovered_at: new Date().toISOString(),
            ttl: Math.floor(Date.now() / 1000) + (config.cleanup.streamTtlDays * 24 * 60 * 60),
          };

          await db.saveDiscoveredStream(discoveredStream);
          newStreamsCount++;

          for (const notificationConfig of eligibleConfigs) {
            try {
              await discord.sendNotification(notificationConfig.webhook_url, stream);
              await db.updateNotificationSuccess(notificationConfig.pk, notificationConfig.sk);
              notificationsSent++;
              console.log(`✓ Notification sent successfully for ${stream.user_name}`);
            } catch (error) {
              console.error(`✗ Failed to send notification for ${stream.user_name}:`, error);
              await db.updateNotificationFailure(notificationConfig.pk, notificationConfig.sk);
              notificationsFailed++;
            }
          }
        } else {
          console.log(`Stream ${stream.user_name} doesn't meet any notification criteria - not saving as discovered`);
        }
      }
    }

    console.log(`Stream check completed:
      - New streams discovered: ${newStreamsCount}
      - Notifications sent: ${notificationsSent}
      - Notifications failed: ${notificationsFailed}`);

    if (event.detail?.type === 'cleanup') {
      console.log('Running cleanup tasks...');
      await db.cleanupFailedConfigs();
      console.log('Cleanup completed');
    }

  } catch (error) {
    console.error('Scheduled handler error:', error);
    throw error;
  }
}