import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/canvas/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        space: {
          bg: "#050816", // Deep Space main background
          surface: "#0B1424", // Space Surface main panels
          panel: "#111E30",
          border: "#1E293B",
          "border-light": "#334155",
        },
        cyan: {
          DEFAULT: "#06B6D4",
          accent: "#06B6D4",
          glow: "rgba(6, 182, 212, 0.25)",
        },
        blue: {
          DEFAULT: "#3B82F6",
          accent: "#3B82F6",
        },
        magenta: {
          DEFAULT: "#D946EF",
          accent: "#D946EF",
        },
        status: {
          success: "#22C55E",
          warning: "#F59E0B",
          critical: "#EF4444",
        },
      },
      fontFamily: {
        heading: ["'Space Grotesk'", "system-ui", "sans-serif"],
        sans: ["'Inter'", "-apple-system", "BlinkMacSystemFont", "'Segoe UI'", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        "glow-cyan": "0 0 16px -2px rgba(6, 182, 212, 0.25)",
        "glow-blue": "0 0 16px -2px rgba(59, 130, 246, 0.25)",
        "glow-critical": "0 0 16px -2px rgba(239, 68, 68, 0.25)",
        panel: "0 4px 20px -2px rgba(0, 0, 0, 0.5)",
      },
    },
  },
  plugins: [],
};

export default config;
