import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { NotificationConfig, DiscoveredStream } from '../types';
import { config } from '../config';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
const dynamodb = DynamoDBDocumentClient.from(client);

export class DatabaseService {
  async saveNotificationConfig(notificationConfig: NotificationConfig): Promise<void> {
    await dynamodb.send(new PutCommand({
      TableName: config.tables.notificationConfigs,
      Item: notificationConfig,
    }));
  }

  async getNotificationConfigs(): Promise<NotificationConfig[]> {
    console.log(`Scanning table: ${config.tables.notificationConfigs}`);
    const result = await dynamodb.send(new ScanCommand({
      TableName: config.tables.notificationConfigs,
    }));

    const items = result.Items as NotificationConfig[] || [];
    console.log(`Scan returned ${items.length} items`);

    if (items.length > 0) {
      console.log('Raw scan results:');
      items.forEach((item, index) => {
        console.log(`  Item ${index + 1}:`, JSON.stringify(item, null, 2));
      });
    }

    // Sort by created_at (oldest first), then alphabetically by game_name
    items.sort((a, b) => {
      if (!a.created_at) return 1;
      if (!b.created_at) return -1;
      const dateCompare = a.created_at.localeCompare(b.created_at);
      if (dateCompare !== 0) return dateCompare;
      return (a.game_name || '').localeCompare(b.game_name || '');
    });

    return items;
  }

  async getNotificationConfigsByWebhook(webhookUrl: string): Promise<NotificationConfig[]> {
    const pk = `webhook#${this.hashWebhookUrl(webhookUrl)}`;

    const result = await dynamodb.send(new QueryCommand({
      TableName: config.tables.notificationConfigs,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': pk,
      },
    }));

    return (result.Items as NotificationConfig[]) || [];
  }

  async getNotificationConfigsByGameId(gameId: string): Promise<NotificationConfig[]> {
    // Since we changed the schema to use config#{uuid} as SK, we need to scan and filter
    const allConfigs = await this.getNotificationConfigs();
    return allConfigs.filter(config => config.game_id === gameId);
  }


  async deleteNotificationConfig(pk: string, sk: string): Promise<void> {
    await dynamodb.send(new DeleteCommand({
      TableName: config.tables.notificationConfigs,
      Key: { pk, sk },
    }));
  }

  async getUniqueGameIds(): Promise<string[]> {
    const configs = await this.getNotificationConfigs();
    const gameIds = new Set<string>();

    console.log(`Processing ${configs.length} configs in getUniqueGameIds()`);

    configs.forEach((config, index) => {
      console.log(`  Config ${index + 1}: sk="${config.sk}", game_id="${config.game_id}"`);
      if (config.sk.startsWith('config#') && config.game_id) {
        console.log(`    ✓ Adding game_id: ${config.game_id}`);
        gameIds.add(config.game_id);
      } else {
        console.log(`    ✗ Skipping - doesn't match criteria`);
      }
    });

    const result = Array.from(gameIds);
    console.log(`Final unique game IDs: [${result.join(', ')}]`);
    return result;
  }

  async saveDiscoveredStream(stream: DiscoveredStream): Promise<void> {
    await dynamodb.send(new PutCommand({
      TableName: config.tables.discoveredStreams,
      Item: stream,
    }));
  }

  async isStreamNotifiedForConfig(streamId: string, configKey: string): Promise<boolean> {
    const result = await dynamodb.send(new QueryCommand({
      TableName: config.tables.discoveredStreams,
      KeyConditionExpression: 'stream_id = :stream_id AND config_key = :config_key',
      ExpressionAttributeValues: {
        ':stream_id': streamId,
        ':config_key': configKey,
      },
    }));

    return (result.Items?.length || 0) > 0;
  }

  async updateNotificationSuccess(pk: string, sk: string): Promise<void> {
    const configs = await this.getNotificationConfigs();
    const existing = configs.find(c => c.pk === pk && c.sk === sk);

    if (existing) {
      const timestamp = new Date().toISOString();
      console.log(`Updating notification success for ${pk}/${sk}: setting last_success to ${timestamp}, resetting failure_count to 0`);

      await dynamodb.send(new PutCommand({
        TableName: config.tables.notificationConfigs,
        Item: {
          ...existing,
          last_success: timestamp,
          failure_count: 0,
          updated_at: timestamp,
        },
      }));
    } else {
      console.log(`Config not found for success update: ${pk}/${sk}`);
    }
  }

  async updateNotificationFailure(pk: string, sk: string): Promise<void> {
    const configs = await this.getNotificationConfigs();
    const existing = configs.find(c => c.pk === pk && c.sk === sk);

    if (existing) {
      const currentFailureCount = existing.failure_count || 0;

      await dynamodb.send(new PutCommand({
        TableName: config.tables.notificationConfigs,
        Item: {
          ...existing,
          failure_count: currentFailureCount + 1,
          updated_at: new Date().toISOString(),
        },
      }));
    }
  }


  async cleanupFailedConfigs(): Promise<void> {
    const configs = await this.getNotificationConfigs();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.cleanup.failureTimeoutDays);

    for (const configItem of configs) {
      if (configItem.failure_count >= config.cleanup.maxFailureCount) {
        const lastSuccess = configItem.last_success ? new Date(configItem.last_success) : null;
        if (!lastSuccess || lastSuccess < cutoffDate) {
          await this.deleteNotificationConfig(configItem.pk, configItem.sk);
        }
      }
    }
  }

  async saveStatusData(key: string, value: string): Promise<void> {
    await dynamodb.send(new PutCommand({
      TableName: config.tables.notificationConfigs,
      Item: {
        pk: 'status',
        sk: key,
        value: value,
        updated_at: new Date().toISOString(),
      },
    }));
  }

  async incrementNotificationCounter(type: 'success' | 'failure'): Promise<void> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const pk = 'counter';
    const sk = `${type}#${today}`;

    try {
      // Try to get existing counter
      const result = await dynamodb.send(new QueryCommand({
        TableName: config.tables.notificationConfigs,
        KeyConditionExpression: 'pk = :pk AND sk = :sk',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':sk': sk,
        },
      }));

      const currentCount = result.Items?.[0]?.count || 0;
      const newCount = currentCount + 1;

      await dynamodb.send(new PutCommand({
        TableName: config.tables.notificationConfigs,
        Item: {
          pk,
          sk,
          count: newCount,
          updated_at: new Date().toISOString(),
          // TTL: expire after 30 days
          ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
        },
      }));
    } catch (error) {
      console.error(`Failed to increment ${type} counter:`, error);
    }
  }

  async getNotificationCounts24h(): Promise<{ sent: number; failed: number }> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get dates to check (today and yesterday to cover 24h window)
    const dates = [
      now.toISOString().split('T')[0],
      yesterday.toISOString().split('T')[0]
    ];

    let sent = 0;
    let failed = 0;

    for (const date of dates) {
      try {
        const [successResult, failureResult] = await Promise.all([
          dynamodb.send(new QueryCommand({
            TableName: config.tables.notificationConfigs,
            KeyConditionExpression: 'pk = :pk AND sk = :sk',
            ExpressionAttributeValues: {
              ':pk': 'counter',
              ':sk': `success#${date}`,
            },
          })),
          dynamodb.send(new QueryCommand({
            TableName: config.tables.notificationConfigs,
            KeyConditionExpression: 'pk = :pk AND sk = :sk',
            ExpressionAttributeValues: {
              ':pk': 'counter',
              ':sk': `failure#${date}`,
            },
          })),
        ]);

        const successCount = successResult.Items?.[0]?.count || 0;
        const failureCount = failureResult.Items?.[0]?.count || 0;

        // For today, use full count. For yesterday, only count if we're within 24h of when it was created
        if (date === now.toISOString().split('T')[0]) {
          sent += successCount;
          failed += failureCount;
        } else {
          // For yesterday's date, we need to check if the counter was updated within last 24h
          const successUpdated = successResult.Items?.[0]?.updated_at;
          const failureUpdated = failureResult.Items?.[0]?.updated_at;

          if (successUpdated && new Date(successUpdated) > yesterday) {
            sent += successCount;
          }
          if (failureUpdated && new Date(failureUpdated) > yesterday) {
            failed += failureCount;
          }
        }
      } catch (error) {
        console.error(`Error getting counts for ${date}:`, error);
      }
    }

    return { sent, failed };
  }

  async getStatusData(key: string): Promise<string | null> {
    const result = await dynamodb.send(new QueryCommand({
      TableName: config.tables.notificationConfigs,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: {
        ':pk': 'status',
        ':sk': key,
      },
    }));

    const item = result.Items?.[0];
    return item?.value || null;
  }

  private hashWebhookUrl(url: string): string {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}