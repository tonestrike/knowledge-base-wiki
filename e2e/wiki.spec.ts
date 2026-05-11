import { expect, test } from '@playwright/test';

/**
 * End-to-end smoke for the public wiki path against the live deploy.
 *
 * Walks the user's path: home → featured wiki → wiki overview → first page →
 * citation chips → chat dock. No OAuth, no fixtures — everything here is what
 * a logged-out visitor sees the moment they land on the featured demo.
 *
 * Some assertions depend on Stream B's "Featured demo" banner shipping and
 * the chat dock auto-focusing the composer on open (Stream A). Until those
 * land the relevant steps will fail and the PR description calls out which.
 */

const FEATURED_WIKI_ID = 'cb0b020d-50ab-41cb-91d9-09a5dda547b2';

test.describe('public wiki path', () => {
  test('home → featured banner → wiki overview → page → chat dock', async ({ page }) => {
    // ---- Home: featured demo banner ----
    await page.goto('/');

    // The "Featured demo" banner — Stream B — surfaces the seed wiki up top
    // so a first-time visitor can click straight in without signing in.
    const banner = page
      .getByRole('region', { name: /featured demo/i })
      .or(page.locator('[data-testid="featured-demo-banner"]'));
    await expect(banner, 'Featured demo banner should be present on the home page').toBeVisible();
    await expect(banner, 'banner should name the Anthropic research bundle').toContainText(
      'Anthropic research bundle',
    );

    // The CTA link inside the banner — its target should be the featured wiki.
    const openWiki = banner.getByRole('link', { name: /open wiki/i });
    await expect(openWiki, 'banner should have an "Open wiki →" link').toBeVisible();

    await openWiki.click();

    // ---- Wiki overview ----
    await expect(page).toHaveURL(new RegExp(`/wiki/${FEATURED_WIKI_ID}(?:/|$)`));

    // Page-type chips render from the wiki schema. The Anthropic bundle has
    // Risk / Pain / Opportunity / Wedge / Competitor / Trend; we don't pin
    // them all, just confirm at least one chip is visible.
    const riskChip = page.getByText('Risk', { exact: true }).first();
    await expect(riskChip, 'a page-type chip should render in the overview').toBeVisible();

    // At least one wiki page card / tree row. We accept either the body
    // grid (PageType cards) or the left-rail tree links — both prove the
    // overview is rendering pages.
    const pageLink = page.locator(`a[href*="/wiki/${FEATURED_WIKI_ID}/page/"]`).first();
    await expect(pageLink, 'overview should expose at least one wiki page link').toBeVisible();

    // ---- Drill into the first wiki page ----
    await pageLink.click();
    await expect(page).toHaveURL(new RegExp(`/wiki/${FEATURED_WIKI_ID}/page/[0-9a-f-]{36}`));

    // Citation chips are rounded-full <button>s next to a page section.
    // We don't care which citation appears, only that the wiki page actually
    // pulled in citations from the compiled corpus.
    const citationChip = page.locator('button.rounded-full[title]').first();
    await expect(citationChip, 'at least one citation chip should be in the DOM').toBeVisible({
      timeout: 15_000,
    });

    // ---- Open the chat dock ----
    // The dock toggle lives in the AppShell header next to Overview/Lint/Gaps.
    // (The brief calls it the "drag-handle" button — that's the same button
    //  that exposes the resizable dock; the dock itself has a drag handle on
    //  its left edge for resizing.)
    await page.getByRole('button', { name: /^chat/i }).first().click();

    // Dock should reveal its composer. The textarea uses placeholder "Ask
    // anything…" — see chat-dock/Composer.
    const composer = page.locator('textarea[placeholder="Ask anything…"]');
    await expect(composer, 'chat dock composer should appear').toBeVisible();

    // Stream A is expected to autofocus the composer on dock open so a user
    // can start typing immediately. If this fails today, it's the
    // regression-target for that work.
    await expect(composer, 'composer should be focused after opening the dock').toBeFocused();
  });
});
