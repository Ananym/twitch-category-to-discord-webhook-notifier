import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Duration } from 'aws-cdk-lib';

export class TwitchNotifierStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const notificationConfigsTable = new dynamodb.Table(this, 'NotificationConfigsV2', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false,
      },
    });

    notificationConfigsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const discoveredStreamsTable = new dynamodb.Table(this, 'DiscoveredStreams', {
      partitionKey: { name: 'stream_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false,
      },
    });

    const twitchNotifierLambda = new lambda.Function(this, 'TwitchNotifierFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../lambda/dist'),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        NOTIFICATION_CONFIGS_TABLE: notificationConfigsTable.tableName,
        DISCOVERED_STREAMS_TABLE: discoveredStreamsTable.tableName,
        TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID || 'your-twitch-client-id',
        TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET || 'your-twitch-client-secret',
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'https://yourusername.github.io',
        CORS_ALLOW_ALL: process.env.CORS_ALLOW_ALL || 'false',
      },
      deadLetterQueueEnabled: false,
      retryAttempts: 0,
    });

    const functionUrl = twitchNotifierLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
        maxAge: Duration.seconds(86400), // 24 hours
      },
    });

    notificationConfigsTable.grantReadWriteData(twitchNotifierLambda);
    discoveredStreamsTable.grantReadWriteData(twitchNotifierLambda);



    const streamCheckRule = new events.Rule(this, 'StreamCheckRule', {
      schedule: events.Schedule.rate(Duration.minutes(5)),
      description: 'Trigger stream checking every 5 minutes',
    });

    streamCheckRule.addTarget(new targets.LambdaFunction(twitchNotifierLambda, {
      event: events.RuleTargetInput.fromObject({
        source: 'aws.events',
        detail: {
          type: 'stream-check'
        }
      })
    }));

    const cleanupRule = new events.Rule(this, 'CleanupRule', {
      schedule: events.Schedule.rate(Duration.hours(6)),
      description: 'Run cleanup tasks every 6 hours',
    });

    cleanupRule.addTarget(new targets.LambdaFunction(twitchNotifierLambda, {
      event: events.RuleTargetInput.fromObject({
        source: 'aws.events',
        detail: {
          type: 'cleanup'
        }
      })
    }));

    new cdk.CfnOutput(this, 'FunctionUrl', {
      value: functionUrl.url,
      description: 'Lambda Function URL',
    });

    new cdk.CfnOutput(this, 'NotificationConfigsTableName', {
      value: notificationConfigsTable.tableName,
      description: 'DynamoDB table for notification configurations',
    });

    new cdk.CfnOutput(this, 'DiscoveredStreamsTableName', {
      value: discoveredStreamsTable.tableName,
      description: 'DynamoDB table for discovered streams',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: twitchNotifierLambda.functionName,
      description: 'Lambda function name',
    });
  }
}