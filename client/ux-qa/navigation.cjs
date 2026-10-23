'use strict';

async function inspectNavigationShell(page, options) {
  const nav = page.getByRole('navigation', { name: options.navigationName });
  const active = nav.locator('[aria-current="page"]');
  const activeNavLabel = (await active.innerText().catch(() => '')).trim();
  const ariaCurrent = await active.getAttribute('aria-current').catch(() => null);
  const headingVisible = await page.getByRole('heading', { name: options.title }).isVisible().catch(() => false);
  const logoutVisible = options.logoutLabel
    ? await page.getByRole('button', { name: options.logoutLabel }).isVisible().catch(() => false)
    : null;
  let sidebar = null;
  if (options.sidebarSelector) {
    sidebar = await page.locator(options.sidebarSelector).evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflows: element.scrollWidth > element.clientWidth + 2,
    })).catch(() => null);
  }

  return {
    navigationVisible: await nav.isVisible().catch(() => false),
    activeNavLabel,
    ariaCurrent,
    headingVisible,
    logoutVisible,
    sidebar,
  };
}

module.exports = { inspectNavigationShell };
