import { expect, test } from '@playwright/test';

/**
 * Logged-out regression. Lives entirely in a fresh, cookie-less browser
 * context so it mimics a first-time visitor who has never signed in to
 * Drive.
 *
 * Today the api leaks every user's wiki list to anonymous callers and
 * the DriveFolderPicker happily renders folders that aren't this user's.
 * Stream A is locking that down — session-scoped auth — so this spec
 * lives here as the regression sentinel.
 *
 * Requires Stream A — session-scoped auth — to be merged.
 */

test.describe('incognito (anonymous) home', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('anonymous visitor sees the sign-in CTA, not the Drive picker', async ({ page }) => {
    await page.goto('/');

    // After Stream A merges, the home page swaps the Drive picker for a
    // sign-in CTA whenever there's no session cookie. Either copy variant
    // ("Sign in" / "Sign in with Google" / "Connect Google Drive") is fine
    // as long as it's a sign-in entry point.
    const signInCta = page
      .getByRole('button', { name: /sign in|connect.*google|continue with google/i })
      .or(page.getByRole('link', { name: /sign in|connect.*google|continue with google/i }));
    await expect(signInCta, 'sign-in CTA should be visible to anonymous visitors').toBeVisible();

    // Critically: the DriveFolderPicker — which lists folders from the
    // user's Drive — must NOT render for an anonymous caller. Its hallmark
    // copy is "Pick a folder from your Google Drive".
    const drivePickerCopy = page.getByText(/pick a folder from your google drive/i);
    await expect(
      drivePickerCopy,
      'DriveFolderPicker should not render for anonymous user',
    ).toHaveCount(0);
  });

  test('anonymous visitor sees only the featured wiki in the list', async ({ page }) => {
    await page.goto('/');

    // The home page's "Compiled wikis" grid is rendered as a <ul>. With
    // session-scoped auth, an anonymous visitor should see exactly the
    // featured demo wiki ("Anthropic research bundle") and nothing else
    // — no leaked wikis from other users.
    const wikiCards = page.locator('ul a[href^="/wiki/"]');
    await expect(wikiCards, 'exactly one wiki should be visible to anonymous visitors').toHaveCount(
      1,
    );
    await expect(wikiCards.first()).toContainText('Anthropic research bundle');
  });
});
