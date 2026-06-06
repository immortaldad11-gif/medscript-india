import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff8ff",
          100: "#dbeefe",
          500: "#0d77c2",
          600: "#0a5fa0",
          700: "#084d82",
        },
      },
    },
  },
  plugins: [],
};

export default config;
