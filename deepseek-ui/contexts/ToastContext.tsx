"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  addToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} });

const STYLES: Record<ToastType, { border: string; text: string; icon: string }> = {
  success: { border: "#00ff9f", text: "#00ff9f", icon: "✓" },
  error:   { border: "#ff4d6d", text: "#ff4d6d", icon: "✕" },
  warning: { border: "#ffd60a", text: "#ffd60a", icon: "!" },
  info:    { border: "#3b82f6", text: "#3b82f6", icon: "i" },
};

let _id = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++_id;
    setToasts(prev => [...prev.slice(-2), { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}>
        {toasts.map(toast => {
          const s = STYLES[toast.type];
          return (
            <div key={toast.id} style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              background: "#0d0d1e",
              border: `1px solid ${s.border}44`,
              borderLeft: `3px solid ${s.border}`,
              borderRadius: 8,
              boxShadow: "0 4px 20px rgba(0,0,0,0.7)",
              maxWidth: 360,
              minWidth: 220,
              pointerEvents: "auto",
              fontFamily: "'Berkeley Mono', 'Fira Code', monospace",
              animation: "toastIn 0.2s ease-out",
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: "50%",
                background: `${s.border}18`,
                border: `1px solid ${s.border}44`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 700, color: s.text, flexShrink: 0,
              }}>{s.icon}</span>
              <span style={{ fontSize: 13, color: "#c8d0e0", lineHeight: 1.4 }}>{toast.message}</span>
            </div>
          );
        })}
      </div>
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:translateX(0); } }`}</style>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
