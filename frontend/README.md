# Hopsnop Frontend

The web frontend of Hopsnop: Next.js (App Router) with React, TypeScript and
Tailwind CSS. It renders pages and calls the [API](../backend/README.md)
from the browser; it has no data of its own and no server-side logic beyond
setting security headers.

## Setup

```bash
cp .env.example .env.local    # once
npm install
npm run dev                   # http://localhost:3000
```

The API has to be running as well; see the [root README](../README.md).

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL of the API, e.g. `http://localhost:8000`. Built into the pages, so it is public: never put a secret in a `NEXT_PUBLIC_` variable |

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build`, `npm start` | Production build, and serving it |
| `npm run lint` | ESLint |
| `npx next typegen && npx tsc --noEmit` | Type check, including the [API contract](#api-types) |
| `npm test`, `npm run test:watch` | Unit and component tests (Vitest) |
| `npm run api:types` | Regenerate `lib/api-schema.d.ts` from `../backend/openapi.json` |

## Layout

| Path | What is there |
| --- | --- |
| `app/(auth)/` | Register, log in and forgot password, for signed-out visitors only; verify email and reset password, which a link can open for anyone |
| `app/(main)/` | Home (stories and the feed), explore, own profile, settings. Only for signed-in users |
| `app/(public)/` | A single post with its replies, and a user's public profile. For everyone |
| `components/` | The UI, by area; each component's tests sit next to it |
| `lib/` | API calls and their types, validation, formatting, security headers |
| `proxy.ts` | Gives every page its Content-Security-Policy |
| `test/` | The test harness: a fetch mock, fixtures and render helpers |

Every page is rendered on the server for the request it answers and then
runs in the browser. All data is fetched from the browser, straight from the
API, with the session cookie (`lib/api.ts`).

## Sessions

The API keeps the session in an `HttpOnly` cookie, so no script on these
pages can read or steal the token, and nothing is kept in `localStorage`.
`components/auth/auth-provider.tsx` asks the API who is signed in
(`GET /auth/me`) and shares the answer with the pages.

`RequireAuth` and `GuestOnly` only decide which page to show. They run in
the browser and can be bypassed, which is fine: the API refuses every request
that lacks a valid session, whatever the frontend shows. The frontend is not
a security boundary.

Every request is sent with `credentials: "include"` and, for a body, only a
`Content-Type` header, which is all the API's CORS policy allows. There is no
CSRF token: the API checks the `Origin` of every request that changes
something, and the cookie is `SameSite=Lax` ([Cookie and
CSRF](../backend/README.md#cookie-and-csrf)). That requires the frontend and
the API to be on the same site, for example `hopsnop.com` and
`api.hopsnop.com`.

## Stories

The row at the top of Home (`components/stories/`) shows the signed-in
user's active stories and those of the people they follow, which
`GET /stories` returns as one flat list, newest first. The list is loaded
once, every page of it up to 250 stories, and grouped by author in the
browser: one's own first as "Your story", then the others by their newest
story. A thick ring in the accent colour marks an author with a story not
viewed yet, and a thin muted one an author whose stories are all viewed; the
button's name says the same. The row loads on its own, and if it fails it
offers to try again without touching the feed.

The viewer is a modal `<dialog>`. It plays an author's stories oldest first,
from the first one not viewed yet (one's own always from the oldest), and
moves on 5 seconds after a picture has loaded: to the author's next story,
then to the next author, and it closes after the last. It pauses while the
picture is pressed, while a control has focus from the keyboard, and while a
deletion is being confirmed, and with reduced motion it does not move on by
itself at all.

- **Views.** A view is posted once, when the picture of someone else's story
  that is not viewed yet has loaded, and never for one's own. The ring changes
  when the API has recorded it. Only the author sees "Seen by", because the API
  tells the count to nobody else.
- **Stories that are gone.** A story that answers `404` to its view, to its
  deletion, or to `GET /stories/{id}` after its picture failed to load, is taken
  out of the row and skipped without a message. A story is also taken out at
  its `expires_at`, by this device's clock, also while it is being viewed.
- **Pictures** are loaded through `apiAssetUrl()` in a plain `<img>`, which
  sends the session cookie, with `width` and `height` set so that the space is
  reserved before they arrive. A picture chosen for a new story is shown from a
  `blob:` address, which is revoked once it is replaced, published or the
  dialog is closed.

## Security headers

The API sends its own headers. These are for the pages, where scripts run
(`lib/security-headers.ts`, `proxy.ts`, `next.config.ts`).

**Content-Security-Policy**, a new one for every page:

| Directive | Value | Why |
| --- | --- | --- |
| `script-src` | `'self' 'nonce-…' 'strict-dynamic'` | Only scripts that carry the page's nonce run. Next.js puts it on its own scripts; an injected `<script>`, an inline event handler or a `javascript:` URL has none |
| `style-src` | `'self' 'nonce-…'` | The same for inline styles |
| `connect-src` | `'self'` and the API's origin | The pages talk to nothing else |
| `img-src` | `'self' data: blob:` and the API's origin | Pictures are uploaded to the API and served by it, never loaded from another host. `blob:` is the preview of a picture chosen for upload |
| `font-src` | `'self'` | `next/font` downloads the fonts when the site is built and serves them from this origin, so browsers never contact Google |
| `frame-ancestors` | `'none'` | No other site can show these pages in a frame (clickjacking) |
| `object-src`, `base-uri` | `'none'` | No plugins, no rewritten base URL |
| `form-action` | `'self'` | Forms post nowhere else |
| `upgrade-insecure-requests` | when the API is on HTTPS | An `http:` address is upgraded, not sent in the clear |

A nonce only works on a page rendered for the request, so the root layout
waits for one (`connection()` in `app/layout.tsx`) and no page is built
ahead of time. `next dev` needs `'unsafe-eval'` for scripts and
`'unsafe-inline'` for styles; those are added in development only.

**On every response:** `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer` (reset and verification links carry their
token in the address), `X-Frame-Options: DENY`,
`Cross-Origin-Opener-Policy: same-origin`, and a `Permissions-Policy` that
refuses the camera, microphone, location, payment and USB. No
`X-Powered-By` header is sent.

`Strict-Transport-Security` belongs to whatever terminates TLS in
production, as for the API.

## API types

The response and request types in `lib/` are written by hand, with what each
field means. `lib/api-contract.ts` makes the compiler check them against
`lib/api-schema.d.ts`, which is generated from the backend's OpenAPI schema:
every response type must be exactly the backend's, and every request type
something the backend accepts. A field the backend adds, removes or renames
fails the type check, and CI fails if the generated file is out of date. How
to regenerate it is in the [root README](../README.md#api-types).

## Tests

```bash
npm test
```

Vitest with React Testing Library in jsdom. The tests never reach a backend:
`test/api.ts` replaces `fetch`, every test states the replies it expects, and
a request without one fails the test. They show that each component behaves
correctly for every answer the API can give, including errors, rate limits
and repeated clicks. They do not show that the frontend and the API work
together; that is for end-to-end tests against a running backend.
