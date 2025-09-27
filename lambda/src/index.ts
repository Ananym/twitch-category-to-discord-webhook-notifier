import { APIGatewayProxyResult, ScheduledEvent } from 'aws-lambda';
import { LambdaFunctionUrlEvent } from './types';
import { webHandler } from './handlers/web';
import { scheduledHandler } from './handlers/scheduled';

// Environment variables are provided by CDK deployment

export const handler = async (
  event: LambdaFunctionUrlEvent | ScheduledEvent
): Promise<APIGatewayProxyResult | void> => {
  console.log('Lambda invoked with event:', JSON.stringify(event, null, 2));

  if ('source' in event && event.source === 'aws.events') {
    console.log('Handling scheduled event');
    await scheduledHandler(event as ScheduledEvent);
    return;
  }

  console.log('Handling web request');
  return await webHandler(event as LambdaFunctionUrlEvent);
};