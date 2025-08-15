import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

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
  const links = [{ to: '/', label: 'Home' }];

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex gap-4 text-lg">
          {links.map(({ to, label }) => {
            return (
              <Link key={to} to={to}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <select
            aria-label="Theme"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            onChange={(e) => setTheme(e.target.value as typeof theme)}
            value={theme}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>
      <hr />
    </div>
  );
}
