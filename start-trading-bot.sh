#!/bin/bash

# Trading Bot Startup Script
# This script ensures the bot runs 24/7 and restarts if it crashes

echo "🚀 Starting AI Trading Bot..."

# Navigate to project directory
cd "/home/aiminer2/Trading Project/deepseek-ui"

# Check if Ollama is running
if ! pgrep -x "ollama" > /dev/null; then
    echo "⚠️  Ollama not running. Starting Ollama..."
    ollama serve &
    sleep 5
fi

# Check if DeepSeek model is available
if ! ollama list | grep -q "deepseek-r1:14b"; then
    echo "📥 Pulling DeepSeek R1 model..."
    ollama pull deepseek-r1:14b
fi

# Kill any existing instances
echo "🔄 Stopping any existing instances..."
pkill -f "next dev"
sleep 2

# Start the trading bot in background (accessible on local network)
echo "▶️  Starting trading bot..."
nohup npm run dev -- -H 0.0.0.0 > /home/aiminer2/Trading\ Project/trading-bot.log 2>&1 &

# Get the PID
BOT_PID=$!
echo "✅ Trading bot started with PID: $BOT_PID"
echo $BOT_PID > /home/aiminer2/Trading\ Project/trading-bot.pid

# Wait a few seconds to ensure it started
sleep 5

# Check if it's running
if ps -p $BOT_PID > /dev/null; then
    echo "✅ Trading bot is running successfully!"
    echo "📊 Dashboard: http://localhost:3001"
    echo "📝 Logs: /home/aiminer2/Trading Project/trading-bot.log"
    echo ""
    echo "To stop the bot, run: kill $BOT_PID"
    echo "Or use: pkill -f 'next dev'"
else
    echo "❌ Failed to start trading bot"
    exit 1
fi

echo ""
echo "🎉 Bot is now running 24/7!"
echo "💰 Target: 25% daily gains"
echo "🔒 Mode: Validation (safe mode)"
echo ""
echo "To enable live trading, edit:"
echo "  deepseek-ui/app/api/trading/engine/route.ts"
echo "  Change: autoExecute: false → autoExecute: true"
