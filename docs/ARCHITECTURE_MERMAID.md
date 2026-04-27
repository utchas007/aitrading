# AI Trading Bot Mermaid Diagrams

These diagrams are derived from `ARCHITECTURE.md`.

## 1) Infrastructure (Docker + Host Services)

```mermaid
flowchart TB
  subgraph Host[Host Machine]
    TWS[TWS / IB Gateway]
    OHost[Ollama GPU Service\n:11500]
  end

  subgraph Stack[Docker Compose Stack]
    NEXT[Next.js Dashboard\ntrading-nextjs\n3001->3000]
    WS[WebSocket Server\ntrading-websocket\n3002]
    BOT[Trading Bot\ntrading-bot\n3003]
    WM[World Monitor\ntrading-worldmonitor\n3000]
    PG[(PostgreSQL\ntrading-postgres\n5432)]
    IB[IB Service\ntrading-ib-service\nhost network :8765]
  end

  TWS --> IB
  BOT --> IB
  NEXT --> IB
  WS --> IB

  NEXT --> OHost
  WM --> OHost

  NEXT <--> WS
  NEXT <--> WM
  BOT --> NEXT

  NEXT --> PG
  BOT --> PG
  WS --> PG
```

## 2) Autonomous Trading Cycle (Every 2 Minutes)

```mermaid
flowchart TD
  A[Start Market Cycle] --> B{Market Session Open?}
  B -- No --> Z[Skip Cycle]
  B -- Yes --> C{IB Healthy?}
  C -- No --> P[Pause Engine\nAuto-resume on reconnect]
  C -- Yes --> D[Fetch Tickers\n2s stagger]
  D --> E[Fetch Balance\nCheck drawdown]
  E --> F[Analyze Each Symbol\n12s stagger]

  F --> G[Fetch OHLC + Indicators\nRSI/MACD/BB/EMA/ATR/...]
  G --> H[Fetch World Monitor Context]
  H --> I[LLM Sentiment\nDeepSeek R1 via Ollama]
  I --> J[Blend Score\n60% Technical + 40% AI]
  J --> K{Risk Guards Pass?\nVIX/Earnings/SPY/Sector}
  K -- No --> L[Skip Symbol]
  K -- Yes --> M{Confidence >= 75?}
  M -- No --> L
  M -- Yes --> N[Place Bracket Order\nEntry + SL + TP]
  N --> O[Persist Trade + Notify]
  O --> F
```

## 3) End-to-End Signal Execution Sequence

```mermaid
sequenceDiagram
  participant TE as Trading Engine
  participant IB as IB Service
  participant WM as World Monitor
  participant AI as Ollama (DeepSeek R1)
  participant DB as PostgreSQL

  loop Every 2 minutes
    TE->>IB: GET /health
    IB-->>TE: connection + market status
    TE->>IB: GET /ticker/{symbol}
    IB-->>TE: live price snapshot
    TE->>IB: GET /ohlc/{symbol}
    IB-->>TE: historical bars
    TE->>WM: GET /api/news + /api/summary
    WM-->>TE: geopolitical + commodities context
    TE->>AI: POST /api/generate (sentiment prompt)
    AI-->>TE: sentiment + confidence
    TE->>TE: Blend confidence + apply risk guards

    alt confidence >= 75 and guards pass
      TE->>IB: POST /bracket-order
      IB-->>TE: parent/sl/tp order IDs
      TE->>DB: INSERT Trade + Signal + Activity
    else filtered out
      TE->>DB: INSERT Activity (skip reason)
    end
  end
```

## 4) Position Monitoring (Every 30 Seconds)

```mermaid
flowchart TD
  A[Start Position Monitor] --> B[Load Open Trades]
  B --> C[Fetch Live Price + Position State]
  C --> D{P&L >= +5%?}
  D -- Yes --> E[Partial Take Profit\nSell 50% + Move SL]
  D -- No --> F{P&L >= +7%?}
  E --> F
  F -- Yes --> G[Activate/Ratchet Trailing Stop\n3% trail]
  F -- No --> H{Age >= 5 days and P&L < +1%?}
  G --> H
  H -- Yes --> I[Time Exit\nCancel orders + market sell]
  H -- No --> J{Position closed by SL/TP?}
  I --> J
  J -- Yes --> K[Mark Trade Closed\nPersist P&L + Notify]
  J -- No --> L[Keep Monitoring]
  K --> M[Next Trade]
  L --> M
```

## 5) Startup Recovery Flow

```mermaid
flowchart TD
  A[Engine Startup] --> B[Rebuild Daily Counters\nfrom Trade table]
  B --> C[Restore Cooldowns]
  C --> D[Load BotCache\ndynamic_pairs + price_last_seen]
  D --> E[Fetch Open Trades from DB]
  E --> F{For each open trade}
  F --> G{IB has shares?}
  G -- Yes --> H[Restore ActivePosition in memory]
  G -- No --> I{Entry order pending?}
  I -- Yes --> J[Cancel pending buy\nmark entry_never_filled]
  I -- No --> K[Mark closed_while_offline]
  H --> L[Continue]
  J --> L
  K --> L
```
