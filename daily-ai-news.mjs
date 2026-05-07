/**
 * daily-ai-news.mjs
 *
 * Fetches the top 3 AI news stories from RSS feeds (no API key needed)
 * and posts a briefing to Slack.
 *
 * Required env vars:
 *   SLACK_BOT_TOKEN   — Slack Bot OAuth token (xoxb-...)
 *   SLACK_CHANNEL_ID  — channel ID, e.g. C0B29RLA7DY
 */

const SLACK_BOT_TOKEN  = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
  console.error("Missing required environment variables.");
  console.error("Set: SLACK_BOT_TOKEN, SLACK_CHANNEL_ID");
  process.exit(1);
}

// ── RSS feeds to pull from (all free, no auth needed) ─────────────────────

const FEEDS = [
  { name: "MIT Tech Review",  url: "https://www.technologyreview.com/feed/" },
  { name: "TechCrunch AI",    url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "The Verge AI",     url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { name: "VentureBeat AI",   url: "https://venturebeat.com/category/ai/feed/" },
  { name: "Ars Technica",     url: "https://feeds.arstechnica.com/arstechnica/technology-lab" },
];

// ── 1. Fetch and parse RSS feeds ───────────────────────────────────────────

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "daily-ai-news-bot/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return parseRSS(xml, feed.name);
  } catch (err) {
    console.warn(`Skipping ${feed.name}: ${err.message}`);
    return [];
  }
}

function parseRSS(xml, sourceName) {
  const items = [];
  const itemBlocks = xml.split(/<item[\s>]/i).slice(1);

  for (const block of itemBlocks) {
    const title   = extractTag(block, "title");
    const desc    = extractTag(block, "description");
    const pubDate = extractTag(block, "pubDate");
    const link    = extractTag(block, "link");

    if (!title) continue;

    items.push({
      headline: cleanText(title),
      tldr:     cleanText(desc).slice(0, 160).replace(/\s+\S+$/, "…"),
      source:   sourceName,
      link,
      pubDate:  pubDate ? new Date(pubDate) : new Date(0),
    });
  }

  return items;
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"))
    || xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function cleanText(str) {
  return str
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8212;/g, '—')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── 2. Pick the top 3 most recent stories ─────────────────────────────────

async function getTopStories() {
  const allFeeds = await Promise.all(FEEDS.map(fetchFeed));
  const allStories = allFeeds.flat();

  allStories.sort((a, b) => b.pubDate - a.pubDate);

  const seen = new Set();
  const unique = allStories.filter((s) => {
    const key = s.headline.toLowerCase().slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.slice(0, 3);
}

// ── 3. Post to Slack ───────────────────────────────────────────────────────

async function postToSlack(stories) {
  const today = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  const lines = stories.map(
    (s, i) => `*${i + 1}. ${s.headline}*\n_${s.source}_ — ${s.tldr}`
  );

  const message =
    `:robot_face: *Daily AI News Briefing* — ${today}\n\n` +
    lines.join("\n\n") +
    `\n\n_Delivered automatically every morning at 9:00 AM ET_ ⚡`;

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel: SLACK_CHANNEL_ID, text: message }),
  });

  const result = await res.json();
  if (!result.ok) throw new Error(`Slack API error: ${result.error}`);
  return result;
}

// ── 4. Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching AI news from RSS feeds...");
  const stories = await getTopStories();

  if (!stories.length) {
    throw new Error("No stories found — all feeds may be down.");
  }

  console.log("Top stories:");
  stories.forEach((s, i) => console.log(`  ${i + 1}. [${s.source}] ${s.headline}`));

  console.log("Posting to Slack...");
  const result = await postToSlack(stories);
  console.log("Posted successfully:", result.ts);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
