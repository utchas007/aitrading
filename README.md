# AI Trading Bot

Automated cryptocurrency trading bot powered by DeepSeek R1 AI and Kraken Exchange.

## 🚀 Features

- **AI-Powered Analysis**: Uses DeepSeek R1 (14B) for sentiment analysis
- **Technical Indicators**: RSI, MACD, Bollinger Bands, Volume analysis
- **Automated Trading**: Auto-executes trades on Kraken when confidence ≥ 75%
- **Risk Management**: 8% stop-loss, 30% take-profit targets
- **Real-Time News**: Integrates financial news from CNBC, Yahoo Finance, FT, MarketWatch
- **Portfolio Tracking**: Real-time balance and P&L monitoring
- **24/7 Operation**: Runs continuously, checks markets every 5 minutes

## 📊 Trading Strategy

- **60% Technical Analysis** + **40% AI Sentiment** = Combined Decision
- Targets 25% daily gains with 20% risk per trade
- Maximum 5 concurrent positions
- Only trades when both technical and AI signals align

## 🛠️ Setup

### Prerequisites

- Node.js 18+
- Ollama with DeepSeek R1 14B model
- Kraken API credentials

### Installation

1. Clone the repository:
```bash
git clone https://github.com/utchas007/aitrading.git
cd aitrading
```

2. Install dependencies:
```bash
cd deepseek-ui
npm install
```

3. Configure environment variables:
```bash
cp .env.example deepseek-ui/.env.local
```

Edit `deepseek-ui/.env.local` and add your Kraken API credentials:
```env
KRAKEN_API_KEY=your_api_key_here
KRAKEN_PRIVATE_KEY=your_private_key_here
OLLAMA_API_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-r1:14b
```

4. Install and start Ollama with DeepSeek R1:
```bash
# Install Ollama (if not already installed)
curl -fsSL https://ollama.com/install.sh | sh

# Pull DeepSeek R1 model
ollama pull deepseek-r1:14b

# Start Ollama service
ollama serve
```

5. Start the trading bot:
```bash
chmod +x start-trading-bot.sh
./start-trading-bot.sh
```

## 📱 Access

- **Dashboard**: http://localhost:3001
- **Trading Page**: http://localhost:3001/trading
- **Network Access**: http://YOUR_IP:3001 (accessible from other devices)

## ⚙️ Configuration

Edit `deepseek-ui/app/api/trading/engine/route.ts` to customize:

```typescript
engineInstance = createTradingEngine({
  pairs: ['XXBTZCAD'],           // Trading pairs
  autoExecute: true,              // Enable/disable live trading
  minConfidence: 75,              // Minimum confidence to trade (0-100)
  maxPositions: 5,                // Max concurrent positions
  riskPerTrade: 0.20,             // 20% of capital per trade
  checkInterval: 5 * 60 * 1000,   // Check every 5 minutes
});
```

## 🔒 Security

- API keys are stored in `.env.local` (not committed to git)
- Use `.env.example` as a template
- Never commit real API keys to the repository

## 📈 Monitoring

- View real-time analysis on the dashboard
- Check logs: `tail -f trading-bot.log`
- Monitor activity feed for all bot actions

## 🛑 Stopping the Bot

```bash
pkill -f 'next dev'
# Or use the PID from trading-bot.pid
kill $(cat trading-bot.pid)
```

## ⚠️ Disclaimer

This bot trades with real money. Use at your own risk. Start with small amounts and test thoroughly before deploying with significant capital.

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a pull request.

## 📧 Support

For issues or questions, open an issue on GitHub.
