import type { Artifact } from '@package/contracts/shared';

type CodeBlockArtifact = Extract<Artifact, { kind: 'CodeBlock' }>;

export function CodeBlock({ artifact }: { artifact: CodeBlockArtifact }) {
  const { props } = artifact;
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
      <code className="font-mono">{props.source}</code>
    </pre>
  );
}
