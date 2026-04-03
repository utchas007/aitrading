"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  colors: typeof darkColors;
}

// Dark theme colors (current default)
const darkColors = {
  // Backgrounds
  bg: '#080810',
  bgSecondary: '#0a0a14',
  bgTertiary: '#0d0d1e',
  bgHover: '#1a1a2e',
  
  // Borders
  border: '#1a1a2e',
  borderLight: '#2a2a4a',
  borderAccent: '#00ff9f44',
  
  // Text
  text: '#c8d0e0',
  textSecondary: '#888',
  textMuted: '#666',
  textDark: '#444',
  white: '#fff',
  
  // Accents
  accent: '#00ff9f',
  accentDim: '#00ff9f22',
  accentBlue: '#0066ff',
  
  // Status
  success: '#00ff9f',
  warning: '#ffd60a',
  danger: '#ff4d6d',
  
  // Charts
  chartBg: '#0a0a14',
  chartGrid: '#1a1a2e',
};

// Light theme colors
const lightColors = {
  // Backgrounds
  bg: '#f8fafc',
  bgSecondary: '#ffffff',
  bgTertiary: '#f1f5f9',
  bgHover: '#e2e8f0',
  
  // Borders
  border: '#e2e8f0',
  borderLight: '#cbd5e1',
  borderAccent: '#10b98144',
  
  // Text
  text: '#1e293b',
  textSecondary: '#64748b',
  textMuted: '#94a3b8',
  textDark: '#cbd5e1',
  white: '#0f172a',
  
  // Accents
  accent: '#10b981',
  accentDim: '#10b98122',
  accentBlue: '#3b82f6',
  
  // Status
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  
  // Charts
  chartBg: '#ffffff',
  chartGrid: '#e2e8f0',
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  // Load theme from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('theme') as Theme;
    if (saved && (saved === 'dark' || saved === 'light')) {
      setTheme(saved);
    }
    setMounted(true);
  }, []);

  // Save theme to localStorage and update HTML class
  useEffect(() => {
    if (mounted) {
      localStorage.setItem('theme', theme);
      document.documentElement.classList.remove('dark', 'light');
      document.documentElement.classList.add(theme);
    }
  }, [theme, mounted]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const colors = theme === 'dark' ? darkColors : lightColors;

  // Prevent flash of wrong theme
  if (!mounted) {
    return null;
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// CSS variables injection component
export function ThemeStyles() {
  const { colors, theme } = useTheme();
  
  return (
    <style jsx global>{`
      :root {
        --bg: ${colors.bg};
        --bg-secondary: ${colors.bgSecondary};
        --bg-tertiary: ${colors.bgTertiary};
        --bg-hover: ${colors.bgHover};
        --border: ${colors.border};
        --border-light: ${colors.borderLight};
        --border-accent: ${colors.borderAccent};
        --text: ${colors.text};
        --text-secondary: ${colors.textSecondary};
        --text-muted: ${colors.textMuted};
        --text-dark: ${colors.textDark};
        --white: ${colors.white};
        --accent: ${colors.accent};
        --accent-dim: ${colors.accentDim};
        --accent-blue: ${colors.accentBlue};
        --success: ${colors.success};
        --warning: ${colors.warning};
        --danger: ${colors.danger};
        --chart-bg: ${colors.chartBg};
        --chart-grid: ${colors.chartGrid};
      }
      
      body {
        background: ${colors.bg};
        color: ${colors.text};
        transition: background 0.3s ease, color 0.3s ease;
      }
    `}</style>
  );
}
