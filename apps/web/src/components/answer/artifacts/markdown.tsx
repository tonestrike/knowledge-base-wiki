import type { Artifact } from '@package/contracts/shared';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MarkdownArtifact = Extract<Artifact, { kind: 'Markdown' }>;

export function Markdown({ artifact }: { artifact: MarkdownArtifact }) {
  return (
    <div className="prose-magazine">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.props.body}</ReactMarkdown>
    </div>
  );
}
