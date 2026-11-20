# FitMetric local app

FitMetric uses an Express.js server and the existing SQLite database for accounts, trainer-member relationships, invitations, notes, measurements, workout progress, goals, schedules, notifications, and website content.

## Run locally

1. Install Node.js 22 LTS.
2. From this project folder, run `npm install`.
3. Run `npm start` and open `http://127.0.0.1:8000`.

The server uses the existing `fitmetric.sqlite3` file beside `server.js`. It creates missing tables only; it does not delete, reset, or replace existing records. Register trainer and member accounts from **Register**.

## Admin Panel

1. If the existing database has no administrator, create the first administrator with `npm run setup-admin`. Enter the full name, email, and a password of at least 12 characters. Password input is hidden. The setup command uses the existing database and rejects email addresses already used by a member, trainer, or administrator. Public registration cannot create administrator accounts.
2. Open `http://127.0.0.1:8000/admin.html` and sign in with that administrator email and password. This page contains both the Admin login and dashboard; it is named `admin.html` in this project. Admin sessions use an HttpOnly, SameSite=Strict cookie, with `Secure` enabled when a trusted HTTPS proxy sends `X-Forwarded-Proto: https`.
3. Use the sidebar to edit the home page, navigation and footer labels, features, training programs, trainer profiles, about page, images, and theme. Changes use the existing website-content tables; no new account/content database is created. **Simpan Perubahan** saves and publishes the current changes immediately; open public pages refresh published content automatically within 10 seconds. **Preview Website** saves a private draft for an admin-only preview; **Publikasikan** publishes a saved preview draft; **Batalkan Perubahan** discards the saved draft.
4. Image uploads are stored in the `uploads` folder beside the database and are limited to JPG, PNG, and WebP files up to 3 MB. Admin changes and publishing actions are recorded in the activity log.

The frontend and API are served from the same origin. Do not open the HTML files directly with `file://` or use VS Code Live Server: those URLs do not provide the FitMetric API and can cause errors such as **Failed to fetch** or a non-JSON response. Start `npm start` and open the URL it prints; the Admin UI reports a connection/origin hint when it cannot reach the API.

The server binds to loopback by default. It is intended for local development and must not be exposed to the public internet as-is. Public deployment requires HTTPS, persistent storage, backups, and hosting-specific security configuration. Set `FITMETRIC_DB` to choose another database file, `FITMETRIC_UPLOADS` to choose the image folder, `FITMETRIC_HOST` to change the bind address, or `PORT` (preferred) / `FITMETRIC_PORT` to change the local port.

## Deploy to Railway

1. Create a Railway project from this repository and add a persistent Volume to the web service. Set its mount path to `/data`. Use the Node.js 22 runtime; `npm start` starts the Express server. Railway supplies `PORT`; the server binds to `0.0.0.0` in Railway environments.
2. Set these service variables:

   | Variable | Value |
   | --- | --- |
   | `FITMETRIC_DB` | `/data/fitmetric.sqlite3` |
   | `FITMETRIC_UPLOADS` | `/data/uploads` |

   Do not set `PORT` manually unless required by your service configuration. The app uses Railway's value automatically. `FITMETRIC_HOST=0.0.0.0` can be set explicitly if the environment does not provide Railway's standard environment marker.
3. Before starting the service against this volume, place the **existing** `fitmetric.sqlite3` database and all existing upload files in the mounted volume (`/data/fitmetric.sqlite3` and `/data/uploads/`). Keep the original database filename and image filenames so existing accounts, CMS references, Library Gambar entries, and published images continue working. Use a consistent SQLite backup (for example, stop writes and use better-sqlite3's `.backup()` API); do not copy a live database file by itself while WAL writes may be in progress. Transfer and verify these files using a secure method. Never point `FITMETRIC_DB` at a new empty volume: when this variable is explicitly set, startup fails if the database file is missing.
4. Configure Railway's public domain and HTTPS. Member and admin session cookies are `HttpOnly`, `SameSite`, and marked `Secure` when Railway's trusted proxy reports `X-Forwarded-Proto: https`. Do not expose the app without HTTPS. Do not put database contents, passwords, session secrets, or credentials in source control or public logs.
5. To create the first administrator, open an interactive shell for the running app service (for example, with Railway's service shell/SSH), confirm it has the same `FITMETRIC_DB` setting and mounted volume, then run `npm run setup-admin`. Enter the password only at the hidden prompt. This command uses the existing database, requires an interactive terminal, and refuses to create another admin once one exists. Public registration only creates member or trainer accounts.
6. Confirm the deployment at `/api/health`, then sign in at `/admin.html`. Back up the persistent volume regularly. Do not remove or replace the volume during redeploys.

`FITMETRIC_UPLOADS` defaults to an `uploads` directory beside the selected database, which preserves the local layout. The app serves images from the configured persistent folder and also falls back to the app's legacy `uploads` folder for reads if an old file is still there; new uploads and deletes use the configured persistent folder.

## Tests

Run the backend workflow, authentication, session, authorization, and existing-password compatibility tests with `npm test`.

Trainer and member pages poll the authenticated API every 10 seconds for updates. Server-side role and relationship checks are authoritative; browser state is an in-memory display cache.
