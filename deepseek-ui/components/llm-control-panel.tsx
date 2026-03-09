"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const MODELS = [
  { id: "deepseek-r1:14b", label: "DeepSeek R1 14B", provider: "DeepSeek" },
  { id: "deepseek-r1:32b", label: "DeepSeek R1 32B", provider: "DeepSeek" },
  { id: "deepseek-r1:70b", label: "DeepSeek R1 70B", provider: "DeepSeek" },
];

const DEFAULT_SYSTEM = "You are an expert cryptocurrency trading assistant with deep knowledge of market analysis, technical indicators, and trading strategies. You have access to real-time market data and can provide detailed analysis, price predictions, and trading recommendations. Always provide direct, actionable answers about market conditions, trends, and trading opportunities. Never deflect questions or tell users to check elsewhere - analyze the data and provide your expert opinion.";

function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "10px 14px" }}>
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
  const [messages, setMessages] = useState<Array<{ role: string; content: string; ts: Date; tokens?: number; error?: boolean }>>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsTab, setSettingsTab] = useState("model");
  const [sessionStart] = useState(new Date());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

    try {
      const res = await fetch("/api/chat", {
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
      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      const assistantText = data.response || "No response.";
      const tokensUsed = data.tokens || 0;
      setTotalTokens(t => t + tokensUsed);
      setMessages(prev => [...prev, { role: "assistant", content: assistantText, ts: new Date(), tokens: tokensUsed }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `⚠ Error: ${e.message}`, ts: new Date(), error: true }]);
    }
    setLoading(false);
  }, [input, loading, messages, model, maxTokens, systemPrompt, temperature]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const clearChat = () => { setMessages([]); setTotalTokens(0); };

  const selectedModel = MODELS.find(m => m.id === model);
  const uptime = Math.floor((new Date().getTime() - sessionStart.getTime()) / 1000);
  const uptimeStr = `${Math.floor(uptime / 60)}m ${uptime % 60}s`;

  return (
    <div style={{
      fontFamily: "'Berkeley Mono', 'Fira Code', 'Cascadia Code', monospace",
      background: "#080810",
      color: "#c8d0e0",
      height: "100vh",
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
        @keyframes scanline { 0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)} }
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
      `}</style>

      {/* Scanline effect */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        pointerEvents: "none", zIndex: 100, overflow: "hidden", opacity: 0.03,
      }}>
        <div style={{
          width: "100%", height: "2px", background: "#fff",
          animation: "scanline 6s linear infinite",
        }} />
      </div>

      {/* Top Bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 20px",
        borderBottom: "1px solid #1a1a2e",
        background: "#0a0a16",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, background: "linear-gradient(135deg, #00ff9f, #0066ff)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 14 }}>⬡</span>
          </div>
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: "0.1em", color: "#fff" }}>
            LLM<span style={{ color: "#00ff9f" }}>CTRL</span>
          </span>
        </div>

        <div style={{ width: 1, height: 20, background: "#1a1a2e", margin: "0 4px" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff9f", boxShadow: "0 0 6px #00ff9f" }} />
          <span style={{ fontSize: 11, color: "#00ff9f", letterSpacing: "0.1em" }}>ONLINE</span>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", gap: 20, fontSize: 11, color: "#444" }}>
          <span>MDL: <span style={{ color: "#888" }}>{selectedModel?.label}</span></span>
          <span>SESS: <span style={{ color: "#888" }}>{uptimeStr}</span></span>
          <span>MSGS: <span style={{ color: "#888" }}>{messages.length}</span></span>
        </div>

        <button className="btn-ghost" onClick={() => setSidebarOpen(s => !s)} style={{ fontSize: 14, padding: "4px 10px" }}>
          {sidebarOpen ? "⟩" : "⟨"}
        </button>
      </div>

      {/* Main Layout */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Chat Area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

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
                  }}>
                    {msg.content}
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

          {/* Token bar */}
          <div style={{ padding: "6px 24px", borderTop: "1px solid #0f0f20" }}>
            <TokenBar used={totalTokens} max={8000} />
          </div>

          {/* Input */}
          <div style={{
            padding: "14px 24px 18px",
            background: "#0a0a14",
            borderTop: "1px solid #1a1a2e",
            display: "flex", gap: 10, alignItems: "flex-end",
          }}>
            <div style={{ flex: 1, position: "relative" }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
                rows={3}
                style={{
                  width: "100%",
                  background: "#0d0d1e",
                  border: "1px solid #2a2a4a",
                  borderRadius: 8,
                  padding: "10px 14px",
                  color: "#c8d0e0",
                  fontFamily: "inherit",
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  transition: "border-color 0.2s",
                }}
                onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = "#00ff9f55"}
                onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = "#2a2a4a"}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button className="btn-primary" onClick={sendMessage} disabled={loading || !input.trim()}>
                {loading ? "▶▶" : "▶ SEND"}
              </button>
              <button className="btn-ghost" onClick={clearChat}>CLR</button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        {sidebarOpen && (
          <div style={{
            width: 280,
            borderLeft: "1px solid #1a1a2e",
            background: "#0a0a14",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            flexShrink: 0,
          }}>
            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "1px solid #1a1a2e", padding: "0 12px" }}>
              {["model", "params", "system"].map(t => (
                <button key={t} className={`tab-btn ${settingsTab === t ? "active" : ""}`} onClick={() => setSettingsTab(t)}>
                  {t.toUpperCase()}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>

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
                      rows={8}
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
                    { label: "Trading Expert", prompt: DEFAULT_SYSTEM },
                    { label: "Technical Analyst", prompt: "You are a cryptocurrency technical analyst specializing in chart patterns, indicators, and price action. Provide detailed technical analysis with specific entry/exit points, support/resistance levels, and risk management advice." },
                    { label: "Market Researcher", prompt: "You are a crypto market researcher focused on fundamental analysis, news impact, and market sentiment. Analyze market trends, regulatory developments, and provide insights on how they affect cryptocurrency prices." },
                    { label: "Risk Manager", prompt: "You are a trading risk management specialist. Focus on position sizing, stop-loss strategies, portfolio diversification, and risk-reward ratios. Always prioritize capital preservation and sustainable trading practices." },
                  ].map(p => (
                    <button key={p.label} className="btn-ghost" style={{ textAlign: "left", marginBottom: 4, width: "100%" }}
                      onClick={() => setSystemPrompt(p.prompt)}>
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom status */}
            <div style={{ padding: "12px 16px", borderTop: "1px solid #1a1a2e", fontSize: 10, color: "#333" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#00ff9f" }} />
                <span>OLLAMA CONNECTED · v1.0</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
