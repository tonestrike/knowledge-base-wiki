import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';

export function RootRoute() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="font-serif text-5xl tracking-tight">folder-wiki</h1>
      <p className="mt-4 max-w-prose text-muted-foreground">
        Compile a Drive folder into a typed, verified wiki.
      </p>
      <Card className="mt-10">
        <CardHeader>
          <CardTitle>Pick a Drive folder</CardTitle>
        </CardHeader>
        <CardContent>
          <Link
            to="/wiki/44444444-2222-4333-8444-555555555555"
            className="text-accent underline-offset-4 hover:underline"
          >
            View demo wiki →
          </Link>
        </CardContent>
      </Card>
      <p className="mt-12 text-sm text-muted-foreground">
        <Link to="/design-system" className="underline">
          Design system
        </Link>
      </p>
    </main>
  );
}
