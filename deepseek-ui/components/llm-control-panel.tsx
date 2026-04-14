"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const MODELS = [
  { id: "deepseek-r1:14b", label: "DeepSeek R1 14B", provider: "DeepSeek" },
];

const DEFAULT_SYSTEM = `You are an expert trading assistant connected to LIVE financial data sources:

• Interactive Brokers (stocks): Real-time prices, positions, order execution
• Kraken (crypto): BTC, ETH, SOL prices and portfolio
• World Monitor (global): Commodities (Oil, Gold), Global indices (S&P, DAX, Nikkei), Geopolitical risks
• News feeds: Breaking financial news from multiple sources
• Trading Bot: Automated analysis every 5 minutes with technical indicators

You HAVE full access to markets, finance, and tech data - it's injected into every prompt.
Analyze the real-time data provided and give direct, specific answers.
Never say you can't access markets or don't have data - you absolutely do!

TRADE EXECUTION: You can execute buy AND sell orders directly from this chat.
- Sell: "sell my AMZN", "sell 50 META", "sell all my TSLA shares"
- Buy:  "buy 10 NVDA", "buy $500 worth of AAPL", "buy MSFT" (auto-sizes to 5% of cash)
The system places the order in Interactive Brokers immediately and injects the result into your context.
All buys come with a GTC bracket order (5% stop-loss, 10% take-profit) that survives restarts.
Confirm the trade result clearly and add brief market commentary. Keep responses concise.`;

function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px" }}>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 7, height: 7, borderRadius: "50%",
            background: "#00ff9f",
            animation: "pulse 1.2s infinite",
            animationDelay: `${i * 0.2}s`,
            opacity: 0.8,
          }} />
        ))}
      </div>
      <span style={{ fontSize: 11, color: "#555", marginLeft: 4 }}>AI is thinking...</span>
    </div>
  );
}

function TokenBar({ used, max }: { used: number; max: number }) {
  const pct = Math.min((used / max) * 100, 100);
  const color = pct > 80 ? "#ff4d6d" : pct > 50 ? "#ffd60a" : "#00ff9f";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#888" }}>
      <span>TOKENS</span>
      <div style={{ flex: 1, height: 4, background: "#1a1a2e", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.4s ease", borderRadius: 2 }} />
      </div>
      <span style={{ color, fontFamily: "monospace" }}>{used}/{max}</span>
    </div>
  );
}

export default function LLMControlPanel() {
  const [model, setModel] = useState(MODELS[0].id);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1000);
  const [messages, setMessages] = useState<Array<{ role: string; content: string; ts: Date; tokens?: number; error?: boolean; streaming?: boolean }>>([]);
  const [streamingText, setStreamingText] = useState('');
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("model");
  const [sessionStart] = useState(new Date());
  const [safeMode, setSafeMode] = useState(false);
  const [safeModeLoading, setSafeModeLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [chatHistory, setChatHistory] = useState<Array<{ id: number; title: string; messageCount: number; updatedAt: string }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load chat history list
  const loadChatHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/chat/history');
      const data = await res.json();
      if (data.success) {
        setChatHistory(data.conversations || []);
      }
    } catch (e) {
      console.error('Failed to load chat history:', e);
    }
    setHistoryLoading(false);
  };

  // Load specific conversation
  const loadConversation = async (id: number) => {
    try {
      const res = await fetch(`/api/chat/history?id=${id}`);
      const data = await res.json();
      if (data.success && data.conversation) {
        setConversationId(id);
        setMessages(data.conversation.messages.map((m: any) => ({
          role: m.role,
          content: m.content,
          ts: new Date(m.createdAt),
          tokens: m.tokens,
          error: m.error,
        })));
        setModel(data.conversation.model);
      }
    } catch (e) {
      console.error('Failed to load conversation:', e);
    }
  };

  // Start new conversation
  const startNewConversation = async () => {
    try {
      const res = await fetch('/api/chat/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', model }),
      });
      const data = await res.json();
      if (data.success) {
        setConversationId(data.conversation.id);
        setMessages([]);
        setTotalTokens(0);
      }
    } catch (e) {
      console.error('Failed to create conversation:', e);
    }
  };

  // Save message to DB
  const saveMessageToDbWithId = async (id: number, role: string, content: string, tokens?: number, error?: boolean) => {
    try {
      await fetch('/api/chat/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'message',
          conversationId: id,
          role,
          content,
          tokens,
          error,
        }),
      });
    } catch (e) {
      console.error('Failed to save message:', e);
    }
  };

  // Load saved settings and chat history on startup
  useEffect(() => {
    try {
      const saved = localStorage.getItem('llm-settings');
      if (saved) {
        const settings = JSON.parse(saved);
        if (settings.model) setModel(settings.model);
        if (settings.temperature !== undefined) setTemperature(settings.temperature);
        if (settings.maxTokens) setMaxTokens(settings.maxTokens);
        if (settings.systemPrompt) setSystemPrompt(settings.systemPrompt);
      }
    } catch (e) {
      // Ignore errors loading settings
    }
    // Load chat history (do NOT auto-create a conversation — create it only when first message is sent)
    loadChatHistory();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input.trim(), ts: new Date() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setStreamingText('');

    // Lazily create a conversation the first time a message is sent
    let activeConversationId = conversationId;
    if (!activeConversationId) {
      try {
        const res = await fetch('/api/chat/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create', model }),
        });
        const data = await res.json();
        if (data.success) {
          activeConversationId = data.conversation.id;
          setConversationId(activeConversationId);
        }
      } catch (e) {
        console.error('Failed to create conversation:', e);
      }
    }

    // Save user message to DB
    if (activeConversationId) {
      saveMessageToDbWithId(activeConversationId, 'user', input.trim());
    }

    try {
      // Use streaming API
      const res = await fetch("/api/chat?stream=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          temperature,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to get response');
      }

      // Check if streaming response
      const contentType = res.headers.get('content-type');
      if (contentType?.includes('text/event-stream')) {
        // Streaming response - read chunks
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let fullText = '';

        // Add placeholder message for streaming
        setMessages(prev => [...prev, { role: "assistant", content: '', ts: new Date(), streaming: true }]);

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

          for (const line of lines) {
            try {
              const data = JSON.parse(line.slice(6)); // Remove 'data: ' prefix
              if (data.token) {
                fullText += data.token;
                setStreamingText(fullText);
                // Update the last message with streaming content
                setMessages(prev => {
                  const updated = [...prev];
                  if (updated.length > 0 && updated[updated.length - 1].streaming) {
                    updated[updated.length - 1].content = fullText;
                  }
                  return updated;
                });
              }
              if (data.done) {
                // Finalize message
                const tokensUsed = Math.ceil(fullText.length / 4);
                setTotalTokens(t => t + tokensUsed);
                setMessages(prev => {
                  const updated = [...prev];
                  if (updated.length > 0) {
                    updated[updated.length - 1] = {
                      ...updated[updated.length - 1],
                      content: fullText,
                      tokens: tokensUsed,
                      streaming: false,
                    };
                  }
                  return updated;
                });
                // Save to DB
                if (activeConversationId) saveMessageToDbWithId(activeConversationId, 'assistant', fullText, tokensUsed, false);
              }
            } catch (e) {
              // Skip malformed JSON
            }
          }
        }
      } else {
        // Non-streaming fallback
        const data = await res.json();
        
        if (data.error) {
          throw new Error(data.error);
        }
        
        const assistantText = data.response || "No response.";
        const tokensUsed = data.tokens || 0;
        setTotalTokens(t => t + tokensUsed);
        setMessages(prev => [...prev, { role: "assistant", content: assistantText, ts: new Date(), tokens: tokensUsed }]);
        // Save to DB
        if (activeConversationId) saveMessageToDbWithId(activeConversationId, 'assistant', assistantText, tokensUsed, false);
      }
    } catch (e: any) {
      console.error('Chat error:', e);
      setMessages(prev => {
        // Remove streaming placeholder if exists
        const filtered = prev.filter(m => !m.streaming);
        return [...filtered, { role: "assistant", content: `⚠ Error: ${e.message}`, ts: new Date(), error: true }];
      });
    }
    setLoading(false);
    setStreamingText('');
  }, [input, loading, messages, model, maxTokens, systemPrompt, temperature]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const clearChat = () => {
    setMessages([]);
    setTotalTokens(0);
    startNewConversation();
    loadChatHistory();
  };

  const selectedModel = MODELS.find(m => m.id === model);
  const uptime = Math.floor((new Date().getTime() - sessionStart.getTime()) / 1000);
  const uptimeStr = `${Math.floor(uptime / 60)}m ${uptime % 60}s`;

  return (
    <div style={{
      fontFamily: "'Berkeley Mono', 'Fira Code', 'Cascadia Code', monospace",
      background: "#080810",
      color: "#c8d0e0",
      height: "calc(100vh - 52px)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0d0d1a; }
        ::-webkit-scrollbar-thumb { background: #2a2a4a; border-radius: 2px; }
        @keyframes pulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        .msg-enter { animation: fadeUp 0.25s ease forwards; }
        .btn-primary {
          background: linear-gradient(135deg, #00ff9f22, #0066ff22);
          border: 1px solid #00ff9f55;
          color: #00ff9f;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-family: inherit;
          font-size: 12px;
          letter-spacing: 0.08em;
          transition: all 0.2s;
        }
        .btn-primary:hover { background: linear-gradient(135deg, #00ff9f33, #0066ff33); border-color: #00ff9f; }
        .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-ghost {
          background: transparent;
          border: 1px solid #2a2a4a;
          color: #666;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-family: inherit;
          font-size: 11px;
          transition: all 0.2s;
        }
        .btn-ghost:hover { border-color: #444; color: #999; }
        .tab-btn {
          background: none; border: none; color: #555;
          padding: 6px 12px; cursor: pointer; font-family: inherit;
          font-size: 11px; letter-spacing: 0.06em; transition: all 0.2s;
          border-bottom: 2px solid transparent;
        }
        .tab-btn.active { color: #00ff9f; border-bottom-color: #00ff9f; }
        .tab-btn:hover:not(.active) { color: #888; }
        input[type=range] { -webkit-appearance:none; width:100%; height:4px; background:#1a1a2e; border-radius:2px; outline:none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; background:#00ff9f; border-radius:50%; cursor:pointer; }
        textarea { resize: none; outline: none; }
        select { outline: none; cursor: pointer; }
        @media (max-width: 900px) {
          .llm-sidebar { width: 200px !important; min-width: 180px !important; }
          .llm-topbar { padding: 8px 12px !important; }
          .llm-topbar .stats { display: none !important; }
        }
        @media (max-width: 768px) {
          .llm-sidebar { display: none !important; }
        }
      `}</style>

      {/* Compact Top Bar */}
      <div className="llm-topbar" style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "8px 16px",
        borderBottom: "1px solid #1a1a2e",
        background: "#0a0a16",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 24, height: 24, background: "linear-gradient(135deg, #00ff9f, #0066ff)", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 12 }}>⬡</span>
          </div>
          <span style={{ fontWeight: 700, fontSize: 13, color: "#fff" }}>
            AI<span style={{ color: "#00ff9f" }}>Chat</span>
          </span>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff9f", boxShadow: "0 0 6px #00ff9f", marginLeft: 4 }} />
        </div>

        <div style={{ flex: 1 }} />

        <div className="stats" style={{ display: "flex", gap: 16, fontSize: 11, color: "#555" }}>
          <span>{selectedModel?.label}</span>
          <span>{messages.length} msgs</span>
        </div>

        <button className="btn-ghost" onClick={() => setSidebarOpen(s => !s)} style={{ fontSize: 12, padding: "4px 8px" }}>
          {sidebarOpen ? "⟩" : "⟨"}
        </button>
      </div>

      {/* Main Layout */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Chat Area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>

            {messages.length === 0 && (
              <div style={{ margin: "auto", textAlign: "center", opacity: 0.5 }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>⬡</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 600, color: "#fff", marginBottom: 6 }}>Ready for input</div>
                <div style={{ fontSize: 12, color: "#555", maxWidth: 300 }}>
                  Configure your model in the panel →<br />then send a message below
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className="msg-enter" style={{
                display: "flex",
                flexDirection: msg.role === "user" ? "row-reverse" : "row",
                gap: 10, alignItems: "flex-start",
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: msg.role === "user" ? "#1a1a3e" : "linear-gradient(135deg, #00ff9f22, #0066ff22)",
                  border: `1px solid ${msg.role === "user" ? "#2a2a5e" : "#00ff9f33"}`,
                  fontSize: 13,
                }}>
                  {msg.role === "user" ? "▲" : "⬡"}
                </div>
                <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", gap: 4, alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    background: msg.role === "user" ? "#0f0f2a" : "#0a0a18",
                    border: `1px solid ${msg.error ? "#ff4d6d33" : msg.role === "user" ? "#2a2a5e" : "#1e1e3a"}`,
                    borderRadius: msg.role === "user" ? "12px 4px 12px 12px" : "4px 12px 12px 12px",
                    padding: "10px 14px",
                    fontSize: 13.5,
                    lineHeight: 1.65,
                    color: msg.error ? "#ff4d6d" : "#c8d0e0",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    position: "relative",
                  }}>
                    {msg.content}
                    {msg.streaming && (
                      <span style={{ 
                        display: "inline-block", 
                        width: 8, 
                        height: 16, 
                        background: "#00ff9f", 
                        marginLeft: 2,
                        animation: "blink 1s infinite",
                      }} />
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 10, color: "#333" }}>
                    <span>{msg.ts.toLocaleTimeString()}</span>
                    {msg.tokens && <span>· {msg.tokens} tok</span>}
                  </div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="msg-enter" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "linear-gradient(135deg, #00ff9f22, #0066ff22)",
                  border: "1px solid #00ff9f33", fontSize: 13,
                }}>⬡</div>
                <div style={{
                  background: "#0a0a18", border: "1px solid #1e1e3a",
                  borderRadius: "4px 12px 12px 12px",
                }}>
                  <TypingIndicator />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div style={{
            padding: "12px 16px",
            background: "#0a0a14",
            borderTop: "1px solid #1a1a2e",
            flexShrink: 0,
          }}>
            {/* Token bar */}
            <div style={{ marginBottom: 8 }}>
              <TokenBar used={totalTokens} max={8000} />
            </div>
            
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Send a message… (Enter to send)"
                rows={2}
                style={{
                  flex: 1,
                  background: "#0d0d1e",
                  border: "1px solid #2a2a4a",
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: "#c8d0e0",
                  fontFamily: "inherit",
                  fontSize: 13,
                  lineHeight: 1.5,
                  transition: "border-color 0.2s",
                  minHeight: 44,
                }}
                onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = "#00ff9f55"}
                onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = "#2a2a4a"}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn-primary" onClick={sendMessage} disabled={loading || !input.trim()} style={{ padding: "10px 14px" }}>
                  {loading ? "▶▶" : "▶"}
                </button>
                <button className="btn-ghost" onClick={clearChat} style={{ padding: "10px 12px" }}>CLR</button>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        {sidebarOpen && (
          <div className="llm-sidebar" style={{
            width: 260,
            maxWidth: '22vw',
            minWidth: 200,
            borderLeft: "1px solid #1a1a2e",
            background: "#0a0a14",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            flexShrink: 0,
          }}>
            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "1px solid #1a1a2e", padding: "0 8px", flexWrap: "wrap" }}>
              {["history", "model", "params", "system"].map(t => (
                <button key={t} className={`tab-btn ${settingsTab === t ? "active" : ""}`} onClick={() => { setSettingsTab(t); if (t === 'history') loadChatHistory(); }} style={{ padding: "6px 8px", fontSize: 10 }}>
                  {t === 'history' ? '📜' : ''}{t.toUpperCase()}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>

              {settingsTab === "history" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button className="btn-primary" onClick={() => { clearChat(); }} style={{ width: "100%", marginBottom: 8 }}>
                    + New Chat
                  </button>
                  {historyLoading ? (
                    <div style={{ textAlign: "center", color: "#555", padding: 20 }}>Loading...</div>
                  ) : chatHistory.length === 0 ? (
                    <div style={{ textAlign: "center", color: "#555", padding: 20, fontSize: 12 }}>No chat history yet</div>
                  ) : (
                    chatHistory.map(chat => (
                      <div
                        key={chat.id}
                        onClick={() => loadConversation(chat.id)}
                        style={{
                          padding: "10px 12px",
                          background: conversationId === chat.id ? "#00ff9f11" : "#0d0d1e",
                          border: `1px solid ${conversationId === chat.id ? "#00ff9f44" : "#1a1a2e"}`,
                          borderRadius: 6,
                          cursor: "pointer",
                          transition: "all 0.2s",
                        }}
                      >
                        <div style={{ fontSize: 12, color: conversationId === chat.id ? "#00ff9f" : "#888", fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {chat.title || "New Chat"}
                        </div>
                        <div style={{ fontSize: 10, color: "#444", display: "flex", justifyContent: "space-between" }}>
                          <span>{chat.messageCount} msgs</span>
                          <span>{new Date(chat.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {settingsTab === "model" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 10, color: "#555", letterSpacing: "0.1em", display: "block", marginBottom: 8 }}>SELECT MODEL</label>
                    {MODELS.map(m => (
                      <div key={m.id} onClick={() => setModel(m.id)} style={{
                        padding: "10px 12px", borderRadius: 6, marginBottom: 6, cursor: "pointer",
                        border: `1px solid ${model === m.id ? "#00ff9f44" : "#1a1a2e"}`,
                        background: model === m.id ? "#00ff9f0a" : "transparent",
                        transition: "all 0.2s",
                      }}>
                        <div style={{ fontSize: 12, color: model === m.id ? "#00ff9f" : "#888", fontWeight: 600, marginBottom: 2 }}>{m.label}</div>
                        <div style={{ fontSize: 10, color: "#444" }}>{m.provider} · {m.id}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ padding: 12, background: "#0d0d1e", borderRadius: 6, border: "1px solid #1a1a2e" }}>
                    <div style={{ fontSize: 10, color: "#555", letterSpacing: "0.1em", marginBottom: 10 }}>SESSION STATS</div>
                    {[
                      ["Messages", messages.length],
                      ["Total Tokens", totalTokens.toLocaleString()],
                      ["Uptime", uptimeStr],
                      ["Avg/Msg", messages.length ? Math.round(totalTokens / messages.length) : 0],
                    ].map(([k, v]) => (
                      <div key={k as string} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                        <span style={{ color: "#555" }}>{k}</span>
                        <span style={{ color: "#888", fontFamily: "monospace" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {settingsTab === "params" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                      <label style={{ fontSize: 10, color: "#555", letterSpacing: "0.1em" }}>TEMPERATURE</label>
                      <span style={{ fontSize: 12, color: "#00ff9f", fontFamily: "monospace" }}>{temperature.toFixed(2)}</span>
                    </div>
                    <input type="range" min={0} max={1} step={0.01} value={temperature}
                      onChange={e => setTemperature(parseFloat(e.target.value))} />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#333", marginTop: 4 }}>
                      <span>PRECISE</span><span>CREATIVE</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                      <label style={{ fontSize: 10, color: "#555", letterSpacing: "0.1em" }}>MAX TOKENS</label>
                      <span style={{ fontSize: 12, color: "#00ff9f", fontFamily: "monospace" }}>{maxTokens}</span>
                    </div>
                    <input type="range" min={100} max={4000} step={100} value={maxTokens}
                      onChange={e => setMaxTokens(parseInt(e.target.value))} />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#333", marginTop: 4 }}>
                      <span>100</span><span>4000</span>
                    </div>
                  </div>

                  <div style={{ padding: 12, background: "#0d0d1e", borderRadius: 6, border: "1px solid #1a1a2e" }}>
                    <div style={{ fontSize: 10, color: "#555", letterSpacing: "0.1em", marginBottom: 8 }}>QUICK PRESETS</div>
                    {[
                      { label: "Precise", temp: 0.1, tok: 500 },
                      { label: "Balanced", temp: 0.7, tok: 1000 },
                      { label: "Creative", temp: 0.95, tok: 2000 },
                    ].map(p => (
                      <button key={p.label} className="btn-ghost" style={{ width: "100%", marginBottom: 6, textAlign: "left", padding: "7px 10px" }}
                        onClick={() => { setTemperature(p.temp); setMaxTokens(p.tok); }}>
                        <span style={{ color: "#888" }}>{p.label}</span>
                        <span style={{ float: "right", color: "#444", fontSize: 10 }}>t={p.temp} · {p.tok}tok</span>
                      </button>
                    ))}
                  </div>

                </div>
              )}

              {settingsTab === "system" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 10, color: "#555", letterSpacing: "0.1em", display: "block", marginBottom: 8 }}>SYSTEM PROMPT</label>
                    <textarea
                      value={systemPrompt}
                      onChange={e => setSystemPrompt(e.target.value)}
                      rows={6}
                      style={{
                        width: "100%", background: "#0d0d1e",
                        border: "1px solid #2a2a4a", borderRadius: 6,
                        padding: "10px 12px", color: "#c8d0e0",
                        fontFamily: "inherit", fontSize: 12, lineHeight: 1.6,
                      }}
                      onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = "#00ff9f55"}
                      onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = "#2a2a4a"}
                    />
                  </div>
                  
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: "0.1em", marginBottom: 4 }}>QUICK PERSONAS</div>
                  {[
                    { label: "Trading Expert", prompt: DEFAULT_SYSTEM, checked: true },
                    { label: "Technical Analyst", prompt: "You are a cryptocurrency technical analyst specializing in chart patterns, indicators, and price action. Provide detailed technical analysis with specific entry/exit points, support/resistance levels, and risk management advice.", checked: true },
                    { label: "Market Researcher", prompt: "You are a crypto market researcher focused on fundamental analysis, news impact, and market sentiment. Analyze market trends, regulatory developments, and provide insights on how they affect cryptocurrency prices.", checked: true },
                    { label: "Risk Manager", prompt: "You are a trading risk management specialist. Focus on position sizing, stop-loss strategies, portfolio diversification, and risk-reward ratios. Always prioritize capital preservation and sustainable trading practices.", checked: true },
                  ].map(p => (
                    <div key={p.label} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 10px", borderRadius: 4,
                      background: "#0d0d1e", border: "1px solid #1a1a2e",
                      marginBottom: 6, cursor: "pointer",
                    }}
                    onClick={() => setSystemPrompt(p.prompt)}>
                      <input type="checkbox" defaultChecked={p.checked} style={{ accentColor: "#00ff9f" }} />
                      <span style={{ fontSize: 12, color: "#888", flex: 1 }}>{p.label}</span>
                    </div>
                  ))}
                  
                  <button className="btn-primary" style={{ width: "100%", padding: "10px" }}
                    onClick={() => {
                      // Save settings to localStorage
                      localStorage.setItem('llm-settings', JSON.stringify({
                        model,
                        temperature,
                        maxTokens,
                        systemPrompt,
                      }));
                      // Show brief confirmation
                      const btn = document.activeElement as HTMLButtonElement;
                      if (btn) {
                        const orig = btn.textContent;
                        btn.textContent = '✅ SAVED!';
                        setTimeout(() => { btn.textContent = orig; }, 1500);
                      }
                    }}
                  >
                    💾 SAVE SETTINGS
                  </button>
                </div>
              )}
            </div>

            {/* Bottom status */}
            <div style={{ padding: "8px 12px", borderTop: "1px solid #1a1a2e", fontSize: 10, color: "#444" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#00ff9f" }} />
                <span>OLLAMA</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
