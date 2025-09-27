# Twitch Discord Notifier

A service that monitors Twitch streams by category and sends Discord notifications when new streams go live.

## Project Structure

```
discord-category-webhook-notifier/
├── frontend/          # Static HTMX frontend for GitHub Pages
├── lambda/           # TypeScript Lambda function
├── cdk/             # AWS CDK infrastructure
└── spec.txt         # Technical specification
```

## Quick Start

1. **Deploy Infrastructure**: `cd cdk && npm run deploy`
2. **Upload Frontend**: Deploy `frontend/` to GitHub Pages
3. **Configure**: Update API endpoints in frontend HTML

## Architecture

- **Frontend**: HTMX-powered static site for webhook management
- **Backend**: AWS Lambda with DynamoDB for stream monitoring
- **Notifications**: Discord webhooks triggered every 15 minutes