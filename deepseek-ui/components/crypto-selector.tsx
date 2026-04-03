"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Crypto {
  pair: string;
  name: string;
  symbol: string;
  tier: "large" | "mid" | "small";
  description: string;
  minOrderSize: number;
}

const AVAILABLE_CRYPTOS: Crypto[] = [
  // 🔥 Tier 1 — High Liquidity (Verified with OHLC Data on Kraken Canada)
  { pair: "XXBTZCAD", name: "Bitcoin", symbol: "BTC", tier: "large", description: "Massive volume, stable spreads, full data", minOrderSize: 0.0001 },
  { pair: "XETHZCAD", name: "Ethereum", symbol: "ETH", tier: "large", description: "Smart contracts, high liquidity, full data", minOrderSize: 0.001 },
  { pair: "SOLCAD", name: "Solana", symbol: "SOL", tier: "large", description: "Fast blockchain, easy automation, full data", minOrderSize: 0.1 },
  { pair: "XXRPZCAD", name: "Ripple", symbol: "XRP", tier: "large", description: "Cross-border payments, high volume, full data", minOrderSize: 10 },
];

const TIER_COLORS = {
  large: { bg: "#00ff9f15", border: "#00ff9f44", text: "#00ff9f" },
  mid: { bg: "#0066ff15", border: "#0066ff44", text: "#0066ff" },
  small: { bg: "#ffd60a15", border: "#ffd60a44", text: "#ffd60a" },
};

export default function CryptoSelector() {
  const [selectedPairs, setSelectedPairs] = useState<string[]>([]);
  const [currentPairs, setCurrentPairs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [prices, setPrices] = useState<{ [key: string]: { price: string; change: string } }>({});

  // Load current configuration
  useEffect(() => {
    fetchCurrentConfig();
    fetchPrices();
  }, []);

  const fetchCurrentConfig = async () => {
    try {
      const res = await fetch("/api/trading/engine");
      const data = await res.json();
      if (data.success && data.status.config.pairs) {
        setCurrentPairs(data.status.config.pairs);
        setSelectedPairs(data.status.config.pairs);
      }
    } catch (error) {
      console.error("Failed to fetch config:", error);
    }
  };

  const fetchPrices = async () => {
    try {
      const pairs = AVAILABLE_CRYPTOS.map(c => c.pair).join(",");
      const res = await fetch(`/api/kraken/ticker?pairs=${pairs}`);
      const data = await res.json();
      if (data.success && data.ticker) {
        const priceData: { [key: string]: { price: string; change: string } } = {};
        Object.entries(data.ticker).forEach(([pair, info]: [string, any]) => {
          priceData[pair] = {
            price: parseFloat(info.c[0]).toFixed(2),
            change: info.p ? info.p[1] : "0",
          };
        });
        setPrices(priceData);
      }
    } catch (error) {
      console.error("Failed to fetch prices:", error);
    }
  };

  const togglePair = (pair: string) => {
    setSelectedPairs(prev =>
      prev.includes(pair) ? prev.filter(p => p !== pair) : [...prev, pair]
    );
  };

  const selectByTier = (tier: "large" | "mid" | "small") => {
    const tierPairs = AVAILABLE_CRYPTOS.filter(c => c.tier === tier).map(c => c.pair);
    setSelectedPairs(tierPairs);
  };

  const selectAll = () => {
    setSelectedPairs(AVAILABLE_CRYPTOS.map(c => c.pair));
  };

  const deselectAll = () => {
    setSelectedPairs([]);
  };

  const applyChanges = async () => {
    if (selectedPairs.length === 0) {
      alert("Please select at least one cryptocurrency");
      return;
    }

    setLoading(true);
    setSaveStatus("saving");

    try {
      // Stop the current engine
      await fetch("/api/trading/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Start with new configuration
      const res = await fetch("/api/trading/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          config: {
            pairs: selectedPairs,
            autoExecute: true,
            minConfidence: 75,
            maxPositions: Math.min(selectedPairs.length, 10),
            riskPerTrade: 0.15,
            stopLossPercent: 0.10,
            takeProfitPercent: 0.20,
            checkInterval: 5 * 60 * 1000,
          },
        }),
      });

      const data = await res.json();

      if (data.success) {
        setCurrentPairs(selectedPairs);
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

  const hasChanges = JSON.stringify(selectedPairs.sort()) !== JSON.stringify(currentPairs.sort());

  return (
    <div style={{
      fontFamily: "'Berkeley Mono', 'Fira Code', monospace",
      background: "#080810",
      color: "#c8d0e0",
      padding: "24px",
      minHeight: "calc(100vh - 52px)",
    }}>
      <style>{`
        .crypto-card {
          transition: all 0.2s ease;
          cursor: pointer;
        }
        .crypto-card:hover {
          transform: translateY(-2px);
        }
        .crypto-card.selected {
          border-color: #00ff9f !important;
          background: #00ff9f0a !important;
        }
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
          CRYPTO SELECTOR
        </h1>
        <p style={{ color: "#666", fontSize: 14 }}>
          Select which cryptocurrencies the trading bot should monitor and trade
        </p>
      </div>

      {/* Quick Filters */}
      <div style={{
        display: "flex",
        gap: 12,
        marginBottom: 24,
        flexWrap: "wrap",
      }}>
        <button
          onClick={selectAll}
          style={{
            padding: "8px 16px",
            background: "#0d0d1e",
            border: "1px solid #2a2a4a",
            borderRadius: 6,
            color: "#888",
            fontSize: 12,
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = "#00ff9f";
            e.currentTarget.style.color = "#00ff9f";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = "#2a2a4a";
            e.currentTarget.style.color = "#888";
          }}
        >
          ✓ Select All
        </button>
        <button
          onClick={deselectAll}
          style={{
            padding: "8px 16px",
            background: "#0d0d1e",
            border: "1px solid #2a2a4a",
            borderRadius: 6,
            color: "#888",
            fontSize: 12,
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = "#ff4d6d";
            e.currentTarget.style.color = "#ff4d6d";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = "#2a2a4a";
            e.currentTarget.style.color = "#888";
          }}
        >
          ✗ Deselect All
        </button>
        <div style={{ width: 1, height: 32, background: "#2a2a4a" }} />
        <button onClick={() => selectByTier("large")} style={{
          padding: "8px 16px",
          background: "#0d0d1e",
          border: "1px solid #2a2a4a",
          borderRadius: 6,
          color: "#888",
          fontSize: 12,
          cursor: "pointer",
        }}>
          Large Cap Only
        </button>
        <button onClick={() => selectByTier("mid")} style={{
          padding: "8px 16px",
          background: "#0d0d1e",
          border: "1px solid #2a2a4a",
          borderRadius: 6,
          color: "#888",
          fontSize: 12,
          cursor: "pointer",
        }}>
          Mid Cap Only
        </button>
        <button onClick={() => selectByTier("small")} style={{
          padding: "8px 16px",
          background: "#0d0d1e",
          border: "1px solid #2a2a4a",
          borderRadius: 6,
          color: "#888",
          fontSize: 12,
          cursor: "pointer",
        }}>
          Small Cap Only
        </button>
      </div>

      {/* Stats Bar */}
      <div style={{
        display: "flex",
        gap: 16,
        marginBottom: 24,
        padding: 16,
        background: "#0d0d1e",
        border: "1px solid #1a1a2e",
        borderRadius: 8,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>SELECTED</div>
          <div style={{ fontSize: 20, color: "#00ff9f", fontWeight: 600 }}>{selectedPairs.length}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>CURRENTLY ACTIVE</div>
          <div style={{ fontSize: 20, color: "#0066ff", fontWeight: 600 }}>{currentPairs.length}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>CHANGES</div>
          <div style={{ fontSize: 20, color: hasChanges ? "#ffd60a" : "#444", fontWeight: 600 }}>
            {hasChanges ? "YES" : "NO"}
          </div>
        </div>
      </div>

      {/* Crypto Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 16,
        marginBottom: 24,
      }}>
        {AVAILABLE_CRYPTOS.map(crypto => {
          const isSelected = selectedPairs.includes(crypto.pair);
          const isActive = currentPairs.includes(crypto.pair);
          const tierColor = TIER_COLORS[crypto.tier];
          const priceInfo = prices[crypto.pair];
          const changeNum = priceInfo ? parseFloat(priceInfo.change) : 0;

          return (
            <div
              key={crypto.pair}
              className={`crypto-card ${isSelected ? "selected" : ""}`}
              onClick={() => togglePair(crypto.pair)}
              style={{
                padding: 16,
                background: isSelected ? tierColor.bg : "#0d0d1e",
                border: `1px solid ${isSelected ? tierColor.border : "#1a1a2e"}`,
                borderRadius: 8,
                position: "relative",
              }}
            >
              {/* Active Indicator */}
              {isActive && (
                <div style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#00ff9f",
                  boxShadow: "0 0 8px #00ff9f",
                }} />
              )}

              {/* Checkbox */}
              <div style={{
                width: 20,
                height: 20,
                border: `2px solid ${isSelected ? tierColor.text : "#2a2a4a"}`,
                borderRadius: 4,
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isSelected ? tierColor.text : "transparent",
                transition: "all 0.2s",
              }}>
                {isSelected && <span style={{ color: "#080810", fontSize: 12, fontWeight: "bold" }}>✓</span>}
              </div>

              {/* Crypto Info */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>{crypto.symbol}</span>
                  <span style={{
                    fontSize: 9,
                    padding: "2px 6px",
                    background: tierColor.bg,
                    border: `1px solid ${tierColor.border}`,
                    borderRadius: 3,
                    color: tierColor.text,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}>
                    {crypto.tier}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>{crypto.name}</div>
                <div style={{ fontSize: 11, color: "#555", lineHeight: 1.4 }}>{crypto.description}</div>
              </div>

              {/* Price Info */}
              {priceInfo && (
                <div style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px solid #1a1a2e",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#555" }}>PRICE</div>
                    <div style={{ fontSize: 14, color: "#fff", fontWeight: 600 }}>${priceInfo.price}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: "#555" }}>24H</div>
                    <div style={{
                      fontSize: 14,
                      color: changeNum >= 0 ? "#00ff9f" : "#ff4d6d",
                      fontWeight: 600,
                    }}>
                      {changeNum >= 0 ? "+" : ""}{changeNum}%
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Apply Button */}
      <div style={{
        position: "sticky",
        bottom: 24,
        display: "flex",
        justifyContent: "center",
        gap: 12,
      }}>
        <button
          onClick={applyChanges}
          disabled={loading || !hasChanges}
          style={{
            padding: "14px 32px",
            background: hasChanges ? "linear-gradient(135deg, #00ff9f, #0066ff)" : "#1a1a2e",
            border: "none",
            borderRadius: 8,
            color: hasChanges ? "#080810" : "#444",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: "0.1em",
            cursor: hasChanges && !loading ? "pointer" : "not-allowed",
            transition: "all 0.2s",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "⟳ APPLYING..." : saveStatus === "saved" ? "✓ SAVED!" : saveStatus === "error" ? "✗ ERROR" : "▶ APPLY CHANGES"}
        </button>
        {hasChanges && (
          <button
            onClick={fetchCurrentConfig}
            style={{
              padding: "14px 24px",
              background: "#0d0d1e",
              border: "1px solid #2a2a4a",
              borderRadius: 8,
              color: "#888",
              fontSize: 14,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            ↺ RESET
          </button>
        )}
      </div>
    </div>
  );
}
