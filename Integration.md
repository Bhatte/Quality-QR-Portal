# ME-QR “Link” API Integration Plan for Quality-QR-Portal

This document summarizes the ME-QR API endpoints and payloads we’ll use, and proposes a concrete integration design for our Node/Express QR Portal so a user can upload a PDF, click “Generate QR,” and then download a branded QR image from our site.

## Overview

- Docs (Swagger): https://me-qr.com/api/doc
- Auth: API key header `X-AUTH-TOKEN: <token>`
- Content: JSON requests; responses vary by `format`
- Type in scope: “Link” QR (encodes a URL)
- Branding: Supports logo and colors in `qrOptions`
- Update: You can update an existing QR’s content/styling by `entryUID`

Note: ME-QR “Link” creates dynamic QR codes tracked in your ME-QR account. Scans typically open a me-qr.com redirect URL which then forwards to your target link. This enables analytics and content updates without changing the printed code.

## Endpoints In Scope

- POST `/api/v2/qr/link/create`
  - Purpose: Create a Link QR code
  - Auth: `X-AUTH-TOKEN` header
  - Body: JSON with `qrFieldsData`, `title`, `format`, `designType`, `qrOptions`, `qrFrame`

- PUT `/api/v2/qr/link/update/{entryUID}`
  - Purpose: Update an existing Link QR (target URL or styling)

- GET `/api/v2/qr/link/{entryUID}`
  - Purpose: Retrieve QR meta and customization settings

- GET `/api/qr/list/`
  - Purpose: List existing QRs in your account (useful for auditing)

## Request Schema (Link QR)

POST `/api/v2/qr/link/create` essential fields:

- `qrFieldsData`
  - `link` (string, required): Target URL encoded into the QR (we will pass the portal’s public PDF URL like `https://{host}/docs/{folder}/{fileName}`)
- `title` (string, required): Name shown in your ME-QR account
- `format` (string, required): One of `"png"`, `"jpeg"`, `"svg"`, `"json"`
- `designType` (string): `"base"` (simple) or `"art"` (advanced). We will use `"base"`.
- `qrOptions` (object): Styling and logo options (see below)
- `qrFrame` (object): Frame settings. We use the selected helmet frame by default.

Example request body (minimal but branded):

```json
{
  "qrFieldsData": {
    "link": "https://your-portal.example.com/docs/Manuals/SOP-001.pdf"
  },
  "title": "SOP-001 QR",
  "format": "png",
  "designType": "base",
  "qrOptions": {
    "size": 1024,
    "errorCorrectionLevel": "Q",
    "pattern": "square",
    "patternColor": "#000000",
    "patternBackground": "#FFFFFF",
    "cornetsOuter": "square",
    "cornetsOuterColor": "#000000",
    "cornetsInterior": "square",
    "cornetsInteriorColor": "#000000",
    "logotype": "https://your-portal.example.com/logo.png",
    "logotypeSize": 0.3,
    "logotypeMargin": 0,
    "logotypeHideBackground": true,
    "gradientPattern": null,
    "gradientCornetsOuter": null,
    "gradientCornetsInterior": null,
    "gradientBackground": null
  },
  "qrFrame": {
    "name": "hundredTventyFive",
    "color": "#000000",
    "backgroundColor": "#FFFFFF",
    "text": "",
    "textSize": null,
    "textColor": "#000000",
    "textFont": "Roboto"
  }
}
```

Field notes:
- `qrOptions.logotype` accepts either a URL or base64 image (type is `string($enumValue|url|base64Image)`). A URL to our already-exposed `GET /logo.png` is simplest.
- `errorCorrectionLevel`: typical values are `"L"`, `"M"`, `"Q"`, `"H"`. The example uses `"Q"`.
- Keep gradients `null` for a basic config.
- `qrFrame` defaults to the selected helmet frame `hundredTventyFive` (black on white). You can override per request.

Update payload (PUT `/api/v2/qr/link/update/{entryUID}`) mirrors the create body. You can change `qrFieldsData.link`, colors, or logo later and keep the same QR.

GET `/api/v2/qr/link/{entryUID}` returns the QR’s metadata and styling (useful to rehydrate state in our DB).

## Response and Download Strategy

- The request body contains a `format` field:
  - Use `"png"` or `"svg"` when you want an image response.
  - Use `"json"` when you want JSON with ME-QR metadata (including identifiers like `entryUID`).

Because Swagger doesn’t explicitly enumerate response types, we’ll adopt a robust approach:
- Phase 1 (recommended): Call with `format: "json"` to receive JSON metadata and extract the `entryUID`. Then either:
  - Call a follow-up “export” action if present in the metadata (direct file URL or a render endpoint), or
  - Re-call create/update with `format: "png"` and appropriate Accept headers to receive image bytes directly.
- Phase 2: Persist the final image bytes in our DB as a new document (BLOB), e.g., `{fileName}-qr.png` in the same folder.

## Authentication

- Header: `X-AUTH-TOKEN: <MEQR_API_TOKEN>`
- Store in `.env`:
  - `MEQR_API_TOKEN=...`
- Never expose the token to the frontend; calls go server-to-server.

## Integration Architecture in Our Portal

Current public document serving endpoint:
- `GET /docs/:folder/:fileName` in `src/routes/public.routes.js` streams the PDF inline from SQLite BLOBs.

Proposed flow:
1. User uploads a PDF as they do today (stored in `documents` table).
2. UI shows a “Generate QR” button next to each upload (in `public/app.js`/`public/ui.js`).
3. Button calls the authenticated admin API route `POST /admin/qr/link` with payload `{ folder, fileName, options? }`.
4. Server resolves the document to a public URL: `https://<host>/docs/{folder}/{fileName}`.
5. Server calls ME-QR `POST /api/v2/qr/link/create` with:
   - `qrFieldsData.link` set to the public URL
   - `title` set to a sensible name (e.g., `{folder}/{fileName}`)
   - `format: "json"` first, then a second call to fetch `png` if needed
   - `qrOptions.logotype` set to `https://<host>/logo.png` and black-on-white colors from config
   - `qrFrame.name` defaulting to `hundredTventyFive` (helmet frame) from environment
6. Server saves the QR PNG bytes as a new document record in the same folder:
   - `file_name`: append `-qr.png` or `-qr.svg`
   - `mime_type`: `image/png` or `image/svg+xml`
   - Optional: store `entryUID` in `notes` for traceability and future updates
7. UI refreshes the folder listing so the user can immediately download/print the QR from `GET /docs/:folder/{fileName-qr.png}`.

Server-side components to add:
- `src/services/meqr.service.js`:
  - `createLinkQr({ link, title, options, frame, format })`
  - `updateLinkQr(entryUID, {...})`
  - `getLinkQr(entryUID)`
- `src/routes/admin.routes.js`:
  - `POST /qr/link` implemented to trigger generation, protected by `requireAdmin` and CSRF (see `index.js`).
  - Optional probe utilities (guarded by `ENABLE_PROBE=true`):
    - `GET /admin/qr/probe/frames` (paged base64 previews)
    - `POST /admin/qr/probe/export` (writes gallery under `public/frame-probe/<timestamp>/`)
- `.env`:
  - `MEQR_API_TOKEN`
  - `MEQR_QR_DESIGN_TYPE=base`
  - `MEQR_QR_FRAME_NAME=hundredTventyFive`
  - Optional defaults: `MEQR_QR_SIZE`, `MEQR_QR_ECL`, `MEQR_QR_PATTERN_COLOR=#000000`, `MEQR_QR_BG_COLOR=#FFFFFF`, `MEQR_QR_LOGO_URL` (fallback to `/logo.png`)

Data persistence:
- Reuse the `documents` table to store the QR image as a BLOB, alongside PDFs.

Security:
- Only authenticated admins can generate QRs.
- ME-QR token kept server-side only.
- Respect existing CSRF and session protections in `index.js`.

## Example Requests

cURL (server-to-server):

Create Link QR (JSON metadata first):

```bash
curl -X POST "https://me-qr.com/api/v2/qr/link/create" \
  -H "Content-Type: application/json" \
  -H "X-AUTH-TOKEN: $MEQR_API_TOKEN" \
  -d '{
    "qrFieldsData": { "link": "https://your-portal.example.com/docs/Manuals/SOP-001.pdf" },
    "title": "SOP-001 QR",
    "format": "json",
    "designType": "base",
    "qrOptions": {
      "size": 1024,
      "errorCorrectionLevel": "Q",
      "pattern": "square",
      "patternColor": "#000000",
      "patternBackground": "#FFFFFF",
      "cornetsOuter": "square",
      "cornetsOuterColor": "#000000",
      "cornetsInterior": "square",
      "cornetsInteriorColor": "#000000",
      "logotype": "https://your-portal.example.com/logo.png",
      "logotypeSize": 0.3,
      "logotypeMargin": 0,
      "logotypeHideBackground": true
    },
    "qrFrame": { "name": "noFrame", "color": "#000000", "backgroundColor": "#FFFFFF", "text": "" }
  }'
```

Update Link QR (change colors or link):

```bash
curl -X PUT "https://me-qr.com/api/v2/qr/link/update/ENTRY_UID_HERE" \
  -H "Content-Type: application/json" \
  -H "X-AUTH-TOKEN: $MEQR_API_TOKEN" \
  -d '{ "qrOptions": { "patternColor": "#1f2937" } }'
```

Fetch Link QR metadata:

```bash
curl -X GET "https://me-qr.com/api/v2/qr/link/ENTRY_UID_HERE" \
  -H "X-AUTH-TOKEN: $MEQR_API_TOKEN"
```

Node.js (server-side) example using fetch:

```js
import fetch from "node-fetch";

const BASE = "https://me-qr.com";
const MEQR_API_TOKEN = process.env.MEQR_API_TOKEN;

export async function createLinkQr({ link, title, logoUrl, colors }) {
  const body = {
    qrFieldsData: { link },
    title,
    format: "json",
    designType: "base",
    qrOptions: {
      size: 1024,
      errorCorrectionLevel: "Q",
      pattern: "square",
      patternColor: colors?.patternColor || "#000000",
      patternBackground: colors?.background || "#FFFFFF",
      cornetsOuter: "square",
      cornetsOuterColor: colors?.cornersColor || "#000000",
      cornetsInterior: "square",
      cornetsInteriorColor: colors?.cornersInnerColor || "#000000",
      logotype: logoUrl || "https://your-portal.example.com/logo.png",
      logotypeSize: 0.3,
      logotypeMargin: 0,
      logotypeHideBackground: true
    },
    qrFrame: { name: "noFrame", color: "#000000", backgroundColor: "#FFFFFF", text: "" }
  };

  const res = await fetch(`${BASE}/api/v2/qr/link/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-TOKEN": MEQR_API_TOKEN
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ME-QR create failed: ${res.status} ${text}`);
  }
  const meta = await res.json(); // Contains entryUID and details
  return meta;
}
```

To retrieve image bytes (if no direct image URL provided in JSON) you can:
- Re-issue a create/update request with `format: "png"` and parse the binary response (if endpoint supports that), or
- Use any explicit “image url” exposed by the JSON metadata.

## Error Handling and Reliability

- **Validation & status codes**: 400/422 invalid input; 401/403 auth; 404 unknown `entryUID`; 429 rate limit; 5xx transient.
- **Retries**: Exponential backoff with jitter on idempotent calls.
- **Timeouts**: 8–15s HTTP client timeouts.
- **Logging**: Log request IDs/`entryUID`, status, timings.
- **Persistence**: Store `entryUID` with the saved QR image (e.g., in `documents.notes`) for future updates.

## Configuration

- `.env`
  - `MEQR_API_TOKEN`
  - Optional defaults:
    - `MEQR_QR_SIZE=1024`
    - `MEQR_QR_ECL=Q`
    - `MEQR_QR_PATTERN_COLOR=#000000`
    - `MEQR_QR_BG_COLOR=#FFFFFF`
    - `MEQR_QR_LOGO_URL=https://your-portal.example.com/logo.png`

Ensure `GET /logo.png` (handled in `index.js`) returns a suitable transparent PNG at least 512×512 for best results.

## Security and Access

- Keep ME-QR calls server-side (don’t leak token to browser).
- Require admin auth for the “Generate QR” action (hook into `requireAdmin` in `index.js`).
- CSRF already enforced on admin mutating requests (see middleware in `index.js`).

## UX Notes

- Add “Generate QR” button per document row.
- Show spinner while generating; on success, immediately show a new entry `{fileName}-qr.png` to download/print.
- Consider a small preview thumbnail (store a 512px PNG alongside the full-size for fast previews).

## Next Steps

- Confirm the JSON response from `POST /api/v2/qr/link/create` in staging to see the exact image download path or whether a second call (png) is needed.
- Implement `meqr.service.js` and the admin route to create-and-store the QR as a BLOB next to the PDF.
- Add front-end button and wire to the new admin route with CSRF header.
- Add `.env` secret and defaults, plus a README section for setup.
