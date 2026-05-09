import { mockWiki } from '@package/contracts/wiki';
import { useParams } from 'react-router-dom';
import { CompileTheater } from '../components/compile-theater/compile-theater.tsx';

export function WikiRoute() {
  const { wikiId } = useParams();
  const wiki = mockWiki();
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <h1 className="font-serif text-3xl">Wiki {wikiId}</h1>
      <p className="text-muted-foreground">
        PageTypes: {wiki.schema.pageTypes.map((p) => p.name).join(', ')}
      </p>
      <CompileTheater />
    </main>
  );
}
