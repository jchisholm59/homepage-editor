# Homepage Editor

A web UI for editing a [Homepage](https://gethomepage.dev) dashboard's config files in place, for people who'd rather not
hand-edit YAML. It runs next to Homepage (granite, `http://192.168.2.210:7200`) and edits the same `config` folder.

## What it does
- **Make it better:** a checkup of the whole dashboard with one-click fixes covering:
  - broken icons
  - services that Homepage has a live widget for
  - up/down status checks
  - a tidy layout and theme preset
  - top-bar widgets
  - dead links, duplicates and plain-text API keys
- **Services / Bookmarks:** cards grouped as on the dashboard, with drag-and-drop between groups. Each entry has an editor with:
  - an icon picker that searches Dashboard Icons, selfh.st, Material Design and Simple Icons, and can upload an image or
    download one from a URL
  - a **widget helper** that builds a form for any of the 155 service widgets from Homepage's own docs, with the docs
    beside it
  - a YAML tab for any other option
- **Info widgets, Settings explorer** (every documented option, with "Use this" on each example), and **Files** (plain text).
- **Safe saves:**
  - Your comments, ordering and commented-out blocks are kept, and each save shows a diff first.
  - Invalid YAML is refused, and so is a save when the file changed underneath you.
  - A backup is taken before every save (in `/root/homepage/editor-backups`, restorable from the Backups tab).

## Run (granite)
```
docker compose up -d --build
```
`compose.yaml` mounts `/root/homepage/config` (Homepage's config) and `/root/homepage/editor-backups`.
For a password, put `EDITOR_PASSWORD=...` in a `.env` file next to `compose.yaml` and re-run the command above. Any user
name works.

**Custom icons:** Homepage only serves your own icons when `config/icons` is also mounted at `/app/public/icons` in
*Homepage's* compose file (`/root/homepage/docker-compose.yml`):
```
    volumes:
      - /root/homepage/config/icons:/app/public/icons
```
Then reference them as `/icons/<file>`. The editor detects whether this is in place.

## Development
```
npm install
CONFIG_DIR=/path/to/a/copy/of/config BACKUP_DIR=/tmp/backups PORT=7299 node server.js
```
Point it at a copy of the config, never the live one. Checks:
- `node scripts/roundtrip-test.mjs <config-copy>`: loading and re-saving must not change content.
- `node scripts/edit-test.mjs <config-copy>`: typical edits must give minimal diffs.

**Widget catalog** (`catalog/catalog.json`) is generated from the Homepage docs for the version in use. Rebuild it when
Homepage is upgraded:
```
git clone --depth 1 --branch vX.Y.Z https://github.com/gethomepage/homepage.git /tmp/homepage-src
node scripts/build-catalog.mjs /tmp/homepage-src vX.Y.Z
```
