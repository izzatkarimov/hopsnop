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

In the production image (`frontend/Dockerfile`, run by
[`deploy/`](../deploy/README.md)) `NEXT_PUBLIC_API_URL` is a build argument,
`https://api.` and the site's domain, and fixed for that image along with the
CSP's API origin. `.env*` files never enter the image, and Next.js's telemetry
is off (`NEXT_TELEMETRY_DISABLED`).

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build`, `npm start` | Production build, and serving it. The build is `standalone` (`.next/standalone/server.js` with only the traced `node_modules`), which `frontend/Dockerfile` runs; `npm start` still works but warns about it |
| `npm run lint` | ESLint |
| `npx next typegen && npx tsc --noEmit` | Type check, including the [API contract](#api-types) |
| `npm test`, `npm run test:watch` | Unit and component tests (Vitest) |
| `npm run api:types` | Regenerate `lib/api-schema.d.ts` from `../backend/openapi.json` |

## Layout

| Path | What is there |
| --- | --- |
| `app/(auth)/` | Register, log in and forgot password, for signed-out visitors only; verify email and reset password, which a link can open for anyone |
| `app/(main)/` | Home (stories and the feed), search (by exact username), own profile, settings. Only for signed-in users |
| `app/(public)/` | A single post with its replies, and a user's public profile. For everyone |
| `components/` | The UI, by area; each component's tests sit next to it |
| `lib/` | API calls and their types, validation, formatting, security headers |
| `proxy.ts` | Gives every page its Content-Security-Policy |
| `test/` | The test harness: a fetch mock, fixtures and render helpers |

Every page is rendered on the server for the request it answers and then
runs in the browser. All data is fetched from the browser, straight from the
API, with the session cookie (`lib/api.ts`).

## Design system

A dark theme made of tokens in `app/globals.css` and a few components in
`components/ui/`. Tailwind CSS generates the classes; there is no UI library.

**Tokens.** The palette is a set of CSS variables on `:root`, mapped into
Tailwind's theme, so a light theme would only have to redefine those variables.

| Kind | Classes |
| --- | --- |
| Surfaces | `bg-bg` (the page, `#0f0e0e`), `bg-tile`, `bg-well`, and the utilities `surface-shell`, `surface-tile`, `surface-well`, `surface-raised`, `surface-glass`, `surface-popover` (menus), `surface-primary`, `surface-danger`, which add each surface's border, highlight and shadow |
| Text | `text-primary`, `text-secondary`, `text-muted` |
| Colours | `ink` (links, focus, blue text), `accent` (primary buttons only, never text), `like`, `success`, `warning`, `mention`, `danger`, `danger-solid` (destructive buttons), `edge` (borders and hairlines, used at 4 to 12%), `highlight` |
| Type | `text-meta` 12/16, `text-body` 16/24, `text-control` 16/20, `text-lead` 20/28, `text-title` 24/32, `text-display` 28/36, in Bricolage Grotesque; `font-mono` (JetBrains Mono) only for recovery codes and the two-factor key. Both are loaded with `next/font` |
| Radii | `rounded-chip` 8, `rounded-item` 12, `rounded-field` 16, `rounded-popover` 20, `rounded-tile` 24, `rounded-shell` 32; buttons and pills `rounded-full` |
| Shadows | `shadow-shell`, `shadow-raised`, `shadow-primary`, `shadow-danger`, `shadow-popover`, `shadow-story` (the story viewer's card), `shadow-story-preview`, `inset-shadow-well` |
| Story ring | `--story-ring`, the gradient around an author with an unseen story; its colours are used nowhere else |
| Widths | Tailwind's breakpoints, plus `wide` (1100px); `max-w-main` (640px) for the page column |

- Spacing follows a 4px grid. Borders are inset rings, so a 1px border never
  changes an element's size, and tiles sit 8px inside a shell, so their
  corners stay concentric.
- Every control shows `focus-ring` when focused from the keyboard: an `ink`
  border and a 4px `accent` ring. Anything else focusable gets an `ink` outline.
- The dotted page background (`dot-grid`), the glow behind the sign-in card
  (`glow`) and the light along the stories tile (`glow-top`) are CSS
  gradients: no image is loaded.
- What is behind a dialog is blurred by 6px under a 64% scrim, and behind the
  story viewer by 16px under an 86% one (`viewer-backdrop`); glass surfaces
  blur by 8px.
- Transitions run only with `motion-safe:`, so they stop for anyone who asks
  for reduced motion.
- The older colour names (`background`, `foreground`, `border`, `hover`,
  `accent-hover`, `accent-foreground`) still map onto the palette, for screens
  that don't use these components yet.

**Components** (`components/ui/`):

| Component | What it does |
| --- | --- |
| `Button`, `ButtonLink` | Primary, secondary, ghost or danger; 36 or 48px tall; an optional leading icon. A button is `type="button"` unless told otherwise |
| `IconButton` | A button with only an icon; its `label` is required and is its accessible name. `overlay` is for controls on a picture |
| `Field`, `TextAreaField` | Label, hint, error, prefix and a trailing slot. An error replaces the hint, sets `aria-invalid` and is linked with `aria-describedby`. `appearance="code"` is for one-time codes |
| `Checkbox` | A native checkbox with a label, a hint and an error |
| `Card` | A `shell` holding `tile`s |
| `SegmentedControl` | Tabs, with the WAI-ARIA keyboard behaviour |
| `Avatar` | A picture from the API or the initials; optionally a story ring |
| `Dialog` | A modal `<dialog>`, named by its title. Tab stays inside it, Escape or Cancel closes it, the page behind it doesn't scroll, and focus goes back to what opened it. `headerStart` takes Cancel's place, e.g. for a back button; `variant="fullscreen"` shows only its content, over the darker backdrop, for the story viewer |
| `Menu`, `MenuItem` | A menu under a button, with the WAI-ARIA keyboard behaviour: arrows, Home and End move, Escape goes back to the button, Tab or a click elsewhere closes it |
| `Notice` | An error (`role="alert"`) or information (`role="status"`), with an optional title |
| `IconBadge`, `TextLink`, `Wordmark` | The round icon above a sign-in card's heading, a link in running text, the logo |
| `icons.tsx` | Outline icons on a 24-unit grid, drawn 2px wide from 20px and 1.5px below, with filled versions for the current page and other "on" states. Only icons in use are included |

**The app shell** (`components/layout/`). From 1024px: a 240px sidebar with
the navigation, New post, the signed-in user and Log out; the page in a 640px
column; and from 1100px a 240px panel on the right, which shrinks the column
rather than overflow. Between 640 and 1024px the sidebar is a 72px rail of
icons. Below 640px there is a top bar with Settings and a floating bar at the
bottom with Home, Search, New post and Profile.

**Posting** (`components/posts/`). New post, in the sidebar, the phone bar or
Home's "What's new" tile, opens a dialog on whatever page is showing. Its ring
fills towards the 300-character limit the backend counts (Unicode code points,
after trimming), turns `warning` within 20 characters, where the count also
shows, and `danger` over it. Closing it with unsent text asks first, inside the
dialog. A published post goes to the top of Home's For you, and from another
page the dialog goes Home. The reply box on a post's page follows the same
rules. Copy link, Copy text and Share use only the post's plain address; Share
uses the system share sheet when the browser has one and copies the link
otherwise, and every outcome, including a refused clipboard, is said in a line
under the post.

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

## Two-factor login

The API's [two-factor login](../backend/README.md#two-factor-login), with an
authenticator app.

**Logging in.** When `POST /auth/login` answers `202` with a challenge, the
login form asks for a code on the same page, at the same address
(`components/auth/two-factor-login-step.tsx`). One field takes the 6-digit
code or a recovery code, so it has no `inputMode`: a numeric keypad couldn't
type a recovery code. A wrong code keeps the step; an expired or voided
challenge goes back to the password, which has to be typed again. A code of the
wrong shape isn't sent, as it would only count as a wrong one.

**Settings** (`components/settings/two-factor-section.tsx`) show whether it is
on and how many recovery codes are left, with a warning at 3 or fewer. Turning
it on asks for the password, then shows a QR code of the `otpauth://` URI and
the same key as text, then asks for a code. Replacing the codes takes the
password and a code from the app; turning it off takes the password, a code or
a recovery code, and a confirmation. Each ends the other sessions, so the
sessions list is loaded again.

**Recovery codes** are shown once, with Copy and a `.txt` download made in the
browser, and can be closed only once the user says they are saved.

**Secrets.**

- The login challenge is kept only in the login form's state and sent only to
  the API: never in the address, storage, a cookie, the page or a log.
- The password typed to turn it on is kept in the setup's state until the code
  is confirmed, because `POST /auth/two-factor/confirm` needs it again. It is
  never shown back, and goes when the setup ends: confirmed, cancelled, expired
  or left.
- The secret, the URI and the recovery codes live in the state of the step
  that shows them and go when it closes. They are marked `translate="no"`, as a
  browser's page translation would send them to a third party.
- A page can only drop a string; JavaScript can't wipe it from memory. Whatever
  the user copies stays on the clipboard.

**The QR code** (`components/ui/qr-code.tsx`) is drawn in the browser with
[`qr`](https://github.com/paulmillr/qr), which has no dependencies. Its module
grid becomes one SVG `<path>`: no markup string, image address or inline
style, so the CSP needed no change.

## Stories

The row at the top of Home (`components/stories/`) shows the signed-in
user's active stories and those of the people they follow, which
`GET /stories` returns as one flat list, newest first. The list is loaded
once, every page of it up to 250 stories, and grouped by author in the
browser: one's own first as "Your story", then the others by their newest
story. A 2px gradient ring (`--story-ring`) marks an author with a story not
viewed yet, and a muted one an author whose stories are all viewed; the
button's name says the same. One's own entry has no ring, only the + badge for
adding a story. The row loads on its own, and if it fails it
offers to try again without touching the feed.

The viewer is a full-screen `Dialog`. On phones the story fills the screen;
from 640px it is a 9:16 card, at most 432×768 and smaller on short screens,
with round Previous and Next buttons beside it; from 1100px the authors before
and after it are shown at half size, dimmed, at the story each would open on. A
picture is always shown whole, on black. The viewer plays an author's stories
oldest first, from the first one not viewed yet (one's own always from the
oldest), and moves on 5 seconds after a picture has loaded: to the author's
next story, then to the next author, and it closes after the last.

- **Controls.** ← and → or the outer thirds of the picture move back and
  forward, Space or Pause (a toggle, `aria-pressed`) holds the story until
  pressed again, and Escape closes. It also pauses while the picture is
  pressed, while a control has focus from the keyboard, while the menu is open
  and while a deletion is being confirmed. With reduced motion it never moves
  on by itself, so Pause is left out.
- **The authors either side** are for pointers only: a click opens them, but
  they are hidden from screen readers and never take focus, since Previous and
  Next reach them too. Loading their pictures records no view.
- **One's own stories** have a ⋯ menu with Delete story, which asks first.

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
- **Adding a story** takes two steps in one dialog. The first takes a photo,
  chosen or dropped on it, and checks its type (JPEG, PNG or WebP) and size
  (10 MB) before anything is sent; Next waits for one. The second shows it as
  it will look, with a caption of up to 150 characters, counted as the backend
  counts them, and Replace photo. Both steps say that stories disappear after
  24 hours and that location and camera details are removed, which the backend
  does for every story. Escape or Cancel closes it without asking, except while
  it is being shared.

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

**No image optimizer.** Nothing uses `next/image`, yet `next start` would
still fetch and decode any same-origin path at `/_next/image?url=…`, the
endpoint of [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw).
`images.unoptimized` in `next.config.ts` makes it answer `404` to every
request before it fetches anything. `outputFileTracingExcludes` keeps sharp
and its libvips out of `.next/standalone`, so the container has neither; the
server only loads sharp to optimize an image, which it never does.

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

## Dependency audit

`npm audit` reports one advisory, left open on purpose:
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), a
denial of service through crafted glob patterns in `minimatch` 10. It comes
in only with ESLint, a development dependency (`eslint-config-next` →
`typescript-eslint` → `@typescript-eslint/typescript-estree`), and npm counts
it once for each package on that path.

It can't be reached here: `typescript-estree` matches globs only for
`parserOptions.projectService.allowDefaultProject`, which our ESLint config
doesn't set, and only against patterns from that config. The fix is in
`minimatch` 11, which no `typescript-eslint` release accepts yet (November
2026); the finding goes away with the first one that does. `npm audit fix
--force` doesn't fix it: it would downgrade `eslint-config-next` to 15.

`vite` is listed only so that the `"$vite"` override holds vitest's copy at
`^7.3.7`, the first release without
[GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) and four others.
