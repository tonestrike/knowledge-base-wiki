import { TriangleAlert } from 'lucide-react';
import { Button } from '../ui/button.tsx';

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-start gap-4 rounded-lg border border-verdict-contradicted/40 bg-verdict-contradicted/5 p-6">
      <TriangleAlert className="mt-1 h-5 w-5 text-verdict-contradicted" />
      <div className="flex-1">
        <p className="font-mono text-xs uppercase tracking-wider">Something went wrong</p>
        <p className="mt-1 text-sm">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
