import { APIGatewayProxyResult } from "aws-lambda";
import { LambdaFunctionUrlEvent } from "../types";
import { DatabaseService } from "../services/database";
import { TwitchService } from "../services/twitch";
import { DiscordService } from "../services/discord";
import { StatusService } from "../services/status";
import { NotificationConfig, StatusInfo } from "../types";
import { config } from "../config";
import { randomUUID } from "crypto";

const db = new DatabaseService();
const twitch = new TwitchService();
const discord = new DiscordService();
const statusService = new StatusService();

export async function webHandler(
  event: LambdaFunctionUrlEvent
): Promise<APIGatewayProxyResult> {
  // CORS headers are handled by Lambda Function URL CORS configuration
  const headers = {
    "Content-Type": "text/html",
  };

  try {
    const path = event.rawPath;
    const method = event.requestContext.http.method;

    // OPTIONS requests should be handled by Lambda Function URL CORS configuration

    if (path === "/notifications" && method === "GET") {
      console.log(
        "GET /notifications - Query params:",
        event.queryStringParameters
      );
      console.log("GET /notifications - Body:", event.body);
      console.log(
        "GET /notifications - isBase64Encoded:",
        event.isBase64Encoded
      );

      let webhookUrl = event.queryStringParameters?.webhook_url;

      // If not in query params, check if HTMX sent it in the body
      if (!webhookUrl && event.body) {
        try {
          const decodedBody = event.isBase64Encoded
            ? Buffer.from(event.body, "base64").toString()
            : event.body;
          console.log("Decoded body:", decodedBody);
          const params = new URLSearchParams(decodedBody);
          webhookUrl = params.get("webhook_url") || undefined;
          console.log("Webhook URL from body:", webhookUrl);
        } catch (error) {
          console.log("Failed to parse body for webhook_url:", error);
        }
      }

      console.log("Final webhookUrl:", webhookUrl);

      if (webhookUrl) {
        return await getNotificationsByWebhook(webhookUrl, headers);
      }

      // Don't show all notifications - require webhook_url parameter
      return {
        statusCode: 400,
        headers,
        body: '<div class="error">webhook_url parameter is required</div>',
      };
    }

    if (path === "/notifications" && method === "POST") {
      return await createNotification(event, headers);
    }

    // Handle DELETE /notifications/{pk}/{sk}
    const deleteMatch = path.match(/^\/notifications\/([^\/]+)\/([^\/]+)$/);
    if (deleteMatch && method === "DELETE") {
      return await deleteNotification(
        decodeURIComponent(deleteMatch[1]),
        decodeURIComponent(deleteMatch[2]),
        event,
        headers
      );
    }

    // Handle PUT /notifications/{pk}/{sk}
    const updateMatch = path.match(/^\/notifications\/([^\/]+)\/([^\/]+)$/);
    if (updateMatch && method === "PUT") {
      return await updateNotification(
        decodeURIComponent(updateMatch[1]),
        decodeURIComponent(updateMatch[2]),
        event,
        headers
      );
    }

    if (path === "/categories/search" && method === "GET") {
      return await searchCategories(event, headers);
    }

    // Handle edit form requests: /notifications/{pk}/{sk}/edit
    const editMatch = path.match(/^\/notifications\/([^\/]+)\/([^\/]+)\/edit$/);
    if (editMatch && method === "GET") {
      const webhookUrl = event.queryStringParameters?.webhook_url;
      if (!webhookUrl) {
        return {
          statusCode: 400,
          headers,
          body: '<div class="error">Missing webhook URL parameter</div>',
        };
      }
      return await getEditForm(
        decodeURIComponent(editMatch[1]),
        decodeURIComponent(editMatch[2]),
        webhookUrl,
        headers
      );
    }

    // Handle view requests: /notifications/{pk}/{sk}
    const viewMatch = path.match(/^\/notifications\/([^\/]+)\/([^\/]+)$/);
    if (viewMatch && method === "GET") {
      const webhookUrl = event.queryStringParameters?.webhook_url;
      if (!webhookUrl) {
        return {
          statusCode: 400,
          headers,
          body: '<div class="error">Missing webhook URL parameter</div>',
        };
      }
      return await getConfigView(
        viewMatch[1],
        viewMatch[2],
        webhookUrl,
        headers
      );
    }

    if (path === "/status" && method === "GET") {
      return await getStatus(headers);
    }

    return {
      statusCode: 404,
      headers,
      body: '<div class="error">Not found</div>',
    };
  } catch (error) {
    console.error("Web handler error:", error);
    return {
      statusCode: 500,
      headers,
      body: '<div class="error">Internal server error</div>',
    };
  }
}

async function getNotificationsByWebhook(
  webhookUrl: string,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    const configs = await db.getNotificationConfigsByWebhook(webhookUrl);

    // Generate HTML for configurations list with edit/delete buttons plus a blank form
    let html = '<div class="webhook-configs">';

    // Add existing configurations
    configs.forEach((config) => {
      // Debug log to see what we're getting
      console.log("Config item:", JSON.stringify(config, null, 2));

      // Skip configs with missing essential data
      if (!config.webhook_url || !config.pk || !config.sk) {
        console.warn("Skipping config with missing essential data:", config);
        return;
      }

      const successInfo = config.last_success
        ? `<i data-lucide="check-circle"></i> Last success: ${new Date(
            config.last_success
          ).toLocaleDateString()}`
        : `<i data-lucide="alert-triangle"></i> Never successful`;

      const failureInfo =
        config.failure_count > 0
          ? `<i data-lucide="x-circle"></i> ${config.failure_count} failures`
          : "";

      const tagsInfo =
        config.required_tags && config.required_tags.length > 0
          ? `<i data-lucide="tag"></i> Required Tags: ${config.required_tags.join(
              ", "
            )}`
          : "";

      const viewersInfo =
        config.minimum_viewers && config.minimum_viewers > 1
          ? `<i data-lucide="users"></i> Min viewers: ${config.minimum_viewers}`
          : "";

      // Fix date handling
      const createdDate = config.created_at
        ? new Date(config.created_at)
        : new Date();
      const formattedDate = isNaN(createdDate.getTime())
        ? "Unknown"
        : createdDate.toLocaleDateString();

      html += `
        <div class="config-item">
          <div class="config-info">
            <div class="config-header">
              <h3>${config.game_name || `Game ID: ${config.game_id}`}</h3>
              <div class="config-actions">
                <!-- <button class="btn-edit"
                        hx-get="/notifications/${
                          config.pk
                        }/${config.sk}/edit?webhook_url=${encodeURIComponent(
        config.webhook_url
      )}"
                        hx-target="closest .config-item"
                        hx-swap="outerHTML">
                  Edit
                </button> -->
                <button class="btn-delete"
                        hx-delete="/notifications/${encodeURIComponent(
                          config.pk
                        )}/${encodeURIComponent(config.sk)}"
                        hx-vals='{"webhook_url": "${config.webhook_url.replace(
                          /"/g,
                          '\\"'
                        )}"}'
                        hx-target="closest .config-item"
                        hx-swap="delete"
                        hx-confirm="Are you sure you want to delete this notification for ${
                          config.game_name
                        }?">
                  Delete
                </button>
              </div>
            </div>
            <div class="config-details">
              <div class="config-meta">
                <div class="meta-item">${successInfo}</div>
                ${failureInfo ? `<div class="meta-item">${failureInfo}</div>` : ''}
                ${tagsInfo ? `<div class="meta-item">${tagsInfo}</div>` : ''}
                ${viewersInfo ? `<div class="meta-item">${viewersInfo}</div>` : ''}
              </div>
              <small class="created-date">Created: ${formattedDate}</small>
            </div>
          </div>
        </div>
      `;
    });

    // Add blank form for new configuration
    html += `
      <div class="config-item new">
        <div class="config-info">
          <div class="config-header">
            <h3>Add New Notification</h3>
          </div>

          <form class="add-config-form"
                hx-post="/notifications"
                hx-target="#all-notifications"
                hx-swap="innerHTML"
                hx-vals='{"webhook_url": "${webhookUrl}"}'>

            <div class="form-fields">
              <div class="field-group">
                <label>Category: <span class="required">*</span></label>
                <select name="category" class="category-search" required>
                  <option value="">Search and select a game...</option>
                </select>
              </div>

              <div class="field-row">
                <div class="field-group">
                  <label>Required Tags:</label>
                  <input name="required_tags" type="text" placeholder="e.g. english, drops"
                         >
                </div>
                <div class="field-group">
                  <label>Min Viewers:</label>
                  <input name="minimum_viewers" type="number" min="0" value="5"
                         >
                </div>
              </div>

              <div class="form-actions">
                <button type="submit" class="btn-add" disabled>Add</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    `;

    html += "</div>";

    return { statusCode: 200, headers, body: html };
  } catch (error) {
    console.error("Error fetching notifications by webhook:", error);
    return {
      statusCode: 500,
      headers,
      body: '<div class="error">Failed to load configurations</div>',
    };
  }
}

async function createNotification(
  event: LambdaFunctionUrlEvent,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body = event.body;
  if (!body) {
    return {
      statusCode: 400,
      headers,
      body: '<div class="error">Missing request body</div>',
    };
  }

  // Lambda Function URLs automatically base64 encode form data
  // Based on AWS documentation and community findings
  const decodedBody = event.isBase64Encoded
    ? Buffer.from(body, "base64").toString()
    : body;
  const params = new URLSearchParams(decodedBody);

  console.log("Decoded body:", decodedBody);
  console.log("isBase64Encoded:", event.isBase64Encoded);

  const webhookUrl = params.get("webhook_url");
  const categoryParam = params.get("category");
  const requiredTagsParam = params.get("required_tags");
  const minimumViewersParam = params.get("minimum_viewers");

  console.log("Parsed params:", {
    webhookUrl: !!webhookUrl,
    category: categoryParam,
    allParams: Object.fromEntries(params.entries()),
  });

  // Parse category JSON
  let gameId: string;
  let gameName: string;

  if (!webhookUrl || !categoryParam) {
    return {
      statusCode: 400,
      headers,
      body: `<div class="error">Missing required fields. Received: webhook_url=${!!webhookUrl}, category=${!!categoryParam}</div>`,
    };
  }

  try {
    const categoryData = JSON.parse(categoryParam);
    gameId = categoryData.id;
    gameName = categoryData.name;

    if (!gameId || !gameName) {
      throw new Error("Invalid category data structure");
    }
  } catch (error) {
    return {
      statusCode: 400,
      headers,
      body: '<div class="error">Invalid category data format</div>',
    };
  }

  // Parse required tags (comma-separated)
  const requiredTags = requiredTagsParam
    ? requiredTagsParam
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    : [];

  // Parse minimum viewers
  const minimumViewers = minimumViewersParam
    ? parseInt(minimumViewersParam, 10)
    : 1;

  const isValidWebhook = await discord.validateWebhook(webhookUrl);
  if (!isValidWebhook) {
    return {
      statusCode: 400,
      headers,
      body: '<div class="error">Invalid Discord webhook URL</div>',
    };
  }

  const category = await twitch.validateCategory(gameId);
  if (!category) {
    return {
      statusCode: 400,
      headers,
      body: '<div class="error">Invalid Twitch category</div>',
    };
  }

  const pk = `webhook#${hashWebhookUrl(webhookUrl)}`;
  const sk = `config#${randomUUID()}`;

  const notificationConfig: NotificationConfig = {
    pk,
    sk,
    webhook_url: webhookUrl,
    game_id: gameId,
    game_name: gameName,
    required_tags: requiredTags.length > 0 ? requiredTags : undefined,
    minimum_viewers: minimumViewers > 1 ? minimumViewers : undefined,
    created_at: new Date().toISOString(),
    failure_count: 0,
    updated_at: new Date().toISOString(),
  };

  await db.saveNotificationConfig(notificationConfig);

  return await getNotificationsByWebhook(webhookUrl, headers);
}

async function deleteNotification(
  pk: string,
  sk: string,
  event: LambdaFunctionUrlEvent,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  if (!pk || !sk) {
    return {
      statusCode: 400,
      headers,
      body: '<div class="error">Missing resource identifiers</div>',
    };
  }

  // Get webhook URL from request body for security validation
  const body = event.body;
  if (!body) {
    return {
      statusCode: 400,
      headers,
      body: '<div class="error">Missing request body</div>',
    };
  }

  const decodedBody = event.isBase64Encoded
    ? Buffer.from(body, "base64").toString()
    : body;

  let webhookUrl: string;
  try {
    // Try JSON first (hx-vals)
    const jsonData = JSON.parse(decodedBody);
    webhookUrl = jsonData.webhook_url || "";
  } catch {
    // Fall back to form data
    const params = new URLSearchParams(decodedBody);
    webhookUrl = params.get("webhook_url") || "";
  }

  if (!webhookUrl) {
    return {
      statusCode: 400,
      headers,
      body: '<div class="error">Missing webhook URL for security validation</div>',
    };
  }

  // Validate the keys have the expected format
  if (!pk.startsWith("webhook#") || !sk.startsWith("config#")) {
    return {
      statusCode: 400,
      headers,
      body: '<div class="error">Invalid configuration ID format</div>',
    };
  }

  // Get the existing config to validate ownership
  const configs = await db.getNotificationConfigs();
  const existingConfig = configs.find((c) => c.pk === pk && c.sk === sk);

  if (!existingConfig) {
    return {
      statusCode: 404,
      headers,
      body: '<div class="error">Configuration not found</div>',
    };
  }

  // Validate that the webhook URL matches (security check)
  if (existingConfig.webhook_url !== webhookUrl) {
    return {
      statusCode: 403,
      headers,
      body: '<div class="error">Access denied</div>',
    };
  }

  try {
    await db.deleteNotificationConfig(pk, sk);

    // Return empty response - HTMX will delete the target element
    return { statusCode: 200, headers, body: "" };
  } catch (error) {
    console.error("Error deleting notification:", error);
    return {
      statusCode: 500,
      headers,
      body: '<div class="error">Failed to delete notification. Please try again.</div>',
    };
  }
}

async function updateNotification(
  pk: string,
  sk: string,
  event: LambdaFunctionUrlEvent,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  if (!pk || !sk) {
    return {
      statusCode: 400,
      headers,
      body: '<div class="error">Missing resource identifiers</div>',
    };
  }

  const body = event.body;
  if (!body) {
    return {
      statusCode: 400,
      headers,
      body: '<div class="error">Missing request body</div>',
    };
  }

  // HTMX sends form data
  const decodedBody = event.isBase64Encoded
    ? Buffer.from(body, "base64").toString()
    : body;
  const params = new URLSearchParams(decodedBody);

  const webhookUrl = params.get("webhook_url");
  const gameId = params.get("game_id");
  const gameName = params.get("game_name");
  const requiredTagsParam = params.get("required_tags");
  const minimumViewersParam = params.get("minimum_viewers");

  if (!webhookUrl || !gameId || !gameName) {
    return {
      statusCode: 400,
      headers,
      body: '<div class="error">Missing required fields</div>',
    };
  }

  // Validate the keys have the expected format
  if (!pk.startsWith("webhook#") || !sk.startsWith("config#")) {
    return {
      statusCode: 400,
      headers,
      body: '<div class="error">Invalid configuration ID format</div>',
    };
  }

  // Get existing config to preserve creation date and other fields
  const configs = await db.getNotificationConfigs();
  const existingConfig = configs.find((c) => c.pk === pk && c.sk === sk);

  if (!existingConfig) {
    return {
      statusCode: 404,
      headers,
      body: '<div class="error">Configuration not found</div>',
    };
  }

  // Parse required tags (comma-separated)
  const requiredTags = requiredTagsParam
    ? requiredTagsParam
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    : [];

  // Parse minimum viewers
  const minimumViewers = minimumViewersParam
    ? parseInt(minimumViewersParam, 10)
    : 1;

  // Validate webhook URL
  const isValidWebhook = await discord.validateWebhook(webhookUrl);
  if (!isValidWebhook) {
    return {
      statusCode: 400,
      headers,
      body: '<div class="error">Invalid Discord webhook URL</div>',
    };
  }

  const updatedConfig: NotificationConfig = {
    ...existingConfig,
    required_tags: requiredTags.length > 0 ? requiredTags : undefined,
    minimum_viewers: minimumViewers > 1 ? minimumViewers : undefined,
    updated_at: new Date().toISOString(),
  };

  try {
    await db.saveNotificationConfig(updatedConfig);

    // Return the updated single item view
    return await getConfigView(pk, sk, webhookUrl, headers);
  } catch (error) {
    console.error("Error updating notification:", error);
    return {
      statusCode: 500,
      headers,
      body: '<div class="error">Failed to update notification. Please try again.</div>',
    };
  }
}

async function searchCategories(
  event: LambdaFunctionUrlEvent,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const query = event.queryStringParameters?.q || "";

  if (!query.trim()) {
    return {
      statusCode: 200,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify([]),
    };
  }

  try {
    const categories = await twitch.searchCategories(query);

    const results = categories.map((category) => ({
      value: JSON.stringify({ id: category.id, name: category.name }),
      label: category.name,
    }));

    return {
      statusCode: 200,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(results),
    };
  } catch (error) {
    console.error("Category search error:", error);
    return {
      statusCode: 500,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify([]),
    };
  }
}

async function getEditForm(
  pk: string,
  sk: string,
  webhookUrl: string,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    // Get the configuration to edit
    const configs = await db.getNotificationConfigs();
    const config = configs.find((c) => c.pk === pk && c.sk === sk);

    if (!config) {
      return {
        statusCode: 404,
        headers,
        body: '<div class="error">Configuration not found</div>',
      };
    }

    // Validate that the webhook URL matches (security check)
    if (config.webhook_url !== webhookUrl) {
      return {
        statusCode: 403,
        headers,
        body: '<div class="error">Access denied</div>',
      };
    }

    const tagsValue = config.required_tags?.join(", ") || "";
    const viewersValue = config.minimum_viewers || 1;

    const html = `
      <div class="config-item editing">
        <div class="config-info">
          <form class="inline-edit-form"
                hx-put="/notifications/${encodeURIComponent(
                  config.pk
                )}/${encodeURIComponent(config.sk)}"
                hx-target="closest .config-item"
                hx-swap="outerHTML">
            <input type="hidden" name="webhook_url" value="${
              config.webhook_url
            }">
            <input type="hidden" name="selected_game_id" value="${
              config.game_id
            }">
            <input type="hidden" name="selected_game_name" value="${
              config.game_name
            }">

            <div class="form-group-inline">
              <label>Category:</label>
              <span class="category-readonly">${config.game_name}</span>
            </div>

            <div class="form-row">
              <div class="form-group-inline">
                <label>Required Tags:</label>
                <input name="required_tags" type="text" value="${tagsValue}" placeholder="english, gaming, drops">
              </div>
              <div class="form-group-inline">
                <label>Min Viewers:</label>
                <input name="minimum_viewers" type="number" min="0" value="${viewersValue}">
              </div>
            </div>

            <div class="edit-actions">
              <button type="submit" class="btn-warning btn-sm">Save</button>
              <button type="button" class="btn-secondary btn-sm"
                      hx-get="/notifications/${encodeURIComponent(
                        config.pk
                      )}/${encodeURIComponent(
      config.sk
    )}?webhook_url=${encodeURIComponent(config.webhook_url)}"
                      hx-target="closest .config-item"
                      hx-swap="outerHTML">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;

    return { statusCode: 200, headers, body: html };
  } catch (error) {
    console.error("Error getting edit form:", error);
    return {
      statusCode: 500,
      headers,
      body: '<div class="error">Failed to load edit form</div>',
    };
  }
}

async function getConfigView(
  pk: string,
  sk: string,
  webhookUrl: string,
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    const configs = await db.getNotificationConfigs();
    const config = configs.find((c) => c.pk === pk && c.sk === sk);

    if (!config) {
      return {
        statusCode: 404,
        headers,
        body: '<div class="error">Configuration not found</div>',
      };
    }

    // Check for missing essential data
    if (!config.webhook_url || !config.pk || !config.sk) {
      return {
        statusCode: 500,
        headers,
        body: '<div class="error">Configuration data is corrupted</div>',
      };
    }

    // Validate that the webhook URL matches (security check)
    if (config.webhook_url !== webhookUrl) {
      return {
        statusCode: 403,
        headers,
        body: '<div class="error">Access denied</div>',
      };
    }

    // Generate the same view HTML as in getNotificationsByWebhook
    const successInfo = config.last_success
      ? `<i data-lucide="check-circle"></i> Last success: ${new Date(
          config.last_success
        ).toLocaleDateString()}`
      : "";

    const failureInfo =
      config.failure_count > 0
        ? `<i data-lucide="x-circle"></i> Failures: ${config.failure_count}`
        : "";

    const tagsInfo =
      config.required_tags && config.required_tags.length > 0
        ? `<i data-lucide="tag"></i> Tags: ${config.required_tags.join(
            ", "
          )}`
        : "";

    const viewersInfo =
      config.minimum_viewers && config.minimum_viewers > 1
        ? `<i data-lucide="users"></i> Min viewers: ${config.minimum_viewers}`
        : "";

    const createdDate = config.created_at
      ? new Date(config.created_at)
      : new Date();
    const formattedDate = isNaN(createdDate.getTime())
      ? "Unknown"
      : createdDate.toLocaleDateString();

    const html = `
      <div class="config-item">
        <div class="config-info">
          <div class="config-header">
            <h3>${config.game_name || `Game ID: ${config.game_id}`}</h3>
            <div class="config-actions">
              <!-- <button class="btn-edit"
                      hx-get="/notifications/${
                        config.pk
                      }/${config.sk}/edit?webhook_url=${encodeURIComponent(
      config.webhook_url
    )}"
                      hx-target="closest .config-item"
                      hx-swap="outerHTML">
                Edit
              </button> -->
              <button class="btn-delete"
                      hx-delete="/notifications/${encodeURIComponent(
                        config.pk
                      )}/${encodeURIComponent(config.sk)}"
                      hx-vals='{"webhook_url": "${config.webhook_url.replace(
                        /"/g,
                        '\\"'
                      )}"}'
                      hx-target="closest .config-item"
                      hx-swap="delete"
                      hx-confirm="Are you sure you want to delete this notification for ${
                        config.game_name
                      }?">
                Delete
              </button>
            </div>
          </div>
          <div class="config-details">
            <div class="config-meta">
              <div class="meta-item">${successInfo}</div>
              ${failureInfo ? `<div class="meta-item">${failureInfo}</div>` : ''}
              ${tagsInfo ? `<div class="meta-item">${tagsInfo}</div>` : ''}
              ${viewersInfo ? `<div class="meta-item">${viewersInfo}</div>` : ''}
            </div>
            <small class="created-date">Created: ${formattedDate}</small>
          </div>
        </div>
      </div>
    `;

    return { statusCode: 200, headers, body: html };
  } catch (error) {
    console.error("Error getting config view:", error);
    return {
      statusCode: 500,
      headers,
      body: '<div class="error">Failed to load configuration</div>',
    };
  }
}

async function getStatus(
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    const statusInfo = await statusService.getStatus();

    let twitchApiError = "";
    try {
      await twitch.getAccessToken();
    } catch (error) {
      twitchApiError = "Twitch API authentication failed";
    }

    if (twitchApiError) {
      statusInfo.twitch_api_error = twitchApiError;
    }

    const html = `
      <div class="status-line">
        ${statusInfo.notification_configs_count} configs |
        ${statusInfo.notifications_sent_24h} sent (24h) |
        ${
          statusInfo.failed_notifications_24h > 0
            ? `<span class="status-error">${statusInfo.failed_notifications_24h} failed (24h)</span>`
            : "0 failed (24h)"
        } |
        Last poll: ${statusInfo.time_since_last_poll}${
      statusInfo.twitch_api_error
        ? ` | <span class="status-error">API Error</span>`
        : ""
    }
      </div>
    `;

    return { statusCode: 200, headers, body: html };
  } catch (error) {
    console.error("Status error:", error);
    return {
      statusCode: 500,
      headers,
      body: '<div class="error">Failed to load status</div>',
    };
  }
}

function hashWebhookUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
