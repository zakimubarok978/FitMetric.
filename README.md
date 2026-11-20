# FitMetric local app

FitMetric uses an Express.js server and the existing SQLite database for accounts, trainer-member relationships, invitations, notes, measurements, workout progress, goals, schedules, notifications, and website content.

## Run locally

1. Install Node.js 20 or later.
2. From this project folder, run `npm install`.
3. Run `npm start` and open `http://127.0.0.1:8000`.

The server uses the existing `fitmetric.sqlite3` file beside `server.js`. It creates missing tables only; it does not delete, reset, or replace existing records. Register trainer and member accounts from **Register**.

## Admin Panel

1. If the existing database has no administrator, create the first administrator with `npm run setup-admin`. Enter the full name, email, and a password of at least 12 characters. Password input is hidden. The setup command uses the existing database and rejects email addresses already used by a member, trainer, or administrator. Public registration cannot create administrator accounts.
2. Open `http://127.0.0.1:8000/admin.html` and sign in with that administrator email and password. This page contains both the Admin login and dashboard; it is named `admin.html` in this project. Admin sessions use an HttpOnly, SameSite=Strict cookie, with `Secure` enabled when a trusted HTTPS proxy sends `X-Forwarded-Proto: https`.
3. Use the sidebar to edit the home page, navigation and footer labels, features, training programs, trainer profiles, about page, images, and theme. Changes use the existing website-content tables; no new account/content database is created. **Simpan Perubahan** saves and publishes the current changes immediately; open public pages refresh published content automatically within 10 seconds. **Preview Website** saves a private draft for an admin-only preview; **Publikasikan** publishes a saved preview draft; **Batalkan Perubahan** discards the saved draft.
4. Image uploads are stored in the `uploads` folder beside the database and are limited to JPG, PNG, and WebP files up to 3 MB. Admin changes and publishing actions are recorded in the activity log.

The frontend and API are served from the same origin. Do not open the HTML files directly with `file://` or use VS Code Live Server: those URLs do not provide the FitMetric API and can cause errors such as **Failed to fetch** or a non-JSON response. Start `npm start` and open the URL it prints; the Admin UI reports a connection/origin hint when it cannot reach the API.

The server binds to loopback by default. It is intended for local development and must not be exposed to the public internet as-is. Public deployment requires HTTPS, production session/cookie settings, backups, and hosting-specific security configuration. Set `FITMETRIC_DB` to choose another database file, `FITMETRIC_HOST` to change the bind address, or `FITMETRIC_PORT` to change the local port.

## Tests

Run the backend workflow, authentication, session, authorization, and existing-password compatibility tests with `npm test`.

Trainer and member pages poll the authenticated API every 10 seconds for updates. Server-side role and relationship checks are authoritative; browser state is an in-memory display cache.
