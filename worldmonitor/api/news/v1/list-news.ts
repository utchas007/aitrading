export const config = { runtime: 'edge' };

import { newsHandler } from '../../../server/worldmonitor/news/v1/handler';

/**
 * Simple REST endpoint to get financial news for trading AI
 * GET /api/news/v1/list-news?variant=finance&limit=20
 */
export default async function handler(req: Request) {
  try {
    const url = new URL(req.url);
    const variant = url.searchParams.get('variant') || 'finance';
    const limit = parseInt(url.searchParams.get('limit') || '20');

    // Call the existing listFeedDigest handler
    const digest = await newsHandler.listFeedDigest({} as any, {
      variant,
      lang: 'en',
    });

    // Extract all news items from all categories
    const allItems: any[] = [];
    
    for (const [category, bucket] of Object.entries(digest.categories || {})) {
      if (bucket && bucket.items) {
        for (const item of bucket.items) {
          allItems.push({
            title: item.title,
            description: item.title, // RSS feeds often don't have separate descriptions
            link: item.link,
            pubDate: new Date(item.publishedAt).toISOString(),
            source: item.source,
            category: category,
            isAlert: item.isAlert,
            threat: item.threat,
          });
        }
      }
    }

    // Sort by date (newest first) and limit
    allItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    const limitedItems = allItems.slice(0, limit);

    return new Response(
      JSON.stringify({
        success: true,
        news: limitedItems,
        count: limitedItems.length,
        variant,
        generatedAt: digest.generatedAt,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      }
    );
  } catch (error: any) {
    console.error('List news error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to fetch news',
        news: [],
        count: 0,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
