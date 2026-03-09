"use client";

import { useState, useEffect } from "react";

interface Activity {
  id: string;
  timestamp: number;
  type: string;
  message: string;
  icon: string;
  color: string;
}

interface BotStatus {
  isRunning: boolean;
  activePositions: number;
}

export default function ActivityFeed() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [botStatus, setBotStatus] = useState<BotStatus>({ isRunning: false, activePositions: 0 });
  const [isStarting, setIsStarting] = useState(false);

  // Fetch activities and status
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/trading/engine');
      const data = await res.json();
      if (data.success) {
        setActivities(data.activities || []);
        setBotStatus(data.status);
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
    }
  };

  // Start bot
  const startBot = async () => {
    setIsStarting(true);
    try {
      const res = await fetch('/api/trading/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          config: {
            autoExecute: false, // Start in validation mode
            minConfidence: 75,
            checkInterval: 5 * 60 * 1000, // 5 minutes
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchStatus();
      }
    } catch (error) {
      console.error('Failed to start bot:', error);
    }
    setIsStarting(false);
  };

  // Stop bot
  const stopBot = async () => {
    try {
      const res = await fetch('/api/trading/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchStatus();
      }
    } catch (error) {
      console.error('Failed to stop bot:', error);
    }
  };

  // Poll for updates
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000); // Update every 3 seconds
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = () => {
    if (botStatus.isRunning) return '#00ff9f';
    return '#666';
  };

  const getStatusText = () => {
    if (botStatus.isRunning) return '🟢 ACTIVE';
    return '⚪ IDLE';
  };

  return (
    <div style={{
      background: '#0a0a14',
      border: '1px solid #1a1a2e',
      borderRadius: 12,
      padding: 20,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Bot Activity</h2>
          <div style={{ fontSize: 12, color: getStatusColor(), fontWeight: 600 }}>
            {getStatusText()}
            {botStatus.activePositions > 0 && ` • ${botStatus.activePositions} positions`}
          </div>
        </div>
        
        {/* Control Buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          {!botStatus.isRunning ? (
            <button
              onClick={startBot}
              disabled={isStarting}
              style={{
                background: 'linear-gradient(135deg, #00ff9f22, #0066ff22)',
                border: '1px solid #00ff9f55',
                color: '#00ff9f',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: isStarting ? 'not-allowed' : 'pointer',
                fontSize: 12,
                fontWeight: 600,
                opacity: isStarting ? 0.5 : 1,
              }}
            >
              {isStarting ? '⏳ Starting...' : '▶ START BOT'}
            </button>
          ) : (
            <button
              onClick={stopBot}
              style={{
                background: 'linear-gradient(135deg, #ff4d6d22, #ff006622)',
                border: '1px solid #ff4d6d55',
                color: '#ff4d6d',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              ⏹ STOP BOT
            </button>
          )}
        </div>
      </div>

      {/* Activity Feed */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {activities.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: 40,
            color: '#666',
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
            <div style={{ fontSize: 14 }}>No activity yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Start the bot to see live updates</div>
          </div>
        ) : (
          activities.map((activity) => (
            <div
              key={activity.id}
              style={{
                padding: '10px 12px',
                background: '#0d0d1e',
                border: '1px solid #1a1a2e',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                animation: 'fadeIn 0.3s ease',
              }}
            >
              <span style={{ fontSize: 16, flexShrink: 0 }}>{activity.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13,
                  color: activity.color,
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                }}>
                  {activity.message}
                </div>
                <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>
                  {new Date(activity.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
