#!/usr/bin/env node
import 'source-map-support/register';
import * as dotenv from 'dotenv';
import * as cdk from 'aws-cdk-lib';
import { TwitchNotifierStack } from '../lib/twitch-notifier-stack';

dotenv.config({ path: '../.env' });

const app = new cdk.App();
new TwitchNotifierStack(app, 'TwitchNotifierStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});