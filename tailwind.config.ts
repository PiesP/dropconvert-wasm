import type { Config } from 'tailwindcss';

export default {
  theme: {
    extend: {
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        shrink: {
          '0%': { width: '100%' },
          '100%': { width: '0%' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.3s ease-out',
        shrink: 'shrink linear',
      },
    },
  },
  plugins: [],
} satisfies Config;
