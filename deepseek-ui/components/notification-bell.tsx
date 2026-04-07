"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Notification {
  id: number;
  createdAt: string;
  type: string;
  title: string;
  message: string;
  pair: string | null;
  read: boolean;
}

const TYPE_STYLES: Record<string, { color: string; icon: string }> = {
  trade_executed:  { color: "#00ff9f", icon: "✅" },
  trade_failed:    { color: "#ff4d6d", icon: "❌" },
  ib_disconnected: { color: "#f97316", icon: "🔌" },
  bot_stopped:     { color: "#ffd60a", icon: "⏹" },
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      const data = await res.json();
      if (data.success) {
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } catch {}
  }, []);

  // Poll every 10s
  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, 10_000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  // Close panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markAllRead = async () => {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "markAllRead" }),
    }).catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const markRead = async (id: number) => {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "markRead", id }),
    }).catch(() => {});
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const timeAgo = (iso: string) => {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return `${Math.round(diff)}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    return `${Math.round(diff / 86400)}d ago`;
  };

  return (
    <div ref={panelRef} style={{ position: "relative" }}>
      {/* Bell Button */}
      <button
        onClick={() => { setOpen(o => !o); if (!open) fetchNotifications(); }}
        style={{
          position: "relative",
          background: open ? "#1a1a2e" : "transparent",
          border: "1px solid",
          borderColor: open ? "#0066ff" : "#2a2a4a",
          borderRadius: 8,
          padding: "7px 10px",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
          color: "#888",
          transition: "all 0.2s",
        }}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: "absolute",
            top: -6,
            right: -6,
            background: "#ff4d6d",
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            borderRadius: "50%",
            minWidth: 18,
            height: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 4px",
            lineHeight: 1,
          }}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          right: 0,
          width: 360,
          maxHeight: 480,
          background: "#0d0d1e",
          border: "1px solid #1a1a2e",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          zIndex: 2000,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            padding: "12px 16px",
            borderBottom: "1px solid #1a1a2e",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
              Notifications {unreadCount > 0 && <span style={{ color: "#ff4d6d" }}>({unreadCount} unread)</span>}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                style={{
                  background: "none",
                  border: "none",
                  color: "#0066ff",
                  fontSize: 11,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {notifications.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "#444", fontSize: 13 }}>
                No notifications yet
              </div>
            ) : (
              notifications.map(n => {
                const style = TYPE_STYLES[n.type] ?? { color: "#888", icon: "ℹ️" };
                return (
                  <div
                    key={n.id}
                    onClick={() => !n.read && markRead(n.id)}
                    style={{
                      padding: "12px 16px",
                      borderBottom: "1px solid #1a1a2e",
                      background: n.read ? "transparent" : "#0066ff08",
                      cursor: n.read ? "default" : "pointer",
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      transition: "background 0.15s",
                    }}
                  >
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{style.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: style.color }}>
                          {n.title}
                        </span>
                        <span style={{ fontSize: 10, color: "#444", whiteSpace: "nowrap", marginLeft: 8 }}>
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5, wordBreak: "break-word" }}>
                        {n.message}
                      </div>
                    </div>
                    {!n.read && (
                      <div style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: "#0066ff", flexShrink: 0, marginTop: 4,
                      }} />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
