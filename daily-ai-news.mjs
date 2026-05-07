/**
 * daily-ai-news.mjs
 *
 * Fetches the top 3 AI news stories from the last 24 hours using the
 * Anthropic API (with web search), then posts a TLDR to Slack.
 *
 * Run manually:   node daily-ai-news.mjs
 * Schedule:       cron / GitHub Actions / Railway / Render (see README below)
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY   — your Anthropic API key
 *   SLACK_BOT_TOKEN     — Slack Bot OAuth token (xoxb-...)
 *   SLACK_CHANNEL_ID    — channel ID, e.g. C0B29RLA7DY
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SLACK_BOT_TOKEN   = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_ID  = process.env.SLACK_CHANNEL_ID;

if (!ANTHROPIC_API_KEY || !SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
  console.error("Missing required environment variables.");
  console.error("Set: ANTHROPIC_API_KEY, SLACK_BOT_TOKEN, SLACK_CHANNEL_ID");
  process.exit(1);
}

// ── 1. Ask Claude to search for top AI news and return structured JSON ─────

async function fetchAINews() {
  const today = new Date().toISOString().split("T")[0];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "interleaved-thinking-2025-05-14",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        },
      ],
      system: `You are a news researcher. Today is ${today}.
Search the web for the top 3 AI news stories from the last 24 hours.
If no stories from the last 24 hours are found, use the most recent available.
Return ONLY valid JSON — no markdown, no preamble — in this exact format:
{
  "stories": [
    { "headline": "...", "tldr": "One sentence summary.", "source": "Publication name" },
    { "headline": "...", "tldr": "One sentence summary.", "source": "Publication name" },
    { "headline": "...", "tldr": "One sentence summary.", "source": "Publication name" }
  ],
  "date_range": "e.g. May 6–7, 2026"
}`,
      messages: [
        {
          role: "user",
          content: "Search for the top 3 AI news stories from the last 24 hours and return the JSON.",
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = await response.json();

  // Extract the last text block (Claude's final answer after tool use)
  const textBlocks = data.content.filter((b) => b.type === "text");
  if (!textBlocks.length) throw new Error("No text block in Claude response");

  const raw = textBlocks[textBlocks.length - 1].text.trim();

  // Strip any accidental markdown fences
  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    return JSON.parse(clean);
  } catch {
    throw new Error(`Failed to parse Claude JSON:\n${clean}`);
  }
}

// ── 2. Post the briefing to Slack ──────────────────────────────────────────

async function postToSlack(news) {
  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  const lines = news.stories.map(
    (s, i) => `*${i + 1}. ${s.headline}*\n_${s.source}_ — ${s.tldr}`
  );

  const message =
    `:robot_face: *Daily AI News Briefing* — ${today}\n\n` +
    lines.join("\n\n") +
    `\n\n_Delivered automatically every morning at 9:00 AM ET_ ⚡`;

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      channel: SLACK_CHANNEL_ID,
      text: message,
    }),
  });

  const result = await response.json();
  if (!result.ok) throw new Error(`Slack API error: ${result.error}`);
  return result;
}

// ── 3. Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching top AI news stories...");
  const news = await fetchAINews();
  console.log("Stories retrieved:", news.stories.map((s) => s.headline));

  console.log("Posting to Slack...");
  const result = await postToSlack(news);
  console.log("Posted successfully:", result.ts);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
