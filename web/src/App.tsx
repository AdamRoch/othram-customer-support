import { useEffect, useState } from 'react';
import type { HealthResponse } from '@othram/shared';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'success'; value: HealthResponse }
  | { kind: 'error'; message: string };

const healthUrl = `${import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'}/health`;

export function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;

    async function checkHealth() {
      try {
        const response = await fetch(healthUrl);
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const value = (await response.json()) as HealthResponse;
        if (active) setHealth({ kind: 'success', value });
      } catch (error) {
        if (active) {
          setHealth({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }

    void checkHealth();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main>
      <p className="eyebrow">Othram customer support</p>
      <h1>Agent Core is coming online.</h1>
      <section aria-live="polite">
        <h2>Server health</h2>
        {health.kind === 'loading' && <p>Checking the support server…</p>}
        {health.kind === 'success' && (
          <p className="success">
            {health.value.service}: {health.value.status}
          </p>
        )}
        {health.kind === 'error' && <p className="error">Unavailable: {health.message}</p>}
      </section>
    </main>
  );
}
