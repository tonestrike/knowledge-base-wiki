import { expect, test } from '@playwright/test';

/**
 * Public-by-design homepage assertions.
 *
 * Backdrop: the Google OAuth client backing `/rpc/ingestion/authStart` is
 * in Google's "unverified app" status — only the developer can complete
 * sign-in, so prompting public visitors to sign in is wrong UX. The
 * homepage instead lands every anonymous visitor on the featured seeded
 * Anthropic-research wiki, with no auth surface at all. The dev-only
 * compile path stays behind a session.
 *
 * These tests are deliberately phrased as "an anonymous visitor must
 * see X and must NOT see Y" so the unverified-OAuth constraint stays
 * enforced even if a future refactor accidentally re-introduces a
 * sign-in CTA.
 */

const FEATURED_WIKI_ID = 'cb0b020d-50ab-41cb-91d9-09a5dda547b2';

test.describe('Anonymous visitor — public-by-design homepage', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('renders the featured-wiki hero with an "Open wiki →" CTA', async ({ page }) => {
    await page.goto('/');

    const hero = page.getByRole('region', { name: /featured wiki/i });
    await expect(hero).toBeVisible();

    // Serif title inside the hero (folder name when reachable, fixed
    // fallback otherwise — both are rendered in a serif heading).
    await expect(hero.getByRole('heading', { level: 2 })).toBeVisible();

    const openWiki = hero.getByRole('link', { name: /open wiki/i });
    await expect(openWiki).toBeVisible();
    await expect(openWiki).toHaveAttribute('href', `/wiki/${FEATURED_WIKI_ID}`);
  });

  test('does NOT show a "Sign in" button anywhere on the homepage', async ({ page }) => {
    await page.goto('/');

    // Belt-and-braces: cover every label the previous picker / hypothetical
    // hero CTAs used. None of these should exist for an anonymous visitor.
    await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /sign in/i })).toHaveCount(0);
    await expect(page.getByText(/sign in with google/i)).toHaveCount(0);
    await expect(page.getByText(/sign in to drive/i)).toHaveCount(0);
  });

  test('does NOT show the DriveFolderPicker or "Connect a Drive folder" card', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /connect a drive folder/i })).toHaveCount(0);
    await expect(page.getByPlaceholder(/search your drive folders/i)).toHaveCount(0);
    await expect(page.getByPlaceholder(/drive\.google\.com\/drive\/folders/i)).toHaveCount(0);
  });

  test('clicking the hero CTA navigates to the featured wiki', async ({ page }) => {
    await page.goto('/');

    const hero = page.getByRole('region', { name: /featured wiki/i });
    await hero.getByRole('link', { name: /open wiki/i }).click();

    await expect(page).toHaveURL(new RegExp(`/wiki/${FEATURED_WIKI_ID}(?:[/?#]|$)`));
  });
});
