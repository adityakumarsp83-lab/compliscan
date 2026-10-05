# CompliScan mobile PWA

The React scanner is installable and supports local English OCR, multi-surface audits, original-image SHA-256 hashing, saved evidence, and PDF exports after its first online setup.

## Build and run

```sh
npm ci
npm run build
npm run preview -- --host 0.0.0.0
```

`prebuild` and `predev` copy the pinned Tesseract worker, both LSTM WebAssembly cores, and English trained data from npm packages into `public/ocr`. These generated assets are ignored by Git and included in `dist` and the service-worker precache. Do not deploy without running the build. Offline installation is intentionally tested against the production build, not Vite's development server.

## Deployment

Deploy the contents of `apps/web/dist` at the root of an HTTPS origin. Localhost is allowed for desktop development; a phone visiting a computer's plain HTTP LAN address will not get an installable offline PWA. Use a real HTTPS deployment for phone testing.

Set `VITE_BACKEND_URL` before building to an HTTPS backend origin; the default localhost backend is only for local development. Configure backend CORS to allow the frontend origin. Initial account registration/sign-in requires the backend. A previously signed-in inspector's local profile is remembered for local work across app launches; JWTs remain session-only. Offline profile access is not fresh authentication or authorization for server operations. Logging out removes the remembered profile; it does not delete local inspection evidence.

Serve `.wasm` as `application/wasm`, `.js` as JavaScript, and `.webmanifest` as `application/manifest+json`. Do not rewrite missing OCR assets into HTML. Serve `sw.js` and `index.html` with revalidation/no-cache; hashed build assets can use long-lived caching. The app expects root hosting (`/`); subdirectory deployment needs coordinated base, manifest, and icon-path changes.

## Field workflow

1. Open online, sign in, and wait for **Offline scanner ready**. The initial offline cache contains approximately 17 MB of application and OCR assets before HTTP compression.
2. Android: use **Install app** when offered, or the browser installation menu. iPhone Safari: **Share → Add to Home Screen**. Install and complete sign-in in the installed app while online before taking it into the field.
3. Choose a surface and use **Capture Front / Side / Crimp**, or upload existing photos. Capture controls request the rear camera; the exact chooser depends on the browser. A maximum of five photos can be harmonized.
4. With connectivity disabled, local OCR, rules, hashing, history reopening, and PDF export continue to work. Gemini, account operations, remote map tiles, and backend storage require connectivity. There is no automatic synchronization queue in this release.
5. Open a saved audit from History using its arrow button. Original images and the ordered manifest are checked against their stored hashes before reopening. Delete a record to delete its original photos too.
6. Use **Protect local storage** to request browser storage persistence. This request can be declined. Storage usage is shown; browser data clearing/uninstallation or storage eviction can still remove evidence. Export important reports. History from older versions may lack original photographs and cannot reconstruct them.
7. Apply **Update app** between scans. Updates are user-triggered, and the control is disabled during OCR/cloud extraction.

Local audit revisions reuse their inspection ID rather than retaining another copy of all original images. Photos and reports commit in one IndexedDB transaction. No signatures, trusted GPS/timestamps, immutable custody ledger, or legal-validity guarantee are added by PWA installation.

## Verification

```sh
npm test
npx playwright install chromium
npm run test:pwa
```

For an existing Chrome installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path. The browser regression uses real Tesseract OCR on a generated label; only login is mocked. It verifies the manifest, offline cache, touch-sized viewport layout, two camera inputs, reopening in a fresh page offline, PDF export, tampered-photo rejection, and deletion of original evidence. Physical camera capture, OS installation prompts, iPhone Safari behavior, and phone memory/latency still require real-device verification.
