# Gentum Finance public website

A standalone, static product and download-status page. It is separate from the financial application in `frontend/`, the local Go service in `backend/`, and desktop packaging in `desktop/`.

## Build and preview

Python 3 is the only build prerequisite. No package installation is required.

```sh
cd website
python3 build.py
python3 -m http.server 4174 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:4174`. The build checks local asset paths, anchor targets, the external link allowlist, and responsive/reduced-motion CSS rules, then creates `website/dist/`. It does not verify remote URL availability or replace visual and accessibility review.

All runtime assets are local, including JetBrains Mono and its SIL Open Font License in `assets/fonts/OFL.txt`. The page has no JavaScript, analytics, external font requests, or financial application connection. The illustrated ledger uses fictional example values and is labeled as an illustration, not a screenshot.

## Hosting boundary

Only the contents of `dist/` belong on a static host. Do not deploy the repository, application frontend, backend, desktop package sources, databases, or local configuration with this site. Assets use relative paths so the site also works below a host subdirectory. There are no server routes or environment variables.

No hosting or release publication is configured or performed by this directory. The page accurately states that desktop packaging is in development and no public installer is available. Its release link opens the project's GitHub Releases page and is not an installer link.

When a desktop release is published, verify the actual supported platforms and published release assets before replacing the availability notice with download links. Keep platform names, filenames, version information, and release claims tied to those real artifacts. Never add a placeholder installer URL.

## Content

Edit `index.html` for product copy and `assets/styles.css` for layout and design. Keep the optional PIN description explicit: it is an app lock, not database encryption. Product documentation, source code, releases, and issue links point to the public `matheustecchio/gentum-finance` repository.
