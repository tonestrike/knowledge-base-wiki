import type { Gap } from '@package/contracts/wiki';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../components/app-shell.tsx';
import { EmptyState } from '../components/states/empty.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { LoadingState } from '../components/states/loading.tsx';
import { orpc } from '../lib/orpc.ts';

const KIND_LABEL: Record<Gap['kind'], string> = {
  PageTypeHasNoPages: 'PageType has no pages',
  PageHasNoClaims: 'Page has no claims',
  ClaimHasNoCitations: 'Claim has no citations',
  SourceNeverCited: 'Source never cited',
};

const KIND_BLURB: Record<Gap['kind'], string> = {
  PageTypeHasNoPages:
    'The schema declares this PageType but the Drafter never produced a page for it. Often a corpus-coverage gap or a schema misjudgment.',
  PageHasNoClaims:
    "This Concept page has prose but no grounded claims, so the Verifier can't lint it.",
  ClaimHasNoCitations: 'The claim asserts something but cites no source — a verification hazard.',
  SourceNeverCited:
    'This source was ingested but no citation in the wiki references it. Possibly out-of-scope, possibly missed coverage.',
};

export function GapsRoute() {
  const { wikiId = '' } = useParams();
  const gaps = useQuery({
    ...orpc.wiki.gaps.queryOptions({ input: { id: wikiId } }),
    enabled: !!wikiId,
  });

  const grouped = useMemo(() => {
    const out: Record<Gap['kind'], Gap[]> = {
      PageTypeHasNoPages: [],
      PageHasNoClaims: [],
      ClaimHasNoCitations: [],
      SourceNeverCited: [],
    };
    for (const g of gaps.data?.gaps ?? []) {
      out[g.kind].push(g);
    }
    return out;
  }, [gaps.data]);

  return (
    <AppShell>
      <main className="mx-auto max-w-4xl space-y-8 px-6 py-10">
        <motion.header
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <h1 className="font-serif text-4xl tracking-tight">Gaps</h1>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            Wiki health report. We surface structural holes in the compile so you can decide whether
            to re-run, expand the corpus, or revise the schema.
          </p>
          {gaps.data ? (
            <p className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">
              {gaps.data.totalGaps === 0 ? 'no gaps' : `${gaps.data.totalGaps} gaps`} ·{' '}
              <time dateTime={gaps.data.generatedAt}>
                {new Date(gaps.data.generatedAt).toLocaleString()}
              </time>
            </p>
          ) : null}
        </motion.header>

        {gaps.isLoading ? <LoadingState /> : null}
        {gaps.error ? <ErrorState message={(gaps.error as Error).message} /> : null}

        {gaps.data && gaps.data.totalGaps === 0 ? (
          <EmptyState
            title="No structural gaps"
            description="Every PageType has at least one page, every Concept page has claims, every claim has citations, and every source is cited at least once."
          />
        ) : null}

        {(
          [
            'PageTypeHasNoPages',
            'PageHasNoClaims',
            'ClaimHasNoCitations',
            'SourceNeverCited',
          ] as const
        ).map((kind) => {
          const items = grouped[kind];
          if (items.length === 0) return null;
          return (
            <section key={kind} className="space-y-3">
              <header>
                <h2 className="font-serif text-2xl tracking-tight">
                  {KIND_LABEL[kind]}{' '}
                  <span className="font-sans text-sm font-normal text-muted-foreground">
                    ({items.length})
                  </span>
                </h2>
                <p className="mt-1 max-w-prose text-sm text-muted-foreground">{KIND_BLURB[kind]}</p>
              </header>
              <ul className="space-y-2">
                {items.map((g, i) => (
                  <motion.li
                    key={gapKey(g)}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      type: 'spring',
                      stiffness: 240,
                      damping: 26,
                      delay: Math.min(i * 0.03, 0.3),
                    }}
                  >
                    <GapRow wikiId={wikiId} gap={g} />
                  </motion.li>
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </AppShell>
  );
}

function gapKey(g: Gap): string {
  if (g.kind === 'PageTypeHasNoPages') return `pt:${g.pageType}`;
  if (g.kind === 'PageHasNoClaims') return `pg:${g.pageId}`;
  if (g.kind === 'ClaimHasNoCitations') return `cl:${g.claimId}`;
  return `src:${g.sourceId}`;
}

/**
 * Per-row action shape. Each gap kind exposes a small "what should I do
 * about this?" affordance — opening the source PDF, jumping to the page,
 * or kicking off a fresh Compile / Lint run. We keep the action set tight
 * (one or two per row) so the list reads as a punch list, not a dashboard.
 */
function actionsFor(
  wikiId: string,
  gap: Gap,
): Array<{ label: string; to: string; external?: boolean }> {
  switch (gap.kind) {
    case 'PageTypeHasNoPages':
      // Re-running Compile is the canonical fix — the Drafter may produce
      // pages for this PageType on a second pass once the schema settles.
      // The Overview hosts the Recompile button; we deep-link there.
      return [{ label: 'Recompile →', to: `/wiki/${wikiId}` }];
    case 'PageHasNoClaims':
      return [
        { label: 'Open page →', to: `/wiki/${wikiId}/page/${gap.pageId}` },
        { label: 'Lint →', to: `/wiki/${wikiId}/lint` },
      ];
    case 'ClaimHasNoCitations':
      return [
        { label: 'Open page →', to: `/wiki/${wikiId}/page/${gap.pageId}` },
        { label: 'Lint →', to: `/wiki/${wikiId}/lint` },
      ];
    case 'SourceNeverCited':
      return [{ label: 'Open source PDF →', to: `/__source/${gap.sourceId}/raw`, external: true }];
  }
}

function RowActions({ actions }: { actions: ReturnType<typeof actionsFor> }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
      {actions.map((a) =>
        a.external ? (
          <a
            key={a.to}
            href={a.to}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-accent transition-colors hover:text-foreground"
          >
            {a.label}
          </a>
        ) : (
          <Link
            key={a.to}
            to={a.to}
            className="font-mono text-accent transition-colors hover:text-foreground"
          >
            {a.label}
          </Link>
        ),
      )}
    </div>
  );
}

function GapRow({ wikiId, gap }: { wikiId: string; gap: Gap }) {
  const base = 'block rounded-md border border-border/60 bg-card/40 p-4 transition-colors';
  const actions = actionsFor(wikiId, gap);
  switch (gap.kind) {
    case 'PageTypeHasNoPages':
      return (
        <div className={base}>
          <div className="font-medium">{gap.pageType}</div>
          <div className="mt-1 text-sm text-muted-foreground">{gap.description}</div>
          <RowActions actions={actions} />
        </div>
      );
    case 'PageHasNoClaims':
      return (
        <div className={base}>
          <div className="font-medium">{gap.title}</div>
          <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
            {gap.pageType ?? 'Concept'}
          </div>
          <RowActions actions={actions} />
        </div>
      );
    case 'ClaimHasNoCitations':
      return (
        <div className={base}>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            on <span className="font-medium text-foreground/80">{gap.pageTitle}</span>
          </div>
          <div className="mt-1 italic">"{gap.claimText}"</div>
          <RowActions actions={actions} />
        </div>
      );
    case 'SourceNeverCited':
      return (
        <div className={base}>
          <div className="font-mono text-sm">{gap.filename}</div>
          <RowActions actions={actions} />
        </div>
      );
  }
}
