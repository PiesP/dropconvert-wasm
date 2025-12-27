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
    extend: {},
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
