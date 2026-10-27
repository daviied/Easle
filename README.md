# Easel

A fast, personal Canvas LMS client. It runs in Docker, talks to your school's Canvas with your own access token, and serves an installable web app (PWA) for your PC and phone.

Everything goes through the real Canvas API, so it stays in sync both ways. Submissions, quiz answers, messages, comments, discussion posts, to-do checkmarks and module progress show up in Canvas, and changes in Canvas show up here.

## What it does

- **Home**: missing work, everything due in the next 6 weeks grouped by day (tap the circle to mark items done, like the Canvas planner), course cards with current grades, recent announcements.
- **Assignments**: details, rubric, your submission and grade, comments. **Submit** files (multiple, with upload progress and drag-and-drop), text, or a URL; resubmit; add comments.
- **Peer reviews**: assignments where you review classmates list your reviews, with a link to their work and a box for feedback. Rubric scoring is done on Canvas.
- **Quizzes**: Classic Quizzes are taken right in the app (see below). New Quizzes, and quizzes with settings the app can't enforce, open on Canvas.
- **Inbox**: read, reply to, archive and mark unread your Canvas messages. Write new ones with recipient search (people, or whole roles such as a course's Teachers), a course or group, attachments, and an option to send an individual copy to each recipient. Unread count in the nav.
- **People & groups**: course and group rosters by role, each with a Message button. Your groups appear in the sidebar with their own announcements, discussions, pages, files and people.
- **Grades and what-if scores**: overall and per course, grouped by assignment group with weights. On a course's Grades tab you can type a hypothetical score next to any assignment, and Easel recalculates the course grade the way Canvas does. That means graded work only, group weights, drop lowest/highest rules (dropped items are shown), excused and "not counted" items skipped, and the course's own letter scale. What-if scores stay on that device and are never sent to Canvas. If Easel's calculation doesn't match the grade Canvas shows, it tells you, since teachers can use settings students can't see.
- **GPA tracker**: term GPA, a GPA per past term, and cumulative GPA. It uses your current grades and the final grades of finished courses.
  - You enter credit hours for each course; a course with no credits isn't counted.
  - You can override any letter, to match your transcript or to try a what-if.
  - Mark a course pass/fail or turn it off entirely.
  - Add credits from before Canvas or transferred ones.
  - Pick a 4.0, 4.3 or no-plus/minus scale, or set a custom one.
  - Add an honors/AP bonus to get a weighted GPA.
  - These settings are saved to your Canvas account's private app storage ("custom data"), so they sync across your devices. Only you can see them.
- **Announcements and discussions** (courses and groups): read, see what's unread, reply and reply in threads, attach files, like posts, and edit or delete your own replies. Start new discussions where the course or group allows it. Opening a topic marks it read in Canvas.
- **Modules, pages, files, syllabus**: browse everything. Opening a "must view" item marks it viewed in Canvas.
- Anything this app can't do itself (media recordings, annotation submissions, external tools) gets an **Open in Canvas ↗** link.

### Quizzes in the app

Classic Quizzes run in Easel through Canvas's quiz-submission API:
- **Every question type**: multiple choice, true/false, multiple answers, short answer, numeric/formula, fill in multiple blanks (inline), dropdowns, matching, essay, file upload, plus text-only sections.
- **While you work**: answers save as you go, you can flag questions, and the timer counts down and submits automatically when time runs out.
- **Resuming**: you can leave and pick the attempt back up on the same device. Canvas's time limit keeps running while you're away.
- **Attempts**: they're counted, and past scores are shown.

A quiz stays on Canvas, with a **Take quiz on Canvas** button, when it uses **LockDown Browser, an access code, IP restrictions, one question at a time, or locked questions**. The server checks this too, so these rules can't be bypassed by calling it directly. New Quizzes have no API for students, so they always open on Canvas.

Two things to know:
- **Starting on another device:** an attempt started on Canvas or another device can't be resumed in Easel. Finish it where you started it.
- **The quiz log:** your teacher's quiz log only records what Canvas's API records, meaning answers, flags and submit. Page views and focus changes that the Canvas quiz page normally logs won't appear.

### Why it's faster

- Every screen draws instantly from a local cache (IndexedDB), then refreshes in the background and redraws only if something changed.
- Hovering or touching a link starts loading the next screen before you tap it.
- The server follows Canvas pagination for you (100 per page), merges duplicate requests, and briefly caches responses (`CACHE_TTL`).
- A service worker caches the app shell, so it opens instantly and still shows your last-seen data when offline.
- No framework, no build step: about 120 KB of plain JavaScript in total.

## Quick install (no clone needed)

This uses the image GitHub Actions publishes (see "Using the image GitHub builds" below), so push to `main` once first.

1. On the server, make a folder and put two files from this repo's `deploy/` folder in it: `docker-compose.yml`, and `.env.example` renamed to `.env`.
2. Fill in `.env`: `EASEL_IMAGE`, `CANVAS_BASE_URL`, `CANVAS_TOKEN`, `APP_PASSWORD`, and ideally `TOTP_SECRET`.
3. Log in to the registry once, with a GitHub token that has only the `read:packages` scope:
   ```bash
   docker login ghcr.io -u <your-username>
   ```
4. Start it:
   ```bash
   docker compose up -d
   ```
5. Point your reverse proxy at `http://127.0.0.1:8080`.

To update, run `docker compose pull && docker compose up -d`. If a required value is missing from `.env`, compose stops and names it.

The port is bound to `127.0.0.1`, so only a proxy on the same machine can reach it. If the proxy runs elsewhere, edit the `ports:` line as the comment in the file explains.

### CasaOS

1. In CasaOS, open **App Store → Custom Install** and click the import icon (top right). Paste the contents of `deploy/casaos.yml`.
2. Replace `your-github-username` in the image name, and fill in the environment values. Each one is described in the form.
3. Pulling a private image needs a one-time `docker login ghcr.io` on the CasaOS host, run over SSH or in its terminal. The other option is to make the package public on GitHub (Packages → easel → Package settings). The image contains no secrets, because those all come from the environment variables.
4. Install, then point your reverse proxy at port 8102 on the CasaOS host (the file publishes the container's 8080 there). Set `FORWARDED_ALLOW_IPS` to your proxy's IP.

To turn on two-factor login after the first start, run `docker exec easel python -m app.totp`. Paste the printed secret into `TOTP_SECRET` in the app's settings, then save.

## Setup (build from source)

1. Get a Canvas token: **Account → Settings → Approved Integrations → + New Access Token**.
2. Create your config file (git-ignored, so it never reaches GitHub):
   ```bash
   cp .env.example .env
   ```
   Fill in `CANVAS_BASE_URL`, `CANVAS_TOKEN` and `APP_PASSWORD`.
3. Start it:
   ```bash
   docker compose up -d --build
   ```
4. Open `http://<server-ip>:8080` and sign in with `APP_PASSWORD`.

The server refuses to start if a required variable is missing, and logs which one.

### Using the image GitHub builds (instead of building on the server)

`.github/workflows/docker-image.yml` builds the image on every push to `main` (and on `v*` tags), for both x86 and ARM, and publishes it to GitHub Container Registry. Pull requests are built but not published. You can watch runs in the repo's **Actions** tab.

1. Push to `main` and wait for the **Docker Image CI** run to finish.
2. In `.env` on the server, set the image name. It must be lowercase:
   ```
   EASEL_IMAGE=ghcr.io/<your-username>/<repo-name>:latest
   ```
3. Because the repo is private, the package is private too, so log the server in once. Use a GitHub personal access token (classic) that has only the `read:packages` scope:
   ```bash
   docker login ghcr.io -u <your-username>
   ```
4. Start or update:
   ```bash
   docker compose pull && docker compose up -d
   ```

Each successful run also publishes a `sha-<commit>` tag. To roll back, point `EASEL_IMAGE` at an older one.

### Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `CANVAS_BASE_URL` | yes | e.g. `https://yourschool.instructure.com` |
| `CANVAS_TOKEN` | yes | Canvas access token. It stays on the server; the browser never sees it. |
| `APP_PASSWORD` | yes | Password for the Easel login page. Use 12+ characters (the server warns if shorter). |
| `TOTP_SECRET` | recommended | Turns on 6-digit authenticator-app codes at login. See "Public deployment" below. |
| `SESSION_SECRET` | no | Signs login cookies. By default it's derived from the password and token, so changing either signs every device out. |
| `SESSION_DAYS` | no | How long a sign-in lasts (default 30) |
| `CACHE_TTL` | no | Seconds the server reuses a Canvas response (default 30). The ⟳ button always bypasses it. |
| `COOKIE_SECURE` | no | `auto` (default): Secure cookie when the request arrived over HTTPS. |
| `FORWARDED_ALLOW_IPS` | no | IP of your reverse proxy, so its `X-Forwarded-*` headers are trusted (uvicorn setting) |
| `EASEL_PORT` | no | Host port in `docker-compose.yml` (default 8080) |
| `EASEL_IMAGE` | no | Image for `docker compose` to run, e.g. `ghcr.io/<user>/<repo>:latest`. Unset: builds locally. |

You can skip the `.env` file and set these variables any other way Docker supports (Portainer, `docker run -e`, secrets, and so on).

## Installing on your phone (needs HTTPS)

Browsers only offer **Install app / Add to Home Screen** for HTTPS sites (`localhost` is the one exception). On plain `http://192.168.x.x:8080` everything works, but it won't install. Any one of these gets you HTTPS:

- **Tailscale** (easiest, private): install Tailscale on the server and your phone, then run `tailscale serve --bg 8080` on the server. Open the `https://<machine>.<tailnet>.ts.net` URL it prints.
- **Reverse proxy** you already run (Caddy, Nginx Proxy Manager, Traefik) with a certificate. Set `FORWARDED_ALLOW_IPS` to the proxy's IP. Raise the proxy's upload size limit if you submit large files (Nginx: `client_max_body_size 500m;`).
- **Cloudflare Tunnel**: works too; consider adding Cloudflare Access in front.

Then install it:
- **Android (Chrome)**: menu (⋮) → *Install app*.
- **iPhone (Safari)**: Share → *Add to Home Screen*.
- **Desktop (Chrome/Edge)**: the install icon in the address bar.

## Public deployment behind a reverse proxy

Anyone who signs in to Easel can act as you on Canvas, so lock it down:

1. **Use a long `APP_PASSWORD`.**
2. **Turn on two-factor login.** Generate a secret:
   ```bash
   docker compose run --rm easel python -m app.totp
   ```
   Put the printed `TOTP_SECRET=...` line in `.env`, then add the secret to an authenticator app (Google Authenticator, Authy, 1Password, Bitwarden, and so on) by entering it manually or scanning the printed `otpauth://` URI as a QR code. The login page will then ask for a 6-digit code.
3. **Trust only your proxy.** Set `FORWARDED_ALLOW_IPS` to the proxy's IP (or its Docker network range) so Easel sees real client IPs for rate limiting, and sees HTTPS for Secure cookies and HSTS.
4. **Don't expose port 8080 directly.** Only the proxy should reach it. With the proxy in the same compose network, change `ports:` to `expose: ["8080"]`, or bind to localhost with `"127.0.0.1:8080:8080"`.
5. **Raise the proxy's upload limit** for large submissions (Nginx: `client_max_body_size 500m;`).

Example Caddy site (gets HTTPS automatically):
```
easel.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

**Signing out every device:** set or change `SESSION_SECRET` (any long random string) and restart. Changing the password, token or TOTP secret does the same.

## Security notes

- The token lives only in the server's environment. The browser talks to Easel, and Easel adds the token when it calls Canvas. It's never sent to any other host, not even Canvas's own file-storage servers during uploads.
- Every `/api` route needs a signed, HttpOnly session cookie. Write routes also need a custom header, which blocks cross-site requests. Login takes a password plus an optional TOTP code (each code works only once). Failed logins are slowed down and limited: 8 per 15 minutes per IP, and 40 per 15 minutes in total, so attacks spread across many IPs are stopped as well. Responses send HSTS (over HTTPS) and anti-framing headers.
- Canvas HTML (descriptions, pages, discussion posts) goes through an allowlist sanitizer, and a strict Content-Security-Policy blocks scripts from Canvas content. Files are streamed through the server in a sandbox so they can't run as the app.
- Anyone who can sign in to Easel can act as you on Canvas, so pick a strong `APP_PASSWORD`, and prefer Tailscale over exposing it to the internet.

## Development

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt   # Windows: .venv\Scripts\pip
```

To try it without touching your real Canvas, there's a small fake Canvas in `dev/mock_canvas.py`:

```bash
uvicorn dev.mock_canvas:app --port 9001
CANVAS_BASE_URL=http://127.0.0.1:9001 CANVAS_TOKEN=dev APP_PASSWORD=dev uvicorn app.main:app --port 8080 --reload
```

To regenerate the PNG icons after editing the artwork: `python tools/make_icons.py`.

## Layout

```
app/main.py       routes: login, read proxy, files, submissions, discussions, inbox, quizzes, GPA settings
app/canvas.py     Canvas client: pagination, cache, de-dup, 3-step file upload
app/auth.py       password login + signed cookie
app/config.py     environment variables
app/static/       the PWA: app.js (router + core screens), grades.js (what-if, GPA), inbox.js, quiz.js, ui.js, api.js, html.js, styles.css, sw.js
dev/mock_canvas.py  fake Canvas for local testing
```
