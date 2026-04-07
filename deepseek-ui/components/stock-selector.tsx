"use client";

import { useState, useEffect } from "react";

interface Stock {
  symbol: string;
  name: string;
  sector: string;
  tier: "large" | "mid" | "small";
  description: string;
}

const AVAILABLE_STOCKS: Stock[] = [
  // Large Cap — Tech
  { symbol: "AAPL",  name: "Apple Inc.",            sector: "Technology",   tier: "large", description: "Consumer electronics, iPhone, services ecosystem" },
  { symbol: "MSFT",  name: "Microsoft Corp.",        sector: "Technology",   tier: "large", description: "Cloud (Azure), Office 365, AI with OpenAI" },
  { symbol: "NVDA",  name: "NVIDIA Corp.",           sector: "Technology",   tier: "large", description: "AI GPUs, data center, dominant in ML hardware" },
  { symbol: "GOOGL", name: "Alphabet Inc.",          sector: "Technology",   tier: "large", description: "Search, YouTube, Google Cloud, AI (Gemini)" },
  { symbol: "AMZN",  name: "Amazon.com Inc.",        sector: "Technology",   tier: "large", description: "E-commerce, AWS cloud, advertising" },
  { symbol: "META",  name: "Meta Platforms",         sector: "Technology",   tier: "large", description: "Facebook, Instagram, WhatsApp, AI/VR push" },
  // Large Cap — Other
  { symbol: "TSLA",  name: "Tesla Inc.",             sector: "Automotive",   tier: "large", description: "Electric vehicles, energy storage, FSD autonomy" },
  { symbol: "JPM",   name: "JPMorgan Chase",         sector: "Finance",      tier: "large", description: "Largest US bank, investment banking, asset mgmt" },
  { symbol: "V",     name: "Visa Inc.",              sector: "Finance",      tier: "large", description: "Global payments network, high margins, stable" },
  { symbol: "JNJ",   name: "Johnson & Johnson",      sector: "Healthcare",   tier: "large", description: "Pharma, medtech, defensive dividend stock" },
  { symbol: "XOM",   name: "ExxonMobil",             sector: "Energy",       tier: "large", description: "Oil & gas giant, dividend, inflation hedge" },
  // Mid Cap — Tech
  { symbol: "AMD",   name: "Advanced Micro Devices", sector: "Technology",   tier: "mid",   description: "CPUs/GPUs, AI accelerators, Ryzen & EPYC chips" },
  { symbol: "CRM",   name: "Salesforce Inc.",        sector: "Technology",   tier: "mid",   description: "CRM SaaS leader, enterprise software" },
  { symbol: "PLTR",  name: "Palantir Technologies",  sector: "Technology",   tier: "mid",   description: "AI/data analytics platform, government & enterprise" },
  { symbol: "SNOW",  name: "Snowflake Inc.",         sector: "Technology",   tier: "mid",   description: "Cloud data platform, high growth SaaS" },
  // Mid Cap — Other
  { symbol: "GS",    name: "Goldman Sachs",          sector: "Finance",      tier: "mid",   description: "Investment banking, trading, asset management" },
  { symbol: "CVX",   name: "Chevron Corp.",          sector: "Energy",       tier: "mid",   description: "Oil & gas, renewable energy transition" },
  { symbol: "PFE",   name: "Pfizer Inc.",            sector: "Healthcare",   tier: "mid",   description: "Pharma giant, mRNA vaccines, oncology pipeline" },
  // ETFs
  { symbol: "SPY",   name: "S&P 500 ETF",            sector: "ETF",          tier: "large", description: "Tracks S&P 500, broad market exposure" },
  { symbol: "QQQ",   name: "Nasdaq-100 ETF",         sector: "ETF",          tier: "large", description: "Top 100 Nasdaq stocks, heavy tech weighting" },
];

const SECTOR_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  Technology:  { bg: "#0066ff15", border: "#0066ff44", text: "#60a5fa" },
  Automotive:  { bg: "#ff4d6d15", border: "#ff4d6d44", text: "#f87171" },
  Finance:     { bg: "#00ff9f15", border: "#00ff9f44", text: "#00ff9f" },
  Healthcare:  { bg: "#a855f715", border: "#a855f744", text: "#c084fc" },
  Energy:      { bg: "#ffd60a15", border: "#ffd60a44", text: "#fbbf24" },
  ETF:         { bg: "#14b8a615", border: "#14b8a644", text: "#2dd4bf" },
};

const TIER_LABELS = { large: "Large Cap", mid: "Mid Cap", small: "Small Cap" };

export default function StockSelector() {
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [currentSymbols, setCurrentSymbols] = useState<string[]>([]);
  const [currentAutoExecute, setCurrentAutoExecute] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [prices, setPrices] = useState<{ [key: string]: { price: string | null } }>({});
  const [sectorFilter, setSectorFilter] = useState<string>("All");

  useEffect(() => {
    // Show cached prices immediately, then refresh in background
    const cached = localStorage.getItem("stock_prices_cache");
    if (cached) {
      try {
        const { data, ts } = JSON.parse(cached);
        // Use cache if under 5 minutes old
        if (Date.now() - ts < 5 * 60 * 1000) {
          setPrices(data);
        }
      } catch {}
    }
    fetchCurrentConfig();
    fetchPrices();
  }, []);

  const fetchCurrentConfig = async () => {
    try {
      const res = await fetch("/api/trading/engine");
      const data = await res.json();
      if (data.success && data.status?.config?.pairs) {
        setCurrentSymbols(data.status.config.pairs);
        setSelectedSymbols(data.status.config.pairs);
        setCurrentAutoExecute(data.status.config.autoExecute ?? false);
      } else {
        // Default selection
        setSelectedSymbols(["AAPL", "MSFT", "NVDA", "TSLA"]);
      }
    } catch {
      setSelectedSymbols(["AAPL", "MSFT", "NVDA", "TSLA"]);
    }
  };

  const fetchPrices = async () => {
    try {
      const symbols = AVAILABLE_STOCKS.map(s => s.symbol).join(",");
      const res = await fetch(`/api/stocks/ticker?symbols=${symbols}`);
      const data = await res.json();
      if (data.success && data.data) {
        const priceData: typeof prices = {};
        for (const [symbol, info] of Object.entries(data.data as Record<string, any>)) {
          const p = info?.price ?? null;
          priceData[symbol] = { price: p != null ? parseFloat(p).toFixed(2) : null };
        }
        setPrices(priceData);
        localStorage.setItem("stock_prices_cache", JSON.stringify({ data: priceData, ts: Date.now() }));
      }
    } catch {
      // silently fail — prices will just show "—"
    }
  };

  const toggle = (symbol: string) => {
    setSelectedSymbols(prev =>
      prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]
    );
  };

  const selectByTier = (tier: "large" | "mid" | "small") => {
    setSelectedSymbols(AVAILABLE_STOCKS.filter(s => s.tier === tier).map(s => s.symbol));
  };

  const selectBySector = (sector: string) => {
    setSelectedSymbols(AVAILABLE_STOCKS.filter(s => s.sector === sector).map(s => s.symbol));
  };

  const applyChanges = async () => {
    if (selectedSymbols.length === 0) {
      alert("Please select at least one stock.");
      return;
    }

    setLoading(true);
    setSaveStatus("saving");

    try {
      await fetch("/api/trading/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      const res = await fetch("/api/trading/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          config: {
            pairs: selectedSymbols,
            autoExecute: currentAutoExecute,
            minConfidence: 75,
            maxPositions: Math.min(selectedSymbols.length, 10),
            riskPerTrade: 0.10,
            stopLossPercent: 0.05,
            takeProfitPercent: 0.10,
            checkInterval: 2 * 60 * 1000,
          },
        }),
      });

      const data = await res.json();

      if (data.success) {
        setCurrentSymbols(selectedSymbols);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        throw new Error(data.error || "Failed to apply changes");
      }
    } catch (error: any) {
      console.error("Failed to apply changes:", error);
      setSaveStatus("error");
      alert(`Error: ${error.message}`);
      setTimeout(() => setSaveStatus("idle"), 3000);
    } finally {
      setLoading(false);
    }
  };

  const sectors = ["All", ...Array.from(new Set(AVAILABLE_STOCKS.map(s => s.sector)))];
  const visibleStocks = sectorFilter === "All"
    ? AVAILABLE_STOCKS
    : AVAILABLE_STOCKS.filter(s => s.sector === sectorFilter);

  const hasChanges = JSON.stringify([...selectedSymbols].sort()) !== JSON.stringify([...currentSymbols].sort());

  return (
    <div style={{
      fontFamily: "'Berkeley Mono', 'Fira Code', monospace",
      background: "#080810",
      color: "#c8d0e0",
      padding: "24px",
      minHeight: "calc(100vh - 52px)",
    }}>
      <style>{`
        .stock-card { transition: all 0.2s ease; cursor: pointer; }
        .stock-card:hover { transform: translateY(-2px); }
        .stock-card.selected { border-color: #00ff9f !important; background: #00ff9f0a !important; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: "0.05em",
          marginBottom: 8,
          background: "linear-gradient(135deg, #00ff9f, #0066ff)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}>
          STOCK SELECTOR
        </h1>
        <p style={{ color: "#666", fontSize: 14 }}>
          Choose which stocks the trading bot should monitor and trade via Interactive Brokers
        </p>
      </div>

      {/* Quick Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => setSelectedSymbols(AVAILABLE_STOCKS.map(s => s.symbol))}
          style={filterBtn()}>✓ Select All</button>
        <button onClick={() => setSelectedSymbols([])}
          style={filterBtn()}>✗ Clear</button>
        <div style={{ width: 1, height: 32, background: "#2a2a4a" }} />
        {(["large", "mid"] as const).map(tier => (
          <button key={tier} onClick={() => selectByTier(tier)} style={filterBtn()}>
            {TIER_LABELS[tier]}
          </button>
        ))}
        <div style={{ width: 1, height: 32, background: "#2a2a4a" }} />
        <button onClick={() => selectBySector("Technology")} style={filterBtn()}>Tech</button>
        <button onClick={() => selectBySector("Finance")}    style={filterBtn()}>Finance</button>
        <button onClick={() => selectBySector("ETF")}        style={filterBtn()}>ETFs</button>
      </div>

      {/* Sector Tab Filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {sectors.map(s => (
          <button
            key={s}
            onClick={() => setSectorFilter(s)}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              border: "1px solid",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: 600,
              background: sectorFilter === s ? "#1e3a5f" : "#0d0d1e",
              borderColor: sectorFilter === s ? "#0066ff" : "#2a2a4a",
              color: sectorFilter === s ? "#60a5fa" : "#666",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Stats Bar */}
      <div style={{
        display: "flex", gap: 16, marginBottom: 24, padding: 16,
        background: "#0d0d1e", border: "1px solid #1a1a2e", borderRadius: 8,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>SELECTED</div>
          <div style={{ fontSize: 20, color: "#00ff9f", fontWeight: 600 }}>{selectedSymbols.length}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>CURRENTLY ACTIVE</div>
          <div style={{ fontSize: 20, color: "#0066ff", fontWeight: 600 }}>{currentSymbols.length}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>UNSAVED CHANGES</div>
          <div style={{ fontSize: 20, color: hasChanges ? "#ffd60a" : "#444", fontWeight: 600 }}>
            {hasChanges ? "YES" : "NO"}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>MODE</div>
          <div style={{ fontSize: 14, color: currentAutoExecute ? "#ff4d6d" : "#ffd60a", fontWeight: 600, paddingTop: 4 }}>
            {currentAutoExecute ? "LIVE" : "PAPER"}
          </div>
        </div>
      </div>

      {/* Stock Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 14,
        marginBottom: 32,
      }}>
        {visibleStocks.map(stock => {
          const isSelected = selectedSymbols.includes(stock.symbol);
          const isActive = currentSymbols.includes(stock.symbol);
          const color = SECTOR_COLORS[stock.sector] ?? SECTOR_COLORS.Technology;
          const priceInfo = prices[stock.symbol];

          return (
            <div
              key={stock.symbol}
              className={`stock-card${isSelected ? " selected" : ""}`}
              onClick={() => toggle(stock.symbol)}
              style={{
                padding: 14,
                background: isSelected ? color.bg : "#0d0d1e",
                border: `1px solid ${isSelected ? color.border : "#1a1a2e"}`,
                borderRadius: 8,
                position: "relative",
              }}
            >
              {/* Active dot */}
              {isActive && (
                <div style={{
                  position: "absolute", top: 10, right: 10,
                  width: 8, height: 8, borderRadius: "50%",
                  background: "#00ff9f", boxShadow: "0 0 8px #00ff9f",
                }} />
              )}

              {/* Checkbox */}
              <div style={{
                width: 18, height: 18,
                border: `2px solid ${isSelected ? color.text : "#2a2a4a"}`,
                borderRadius: 4, marginBottom: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: isSelected ? color.text : "transparent",
                transition: "all 0.2s",
              }}>
                {isSelected && <span style={{ color: "#080810", fontSize: 11, fontWeight: "bold" }}>✓</span>}
              </div>

              {/* Stock info */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>{stock.symbol}</span>
                  <span style={{
                    fontSize: 9, padding: "2px 6px",
                    background: color.bg, border: `1px solid ${color.border}`,
                    borderRadius: 3, color: color.text,
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>
                    {stock.sector}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>{stock.name}</div>
                <div style={{ fontSize: 11, color: "#555", lineHeight: 1.4 }}>{stock.description}</div>
              </div>

              {/* Price */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1a1a2e" }}>
                <div style={{ fontSize: 10, color: "#555", marginBottom: 2 }}>LAST PRICE</div>
                <div style={{ fontSize: 14, color: priceInfo?.price ? "#fff" : "#444", fontWeight: 600 }}>
                  {priceInfo?.price ? `$${priceInfo.price}` : "—"}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Apply Button */}
      <div style={{
        position: "sticky", bottom: 24,
        display: "flex", justifyContent: "center", gap: 12,
      }}>
        <button
          onClick={applyChanges}
          disabled={loading || !hasChanges}
          style={{
            padding: "14px 36px",
            background: hasChanges ? "linear-gradient(135deg, #00ff9f, #0066ff)" : "#1a1a2e",
            border: "none", borderRadius: 8,
            color: hasChanges ? "#080810" : "#444",
            fontSize: 14, fontWeight: 700, letterSpacing: "0.1em",
            cursor: hasChanges && !loading ? "pointer" : "not-allowed",
            transition: "all 0.2s", opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "⟳ APPLYING..."
            : saveStatus === "saved" ? "✓ SAVED!"
            : saveStatus === "error" ? "✗ ERROR"
            : "▶ APPLY CHANGES"}
        </button>
        {hasChanges && (
          <button
            onClick={fetchCurrentConfig}
            style={{
              padding: "14px 24px",
              background: "#0d0d1e", border: "1px solid #2a2a4a",
              borderRadius: 8, color: "#888", fontSize: 14, cursor: "pointer",
            }}
          >
            ↺ RESET
          </button>
        )}
      </div>
    </div>
  );
}

function filterBtn(): React.CSSProperties {
  return {
    padding: "7px 14px",
    background: "#0d0d1e",
    border: "1px solid #2a2a4a",
    borderRadius: 6,
    color: "#888",
    fontSize: 12,
    cursor: "pointer",
    transition: "all 0.2s",
  };
}
