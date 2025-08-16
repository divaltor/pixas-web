import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

export default function Header() {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const root = document.documentElement;
    const apply = (t: typeof theme) => {
      const resolved = t === 'system' ? (media.matches ? 'dark' : 'light') : t;
      if (resolved === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };
    apply(theme);
    const handler = () => {
      if (theme === 'system') {
        apply('system');
      }
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [theme]);
  return (
    <div>
      <div className="flex flex-row items-center justify-end px-2 py-1">
        <div className="flex items-center">
          <div
            aria-label="Theme"
            className="inline-flex items-center rounded-md border bg-background p-1"
            role="radiogroup"
          >
            <button
              aria-checked={theme === 'system'}
              aria-label="System theme"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-sm transition-colors ${
                theme === 'system'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
              onClick={() => setTheme('system')}
              role="radio"
              type="button"
            >
              <Monitor className="h-4 w-4" />
            </button>
            <button
              aria-checked={theme === 'light'}
              aria-label="Light theme"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-sm transition-colors ${
                theme === 'light'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
              onClick={() => setTheme('light')}
              role="radio"
              type="button"
            >
              <Sun className="h-4 w-4" />
            </button>
            <button
              aria-checked={theme === 'dark'}
              aria-label="Dark theme"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-sm transition-colors ${
                theme === 'dark'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
              onClick={() => setTheme('dark')}
              role="radio"
              type="button"
            >
              <Moon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <hr />
    </div>
  );
}
