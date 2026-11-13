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

Import the source project into Vercel with framework preset Other, build command `npm run build`, and output directory `dist`. API routing is provided by `vercel.json`.
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
