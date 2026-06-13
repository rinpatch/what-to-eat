This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## VideoDB Offline Cache

The Vercel app should not run the full VideoDB ingest/index/search pipeline during a user request. Build a cache first, then let the frontend/API read the stable JSON contract.

Demo cache, no VideoDB calls:

```bash
npm run videodb:demo
```

Supabase fetch into the VideoDB cache contract, still without VideoDB calls:

```bash
npm run smoke:supabase-videodb
```

Live cache from normalized Bright Data reels in `data/pipeline-db.json`:

```bash
npm run videodb:cache -- --limit=60
```

Live cache from a Bright-Data-shaped seed file:

```bash
npm run videodb:cache -- --input=data/seed_posts.json --output=data/videodb_evidence.json --limit=60
```

Required local/server environment variable: `VIDEODB_API_KEY`. Keep it in `.env`, `.env.local`, or Vercel Environment Variables. Never expose it to the browser or commit it.

Each evidence row contains `post_id`, `video_id`, `stream_url`, `best_clip`, transcript snippets, visual snippets, quote candidates, TokenRouter input, status, and per-row errors. Failed clips do not block the deck.
