import type { Config } from 'tailwindcss';

export default {
  content: {
    files: ['./index.html', './src/**/*.{ts,tsx}'],
    // Extract dynamic class patterns for more accurate purging
    extract: {
      tsx: (content) => {
        // Match all class attributes including classList and dynamic strings
        const classMatches = content.match(/class(?:Name|List)?=["'{]([^"'}]+)["'}]/g);
        return classMatches ? classMatches.join(' ') : content;
      },
    },
  },
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
  // Disable unused core plugins to reduce bundle size
  corePlugins: {
    // Disable features we're not using
    container: false,
    float: false,
    clear: false,
    objectFit: false,
    objectPosition: false,
    overscrollBehavior: false,
    placeholderColor: false,
    placeholderOpacity: false,
    verticalAlign: false,
    listStylePosition: false,
    listStyleType: false,
    appearance: false,
    columns: false,
    breakBefore: false,
    breakInside: false,
    breakAfter: false,
    gridAutoColumns: false,
    gridAutoFlow: false,
    gridAutoRows: false,
    gridTemplateColumns: false,
    gridTemplateRows: false,
    gridColumn: false,
    gridColumnStart: false,
    gridColumnEnd: false,
    gridRow: false,
    gridRowStart: false,
    gridRowEnd: false,
  },
  plugins: [],
} satisfies Config;
