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
    const result = await dynamodb.send(new ScanCommand({
      TableName: config.tables.notificationConfigs,
    }));
    return result.Items as NotificationConfig[] || [];
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

    configs.forEach(config => {
      if (config.sk.startsWith('category#')) {
        gameIds.add(config.sk.replace('category#', ''));
      }
    });

    return Array.from(gameIds);
  }

  async saveDiscoveredStream(stream: DiscoveredStream): Promise<void> {
    await dynamodb.send(new PutCommand({
      TableName: config.tables.discoveredStreams,
      Item: stream,
    }));
  }

  async isStreamDiscovered(streamId: string): Promise<boolean> {
    const result = await dynamodb.send(new QueryCommand({
      TableName: config.tables.discoveredStreams,
      KeyConditionExpression: 'stream_id = :stream_id',
      ExpressionAttributeValues: {
        ':stream_id': streamId,
      },
    }));

    return (result.Items?.length || 0) > 0;
  }

  async updateNotificationSuccess(pk: string, sk: string): Promise<void> {
    const configs = await this.getNotificationConfigs();
    const existing = configs.find(c => c.pk === pk && c.sk === sk);

    if (existing) {
      await dynamodb.send(new PutCommand({
        TableName: config.tables.notificationConfigs,
        Item: {
          ...existing,
          last_success: new Date().toISOString(),
          failure_count: 0,
          updated_at: new Date().toISOString(),
        },
      }));
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