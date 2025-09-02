# UI/UX Design Document (Grounded in Current Build)

Below is a design plan that aligns with the project goals, what’s already implemented, and Jones Engineering brand. It covers both public and admin UI with a focus on simplicity, reliability, and a subtle “wow” factor while remaining enterprise-grade.

## Findings: What’s Already Built

- Backend and routes
  - Public routes in `src/routes/public.routes.js`:
    - `GET /folders`, `GET /folder/:folderName`, `GET /docs/:folder/:fileName` (redirect to latest), friendly `GET /:folderName` and `GET /docs/:folder`
    - Health endpoints: `GET /healthz`, `GET /readyz`
  - Admin routes in `src/routes/admin.routes.js`:
    - `POST /admin/folder`, `POST /admin/upload` with PDF-only and 50MB limit, versioning via `getNextVersion()`
    - `DELETE /admin/document/:id` deletes a single version
  - Security and ops in `index.js`:
    - `helmet`, `morgan`, trust proxy, Easy Auth header + `ADMIN_EMAILS` allowlist (prod), IP rate-limit on `/admin`, no-store cache for `public/admin.html`, centralized error handler

- Data and storage
  - SQLite schema via `src/db/init.js`; services in `src/services/database.service.js`
  - Azure Blob wrapper in `src/services/storage.service.js`
  - Versioning persisted per `documents.version`; per-record deletion now supported

- Admin UI
  - `public/admin.html` and `public/app.js` provide:
    - Folder creation + dropdown
    - Drag-and-drop PDF upload with client/server validation
    - List documents (shows version), copy portal URL, delete version
    - Basic success/error feedback via status line

- Gaps/opportunities
  - UI is functional but minimal—no theming, brand polish, or advanced feedback (e.g., toasts/progress)
  - No dashboard/home for quick stats
  - No grouped-by-filename display of versions or search
  - Public UI is JSON-based (no branded web pages served for browsing)

## Design Objectives

- Minimize steps; first-use success for non-technical users.
- Emphasize permanent portal URLs and reliability.
- Subtle delight (microinteractions, skeletons, toasts) without sacrificing speed.
- Align with Jones Engineering brand at https://joneseng.com/ while keeping the app lightweight.

## Information Architecture

- Public
  - Home: Folders index page
  - Folder: Documents list with clear “open latest” action
  - Docs: Redirect to Blob via `/docs/:folder/:fileName`
- Admin
  - Dashboard: quick stats and recent activity
  - Folders: list, create, search
  - Documents (scoped to folder): upload + manage versions
  - Help: quick QR instructions and best practices

## Public UI (Field Users)

- Home (Folders)
  - Simple branded page; grid/list of folders; search box at top
  - Tap folder to see documents
- Folder (Documents)
  - List entries: “Filename” + “vX” tag for the latest; secondary info (uploaded_at optional)
  - Tap opens the redirect URL (latest)
- States and feedback
  - Skeleton loaders, empty state (“No documents yet”), retry on error
- Visuals (aligned with Jones Engineering)
  - Colors: adopt Jones primary blue with neutral grays; high contrast
  - Typography: use a modern, legible face (e.g., Inter or system Segoe UI) to complement site tone
  - Spacing: airy 8–16pt scale; large touch targets for mobile

## Admin UI

- Shell
  - Left sidebar: Navigation (Dashboard, Folders, Help) + folder quick list with search
  - Top bar: Logo + app title; user email; environment badge (Dev/Prod)
- Dashboard
  - Cards: total folders, total documents, last upload (filename/time), rate-limit status if tripped
  - Quick actions: “Create Folder”, “Upload Document”
- Folders
  - Table/list: folder name, count of documents, created_at
  - Create Folder dialog: name (required), display name (optional). Inline validation
  - Success: toast + auto-insert into list
- Documents (per folder)
  - Header: Folder name and “Upload” button
  - Upload panel:
    - Drag-and-drop zone + “Choose file”
    - Folder preselected
    - Optional Standard ID field (stored in `notes`); helper text clarifies purpose
    - PDF-only enforcement, 50MB limit; client pre-check and server error mapping
    - Show progress bar (client side) and final status toast
    - On success: show portal URL with “Copy” and “Open”
  - List of documents
    - Default: grouped by filename (accordion). Each group shows versions descending (v3, v2, v1)
    - Each version row:
      - Open (new tab)
      - Copy portal URL (always targets the canonical “latest” route for the filename)
      - Delete version (with confirm dialog)
    - Alternate view toggle: flat list
  - Search and filters: search-as-you-type by filename; filter by version or date
- Help (QR)
  - 3-step guide for making QR codes, with a sample portal URL and tips
- Feedback
  - Toasts: success, error, info; unobtrusive and timed
  - Error handling: specific messages—pdf_only, file too large, auth, network
  - Disabled buttons during ongoing upload to prevent duplicates

## Interaction and Microinteractions

- Upload
  - Immediate validation (extension + MIME), progress indicator, completion toast; resets file input on success
- Copy
  - Click to copy; toast with small icon and auto-dismiss
- Delete
  - Confirm modal clearly states filename + version, destructive button colored
- Loading
  - Skeletons shimmer for lists/tables; subtle easing transitions on mount/unmount
- Focus and keyboard
  - Visible focus rings; tab order logical; enter/escape for dialogs

## Accessibility

- Color contrast compliant; ARIA roles for lists, dialogs, toasts
- Keyboard-only operable (folder navigation, upload trigger, delete confirm)
- Screen-reader labels for actions (“Delete version v3 of SWI-105.pdf”)

## Branding and Theme (aligned with Jones Engineering)

- Colors
  - Primary: Jones Engineering blue (choose the closest accessible hue from their site palette)
  - Secondary: success green, error red, warning amber
  - Background: off-white/light gray
- Typography
  - Pairing consistent with enterprise tone; stick to system fonts or Inter for breadth of support
- Logo and identity
  - Place company logo in top-left; keep it modest in size; no visual clutter
- Components
  - Buttons: Primary solid, Secondary outline, Destructive red
  - Inputs with clear focus; helper text for validation

## URL and Content Model

- Public URLs remain `/docs/:folder/:fileName` → redirect to latest matching record (DB-driven)
- Documents are keyed by `folder` and `file_name` with independent version rows in `documents`
- Standard ID stored as `notes` (kept optional and concise in the UI)
- Per-version delete via `DELETE /admin/document/:id` (already implemented)

## Security/Operational Considerations

- Admin area
  - Easy Auth enforced in production via `x-ms-client-principal` with `ADMIN_EMAILS` allowlist
  - IP-based rate limiting on `/admin`
  - No-cache for `admin.html`
- Errors
  - Centralized handler returns JSON for `pdf_only`, multer size errors, and generic server errors
- Health
  - `/healthz` for liveness, `/readyz` for DB readiness

## Implementation Notes (kept brief)

- Public UI can be served as a branded static page for folders and folder details (in `public/`), calling existing JSON endpoints.
- Admin UI should be upgraded from current basic HTML/JS to a cohesive, styled single-page feel:
  - Still zero-build if needed: Vanilla JS + modular CSS
  - Or light-weight client framework if allowed (but not necessary)

## Validation Against Goals

- Ease of use
  - Fewer steps; clear CTAs; error messages that instruct; mobile-first; keyboard support
- Visual appeal
  - Clean brand-aligned palette and typography; generous whitespace; subtle animations; polished toasts
- Requirements alignment
  - Permanent portal URL explicit post-upload; public is no-login; admin protected; PDF-only + limits; version management by individual delete; health endpoints; minimal ops friction

## Decisions (exercising creative freedom)

- Default doc view: grouped-by-filename, versions descending for clarity
- Keep Standard ID optional but visible (as metadata) to help Quality workflows
- Add client-side QR preview (purely visual) on upload success; official QR remains manual policy
- Toasts + progress bar for “wow” without adding heavy frameworks
- Adopt Inter (fallbacks to system fonts) for a modern, enterprise-friendly look

## Next Steps

- Approve the visual baseline (colors/typography) to match Jones Engineering.
- Confirm whether to add a public branded folders/documents UI (currently API returns JSON). If approved, I’ll add:
  - `public/index.html` (folders)
  - `public/folder.html?name=...` (documents list)
  - Shared `public/styles.css` and `public/ui.js`
- Upgrade admin UI styling + components per plan (toasts, progress, grouped view, search).
- Provide wireframes for both public and admin—then implement iteratively.
