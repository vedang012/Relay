export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        relay: { teal: "#0f766e", navy: "#151d2e", canvas: "#f8fafc" },
      },
    },
  },
  plugins: [],
};
