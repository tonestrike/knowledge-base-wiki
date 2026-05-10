import type { Citation, Claim } from '@package/contracts/shared';
import type { WikiPage } from '@package/contracts/wiki';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { CitationChip } from '../citation/citation-chip.tsx';
import { Sidebar } from './sidebar.tsx';

export interface WikiPageViewProps {
  page: WikiPage;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Convert a heading like "Markets at Issue" → "markets-at-issue".
 * Mirrors the slug shape the Drafter emits in `claim.paragraphId`.
 */
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

interface BodySection {
  /** H2 heading text, or empty string for the lead-in before the first H2. */
  heading: string;
  /** Markdown body of this section (no heading). */
  markdown: string;
  /** Claims whose `paragraphId` matches this section's slug. */
  claims: Claim[];
}

/**
 * Splits the rendered markdown body into H2-delimited sections so we can
 * intersperse citation chips between sections. Drafter emits one claim per
 * H2 section (paragraphId = slug of the heading), so each section gets the
 * matching claim's citations rendered as chips inline at the end.
 *
 * If a claim's paragraphId can't be matched (Drafter drift), it gets parked
 * in a final "Sources cited" footer section so the citation never silently
 * disappears.
 *
 * Drafters frequently lead the body with `# <Title>` (H1 duplicates the
 * already-rendered title) — we strip those H1 lines before slicing.
 */
const sliceIntoSections = (page: WikiPage): { sections: BodySection[]; orphans: Claim[] } => {
  const lines = page.body.split('\n').filter((line) => !line.match(/^#\s+/));
  const sections: BodySection[] = [];
  let cursor: BodySection = { heading: '', markdown: '', claims: [] };
  for (const line of lines) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) {
      sections.push(cursor);
      cursor = { heading: m[1]?.trim() ?? '', markdown: '', claims: [] };
    } else {
      cursor.markdown += `${line}\n`;
    }
  }
  sections.push(cursor);

  const claimsByParagraphId = new Map<string, Claim>();
  for (const c of page.claims) claimsByParagraphId.set(c.paragraphId, c);

  const matched = new Set<string>();
  for (const s of sections) {
    const slug = slugify(s.heading);
    const claim = slug ? claimsByParagraphId.get(slug) : undefined;
    if (claim) {
      s.claims.push(claim);
      matched.add(claim.id);
    }
  }
  const orphans = page.claims.filter((c) => !matched.has(c.id));
  // Drop the empty leading section if it has nothing in it.
  const trimmed = sections.filter((s, i) => i > 0 || s.markdown.trim().length > 0);
  return { sections: trimmed, orphans };
};

export function WikiPageView({ page }: WikiPageViewProps) {
  const { sections, orphans } = sliceIntoSections(page);

  // Custom markdown <a> renderer that rewrites IndexBuilder's `/<uuid>`
  // links into proper React Router routes (`/wiki/<wikiId>/page/<uuid>`)
  // and uses <Link> so navigation stays SPA-fast. External links are
  // kept as raw <a target="_blank">.
  const components = useMemo(
    () => ({
      a: ({
        href,
        children,
        ...rest
      }: {
        href?: string;
        children?: React.ReactNode;
      } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
        if (!href) return <span {...rest}>{children}</span>;
        const internalUuid = href.match(/^\/([0-9a-f-]+)$/i);
        if (internalUuid && UUID_RE.test(internalUuid[1] ?? '')) {
          return (
            <Link
              to={`/wiki/${page.wikiId}/page/${internalUuid[1]}`}
              className="text-accent underline-offset-4 hover:underline"
            >
              {children}
            </Link>
          );
        }
        if (href.startsWith('/')) {
          return (
            <Link to={href} className="text-accent underline-offset-4 hover:underline">
              {children}
            </Link>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline-offset-4 hover:underline"
            {...rest}
          >
            {children}
          </a>
        );
      },
    }),
    [page.wikiId],
  );

  return (
    <article className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 py-12 md:grid-cols-[minmax(0,60ch)_280px]">
      <div>
        {page.pageType ? (
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
            {page.pageType}
          </p>
        ) : null}
        <h1 className="mt-2 font-serif text-4xl leading-tight tracking-tight md:text-5xl">
          {page.title}
        </h1>
        <div className="prose-magazine mt-8 [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:tracking-tight [&_p]:mt-4">
          {sections.map((s, i) => (
            <section key={`${s.heading}-${i}`} className="mt-8 first:mt-0">
              {s.heading ? <h2>{s.heading}</h2> : null}
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {s.markdown}
              </ReactMarkdown>
              {s.claims.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.claims.flatMap((c) =>
                    c.citations.map((cite: Citation) => (
                      <CitationChip key={cite.id} citation={cite} />
                    )),
                  )}
                </div>
              ) : null}
            </section>
          ))}
          {orphans.length > 0 ? (
            <section className="mt-8">
              <h2>Sources cited</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {orphans.flatMap((c) =>
                  c.citations.map((cite: Citation) => (
                    <CitationChip key={cite.id} citation={cite} />
                  )),
                )}
              </div>
            </section>
          ) : null}
        </div>
      </div>
      <Sidebar page={page} />
    </article>
  );
}
