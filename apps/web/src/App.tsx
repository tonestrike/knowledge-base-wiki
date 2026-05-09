import { useQuery } from '@tanstack/react-query';
import { orpc } from './lib/orpc.ts';

export function App() {
  const health = useQuery(orpc.core.health.queryOptions());

  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <h1>tenex</h1>
      <section>
        <h2>health</h2>
        {health.isPending && <p>checking...</p>}
        {health.isError && <p>error: {String(health.error)}</p>}
        {health.data && <pre>{JSON.stringify(health.data, null, 2)}</pre>}
      </section>
    </main>
  );
}
