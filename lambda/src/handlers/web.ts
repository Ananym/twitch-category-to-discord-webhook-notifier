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

      const languageInfo =
        config.required_language && config.required_language.trim() !== ""
          ? `<i data-lucide="globe"></i> Language: ${config.required_language.toUpperCase()}`
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
                ${languageInfo ? `<div class="meta-item">${languageInfo}</div>` : ''}
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
                  <label>Required Language:</label>
                  <select name="required_language" class="language-select">
                    <option value="">Any Language</option>
                    <option value="aa">aa - Afar</option>
                    <option value="ab">ab - Abkhazian</option>
                    <option value="ae">ae - Avestan</option>
                    <option value="af">af - Afrikaans</option>
                    <option value="ak">ak - Akan</option>
                    <option value="am">am - Amharic</option>
                    <option value="an">an - Aragonese</option>
                    <option value="ar">ar - Arabic</option>
                    <option value="as">as - Assamese</option>
                    <option value="av">av - Avaric</option>
                    <option value="ay">ay - Aymara</option>
                    <option value="az">az - Azerbaijani</option>
                    <option value="ba">ba - Bashkir</option>
                    <option value="be">be - Belarusian</option>
                    <option value="bg">bg - Bulgarian</option>
                    <option value="bh">bh - Bihari languages</option>
                    <option value="bi">bi - Bislama</option>
                    <option value="bm">bm - Bambara</option>
                    <option value="bn">bn - Bengali</option>
                    <option value="bo">bo - Tibetan</option>
                    <option value="br">br - Breton</option>
                    <option value="bs">bs - Bosnian</option>
                    <option value="ca">ca - Catalan</option>
                    <option value="ce">ce - Chechen</option>
                    <option value="ch">ch - Chamorro</option>
                    <option value="co">co - Corsican</option>
                    <option value="cr">cr - Cree</option>
                    <option value="cs">cs - Czech</option>
                    <option value="cu">cu - Church Slavic</option>
                    <option value="cv">cv - Chuvash</option>
                    <option value="cy">cy - Welsh</option>
                    <option value="da">da - Danish</option>
                    <option value="de">de - German</option>
                    <option value="dv">dv - Divehi</option>
                    <option value="dz">dz - Dzongkha</option>
                    <option value="ee">ee - Ewe</option>
                    <option value="el">el - Greek</option>
                    <option value="en">en - English</option>
                    <option value="eo">eo - Esperanto</option>
                    <option value="es">es - Spanish</option>
                    <option value="et">et - Estonian</option>
                    <option value="eu">eu - Basque</option>
                    <option value="fa">fa - Persian</option>
                    <option value="ff">ff - Fulah</option>
                    <option value="fi">fi - Finnish</option>
                    <option value="fj">fj - Fijian</option>
                    <option value="fo">fo - Faroese</option>
                    <option value="fr">fr - French</option>
                    <option value="fy">fy - Western Frisian</option>
                    <option value="ga">ga - Irish</option>
                    <option value="gd">gd - Gaelic</option>
                    <option value="gl">gl - Galician</option>
                    <option value="gn">gn - Guarani</option>
                    <option value="gu">gu - Gujarati</option>
                    <option value="gv">gv - Manx</option>
                    <option value="ha">ha - Hausa</option>
                    <option value="he">he - Hebrew</option>
                    <option value="hi">hi - Hindi</option>
                    <option value="ho">ho - Hiri Motu</option>
                    <option value="hr">hr - Croatian</option>
                    <option value="ht">ht - Haitian</option>
                    <option value="hu">hu - Hungarian</option>
                    <option value="hy">hy - Armenian</option>
                    <option value="hz">hz - Herero</option>
                    <option value="ia">ia - Interlingua</option>
                    <option value="id">id - Indonesian</option>
                    <option value="ie">ie - Interlingue</option>
                    <option value="ig">ig - Igbo</option>
                    <option value="ii">ii - Sichuan Yi</option>
                    <option value="ik">ik - Inupiaq</option>
                    <option value="io">io - Ido</option>
                    <option value="is">is - Icelandic</option>
                    <option value="it">it - Italian</option>
                    <option value="iu">iu - Inuktitut</option>
                    <option value="ja">ja - Japanese</option>
                    <option value="jv">jv - Javanese</option>
                    <option value="ka">ka - Georgian</option>
                    <option value="kg">kg - Kongo</option>
                    <option value="ki">ki - Kikuyu</option>
                    <option value="kj">kj - Kuanyama</option>
                    <option value="kk">kk - Kazakh</option>
                    <option value="kl">kl - Kalaallisut</option>
                    <option value="km">km - Central Khmer</option>
                    <option value="kn">kn - Kannada</option>
                    <option value="ko">ko - Korean</option>
                    <option value="kr">kr - Kanuri</option>
                    <option value="ks">ks - Kashmiri</option>
                    <option value="ku">ku - Kurdish</option>
                    <option value="kv">kv - Komi</option>
                    <option value="kw">kw - Cornish</option>
                    <option value="ky">ky - Kirghiz</option>
                    <option value="la">la - Latin</option>
                    <option value="lb">lb - Luxembourgish</option>
                    <option value="lg">lg - Ganda</option>
                    <option value="li">li - Limburgan</option>
                    <option value="ln">ln - Lingala</option>
                    <option value="lo">lo - Lao</option>
                    <option value="lt">lt - Lithuanian</option>
                    <option value="lu">lu - Luba-Katanga</option>
                    <option value="lv">lv - Latvian</option>
                    <option value="mg">mg - Malagasy</option>
                    <option value="mh">mh - Marshallese</option>
                    <option value="mi">mi - Maori</option>
                    <option value="mk">mk - Macedonian</option>
                    <option value="ml">ml - Malayalam</option>
                    <option value="mn">mn - Mongolian</option>
                    <option value="mr">mr - Marathi</option>
                    <option value="ms">ms - Malay</option>
                    <option value="mt">mt - Maltese</option>
                    <option value="my">my - Burmese</option>
                    <option value="na">na - Nauru</option>
                    <option value="nb">nb - Norwegian Bokmål</option>
                    <option value="nd">nd - North Ndebele</option>
                    <option value="ne">ne - Nepali</option>
                    <option value="ng">ng - Ndonga</option>
                    <option value="nl">nl - Dutch</option>
                    <option value="nn">nn - Norwegian Nynorsk</option>
                    <option value="no">no - Norwegian</option>
                    <option value="nr">nr - South Ndebele</option>
                    <option value="nv">nv - Navajo</option>
                    <option value="ny">ny - Chichewa</option>
                    <option value="oc">oc - Occitan</option>
                    <option value="oj">oj - Ojibwa</option>
                    <option value="om">om - Oromo</option>
                    <option value="or">or - Oriya</option>
                    <option value="os">os - Ossetian</option>
                    <option value="pa">pa - Panjabi</option>
                    <option value="pi">pi - Pali</option>
                    <option value="pl">pl - Polish</option>
                    <option value="ps">ps - Pushto</option>
                    <option value="pt">pt - Portuguese</option>
                    <option value="qu">qu - Quechua</option>
                    <option value="rm">rm - Romansh</option>
                    <option value="rn">rn - Rundi</option>
                    <option value="ro">ro - Romanian</option>
                    <option value="ru">ru - Russian</option>
                    <option value="rw">rw - Kinyarwanda</option>
                    <option value="sa">sa - Sanskrit</option>
                    <option value="sc">sc - Sardinian</option>
                    <option value="sd">sd - Sindhi</option>
                    <option value="se">se - Northern Sami</option>
                    <option value="sg">sg - Sango</option>
                    <option value="si">si - Sinhala</option>
                    <option value="sk">sk - Slovak</option>
                    <option value="sl">sl - Slovenian</option>
                    <option value="sm">sm - Samoan</option>
                    <option value="sn">sn - Shona</option>
                    <option value="so">so - Somali</option>
                    <option value="sq">sq - Albanian</option>
                    <option value="sr">sr - Serbian</option>
                    <option value="ss">ss - Swati</option>
                    <option value="st">st - Southern Sotho</option>
                    <option value="su">su - Sundanese</option>
                    <option value="sv">sv - Swedish</option>
                    <option value="sw">sw - Swahili</option>
                    <option value="ta">ta - Tamil</option>
                    <option value="te">te - Telugu</option>
                    <option value="tg">tg - Tajik</option>
                    <option value="th">th - Thai</option>
                    <option value="ti">ti - Tigrinya</option>
                    <option value="tk">tk - Turkmen</option>
                    <option value="tl">tl - Tagalog</option>
                    <option value="tn">tn - Tswana</option>
                    <option value="to">to - Tonga</option>
                    <option value="tr">tr - Turkish</option>
                    <option value="ts">ts - Tsonga</option>
                    <option value="tt">tt - Tatar</option>
                    <option value="tw">tw - Twi</option>
                    <option value="ty">ty - Tahitian</option>
                    <option value="ug">ug - Uighur</option>
                    <option value="uk">uk - Ukrainian</option>
                    <option value="ur">ur - Urdu</option>
                    <option value="uz">uz - Uzbek</option>
                    <option value="ve">ve - Venda</option>
                    <option value="vi">vi - Vietnamese</option>
                    <option value="vo">vo - Volapük</option>
                    <option value="wa">wa - Walloon</option>
                    <option value="wo">wo - Wolof</option>
                    <option value="xh">xh - Xhosa</option>
                    <option value="yi">yi - Yiddish</option>
                    <option value="yo">yo - Yoruba</option>
                    <option value="za">za - Zhuang</option>
                    <option value="zh">zh - Chinese</option>
                    <option value="zu">zu - Zulu</option>
                  </select>
                </div>
                <div class="field-group">
                  <label>Min Viewers:</label>
                  <input name="minimum_viewers" type="number" min="0" value="5">
                </div>
              </div>
              <div class="field-row">
                <div class="field-group">
                  <label>Required Tags:</label>
                  <input name="required_tags" type="text" placeholder="tag1, tag2, tag3">
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
  const requiredLanguageParam = params.get("required_language");
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

  // Parse required language
  const requiredLanguage = requiredLanguageParam && requiredLanguageParam.trim() !== ""
    ? requiredLanguageParam.trim()
    : undefined;

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
    required_language: requiredLanguage,
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
  const requiredLanguageParam = params.get("required_language");
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

  // Parse required language
  const requiredLanguage = requiredLanguageParam && requiredLanguageParam.trim() !== ""
    ? requiredLanguageParam.trim()
    : undefined;

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
    required_language: requiredLanguage,
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
    const languageValue = config.required_language || "";
    const viewersValue = config.minimum_viewers || 1;

    // Generate language options with selected value
    const languageOptions = [
      { value: "", label: "Any Language" },
      { value: "aa", label: "aa - Afar" },
      { value: "ab", label: "ab - Abkhazian" },
      { value: "ae", label: "ae - Avestan" },
      { value: "af", label: "af - Afrikaans" },
      { value: "ak", label: "ak - Akan" },
      { value: "am", label: "am - Amharic" },
      { value: "an", label: "an - Aragonese" },
      { value: "ar", label: "ar - Arabic" },
      { value: "as", label: "as - Assamese" },
      { value: "av", label: "av - Avaric" },
      { value: "ay", label: "ay - Aymara" },
      { value: "az", label: "az - Azerbaijani" },
      { value: "ba", label: "ba - Bashkir" },
      { value: "be", label: "be - Belarusian" },
      { value: "bg", label: "bg - Bulgarian" },
      { value: "bh", label: "bh - Bihari languages" },
      { value: "bi", label: "bi - Bislama" },
      { value: "bm", label: "bm - Bambara" },
      { value: "bn", label: "bn - Bengali" },
      { value: "bo", label: "bo - Tibetan" },
      { value: "br", label: "br - Breton" },
      { value: "bs", label: "bs - Bosnian" },
      { value: "ca", label: "ca - Catalan" },
      { value: "ce", label: "ce - Chechen" },
      { value: "ch", label: "ch - Chamorro" },
      { value: "co", label: "co - Corsican" },
      { value: "cr", label: "cr - Cree" },
      { value: "cs", label: "cs - Czech" },
      { value: "cu", label: "cu - Church Slavic" },
      { value: "cv", label: "cv - Chuvash" },
      { value: "cy", label: "cy - Welsh" },
      { value: "da", label: "da - Danish" },
      { value: "de", label: "de - German" },
      { value: "dv", label: "dv - Divehi" },
      { value: "dz", label: "dz - Dzongkha" },
      { value: "ee", label: "ee - Ewe" },
      { value: "el", label: "el - Greek" },
      { value: "en", label: "en - English" },
      { value: "eo", label: "eo - Esperanto" },
      { value: "es", label: "es - Spanish" },
      { value: "et", label: "et - Estonian" },
      { value: "eu", label: "eu - Basque" },
      { value: "fa", label: "fa - Persian" },
      { value: "ff", label: "ff - Fulah" },
      { value: "fi", label: "fi - Finnish" },
      { value: "fj", label: "fj - Fijian" },
      { value: "fo", label: "fo - Faroese" },
      { value: "fr", label: "fr - French" },
      { value: "fy", label: "fy - Western Frisian" },
      { value: "ga", label: "ga - Irish" },
      { value: "gd", label: "gd - Gaelic" },
      { value: "gl", label: "gl - Galician" },
      { value: "gn", label: "gn - Guarani" },
      { value: "gu", label: "gu - Gujarati" },
      { value: "gv", label: "gv - Manx" },
      { value: "ha", label: "ha - Hausa" },
      { value: "he", label: "he - Hebrew" },
      { value: "hi", label: "hi - Hindi" },
      { value: "ho", label: "ho - Hiri Motu" },
      { value: "hr", label: "hr - Croatian" },
      { value: "ht", label: "ht - Haitian" },
      { value: "hu", label: "hu - Hungarian" },
      { value: "hy", label: "hy - Armenian" },
      { value: "hz", label: "hz - Herero" },
      { value: "ia", label: "ia - Interlingua" },
      { value: "id", label: "id - Indonesian" },
      { value: "ie", label: "ie - Interlingue" },
      { value: "ig", label: "ig - Igbo" },
      { value: "ii", label: "ii - Sichuan Yi" },
      { value: "ik", label: "ik - Inupiaq" },
      { value: "io", label: "io - Ido" },
      { value: "is", label: "is - Icelandic" },
      { value: "it", label: "it - Italian" },
      { value: "iu", label: "iu - Inuktitut" },
      { value: "ja", label: "ja - Japanese" },
      { value: "jv", label: "jv - Javanese" },
      { value: "ka", label: "ka - Georgian" },
      { value: "kg", label: "kg - Kongo" },
      { value: "ki", label: "ki - Kikuyu" },
      { value: "kj", label: "kj - Kuanyama" },
      { value: "kk", label: "kk - Kazakh" },
      { value: "kl", label: "kl - Kalaallisut" },
      { value: "km", label: "km - Central Khmer" },
      { value: "kn", label: "kn - Kannada" },
      { value: "ko", label: "ko - Korean" },
      { value: "kr", label: "kr - Kanuri" },
      { value: "ks", label: "ks - Kashmiri" },
      { value: "ku", label: "ku - Kurdish" },
      { value: "kv", label: "kv - Komi" },
      { value: "kw", label: "kw - Cornish" },
      { value: "ky", label: "ky - Kirghiz" },
      { value: "la", label: "la - Latin" },
      { value: "lb", label: "lb - Luxembourgish" },
      { value: "lg", label: "lg - Ganda" },
      { value: "li", label: "li - Limburgan" },
      { value: "ln", label: "ln - Lingala" },
      { value: "lo", label: "lo - Lao" },
      { value: "lt", label: "lt - Lithuanian" },
      { value: "lu", label: "lu - Luba-Katanga" },
      { value: "lv", label: "lv - Latvian" },
      { value: "mg", label: "mg - Malagasy" },
      { value: "mh", label: "mh - Marshallese" },
      { value: "mi", label: "mi - Maori" },
      { value: "mk", label: "mk - Macedonian" },
      { value: "ml", label: "ml - Malayalam" },
      { value: "mn", label: "mn - Mongolian" },
      { value: "mr", label: "mr - Marathi" },
      { value: "ms", label: "ms - Malay" },
      { value: "mt", label: "mt - Maltese" },
      { value: "my", label: "my - Burmese" },
      { value: "na", label: "na - Nauru" },
      { value: "nb", label: "nb - Norwegian Bokmål" },
      { value: "nd", label: "nd - North Ndebele" },
      { value: "ne", label: "ne - Nepali" },
      { value: "ng", label: "ng - Ndonga" },
      { value: "nl", label: "nl - Dutch" },
      { value: "nn", label: "nn - Norwegian Nynorsk" },
      { value: "no", label: "no - Norwegian" },
      { value: "nr", label: "nr - South Ndebele" },
      { value: "nv", label: "nv - Navajo" },
      { value: "ny", label: "ny - Chichewa" },
      { value: "oc", label: "oc - Occitan" },
      { value: "oj", label: "oj - Ojibwa" },
      { value: "om", label: "om - Oromo" },
      { value: "or", label: "or - Oriya" },
      { value: "os", label: "os - Ossetian" },
      { value: "pa", label: "pa - Panjabi" },
      { value: "pi", label: "pi - Pali" },
      { value: "pl", label: "pl - Polish" },
      { value: "ps", label: "ps - Pushto" },
      { value: "pt", label: "pt - Portuguese" },
      { value: "qu", label: "qu - Quechua" },
      { value: "rm", label: "rm - Romansh" },
      { value: "rn", label: "rn - Rundi" },
      { value: "ro", label: "ro - Romanian" },
      { value: "ru", label: "ru - Russian" },
      { value: "rw", label: "rw - Kinyarwanda" },
      { value: "sa", label: "sa - Sanskrit" },
      { value: "sc", label: "sc - Sardinian" },
      { value: "sd", label: "sd - Sindhi" },
      { value: "se", label: "se - Northern Sami" },
      { value: "sg", label: "sg - Sango" },
      { value: "si", label: "si - Sinhala" },
      { value: "sk", label: "sk - Slovak" },
      { value: "sl", label: "sl - Slovenian" },
      { value: "sm", label: "sm - Samoan" },
      { value: "sn", label: "sn - Shona" },
      { value: "so", label: "so - Somali" },
      { value: "sq", label: "sq - Albanian" },
      { value: "sr", label: "sr - Serbian" },
      { value: "ss", label: "ss - Swati" },
      { value: "st", label: "st - Southern Sotho" },
      { value: "su", label: "su - Sundanese" },
      { value: "sv", label: "sv - Swedish" },
      { value: "sw", label: "sw - Swahili" },
      { value: "ta", label: "ta - Tamil" },
      { value: "te", label: "te - Telugu" },
      { value: "tg", label: "tg - Tajik" },
      { value: "th", label: "th - Thai" },
      { value: "ti", label: "ti - Tigrinya" },
      { value: "tk", label: "tk - Turkmen" },
      { value: "tl", label: "tl - Tagalog" },
      { value: "tn", label: "tn - Tswana" },
      { value: "to", label: "to - Tonga" },
      { value: "tr", label: "tr - Turkish" },
      { value: "ts", label: "ts - Tsonga" },
      { value: "tt", label: "tt - Tatar" },
      { value: "tw", label: "tw - Twi" },
      { value: "ty", label: "ty - Tahitian" },
      { value: "ug", label: "ug - Uighur" },
      { value: "uk", label: "uk - Ukrainian" },
      { value: "ur", label: "ur - Urdu" },
      { value: "uz", label: "uz - Uzbek" },
      { value: "ve", label: "ve - Venda" },
      { value: "vi", label: "vi - Vietnamese" },
      { value: "vo", label: "vo - Volapük" },
      { value: "wa", label: "wa - Walloon" },
      { value: "wo", label: "wo - Wolof" },
      { value: "xh", label: "xh - Xhosa" },
      { value: "yi", label: "yi - Yiddish" },
      { value: "yo", label: "yo - Yoruba" },
      { value: "za", label: "za - Zhuang" },
      { value: "zh", label: "zh - Chinese" },
      { value: "zu", label: "zu - Zulu" }
    ];

    const languageOptionsHtml = languageOptions.map(option =>
      `<option value="${option.value}" ${option.value === languageValue ? 'selected' : ''}>${option.label}</option>`
    ).join('');

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
                <label>Required Language:</label>
                <select name="required_language" class="language-select">
                  ${languageOptionsHtml}
                </select>
              </div>
              <div class="form-group-inline">
                <label>Min Viewers:</label>
                <input name="minimum_viewers" type="number" min="0" value="${viewersValue}">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group-inline">
                <label>Required Tags:</label>
                <input name="required_tags" type="text" value="${tagsValue}" placeholder="tag1, tag2, tag3">
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

    const languageInfo =
      config.required_language && config.required_language.trim() !== ""
        ? `<i data-lucide="globe"></i> Language: ${config.required_language.toUpperCase()}`
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
              ${languageInfo ? `<div class="meta-item">${languageInfo}</div>` : ''}
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
