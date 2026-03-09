/**
 * Web Research Module
 * Uses browser automation to gather market intelligence
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import axios from 'axios';

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

export class WebResearcher {
  private browser?: Browser;
  private isInitialized: boolean = false;

  /**
   * Initialize browser
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      });
      this.isInitialized = true;
      console.log('✅ Browser initialized for web research');
    } catch (error) {
      console.error('Failed to initialize browser:', error);
      throw error;
    }
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.isInitialized = false;
      console.log('🛑 Browser closed');
    }
  }

  /**
   * Search Google for crypto news
   */
  async searchGoogle(query: string): Promise<NewsArticle[]> {
    if (!this.browser) await this.initialize();

    const page = await this.browser!.newPage();
    const articles: NewsArticle[] = [];

    try {
      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws`, {
        waitUntil: 'networkidle2',
        timeout: 10000,
      });

      const content = await page.content();
      const $ = cheerio.load(content);

      $('div.SoaBEf').each((i, elem) => {
        if (i >= 10) return; // Limit to 10 results

        const title = $(elem).find('div.n0jPhd').text();
        const source = $(elem).find('div.CEMjEf span').first().text();
        const snippet = $(elem).find('div.GI74Re').text();
        const url = $(elem).find('a').attr('href') || '';

        if (title && source) {
          articles.push({
            title,
            source,
            url,
            snippet,
            timestamp: Date.now(),
            sentiment: this.analyzeSentiment(title + ' ' + snippet),
          });
        }
      });

      console.log(`📰 Found ${articles.length} news articles for "${query}"`);
    } catch (error) {
      console.error('Google search error:', error);
    } finally {
      await page.close();
    }

    return articles;
  }

  /**
   * Get Twitter sentiment (simplified - scrapes public data)
   */
  async getTwitterSentiment(keyword: string): Promise<number> {
    // Note: Twitter API requires authentication
    // This is a simplified version using public search
    try {
      const response = await axios.get(
        `https://twitter.com/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=live`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          timeout: 5000,
        }
      );

      // Simplified sentiment analysis
      const content = response.data.toLowerCase();
      const positiveWords = ['bullish', 'moon', 'pump', 'buy', 'long', 'up', 'gain'];
      const negativeWords = ['bearish', 'dump', 'sell', 'short', 'down', 'loss', 'crash'];

      let score = 0;
      positiveWords.forEach(word => {
        const matches = (content.match(new RegExp(word, 'g')) || []).length;
        score += matches;
      });
      negativeWords.forEach(word => {
        const matches = (content.match(new RegExp(word, 'g')) || []).length;
        score -= matches;
      });

      return Math.max(-100, Math.min(100, score));
    } catch (error) {
      console.error('Twitter sentiment error:', error);
      return 0;
    }
  }

  /**
   * Get Reddit sentiment from r/cryptocurrency
   */
  async getRedditSentiment(keyword: string): Promise<number> {
    try {
      const response = await axios.get(
        `https://www.reddit.com/r/cryptocurrency/search.json?q=${encodeURIComponent(keyword)}&restrict_sr=1&sort=new&limit=25`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          timeout: 5000,
        }
      );

      const posts = response.data.data.children;
      let score = 0;

      posts.forEach((post: any) => {
        const title = post.data.title.toLowerCase();
        const upvotes = post.data.ups || 0;

        // Weight by upvotes
        if (title.includes('bullish') || title.includes('buy') || title.includes('moon')) {
          score += upvotes * 0.1;
        }
        if (title.includes('bearish') || title.includes('sell') || title.includes('crash')) {
          score -= upvotes * 0.1;
        }
      });

      return Math.max(-100, Math.min(100, score));
    } catch (error) {
      console.error('Reddit sentiment error:', error);
      return 0;
    }
  }

  /**
   * Scrape CoinDesk for latest crypto news
   */
  async scrapeCoinDesk(): Promise<NewsArticle[]> {
    const articles: NewsArticle[] = [];

    try {
      const response = await axios.get('https://www.coindesk.com/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 10000,
      });

      const $ = cheerio.load(response.data);

      $('article').each((i, elem) => {
        if (i >= 10) return;

        const title = $(elem).find('h2, h3, h4').first().text().trim();
        const url = $(elem).find('a').first().attr('href') || '';
        const snippet = $(elem).find('p').first().text().trim();

        if (title) {
          articles.push({
            title,
            source: 'CoinDesk',
            url: url.startsWith('http') ? url : `https://www.coindesk.com${url}`,
            snippet,
            timestamp: Date.now(),
            sentiment: this.analyzeSentiment(title + ' ' + snippet),
          });
        }
      });

      console.log(`📰 Scraped ${articles.length} articles from CoinDesk`);
    } catch (error) {
      console.error('CoinDesk scraping error:', error);
    }

    return articles;
  }

  /**
   * Get Fear & Greed Index
   */
  async getFearGreedIndex(): Promise<{ value: number; classification: string }> {
    try {
      const response = await axios.get('https://api.alternative.me/fng/', {
        timeout: 5000,
      });

      const data = response.data.data[0];
      return {
        value: parseInt(data.value),
        classification: data.value_classification,
      };
    } catch (error) {
      console.error('Fear & Greed Index error:', error);
      return { value: 50, classification: 'Neutral' };
    }
  }

  /**
   * Comprehensive market research
   */
  async conductResearch(pair: string): Promise<ResearchData> {
    console.log(`\n🔍 Conducting web research for ${pair}...`);

    const coin = pair.replace('ZUSD', '').replace('X', ''); // XXBTZUSD -> BTC

    // Parallel research
    const [googleNews, coinDeskNews, twitterSentiment, redditSentiment, fearGreed] = await Promise.all([
      this.searchGoogle(`${coin} cryptocurrency news today`),
      this.scrapeCoinDesk(),
      this.getTwitterSentiment(coin),
      this.getRedditSentiment(coin),
      this.getFearGreedIndex(),
    ]);

    // Combine news
    const allNews = [...googleNews, ...coinDeskNews];

    // Calculate overall sentiment
    const newsSentiment = this.calculateNewsSentiment(allNews);
    const overallScore = (newsSentiment + twitterSentiment + redditSentiment + (fearGreed.value - 50)) / 4;

    const sentiment: SentimentData = {
      overall: overallScore > 20 ? 'bullish' : overallScore < -20 ? 'bearish' : 'neutral',
      score: overallScore,
      sources: {
        twitter: twitterSentiment,
        reddit: redditSentiment,
        news: newsSentiment,
      },
    };

    console.log(`📊 Research complete:`);
    console.log(`   News articles: ${allNews.length}`);
    console.log(`   Overall sentiment: ${sentiment.overall} (${sentiment.score.toFixed(1)})`);
    console.log(`   Fear & Greed: ${fearGreed.value} (${fearGreed.classification})`);

    return {
      news: allNews,
      sentiment,
      trends: [],
      charts: [],
    };
  }

  /**
   * Simple sentiment analysis
   */
  private analyzeSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    const lowerText = text.toLowerCase();
    const positiveWords = ['bullish', 'surge', 'rally', 'gain', 'up', 'rise', 'moon', 'pump', 'buy', 'long'];
    const negativeWords = ['bearish', 'crash', 'dump', 'loss', 'down', 'fall', 'sell', 'short', 'fear'];

    let score = 0;
    positiveWords.forEach(word => {
      if (lowerText.includes(word)) score++;
    });
    negativeWords.forEach(word => {
      if (lowerText.includes(word)) score--;
    });

    if (score > 0) return 'positive';
    if (score < 0) return 'negative';
    return 'neutral';
  }

  /**
   * Calculate news sentiment score
   */
  private calculateNewsSentiment(articles: NewsArticle[]): number {
    if (articles.length === 0) return 0;

    let score = 0;
    articles.forEach(article => {
      if (article.sentiment === 'positive') score += 10;
      else if (article.sentiment === 'negative') score -= 10;
    });

    return Math.max(-100, Math.min(100, score / articles.length * 10));
  }
}

/**
 * Create web researcher instance
 */
export function createWebResearcher(): WebResearcher {
  return new WebResearcher();
}
