/**
 * Web Research Module
 * Gathers market intelligence using lightweight HTTP requests + RSS parsing.
 *
 * NOTE: Previously used Puppeteer + headless Chrome for scraping.
 * Replaced with native fetch + cheerio for the following reasons:
 *   - Puppeteer adds ~300MB to the Docker image
 *   - Browser automation is fragile and breaks on site layout changes
 *   - All required data (news, sentiment, Fear & Greed) is available via free APIs
 *   - Reddit JSON API, Yahoo Finance RSS, and alternative.me need no API key
 *
 * For more detailed AI analysis of news, use market-intelligence.ts which
 * aggregates multiple free data sources without requiring a browser.
 */

import { createLogger } from './logger';
import { TIMEOUTS } from './timeouts';

const log = createLogger('web-research');
import * as cheerio from 'cheerio';

export interface ResearchData {
  news: NewsArticle[];
  sentiment: SentimentData;
  trends: TrendData[];
  charts: ChartAnalysis[];
}

export interface NewsArticle {
  title: string;
  source: string;
  url: string;
  snippet: string;
  timestamp: number;
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface SentimentData {
  overall: 'bullish' | 'bearish' | 'neutral';
  score: number; // -100 to 100
  sources: {
    twitter: number;
    reddit: number;
    news: number;
  };
}

export interface TrendData {
  keyword: string;
  volume: number;
  change: number;
  relevance: number;
}

export interface ChartAnalysis {
  pair: string;
  pattern: string;
  confidence: number;
  prediction: 'up' | 'down' | 'sideways';
}

const CHROME_UA = 'Mozilla/5.0 (compatible; TradingBot/1.0)';

export class WebResearcher {
  /** No browser to initialize. Kept for API compatibility. */
  async initialize(): Promise<void> {
    // no-op: browser automation removed in favour of lightweight HTTP
  }

  async close(): Promise<void> {
    // no-op
  }

  /**
   * Fetch news from Yahoo Finance RSS feed (free, no API key, no browser).
   * Previously used Google scraping via Puppeteer.
   */
  async searchGoogle(query: string): Promise<NewsArticle[]> {
    const articles: NewsArticle[] = [];
    try {
      const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(query)}&region=US&lang=en-US`;
      const res = await fetch(url, {
        headers: { 'User-Agent': CHROME_UA, Accept: 'application/rss+xml,text/xml,*/*' },
        signal: AbortSignal.timeout(TIMEOUTS.EXTERNAL_API_MS),
      });
      if (!res.ok) return articles;

      const xml = await res.text();
      const $ = cheerio.load(xml, { xmlMode: true });
      $('item').slice(0, 10).each((_, elem) => {
        const title   = $(elem).find('title').text().trim();
        const link    = $(elem).find('link').text().trim();
        const snippet = $(elem).find('description').text().trim();
        if (title) {
          articles.push({
            title,
            source: 'Yahoo Finance',
            url:    link,
            snippet,
            timestamp: Date.now(),
            sentiment: this.analyzeSentiment(title + ' ' + snippet),
          });
        }
      });
      log.debug('Yahoo Finance RSS complete', { query, articles: articles.length });
    } catch (error) {
      log.warn('Yahoo Finance RSS unavailable', { query, error: String(error) });
    }
    return articles;
  }

  /**
   * Twitter sentiment is no longer available without API auth.
   * Returns 0 (neutral) as a no-op.
   */
  async getTwitterSentiment(_keyword: string): Promise<number> {
    return 0; // Twitter API requires OAuth2 — not feasible without credentials
  }

  /**
   * Reddit sentiment via the public JSON API (no API key needed).
   */
  async getRedditSentiment(keyword: string): Promise<number> {
    try {
      const res = await fetch(
        `https://www.reddit.com/r/stocks/search.json?q=${encodeURIComponent(keyword)}&restrict_sr=1&sort=hot&limit=25`,
        {
          headers: { 'User-Agent': 'TradingBot/1.0 (research)' },
          signal: AbortSignal.timeout(TIMEOUTS.EXTERNAL_API_MS),
        },
      );
      if (!res.ok) return 0;
      const data = await res.json();
      const posts: Array<{ data: { title: string; ups: number } }> = data?.data?.children ?? [];

      let score = 0;
      for (const post of posts) {
        const title  = post.data.title.toLowerCase();
        const upvotes = post.data.ups || 0;
        if (/bullish|buy|long|moon/.test(title)) score += upvotes * 0.1;
        if (/bearish|sell|short|crash/.test(title)) score -= upvotes * 0.1;
      }
      return Math.max(-100, Math.min(100, score));
    } catch (error) {
      log.warn('Reddit sentiment unavailable', { error: String(error) });
      return 0;
    }
  }

  /**
   * Fetch Reuters Business RSS feed instead of scraping CoinDesk.
   */
  async scrapeCoinDesk(): Promise<NewsArticle[]> {
    const articles: NewsArticle[] = [];
    try {
      const res = await fetch('https://feeds.reuters.com/reuters/businessNews', {
        headers: { 'User-Agent': CHROME_UA, Accept: 'application/rss+xml,text/xml,*/*' },
        signal: AbortSignal.timeout(TIMEOUTS.EXTERNAL_API_MS),
      });
      if (!res.ok) return articles;

      const xml = await res.text();
      const $ = cheerio.load(xml, { xmlMode: true });
      $('item').slice(0, 10).each((_, elem) => {
        const title   = $(elem).find('title').text().trim();
        const link    = $(elem).find('link').text().trim();
        const snippet = $(elem).find('description').text().trim();
        if (title) {
          articles.push({
            title,
            source: 'Reuters',
            url:    link,
            snippet,
            timestamp: Date.now(),
            sentiment: this.analyzeSentiment(title + ' ' + snippet),
          });
        }
      });
    } catch (error) {
      log.warn('Reuters RSS unavailable', { error: String(error) });
    }
    return articles;
  }

  /** Fear & Greed Index from alternative.me (free API). */
  async getFearGreedIndex(): Promise<{ value: number; classification: string }> {
    try {
      const res = await fetch('https://api.alternative.me/fng/?limit=1', {
        signal: AbortSignal.timeout(TIMEOUTS.EXTERNAL_API_MS),
      });
      if (!res.ok) return { value: 50, classification: 'Neutral' };
      const data = await res.json();
      const item = data.data[0];
      return { value: parseInt(item.value), classification: item.value_classification };
    } catch (error) {
      log.warn('Fear & Greed Index unavailable', { error: String(error) });
      return { value: 50, classification: 'Neutral' };
    }
  }

  /** Comprehensive market research — runs all data sources in parallel. */
  async conductResearch(pair: string): Promise<ResearchData> {
    log.info('Conducting web research', { pair });
    const coin = pair.replace(/Z?USD$/, '').replace(/^X/, '');

    const [yahooNews, reutersNews, redditSentiment, fearGreed] = await Promise.all([
      this.searchGoogle(coin),
      this.scrapeCoinDesk(),
      this.getRedditSentiment(coin),
      this.getFearGreedIndex(),
    ]);

    const allNews        = [...yahooNews, ...reutersNews];
    const newsSentiment  = this.calculateNewsSentiment(allNews);
    const overallScore   = (newsSentiment + redditSentiment + (fearGreed.value - 50)) / 3;

    const sentiment: SentimentData = {
      overall: overallScore > 20 ? 'bullish' : overallScore < -20 ? 'bearish' : 'neutral',
      score:   overallScore,
      sources: { twitter: 0, reddit: redditSentiment, news: newsSentiment },
    };

    log.info('Research complete', {
      pair, newsArticles: allNews.length,
      sentiment: sentiment.overall, sentimentScore: sentiment.score.toFixed(1),
      fearGreed: fearGreed.value,
    });

    return { news: allNews, sentiment, trends: [], charts: [] };
  }

  private analyzeSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    const lower = text.toLowerCase();
    const pos = ['bullish', 'surge', 'rally', 'gain', 'up', 'rise', 'buy', 'strong'].filter(w => lower.includes(w)).length;
    const neg = ['bearish', 'crash', 'dump', 'loss', 'down', 'fall', 'sell', 'fear'].filter(w => lower.includes(w)).length;
    return pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
  }

  private calculateNewsSentiment(articles: NewsArticle[]): number {
    if (!articles.length) return 0;
    const score = articles.reduce((s, a) =>
      s + (a.sentiment === 'positive' ? 10 : a.sentiment === 'negative' ? -10 : 0), 0);
    return Math.max(-100, Math.min(100, (score / articles.length) * 10));
  }
}

/**
 * Create web researcher instance
 */
export function createWebResearcher(): WebResearcher {
  return new WebResearcher();
}
