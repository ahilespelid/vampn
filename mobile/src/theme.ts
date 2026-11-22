export type AppTheme = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  button: string;
  buttonText: string;
  accent: string;
  backdrop: string;
};

const baseTheme: AppTheme = {
  background: '#f4f4f2',
  surface: '#ffffff',
  text: '#161616',
  muted: '#6d6d6d',
  border: '#e4e4e0',
  button: '#111111',
  buttonText: '#ffffff',
  accent: '#ef7d1a',
  backdrop: 'rgba(22, 22, 22, 0.35)',
};

function invertHex(color: string): string {
  const hex = color.slice(1);
  const channels = [0, 2, 4].map(start =>
    (255 - parseInt(hex.slice(start, start + 2), 16)).toString(16).padStart(2, '0'),
  );
  return `#${channels.join('')}`;
}

function invertColor(color: string): string {
  if (color.startsWith('#')) {
    return invertHex(color);
  }
  const parts = color.match(/[\d.]+/g);
  if (!parts || parts.length < 3) {
    return color;
  }
  const [red, green, blue, alpha = '1'] = parts;
  return `rgba(${255 - Number(red)}, ${255 - Number(green)}, ${255 - Number(blue)}, ${alpha})`;
}

export function themeFor(inverted: boolean): AppTheme {
  if (!inverted) {
    return baseTheme;
  }
  return {
    background: invertColor(baseTheme.background),
    surface: invertColor(baseTheme.surface),
    text: invertColor(baseTheme.text),
    muted: invertColor(baseTheme.muted),
    border: invertColor(baseTheme.border),
    button: invertColor(baseTheme.button),
    buttonText: invertColor(baseTheme.buttonText),
    accent: invertColor(baseTheme.accent),
    backdrop: invertColor(baseTheme.backdrop),
  };
}
