import type { Wiki } from '@package/contracts/wiki';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

interface FeaturedWikiHeroProps {
  wiki: Wiki;
}

/**
 * The headline card at the top of the landing page. Showcases a single
 * wiki — its thesis and page-type taxonomy — so an unauthenticated
 * visitor immediately has something rich to click into without first
 * signing in. The compiled grid below renders the user's other wikis
 * (if any), with this one excluded to avoid duplication.
 *
 * We show only the first sentence of `wiki.schema.thesis` here:
 *  - Theses are written by the Narrator pass and tend to run long.
 *  - A single sentence keeps the hero scannable; the full thesis lives
 *    on the wiki's own page.
 *  - If no thesis was inferred (older compiles), we fall back to a
 *    generic line so the slot still has weight.
 */
export function FeaturedWikiHero({ wiki }: FeaturedWikiHeroProps) {
  const title = firstPageTypeOrDefault(wiki);
  const blurb = firstSentenceOfThesis(wiki.schema.thesis);
  const chips = wiki.schema.pageTypes.slice(0, 5).map((p) => p.name);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      aria-labelledby="featured-wiki-title"
      className="space-y-4"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">Featured wiki</p>
      <Link
        to={`/wiki/${wiki.id}`}
        className="group relative block overflow-hidden rounded-2xl border border-accent/30 bg-linear-to-br from-accent/10 via-card/40 to-card/10 p-8 transition-colors hover:border-accent/60 md:p-12"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-accent/40 to-transparent" />
        <h2
          id="featured-wiki-title"
          className="font-serif text-4xl leading-tight tracking-tight md:text-5xl"
        >
          {title}
        </h2>
        <p className="mt-4 max-w-prose text-base leading-relaxed text-muted-foreground md:text-lg">
          {blurb}
        </p>
        <ul className="mt-6 flex flex-wrap gap-2">
          {chips.map((name) => (
            <li
              key={name}
              className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-accent"
            >
              {name}
            </li>
          ))}
          {wiki.schema.pageTypes.length > chips.length ? (
            <li className="self-center font-mono text-[11px] text-muted-foreground">
              +{wiki.schema.pageTypes.length - chips.length} more
            </li>
          ) : null}
        </ul>
        <p className="mt-8 inline-flex items-center gap-1 font-mono text-xs uppercase tracking-[0.2em] text-accent transition-transform group-hover:translate-x-0.5">
          Open wiki <span aria-hidden>→</span>
        </p>
      </Link>
    </motion.section>
  );
}

/**
 * Pulls a "hero title" off the wiki. The Wiki type has no top-level
 * title field — the closest thing is the schema's first PageType
 * description, but that reads like taxonomy not a headline. We use a
 * stable default and let the thesis carry the actual narrative.
 */
function firstPageTypeOrDefault(_wiki: Wiki): string {
  return 'A typed, span-verified wiki';
}

/**
 * Trims a thesis paragraph to its first sentence so the hero stays
 * scannable. We split on the first sentence-terminator followed by a
 * space (so abbreviations like "U.S." don't break it too aggressively)
 * and fall back to the whole string if no terminator is found.
 */
function firstSentenceOfThesis(thesis: string | undefined): string {
  if (!thesis || thesis.trim().length === 0) {
    return 'Compile a folder of documents into a wiki you can chat with — every claim anchored to the verbatim source bytes.';
  }
  const trimmed = thesis.trim();
  const match = trimmed.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (match?.[0] ?? trimmed).trim();
}
