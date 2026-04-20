import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { withCorrelation } from '@/lib/correlation';

const log = createLogger('api/worldmonitor/news');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface NewsItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: string;
  category?: string;
}

function parseRssXml(xml: string, sourceName: string): NewsItem[] {
  const items: NewsItem[] = [];
  
  // Match both <item> (RSS) and <entry> (Atom) tags
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
  
  let matches = [...xml.matchAll(itemRegex)];
  const isAtom = matches.length === 0;
  if (isAtom) matches = [...xml.matchAll(entryRegex)];
  
  for (const match of matches.slice(0, 10)) { // Limit to 10 items per feed
    const block = match[1]!;
    
    const title = extractTag(block, 'title');
    if (!title) continue;
    
    let link: string;
    if (isAtom) {
      const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["']/);
      link = hrefMatch?.[1] ?? '';
    } else {
      link = extractTag(block, 'link');
    }
    
    const description = extractTag(block, 'description') || extractTag(block, 'summary') || title;
    
    const pubDateStr = isAtom
      ? (extractTag(block, 'published') || extractTag(block, 'updated'))
      : extractTag(block, 'pubDate');
    const parsedDate = pubDateStr ? new Date(pubDateStr) : new Date();
    const pubDate = Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
    
    items.push({
      title,
      description,
      link,
      pubDate,
      source: sourceName,
      category: 'finance',
    });
  }
  
  return items;
}

function extractTag(xml: string, tag: string): string {
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, 'i');
  const plainRe = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');
  
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1]!.trim();
  
  const match = xml.match(plainRe);
  return match ? decodeXmlEntities(match[1]!.trim()) : '';
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

export async function GET(req: NextRequest) {
  return withCorrelation(req, async () => {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category') || 'markets';
    const limit = parseInt(searchParams.get('limit') || '50');

    // Fetch financial news directly from RSS feeds
    // Using the same feeds World Monitor uses for finance variant
    const financeFeeds = [
      { name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
      { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/rss/topstories' },
      { name: 'Financial Times', url: 'https://www.ft.com/rss/home' },
      { name: 'MarketWatch', url: 'https://www.marketwatch.com/rss/topstories' },
    ];

    const allNews: NewsItem[] = [];

    // Fetch from each feed
    for (const feed of financeFeeds) {
      try {
        const response = await fetch(feed.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          },
        });

        if (response.ok) {
          const xml = await response.text();
          const items = parseRssXml(xml, feed.name);
          allNews.push(...items);
        }
      } catch (error) {
        log.warn('Failed to fetch RSS feed', { feed: feed.name, error: String(error) });
      }
    }

    // Sort by date and limit
    allNews.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    const limitedNews = allNews.slice(0, limit);

    if (limitedNews.length > 0) {
      return NextResponse.json({
        success: true,
        news: limitedNews,
        category,
        count: limitedNews.length,
      });
    }

    // If all feeds failed, use fallback
    throw new Error('All RSS feeds failed');
  } catch (error: unknown) {
    log.warn('RSS feeds unavailable, using mock financial news', { error: getErrorMessage(error) });
    
    // Return mock data if worldmonitor is unavailable
    const mockNews: NewsItem[] = [
      {
        title: 'Global Markets React to Economic Data',
        description: 'Major indices show volatility as investors digest latest economic indicators',
        link: 'https://example.com/news/1',
        pubDate: new Date().toISOString(),
        source: 'Financial Times',
        category: 'markets',
      },
      {
        title: 'Central Bank Announces Policy Decision',
        description: 'Interest rate decision impacts currency markets',
        link: 'https://example.com/news/2',
        pubDate: new Date().toISOString(),
        source: 'Reuters',
        category: 'economy',
      },
      {
        title: 'Geopolitical Tensions Affect Commodity Prices',
        description: 'Oil and gold prices surge amid regional conflicts',
        link: 'https://example.com/news/3',
        pubDate: new Date().toISOString(),
        source: 'Bloomberg',
        category: 'commodities',
      },
    ];

    return NextResponse.json({
      success: true,
      news: mockNews,
      category: 'all',
      count: mockNews.length,
      note: 'Using mock data - worldmonitor API unavailable',
    });
  }
  });
}
