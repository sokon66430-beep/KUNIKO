import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Refined indigo-blue — confident and professional, not neon.
        brand: {
          50: "#eef4ff",
          100: "#dbe6fe",
          200: "#bfd3fe",
          300: "#93b4fd",
          400: "#608cfa",
          500: "#3b66f5",
          600: "#2549e8",
          700: "#1d38d4",
          800: "#1e30ac",
          900: "#1e2e88",
        },
        ink: {
          900: "#0b1120",
          800: "#131a2b",
          700: "#1c2539",
          600: "#2a3450",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "Segoe UI", "sans-serif"],
      },
      borderRadius: {
        xl: "0.85rem",
        "2xl": "1.15rem",
        "3xl": "1.6rem",
      },
      boxShadow: {
        // Soft, layered depth — modern "floating" surfaces over hairline borders.
        card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.03)",
        soft: "0 4px 20px -6px rgba(16,24,40,0.10), 0 2px 8px -4px rgba(16,24,40,0.05)",
        lift: "0 20px 44px -14px rgba(16,24,40,0.22), 0 6px 16px -8px rgba(16,24,40,0.10)",
        "brand-glow": "0 6px 16px -6px rgba(37,73,232,0.40)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.28s cubic-bezier(0.16,1,0.3,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
