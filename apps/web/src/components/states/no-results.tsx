export function NoResultsState({ query }: { query?: string }) {
  return (
    <div className="rounded-lg border border-border p-8 text-center text-muted-foreground">
      {query ? (
        <>
          No matches for <span className="font-mono">"{query}"</span>.
        </>
      ) : (
        <>No results.</>
      )}
    </div>
  );
}
