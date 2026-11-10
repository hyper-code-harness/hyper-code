---
name: youtubeNews
description: "Incremental YouTube channel catalogue that mirrors new videos, retrieves available transcripts, and publishes deduplicated items into News."
---

# YouTube News

Use this plugin to track selected YouTube channels as News producers.

```ts
await ctx.fns.youtubeNews.add({ key: "ai-engineer", channel: "@aiDotEngineer", label: "AI Engineer" });
await ctx.fns.youtubeNews.sync({ key: "ai-engineer", limit: 20 });
await ctx.fns.youtubeNews.syncAll({ limit: 20 });
await ctx.fns.youtubeNews.list({ enabled: true });
```

Each sync queries the YouTube Data API, deduplicates videos by `(channel_key, video_id)`, retrieves a manual or automatic transcript when YouTube exposes one, and publishes new or changed records through `news.put`. `news.summarize` then produces the News summary. Missing transcripts do not block ingestion; the video description is used instead. The `youtube-news-sync` cron refreshes all enabled channels every six hours.
