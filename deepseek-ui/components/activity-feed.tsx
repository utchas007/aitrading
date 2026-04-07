"use client";

import { useState, useEffect, useRef } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";

export default function ActivityFeed() {
  const { activities, botStatus, ibHealth, connected } = useWebSocket();
  const [isStarting, setIsStarting] = useState(false);
  const [isTogglingMode, setIsTogglingMode] = useState(false);
  const [checkInterval, setCheckInterval] = useState(2 * 60 * 1000);
  const [lastTrade, setLastTrade] = useState<string | null>(null);
  const lastActivityId = useRef<string | number | null>(null);

  const INTERVALS = [
    { label: '1m',  ms: 1 * 60 * 1000 },
    { label: '2m',  ms: 2 * 60 * 1000 },
    { label: '5m',  ms: 5 * 60 * 1000 },
    { label: '15m', ms: 15 * 60 * 1000 },
    { label: '30m', ms: 30 * 60 * 1000 },
  ];

  const isRunning = botStatus?.isRunning ?? false;
  const activePositions = botStatus?.activePositions ?? 0;
  const isLive = botStatus?.config?.autoExecute ?? false;

  // Request notification permission when bot starts
  useEffect(() => {
    if (isRunning && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [isRunning]);

  // Watch for new trade executions and fire browser notification + banner
  useEffect(() => {
    if (!activities.length) return;
    const latest = activities[0];
    const key = latest.id ?? latest.createdAt ?? latest.message;
    if (key === lastActivityId.current) return;
    lastActivityId.current = key;

    const isTradeExecution = latest.type === "completed" && latest.message.startsWith("✅");
    const isTradeError = latest.type === "error" && latest.message.includes("execute");

    if (isTradeExecution || isTradeError) {
      setLastTrade(latest.message);
      // Clear banner after 10s
      const t = setTimeout(() => setLastTrade(null), 10_000);

      // Browser notification
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(isTradeExecution ? "Trade Executed" : "Trade Failed", {
          body: latest.message.replace(/^✅\s*/, ""),
          icon: "/favicon.ico",
        });
      }

      return () => clearTimeout(t);
    }
  }, [activities]);

  const startBot = async (autoExecute = isLive) => {
    setIsStarting(true);
    try {
      await fetch("/api/trading/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          config: {
            autoExecute,
            minConfidence: 60,
            checkInterval,
            pairs: botStatus?.config?.pairs ?? ["AAPL", "MSFT", "NVDA", "TSLA"],
          },
        }),
      });
    } catch (error) {
      console.error("Failed to start bot:", error);
    }
    setIsStarting(false);
  };

  const stopBot = async () => {
    await fetch("/api/trading/engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    }).catch(err => console.error("Failed to stop bot:", err));
  };

  // Toggle between live and safe mode — restarts bot if running
  const toggleMode = async () => {
    setIsTogglingMode(true);
    const newMode = !isLive;
    try {
      if (isRunning) {
        await stopBot();
        await new Promise(r => setTimeout(r, 800));
        await startBot(newMode);
      } else {
        // Just update via a start+immediate-stop isn't ideal — instead
        // store the intent locally; it takes effect on next start
        await startBot(newMode);
      }
    } catch (error) {
      console.error("Failed to toggle mode:", error);
    }
    setIsTogglingMode(false);
  };

  const statusColor = isRunning
    ? isLive ? "#ff4d6d" : "#00ff9f"
    : connected ? "#666" : "#f97316";

  const statusText = isRunning
    ? isLive ? "🔴 LIVE TRADING" : "🟢 SAFE MODE"
    : connected ? "⚪ IDLE"
    : "🟠 WS DISCONNECTED";

  return (
    <div style={{
      background: "#0a0a14",
      borderRadius: 0,
      padding: "16px 12px",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 4 }}>Bot Activity</h2>
            <div style={{ fontSize: 12, color: statusColor, fontWeight: 600 }}>
              {statusText}
              {activePositions > 0 && ` • ${activePositions} positions`}
            </div>
          </div>

          {/* Start / Stop */}
          {!isRunning ? (
            <button
              onClick={() => startBot()}
              disabled={isStarting}
              style={{
                background: "linear-gradient(135deg, #00ff9f22, #0066ff22)",
                border: "1px solid #00ff9f55",
                color: "#00ff9f",
                padding: "8px 14px",
                borderRadius: 6,
                cursor: isStarting ? "not-allowed" : "pointer",
                fontSize: 12,
                fontWeight: 600,
                opacity: isStarting ? 0.5 : 1,
              }}
            >
              {isStarting ? "⏳ Starting..." : "▶ START"}
            </button>
          ) : (
            <button
              onClick={stopBot}
              style={{
                background: "linear-gradient(135deg, #ff4d6d22, #ff006622)",
                border: "1px solid #ff4d6d55",
                color: "#ff4d6d",
                padding: "8px 14px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              ⏹ STOP
            </button>
          )}
        </div>

        {/* Check Interval Picker */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: "#444", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>CHECK EVERY</span>
          {INTERVALS.map(({ label, ms }) => (
            <button
              key={ms}
              onClick={() => setCheckInterval(ms)}
              disabled={isRunning}
              style={{
                flex: 1,
                padding: "5px 0",
                borderRadius: 4,
                border: `1px solid ${checkInterval === ms ? "#0066ff" : "#1a1a2e"}`,
                background: checkInterval === ms ? "#0066ff22" : "transparent",
                color: checkInterval === ms ? "#60a5fa" : "#444",
                fontSize: 11,
                fontWeight: 600,
                cursor: isRunning ? "not-allowed" : "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Mode Toggle */}
        <button
          onClick={toggleMode}
          disabled={isTogglingMode || isStarting}
          title={isLive ? "Switch to Safe Mode (paper trading)" : "Switch to Live Trading (real orders)"}
          style={{
            width: "100%",
            padding: "9px 14px",
            borderRadius: 6,
            border: `1px solid ${isLive ? "#ff4d6d88" : "#2a2a4a"}`,
            background: isLive ? "#ff4d6d11" : "#0d0d1e",
            color: isLive ? "#ff4d6d" : "#555",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            cursor: isTogglingMode || isStarting ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            opacity: isTogglingMode ? 0.5 : 1,
            transition: "all 0.2s",
          }}
        >
          <span>{isLive ? "🔴 LIVE TRADING" : "⚪ SAFE MODE"}</span>
          <span style={{
            fontSize: 10,
            color: isLive ? "#ff4d6d99" : "#444",
          }}>
            {isTogglingMode ? "switching..." : `tap to switch to ${isLive ? "safe" : "live"}`}
          </span>
        </button>
      </div>

      {/* Trade Execution Banner */}
      {lastTrade && (
        <div style={{
          marginBottom: 10,
          padding: "10px 12px",
          background: lastTrade.includes("error") ? "#ff4d6d11" : "#00ff9f11",
          border: `1px solid ${lastTrade.includes("error") ? "#ff4d6d55" : "#00ff9f55"}`,
          borderRadius: 6,
          fontSize: 12,
          color: lastTrade.includes("error") ? "#ff4d6d" : "#00ff9f",
          fontWeight: 600,
          animation: "fadeIn 0.3s ease",
        }}>
          {lastTrade}
        </div>
      )}

      {/* IB Disconnect Alert */}
      {isRunning && ibHealth && !ibHealth.connected && (
        <div style={{
          marginBottom: 10,
          padding: "10px 12px",
          background: "#ff4d6d11",
          border: "1px solid #ff4d6d55",
          borderRadius: 6,
          fontSize: 12,
          color: "#ff4d6d",
          fontWeight: 600,
        }}>
          🔴 IB disconnected — bot will stop after 3 failed checks. Restart ib_service.py and TWS.
        </div>
      )}

      {/* Activity Feed */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        {activities.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
            <div style={{ fontSize: 14 }}>No activity yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Start the bot to see live updates</div>
          </div>
        ) : (
          activities.map((activity, i) => (
            <div
              key={i}
              style={{
                padding: "10px 12px",
                background: "#0d0d1e",
                border: "1px solid #1a1a2e",
                borderRadius: 8,
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                animation: "fadeIn 0.3s ease",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13,
                  color: "#c8d0e0",
                  lineHeight: 1.5,
                  wordBreak: "break-word",
                }}>
                  {activity.message}
                </div>
                {activity.createdAt && (
                  <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>
                    {new Date(activity.createdAt).toLocaleTimeString()}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
