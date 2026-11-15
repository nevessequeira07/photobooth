# Our Evening

Wedding photo sharing for Neves & Lavina. Guests enter their name, upload photos, and browse the shared gallery. No guest accounts or database.

## Run locally

Requires Node.js 22 or newer. There are no package dependencies.

1. Keep your Drime token in `.env.local` as `DRIME_API_TOKEN` and the wedding folder ID as `DRIME_FOLDER_ID`.
2. Run `npm run check:drime` to check authentication and discover the Wedding Photos folder.
3. Run `npm run dev`, then open http://127.0.0.1:5173/.
4. Upload one photo, refresh, and verify it remains in the gallery and appears in Drime.

Never share `.env.local`. The browser only calls this site's API; the token stays on the server. The local server explicitly serves only the three public UI files.

## Vercel

Import the source project into Vercel with framework preset Other. Set the Root Directory to the repository root, where `vercel.json`, `package.json`, and `api/` are located. `vercel.json` builds the public files into `dist`, and Vercel serves `/api/upload`, `/api/gallery`, and `/api/photo` from the matching files in `api/`.
Add `DRIME_API_TOKEN` and `DRIME_FOLDER_ID` in Vercel's project Environment Variables before deployment. Use the values from your private local file, not frontend variables or VITE-prefixed variables. Redeploy after changing environment variables.

Test a real upload and gallery refresh on the deployed URL before printing a QR code linking to that URL. Localhost cannot be used by wedding guests.

## Behavior and limits

- Accepts JPG, PNG, and WebP, up to 20 MB per source photo and 30 photos per batch. Convert HEIC to JPG first.
- Browser resizes to a maximum 2560-pixel longest edge and encodes JPEG, up to 2 MiB. These are optimized copies, not originals. Transparency becomes white; animation and metadata are not retained.
- Uploads are sequential. Failed uploads stay selected for retry. Keep the tab open while uploading. Retry identifiers avoid duplicates within a running server; simultaneous serverless retries are not globally atomic.
- Guest names are encoded into filenames. Do not rename uploaded files in Drime if you want attribution retained.
- Your uploads is identified by IDs saved in that browser, not by guest name. Clearing browser storage or changing device resets this filter. It covers loaded gallery pages.
- Gallery loads 40 folder entries at a time. Refresh checks for new photos. Sorting applies to loaded photos; load additional pages to include older photos.
- Anyone with the website URL can view and upload. The website is not an authenticated private album. The backend only permits the configured wedding folder; do not put unrelated private photos there.
- A 9 GB soft guard checks folder usage before upload. It is not a strict global cap under concurrent Vercel instances. The per-instance 40-upload/minute/IP limiter is also best effort, not robust abuse prevention.
- Drime storage quotas and Vercel request/bandwidth quotas still apply. Serving photos uses Vercel bandwidth. This setup does not provide unlimited free traffic. Check current plan terms and keep paid upgrades disabled if you need zero spending.
- Manually imported photos larger than 2 MiB cannot be served by this gallery.

## Validation

`npm run check`, `npm test`, and `npm run build` validate syntax, mocked API safety/behavior, and static output. Mock tests do not establish live Drime upload compatibility. A live upload and deployed Vercel test are required before the wedding.

## Camera capture

Take a photo asks for a name first and opens a separate image input with capture="environment". Confirming the captured photo starts uploading only that photo; other selected files stay pending. Cancelling does not upload anything. Failed captures stay selected for manual retry. Mobile browser/OS controls the camera picker; desktop may show a file picker. JPEG optimization uses an image-element decode fallback if ImageBitmap is unavailable. HEIC decoding depends on the browser; if unsupported, use JPG/Most Compatible camera format. Real iOS Safari and Android Chrome device testing is still required on the deployed HTTPS site.

## Downloading photos

Every gallery photo and the full-size viewer has a Download photo link. Downloads use the stored image without further compression, with a safe filename and the matching JPG/PNG/WebP extension. Uploaded photos are optimized JPEG copies, not the original camera files. The browser controls the save location; on phones the file may appear in Downloads rather than the Photos app. Downloads enforce the same wedding-folder and image checks as previews.

## Optional shared likes

Create an Upstash Redis database and add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to Vercel's server-side environment variables (and `.env.local` for local use), then redeploy. Use the read/write REST token. Never put it in browser code. See https://upstash.com/docs/redis/features/restapi for obtaining these credentials. Keep database eviction disabled so vote records are not silently removed. Likes remain hidden without configuration; a Redis outage does not stop gallery browsing or downloads.

The heart toggles like/unlike, not a separate negative vote. A signed HttpOnly, SameSite=Strict browser cookie identifies an anonymous voter for one year; Vercel uses a Secure, host-only cookie. Redis sets enforce one active vote per browser/photo, and an atomic script updates membership and reads the count. Repeated `liked: true` requests cannot increment it again. There is a shared limit of 120 like requests per browser per minute. Buttons are disabled while saving. Gallery refresh loads current counts; there is no live push subscription.

This is one vote per browser, not proof of one human: clearing cookies, private browsing, another device, or automation obtaining new cookies can bypass it. Sign-in or guest-specific invitations would be needed for stronger identity controls. Rotating the Redis token invalidates voter cookies (the token also signs these cookies). Keep one stable database and token across instances, and separate preview databases from production if you do not want preview likes mixed in. The database stores random voter identifiers and photo IDs, not guest names or image files. Downloads still work without cookies.
