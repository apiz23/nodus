# Real-browser smoke test

Run the real Nodus UI and local API in Chromium against a fresh temporary vault:

```sh
pnpm test:browser
```

The command requires Node.js 24 or newer, installed project dependencies, and a Chromium browser. Playwright uses its installed Chromium by default; install it once with `pnpm exec playwright install chromium` if it is not already available. No existing app server is reused: the runner reserves a loopback port, starts a dedicated Vite child with strict port binding and `NODUS_VAULT` pointed at a newly created temporary directory, and checks the returned vault path before opening the browser. If that child cannot bind its port, the test fails without sending requests to another server.

The runner creates a fresh browser context and temporary vault for each run. It checks the empty-vault screen, creates and saves two notes through the UI, navigates between them, verifies the saved Markdown through the local API and filesystem, reloads the page, and checks that the first note remains intact. It also fails on uncaught browser/console errors and failed or non-success local API requests. The child server, browser context, browser process, and temporary files are cleaned up in `finally` handling.

This is a focused workflow smoke test, not a visual regression suite. It uses the Vite development server and does not read or modify the configured personal vault or `dist/`.
