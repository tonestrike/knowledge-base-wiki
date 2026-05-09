import { Skeleton } from '../ui/skeleton.tsx';

export function LoadingState({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => `skeleton-row-${i}`).map((key) => (
        <Skeleton key={key} className="h-6 w-full" />
      ))}
    </div>
  );
}
