# DeepSeek AI Trading Bot

An AI-powered cryptocurrency trading bot that combines **DeepSeek R1** for intelligent analysis, **Kraken Exchange** for trading, and **Worldmonitor** for real-time news and market events.

## 🚀 Features

### AI-Powered Analysis
- **DeepSeek R1 14B** running locally via Ollama for fundamental analysis
- Sentiment analysis from news and market events
- BUY/SELL/HOLD signals with confidence levels
- Risk assessment and trading recommendations

### Trading Capabilities
- **Kraken Exchange Integration** for live trading
- Real-time market data (BTC, ETH, LTC, XRP)
- Portfolio balance tracking
- Order management (place, view, cancel orders)

### News & Data Sources
- **Worldmonitor API** for global news and market events
- Real-time news feed with sentiment analysis
- Economic data and geopolitical events

### Risk Management
- Position sizing based on portfolio risk (default: 2% max risk per trade)
- Automatic stop-loss and take-profit calculations
- Maximum position limits (default: 10% of portfolio per trade)
- Confidence threshold filtering (default: 70% minimum)
- Portfolio risk metrics and monitoring

### User Interface
- **Dual-mode interface**: AI Chat + Trading Dashboard
- Real-time market price updates
- AI trading signals with detailed analysis
- News feed integration
- Portfolio balance display

## 📋 Prerequisites

- **Node.js** 18+ and npm
- **Ollama** with DeepSeek R1 model installed
- **Kraken Account** with API keys
- (Optional) **Worldmonitor** access for enhanced news data

## 🛠️ Installation

### 1. Clone and Install Dependencies

```bash
cd "Trading Project/deepseek-ui"
npm install
```

### 2. Set Up Ollama with DeepSeek R1

```bash
# Install Ollama (if not already installed)
curl -fsSL https://ollama.com/install.sh | sh

# Pull DeepSeek R1 14B model
ollama pull deepseek-r1:14b

# Start Ollama server
ollama serve
```

### 3. Configure Environment Variables

Create `.env.local` file:

```bash
# Kraken API Configuration
KRAKEN_API_KEY=your_kraken_api_key_here
KRAKEN_PRIVATE_KEY=your_kraken_private_key_here

# Ollama Configuration
OLLAMA_API_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-r1:14b

# Worldmonitor API (optional)
WORLDMONITOR_API_URL=https://api.worldmonitor.app
```

### 4. Get Kraken API Keys

1. Log into your Kraken account
2. Go to **Settings → API**
3. Click **"Generate New Key"**
4. Set permissions:
   - ✅ Query Funds (view balance)
   - ✅ Query Open Orders & Trades
   - ✅ Query Closed Orders & Trades
   - ⚠️ Create & Modify Orders (only if you want live trading)
5. Copy the **API Key** and **Private Key**
6. Add them to `.env.local`

**⚠️ Security Warning**: Start with **read-only permissions** for testing!

## 🚀 Running the Application

```bash
# Development mode
npm run dev

# The app will be available at http://localhost:3001
```

## 📊 Usage

### 1. AI Chat Mode
- Ask DeepSeek R1 questions about trading strategies
- Get market analysis and insights
- Adjust AI parameters (temperature, max tokens, system prompts)

### 2. Trading Dashboard Mode
- View real-time market prices for BTC, ETH, LTC, XRP
- See your Kraken portfolio balance
- Read latest market news from Worldmonitor
- Click **"Analyze"** to get AI trading signals

### 3. AI Trading Signals
The bot analyzes:
- Recent news sentiment (last 10 articles)
- Current market data (price, volume)
- Historical patterns

And provides:
- **Signal**: BUY, SELL, or HOLD
- **Confidence**: 0-100% confidence level
- **Sentiment**: Bullish, Bearish, or Neutral
- **Key Factors**: 3-5 most important factors
- **Risks**: Potential concerns
- **Recommendation**: Detailed trading advice

## 🛡️ Risk Management

The bot includes built-in risk management:

```typescript
// Default risk parameters
{
  maxPositionSize: 0.1,      // 10% of portfolio per trade
  maxPortfolioRisk: 0.02,    // 2% max risk per trade
  stopLossPercent: 0.05,     // 5% stop loss
  takeProfitPercent: 0.10,   // 10% take profit
  maxOpenPositions: 3,       // Max 3 concurrent positions
  minConfidence: 70          // 70% minimum AI confidence
}
```

### Position Sizing Formula
```
Position Size = (Portfolio Value × Max Risk %) / (Entry Price - Stop Loss Price)
```

### Risk Validation
Before executing any trade, the bot checks:
- ✅ AI confidence meets minimum threshold
- ✅ Not exceeding maximum open positions
- ✅ No existing position in the same pair
- ✅ Sufficient available capital
- ✅ Position size within limits

## 🔧 API Endpoints

### Kraken APIs
- `GET /api/kraken/balance` - Get account balance
- `GET /api/kraken/ticker?pairs=XXBTZUSD,XETHZUSD` - Get market prices
- `GET /api/kraken/orders?type=open` - Get open orders
- `POST /api/kraken/orders` - Place new order
- `DELETE /api/kraken/orders?txid=xxx` - Cancel order

### Worldmonitor APIs
- `GET /api/worldmonitor/news?category=markets&limit=20` - Get news

### Trading Analysis
- `POST /api/trading/analyze` - Get AI trading signal

Example request:
```json
{
  "news": [...],
  "marketData": {
    "XXBTZUSD": { "price": "50000", "volume": "1000" }
  },
  "pair": "XXBTZUSD"
}
```

## 📁 Project Structure

```
deepseek-ui/
├── app/
│   ├── api/
│   │   ├── chat/route.ts           # DeepSeek chat API
│   │   ├── kraken/
│   │   │   ├── balance/route.ts    # Get balance
│   │   │   ├── ticker/route.ts     # Get prices
│   │   │   └── orders/route.ts     # Manage orders
│   │   ├── worldmonitor/
│   │   │   └── news/route.ts       # Get news
│   │   └── trading/
│   │       └── analyze/route.ts    # AI analysis
│   ├── page.tsx                    # Main page with mode toggle
│   └── trading/page.tsx            # Trading dashboard page
├── components/
│   ├── llm-control-panel.tsx       # AI chat interface
│   └── trading-dashboard.tsx       # Trading dashboard
├── lib/
│   ├── kraken.ts                   # Kraken API client
│   └── risk-management.ts          # Risk management module
└── .env.local                      # Environment variables
```

## ⚠️ Important Notes

### Safety First
1. **Start with paper trading** - Use `validate: true` in order requests to test without real trades
2. **Use read-only API keys** initially
3. **Test with small amounts** when going live
4. **Monitor positions** regularly
5. **Set stop-losses** on all positions

### Limitations
- This is a **fundamental analysis bot** (news-based), not technical analysis
- AI signals are **recommendations**, not guarantees
- **Always review** AI recommendations before trading
- **Market conditions** can change rapidly
- **Past performance** doesn't guarantee future results

### Legal Disclaimer
This software is provided "as is" for educational purposes. Trading cryptocurrencies involves substantial risk of loss. The developers are not responsible for any financial losses incurred through use of this software. Always do your own research and consult with financial advisors.

## 🔮 Future Enhancements

- [ ] **OpenCV Integration** - Chart pattern recognition and visual analysis
- [ ] **Backtesting** - Test strategies on historical data
- [ ] **Multiple Exchanges** - Support for Binance, Coinbase, etc.
- [ ] **Technical Indicators** - RSI, MACD, Bollinger Bands
- [ ] **Automated Trading** - Fully automated execution (with safety controls)
- [ ] **Portfolio Optimization** - AI-driven portfolio rebalancing
- [ ] **Mobile App** - React Native mobile interface
- [ ] **Telegram Notifications** - Real-time trade alerts

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

MIT License - See LICENSE file for details

## 🆘 Support

For issues or questions:
1. Check the [Issues](https://github.com/yourusername/deepseek-trading-bot/issues) page
2. Create a new issue with detailed information
3. Include error messages and logs

## 🙏 Acknowledgments

- **DeepSeek AI** - For the powerful R1 model
- **Kraken** - For the robust trading API
- **Worldmonitor** - For comprehensive news data
- **Ollama** - For local LLM hosting

---

**Built with ❤️ using DeepSeek R1, Next.js, and TypeScript**
