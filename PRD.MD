# PRODUCT REQUIREMENTS DOCUMENT
# VISUALIFY

### AI-powered visual learning workspace
Turn prompts, PDFs and images into editable visual notes, diagrams and study materials.

| Document field | Value |
| :--- | :--- |
| **Document status** | Build-ready product specification / working baseline |
| **Version** | 1.0 |
| **Prepared** | 24 November 2026 |
| **Product name** | Visualify (working title; brand validation pending) |
| **Primary platform** | Responsive web application |
| **Primary audience** | Students, self-learners and educators |
| **Reference implementation** | Excalidraw CLI + @excalidraw/excalidraw |
| **Backend platform** | Node.js + Express + Supabase |

> **Core product promise:** A student should be able to bring messy learning material into Visualify and leave with a clear, editable, downloadable visual explanation they can study again.

*This PRD is intended to guide design, implementation, testing and deployment. It distinguishes launch requirements from later expansion so that the first release stays achievable.*

---

## Document contents

1. [Executive summary and product purpose](#1-executive-summary-and-product-purpose)
2. [Goals, non-goals and product principles](#2-goals-non-goals-and-product-principles)
3. [Users, personas and primary use cases](#3-users-personas-and-primary-use-cases)
4. [Scope and release boundaries](#4-scope-and-release-boundaries)
5. [Functional requirements](#5-functional-requirements)
6. [User journeys and screen behaviour](#6-user-journeys-and-screen-behaviour)
7. [Application routes and navigation](#7-application-routes-and-navigation)
8. [System architecture and complete tech stack](#8-system-architecture-and-complete-tech-stack)
9. [AI generation pipeline and visual representation strategy](#9-ai-generation-pipeline-and-visual-strategy)
10. [Data model and Supabase design](#10-data-model-and-supabase-design)
11. [API contract](#11-api-contract)
12. [Security, privacy and reliability requirements](#12-security-privacy-and-reliability-requirements)
13. [UX, accessibility and responsive requirements](#13-ux-accessibility-and-responsive-requirements)
14. [Analytics, success metrics and quality evaluation](#14-analytics-success-metrics-and-quality-evaluation)
15. [Testing and acceptance strategy](#15-testing-and-acceptance-strategy)
16. [Deployment, environments and operations](#16-deployment-environments-and-operations)
17. [Delivery phases and exit criteria](#17-delivery-phases-and-exit-criteria)
18. [Risks, decisions and launch checklist](#18-risks-decisions-and-launch-checklist)
19. [Appendices: sample schemas, environment variables and sources](#19-appendices)

> **Implementation rule:** Build the smallest complete vertical slice first: prompt → valid visual plan → Excalidraw scene → live editor → save to library → export. Add document ingestion only after this path is reliable.

---

## 1. Executive summary and product purpose

Visualify is a web-based learning workspace that transforms educational content into visual explanations. A user can enter a topic or prompt, upload a PDF, or upload an image of handwritten or printed notes. The platform analyses the input, identifies concepts and relationships, chooses suitable visual formats, generates editable Excalidraw content, and presents it inside an interactive workspace. Users can refine, save, organise, revisit and download their work.

The product is not intended to be a generic “text-to-flowchart” wrapper. Its core value is educational interpretation: recognising whether a concept is best taught through a flowchart, sequence diagram, mind map, comparison board, timeline, entity relationship diagram, annotated illustration or a set of connected pages.

### 1.1 Problem statement

- **Information is text-heavy.** Students often receive long PDFs, lecture notes and textbook chapters that are hard to revise quickly.
- **Existing diagrams are not always explanatory.** A raw chart may show boxes and arrows without teaching the why, the sequence or the relationships.
- **Manual visual note-making takes time.** Students may understand a topic but spend too long arranging shapes and writing labels.
- **Generated images are not editable.** A flat image is difficult to correct, rearrange, expand or reuse as a study resource.
- **Learning material gets scattered.** Users need a persistent library where the generated visual notes, source files and revisions stay organised.

### 1.2 Product solution

1. Accept a text prompt, PDF document or image as the source material.
2. Extract and interpret relevant content, preserving page or source references where possible.
3. Create a structured learning plan with objectives, concepts, relationships and recommended visual formats.
4. Generate one or more editable Excalidraw scenes, using Mermaid when it fits and direct scene composition when it does not.
5. Open the result in an embedded Excalidraw editor with a companion explanation panel.
6. Allow the user to save it in a personal notes library, create versions, organise it and export it.
7. Expand the saved visual into learning actions such as explain-this-node, quick quiz, flashcards and presentation mode.

### 1.3 Product positioning

> **Positioning statement:** Visualify is a visual learning workspace, not simply a diagram generator. It turns course material into structured, editable learning assets and keeps those assets in one personal library.

---

## 2. Goals, non-goals and product principles

### 2.1 Product goals

| ID | Goal | How success is demonstrated |
| :--- | :--- | :--- |
| **G-01** | Reduce time from source material to useful visual notes. | A first-time user can generate a useful visual from a prompt without manually drawing it. |
| **G-02** | Make the visual editable, not a dead image. | Generated scenes open in the embedded Excalidraw editor and can be modified. |
| **G-03** | Support multiple learning inputs. | Prompt generation ships first; PDF and image ingestion follow with explicit processing feedback. |
| **G-04** | Build a persistent student workspace. | Users can save, search, organise, reopen, version and delete notes. |
| **G-05** | Make visuals educationally meaningful. | Every generated note includes an explanation and coherent information hierarchy. |
| **G-06** | Keep user data private by default. | Supabase Auth, Postgres RLS and private Storage buckets enforce ownership. |
| **G-07** | Keep generation operationally safe. | Long-running AI and rendering jobs run asynchronously with limits and observable states. |

### 2.2 Non-goals for the first release

- No real-time multiplayer editing, public social feed or classroom collaboration in v1.
- No attempt to replace a full document editor, LMS, note-taking suite or full Excalidraw application.
- No guarantee that every academic diagram type can be generated perfectly from arbitrary material.
- No autonomous web research or citations to external sources in the first prompt/PDF release. A later research mode can be scoped separately.
- No RAG/vector database in the MVP. Add retrieval only when saved-document Q&A or cross-document search is a real validated requirement.
- No custom payment, subscription, team billing or institution administration in the initial launch. Keep usage limits configurable so monetisation can be added later.

### 2.3 Product principles

- **Teach first, decorate second.** Clarity, hierarchy and correctness beat visual complexity.
- **Editable source is canonical.** The Excalidraw scene JSON is the editable artefact; PNG/SVG exports are derivatives.
- **Multiple render strategies.** Use Mermaid for supported graph-like diagrams; use a controlled scene schema and deterministic adapter for richer educational layouts.
- **Explain the output.** Every generation should include a short summary, learning objectives and a readable outline.
- **Private by default.** Uploaded source files and saved notes are private unless the user explicitly shares them in a future release.
- **Progress is visible.** Long-running jobs must show the current stage, not an indefinite spinner.
- **Human correction is expected.** Users can edit, regenerate a section or roll back to a prior version.

---

## 3. Users, personas and primary use cases

| Persona | Needs | Typical workflow |
| :--- | :--- | :--- |
| **University student** | Turn lecture PDFs and class notes into exam revision assets. | Upload a DBMS PDF → generate topic maps and process diagrams → fix labels → save in a subject folder → revise later. |
| **Self-learner / developer** | Understand technical systems and relationships. | Enter “how a React request reaches Express” → choose architecture/sequence visual → inspect each step → export SVG. |
| **Educator / tutor** | Create reusable explanations and teaching visuals. | Enter a lesson topic → produce multi-frame explanation → edit terminology → present in class. |
| **Visual learner** | Replace dense notes with spatial and visual explanations. | Upload notes image → review OCR/extraction → generate mind map and comparison visual. |

### 3.1 Main jobs to be done

- When I am given a dense topic, help me see its structure before I memorise its details.
- When I upload notes, convert the important information into a visual without silently inventing facts.
- When a generated diagram is close but not right, let me correct it in a real editor.
- When I study again, let me find the note quickly and understand it without repeating the whole generation process.
- When I need to share or submit work, let me download a clean PNG, SVG, PDF or editable Excalidraw file.

---

## 4. Scope and release boundaries

| Capability | MVP | Next release | Later / optional |
| :--- | :--- | :--- | :--- |
| Email/password authentication, Google OAuth, profile, avatar | Required | | |
| Prompt → visual generation | Required | | |
| Excalidraw editor and scene autosave | Required | | |
| Save to notes library; folders, tags, search | Required | | |
| PNG/SVG/Excalidraw download | Required | | |
| PDF ingestion | | Required | |
| Image and handwritten-note ingestion | | Required | |
| Multi-page visual notes / presentation mode | | Required | |
| Explain selected element; quiz and flashcards | | Required | |
| Saved-source Q&A / RAG | | | Optional |
| Public read-only share links | | | Optional |
| Live collaboration and comments | | | Optional |
| Teacher/classroom workspaces | | | Optional |
| Billing and premium plans | | | Optional |

> **Release policy:** Do not advertise a later-phase capability as available in the MVP. The product UI should label unreleased features as “Coming later” or omit them entirely.

---

## 5. Functional requirements

Priority definitions: **P0** = required for launch; **P1** = high-value follow-on; **P2** = optional/future. Each requirement is testable and should be linked to implementation issues.

### 5.1 Authentication and account lifecycle

| ID / Priority | Requirement | Acceptance criteria |
| :--- | :--- | :--- |
| **FR-AUTH-01 / P0** | Users can sign up using email and password through Supabase Auth. | Valid signup creates an Auth user; email confirmation follows configured project policy; duplicate/invalid signup produces safe feedback. |
| **FR-AUTH-02 / P0** | Users can sign in and sign out. | Session persists on refresh; protected routes redirect signed-out visitors; sign-out clears local authenticated state. |
| **FR-AUTH-03 / P0** | Password reset and recovery. | User requests reset email, follows recovery link, sets a new password and can sign in. |
| **FR-AUTH-04 / P0** | Google OAuth sign-in. | Google provider is configured in Supabase; OAuth callback returns the user to the intended app route. |
| **FR-AUTH-05 / P0** | Route-level authentication guard. | Authenticated routes wait for session initialisation and do not flash protected content to signed-out users. |
| **FR-AUTH-06 / P0** | Create a profile row for every new user. | Database trigger inserts profile row; signup is tested so a trigger failure cannot silently strand users. |
| **FR-AUTH-07 / P1** | Account deletion. | User confirms destructive action; application removes owned content and files according to retention policy, then deletes Auth user. |

*Implementation note: use the Supabase JavaScript client in the React app for Auth. Listen to auth changes with `onAuthStateChange` and unsubscribe on provider teardown. Keep the access session in the official client-managed session mechanism; do not build a parallel refresh-token system.*

### 5.2 Profile and preferences

| ID / Priority | Requirement | Acceptance criteria |
| :--- | :--- | :--- |
| **FR-PROF-01 / P0** | Profile includes display name, username, avatar and optional bio. | Profile can be viewed and edited; display name and username validation runs server-side or through database constraints. |
| **FR-PROF-02 / P0** | User can upload/change/remove avatar. | Only image MIME types are accepted; image size is limited; file path is scoped to the authenticated user; UI updates after successful upload. |
| **FR-PROF-03 / P1** | User preferences include theme, default export format and learning level. | Preferences persist across sessions and are applied in the editor/create flow. |
| **FR-PROF-04 / P1** | User can view account email and sign out all app sessions where supported. | Sensitive account operations require confirmation and clear success/error feedback. |

### 5.3 Dashboard and onboarding

- First visit shows a short onboarding sequence: what Visualify does, supported inputs, privacy basics and a sample visual.
- Dashboard contains a prominent “Create visual notes” action, recent notes, pinned/favourite notes, recent generation activity and usage indicator.
- Empty library state explains how to create the first note and provides a sample prompt.
- Dashboard should avoid vanity metrics until they are meaningful; show real saved-note counts and recent activity only.
- Onboarding is skippable and can be reopened from settings.

### 5.4 Creation inputs and source handling

| ID / Priority | Requirement | Acceptance criteria |
| :--- | :--- | :--- |
| **FR-IN-01 / P0** | Prompt input accepts topic, question or pasted notes. | Validate non-empty prompt; trim excessive whitespace; enforce configured character limit; show remaining count. |
| **FR-IN-02 / P0** | User can choose subject/topic, learning level, visual style and output depth. | Settings are passed into generation config and stored with the job/version. |
| **FR-IN-03 / P1** | PDF upload supports digital and scanned PDFs within configured limits. | Reject unsupported/corrupt/encrypted files with actionable message; show upload and page-processing progress. |
| **FR-IN-04 / P1** | Image upload supports JPG, PNG and WebP. | Validate magic bytes/MIME and size; image preview appears before generation; rotate/resize if required. |
| **FR-IN-05 / P1** | User can choose pages or a page range from a PDF. | Only selected pages enter extraction; visible page numbers are preserved as source metadata. |
| **FR-IN-06 / P1** | User can review extracted content before generation. | Show extracted title/text preview and let user remove sensitive or irrelevant content before sending it to the model. |
| **FR-IN-07 / P0** | User can cancel a queued or active job where technically safe. | Queued job is cancelled immediately; running job receives cancellation signal and is marked cancelled when worker stops. |

> **Initial operational defaults:** Start with configurable limits such as 20 MB per source file, 100 PDF pages per generation, 1 active generation per user and a per-user monthly generation allowance. These are product defaults to tune after cost and abuse testing, not vendor API limits.

### 5.5 AI understanding and visual generation

| ID / Priority | Requirement | Acceptance criteria |
| :--- | :--- | :--- |
| **FR-AI-01 / P0** | AI returns a structured learning plan before visual rendering. | Output validates against a versioned JSON schema; includes title, summary, objectives, key concepts, relationships and diagram/page specs. |
| **FR-AI-02 / P0** | System chooses the visual representation based on content. | Planner selects from supported visual types and records a rationale; user can override the choice. |
| **FR-AI-03 / P0** | System produces an editable Excalidraw scene. | Scene schema passes validation and loads in embedded Excalidraw without a blank canvas or fatal runtime error. |
| **FR-AI-04 / P0** | Use Mermaid for supported graph diagram types. | Valid Mermaid is converted to an Excalidraw scene; malformed Mermaid is repaired once or routed to a controlled fallback. |
| **FR-AI-05 / P0** | Use direct scene composition for visual types Mermaid cannot represent well. | LLM returns constrained intermediate diagram JSON; deterministic adapter creates Excalidraw elements. |
| **FR-AI-06 / P0** | Generation includes explanatory text. | Result contains a short overview and section-by-section explanation aligned to scene content. |
| **FR-AI-07 / P1** | Generation supports multiple related frames/pages. | Each page has stable ID, title, learning purpose, scene JSON and order; users can navigate between pages. |
| **FR-AI-08 / P1** | Support regeneration of a whole note or selected section. | New version is created; previous version remains recoverable; regeneration instructions are stored. |
| **FR-AI-09 / P1** | System can identify low-confidence or incomplete extraction. | Warnings appear to the user; generation does not claim missing content was understood. |

### 5.6 Visual editor and workspace

| ID / Priority | Requirement | Acceptance criteria |
| :--- | :--- | :--- |
| **FR-EDIT-01 / P0** | Embed @excalidraw/excalidraw in a dedicated editor route. | Canvas has non-zero height, required CSS is imported, editor runs client-side and scene loads via initialData. |
| **FR-EDIT-02 / P0** | User can move, resize, add, edit and delete supported elements. | Core editing actions work using native Excalidraw UI; changes update editor state. |
| **FR-EDIT-03 / P0** | Autosave changes to the current version. | Debounced save status displays Saving/Saved/Error; reload restores last confirmed save. |
| **FR-EDIT-04 / P0** | User can explicitly save a version/snapshot. | Version number increases; previous snapshots remain available. |
| **FR-EDIT-05 / P1** | User can edit the learning outline and regenerate a section. | Edited outline is included in the regeneration request; unaffected pages remain unchanged where possible. |
| **FR-EDIT-06 / P1** | Selection-aware explanation. | Selecting an element and choosing Explain sends only relevant scene context and returns a concise explanation. |
| **FR-EDIT-07 / P1** | Presentation mode. | Multi-frame notes can be presented in order with next/previous controls and keyboard navigation. |

### 5.7 Notes library and organisation

| ID / Priority | Requirement | Acceptance criteria |
| :--- | :--- | :--- |
| **FR-LIB-01 / P0** | Users can save generated notes to a personal library. | Saved note appears in library and dashboard; it remains available after logout/login. |
| **FR-LIB-02 / P0** | Library supports grid and list views. | Cards show title, thumbnail, subject, updated date and status; list view supports sorting. |
| **FR-LIB-03 / P0** | Users can search notes by title and tags. | Search returns only the current user’s notes and updates as query changes. |
| **FR-LIB-04 / P0** | Users can create folders and move notes. | Folder CRUD is owner-scoped; note folder assignment persists. |
| **FR-LIB-05 / P0** | Users can add tags, favourite/pin notes and filter. | Filters combine predictably; empty states explain why no results appear. |
| **FR-LIB-06 / P0** | Users can rename, duplicate, archive and delete notes. | Destructive actions require confirmation; duplicate creates an independent note/scene copy. |
| **FR-LIB-07 / P0** | Version history is visible. | User can preview and restore an earlier version, which becomes a new current version rather than destroying history. |
| **FR-LIB-08 / P1** | Recently opened and recently updated filters. | Sort order is based on actual timestamps and last-opened updates. |

### 5.8 Export and download

| ID / Priority | Requirement | Acceptance criteria |
| :--- | :--- | :--- |
| **FR-EXP-01 / P0** | Download current scene as PNG. | PNG export works for selected frame or full scene; clear background/theme choice is honoured. |
| **FR-EXP-02 / P0** | Download current scene as SVG. | SVG renders correctly in common browsers and has readable text. |
| **FR-EXP-03 / P0** | Download editable .excalidraw JSON. | File opens in Excalidraw and includes scene elements and app state required for editing. |
| **FR-EXP-04 / P1** | Download multi-page notes as a ZIP of images and/or PDF. | Pages retain ordering and have readable page titles; errors for partial exports are shown. |
| **FR-EXP-05 / P1** | Export selected page or selected elements. | The export action clearly states what is included. |

### 5.9 Learning companion features

These features are P1 and should be built after the generation/edit/save loop is stable.

- **Explain a node:** user selects a shape or text element and asks for a simpler explanation, example or analogy.
- **Quick quiz:** generate a small set of questions from the saved note; show answer feedback and a short explanation.
- **Flashcards:** generate front/back cards for key terms and relationships; allow marking “Know it” / “Review again”.
- **Revision mode:** compact view of the note summary, key terms, common confusions and a 5-question self-check.
- **Ask this note:** answer only from the saved source and note content; state when the answer is not present. RAG/pgvector is a later enhancement if documents exceed practical prompt context.

### 5.10 Errors, empty states and notifications

- Every async generation state must be visible: Queued, Extracting, Understanding, Planning visuals, Building scene, Rendering preview, Saving, Completed, Failed, Cancelled.
- Failure messages must be actionable and safe. Show a request ID for support; never show provider API keys, raw stack traces or internal filesystem paths.
- If a generation partially succeeds, explain what is available and let the user retry the failed stage when safe.
- Provide toast feedback for saved, moved, renamed, exported and deleted actions.
- Use skeletons for loading library cards and clear empty states for library, folders, versions and search.

---

## 6. User journeys and screen behaviour

### 6.1 Journey A: prompt to saved visual

1. User opens landing page and clicks Create. If unauthenticated, sign-up/sign-in is requested before generation.
2. User enters a topic, selects “Explain visually”, chooses level and desired depth, then clicks Generate.
3. Frontend sends `POST /api/v1/generations` with prompt and settings. Backend verifies session and quota, creates job, and returns job ID.
4. Frontend opens generation progress screen and subscribes to job events (SSE) with polling fallback.
5. Worker calls Gemini for a structured learning plan, validates it, builds Mermaid or intermediate scene schema, composes the Excalidraw scene, then creates preview exports.
6. Frontend loads generated scene into editor and displays title, learning objectives, overview and outline.
7. User adjusts a label, autosave confirms, then clicks Save to library.
8. Note appears in library; user can reopen, export or continue editing.

### 6.2 Journey B: PDF to visual notes

1. User selects PDF input and uploads a file into the private source-files bucket using authenticated Supabase Storage access.
2. Backend registers metadata and verifies ownership, MIME, size and processing limits.
3. User selects pages or accepts all pages, previews extracted text/page thumbnails and starts generation.
4. Extraction pipeline uses text extraction for digital text and multimodal PDF/vision processing for visual or scanned content where required.
5. Planner builds topic hierarchy, preserves page references and splits long content into manageable visual sections.
6. Worker generates one or more scenes; user reviews output and warnings before saving.
7. Source file remains associated with the note until the user deletes it or removes source retention.

### 6.3 Journey C: profile and library management

1. User opens profile settings and updates display name, username, bio or avatar.
2. Avatar is uploaded to the user-scoped avatar path; profile row stores the storage path rather than a permanent signed URL.
3. User opens library, filters by subject/tag/folder, searches by title and opens a saved note.
4. User renames, duplicates, moves, favourites, archives or deletes the note; ownership is enforced by RLS and API checks.
5. User can inspect version history and restore a snapshot as a new current version.

### 6.4 Main editor layout

| Region | Purpose | Expected behaviour |
| :--- | :--- | :--- |
| **Top bar** | Title, save status, undo/redo, export and exit. | Save state is explicit; export actions are easy to discover; exit warns if unsaved changes remain. |
| **Left panel** | Learning outline, pages/frames and source references. | Selecting a section navigates to its scene; page order can be changed in P1. |
| **Canvas** | Embedded Excalidraw editor. | Primary editing surface; responsive; keyboard shortcuts preserved where possible. |
| **Right panel** | AI study assistant and explanation. | Explain selected element, simplify, examples and regeneration controls; collapsible on smaller screens. |
| **Bottom/status area** | Zoom, current page and generation/version info. | Shows page count and last saved version without crowding the canvas. |

---

## 7. Application routes and navigation

Use React Router. Routes marked “protected” require an initialised Supabase session. The app shell should be shared by dashboard, create, editor, library and profile pages.

| Route | Access | Page / purpose |
| :--- | :--- | :--- |
| `/` | Public | Landing page: value proposition, sample visuals, feature overview, CTA. |
| `/features` | Public | Feature explanations and supported input/output formats. |
| `/pricing` | Public / optional | Plan information only when billing exists; otherwise omit or show early-access details. |
| `/login` | Public | Email/password and Google sign-in. |
| `/signup` | Public | Create account and email verification state. |
| `/forgot-password` | Public | Request password reset. |
| `/reset-password` | Public callback | Set new password after recovery flow. |
| `/auth/callback` | Public callback | Complete OAuth/email link and redirect safely. |
| `/app` | Protected | Dashboard and recent activity. |
| `/app/create` | Protected | Prompt/PDF/image creation screen. |
| `/app/generations/:jobId` | Protected | Live job progress and completed result hand-off. |
| `/app/notes` | Protected | Notes library with search, folder, tag and sort filters. |
| `/app/notes/:noteId` | Protected | Read/revision view of saved note. |
| `/app/notes/:noteId/edit` | Protected | Full Excalidraw editor and AI side panel. |
| `/app/notes/:noteId/present` | Protected | Presentation mode for multi-frame notes. |
| `/app/folders/:folderId` | Protected | Folder-specific library view. |
| `/app/profile` | Protected | Public-facing profile fields and avatar. |
| `/app/settings` | Protected | Settings overview. |
| `/app/settings/account` | Protected | Email, password, sessions, delete account. |
| `/app/settings/preferences` | Protected | Theme, default export, learning level. |
| `/privacy` | Public | Privacy and content handling policy. |
| `/terms` | Public | Terms of service and acceptable use. |
| `/404` | Any | Not-found screen with safe route back to app. |

### 7.1 Route and navigation rules

- Unauthenticated visits to `/app/*` redirect to `/login` with a validated `returnTo` path.
- Authenticated visits to `/login` or `/signup` redirect to `/app` unless completing a recovery flow.
- Never trust a user-provided `returnTo` URL; allow only same-origin app paths.
- Editor route fetches note ownership and current version before loading canvas.
- Unknown or inaccessible note IDs should return a consistent not-found state rather than reveal whether another user owns the ID.
- Use nested app layout with persistent navigation: Dashboard, Create, My Notes, Profile/Settings.

---

## 8. System architecture and complete tech stack

### 8.1 Recommended stack

| Layer | Technology | Responsibility / reason |
| :--- | :--- | :--- |
| **Frontend framework** | React 18+ with JavaScript (no TypeScript for v1) | Component-driven SPA; familiar, fast to build and deploy. |
| **Build tooling** | Vite | Fast local development and production bundle. |
| **Styling** | Tailwind CSS | Consistent responsive layout and design tokens. |
| **Routing** | React Router | Public/protected routes and nested app shell. |
| **Server-state** | TanStack Query | Caching, request lifecycle, retries and invalidation for API data. |
| **Local UI state** | Zustand or React Context | Editor panel state, modal state, current selections; avoid duplicating server data. |
| **Forms / validation** | React Hook Form + Zod | Client-side feedback; backend must independently validate. |
| **Canvas editor** | @excalidraw/excalidraw | Embedded, editable drawing workspace; import the official CSS. |
| **HTTP / live updates** | fetch or Axios + Server-Sent Events | REST API calls and generation progress streaming. |
| **Backend runtime** | Node.js 22+ + Express | REST API, auth verification, job orchestration and file processing. |
| **Validation / security** | Zod, Helmet, express-rate-limit, CORS allowlist | Input validation, security headers, rate limits and controlled origins. |
| **AI model** | Gemini API via official Google GenAI JS SDK | Multimodal understanding and schema-constrained generation. |
| **Document processing** | pdfjs-dist or maintained PDF parser; Sharp for images | Extract text/page information and preprocess images. |
| **Diagram syntax** | Mermaid | Structured diagrams that fit supported graph types. |
| **Scene conversion / export** | @excalidraw/cli | Mermaid-to-Excalidraw conversion; local PNG/SVG rendering. |
| **Rendering browser** | Chromium/Chrome installed in worker container | Required by CLI local conversion and render operations. |
| **Database** | Supabase Postgres | Profiles, notes, versions, folders, source metadata, jobs and usage. |
| **Authentication** | Supabase Auth | Email/password, OAuth, sessions and recovery. |
| **Object storage** | Supabase Storage | Private source uploads, avatars, previews and downloadable assets. |
| **Background queue** | BullMQ + Redis (Upstash/managed Redis or Render Key Value) | Reliable asynchronous generation/rendering and retries. |
| **Frontend hosting** | Vercel | Deploy Vite SPA and connect custom domain. |
| **API + worker hosting** | Render Docker services | Express API and separate background worker with Chromium dependency. |
| **Monitoring** | Sentry + structured JSON logs | Frontend/backend exception visibility and request correlation. |
| **Testing** | Vitest, Supertest, Playwright | Unit, API integration and browser end-to-end tests. |
| **Source control / CI** | GitHub + GitHub Actions | Lint, test, build and deploy gates. |

### 8.2 High-level architecture

```text
React SPA (Vercel)
 |-- Supabase Auth SDK ----------------------> Supabase Auth
 |-- Supabase client (publishable key) ------> Postgres + Storage (RLS)
 |-- HTTPS REST + SSE -----------------------> Express API (Render)
 |-- verifies Supabase JWT
 |-- creates generation job
 |-- reads/writes user-owned data
 |-- enqueues BullMQ job
 v
 Redis / BullMQ
 |
 v
 Generation Worker (Render Docker)
 |-- fetches private source file
 |-- extracts PDF/image content
 |-- calls Gemini API
 |-- validates learning plan
 |-- builds Mermaid / scene schema
 |-- invokes Excalidraw CLI + Chromium
 |-- stores scene + exports in Supabase
 |
 v
 Supabase Postgres + private Storage
 |
 v
 React editor loads saved scene JSON
```

*Architectural rule: the browser never receives Gemini API keys, Supabase service-role credentials, Redis credentials or Excalidraw+ workspace keys. The frontend uses only the Supabase publishable key and the authenticated user session.*

### 8.3 Frontend package plan

```bash
# frontend
npm install react react-dom react-router-dom
npm install @supabase/supabase-js @excalidraw/excalidraw
npm install @tanstack/react-query zustand axios
npm install react-hook-form zod @hookform/resolvers
npm install lucide-react clsx tailwind-merge
npm install -D vite tailwindcss vitest @playwright/test
```

Pin compatible package versions in `package-lock.json`. Excalidraw requires its CSS import and a parent container with non-zero height. Render the editor client-side; if the application later moves to an SSR framework, load the editor dynamically with SSR disabled. [S3]

### 8.4 Backend package plan

```bash
# backend (illustrative package set)
npm install express cors helmet express-rate-limit
npm install @supabase/supabase-js @google/genai
npm install zod multer file-type pdfjs-dist sharp
npm install bullmq ioredis
npm install pino pino-http
npm install -D vitest supertest
```

The exact PDF parser and image-processing packages should be selected after a proof of concept against digital PDFs, scanned PDFs and rotated handwritten images. Do not assume text extraction alone can understand embedded diagrams or handwriting.

### 8.5 Suggested repository layout

```text
visualify/
 frontend/
 src/
 app/ # router, providers, guards
 components/ # shared UI components
 features/
 auth/ profile/ create/ editor/ library/ learning/
 lib/ # supabase client, API client, schemas
 hooks/ styles/ utils/
 backend/
 src/
 config/ middleware/ routes/ controllers/
 services/ # auth, storage, gemini, extraction
 generation/
 planner/ adapters/ validation/ render/
 workers/ # BullMQ processors
 repositories/ # DB access layer
 utils/
 Dockerfile
 supabase/
 migrations/
 seed.sql
 docs/
 prompts/ schemas/ architecture/
 .github/workflows/
```

---

## 9. AI generation pipeline and visual strategy

### 9.1 Pipeline stages

| Stage | Operation | Output / failure behaviour |
| :--- | :--- | :--- |
| **1. Intake** | Validate auth, quota, prompt/file metadata, settings and consent. | Generation job ID; reject unsupported or oversized input before expensive work. |
| **2. Source extraction** | Prompt normalisation; PDF text/page extraction; multimodal image/PDF understanding as needed. | Normalized source bundle with page references, detected language and extraction warnings. |
| **3. Content planning** | Gemini identifies topic, objectives, concepts, definitions, examples, sequence and relationships. | Versioned learning-plan JSON validated with Zod. |
| **4. Visual planning** | Choose layout per section: flow, sequence, map, comparison, timeline, ER/class or annotated board. | Diagram specification with complexity budget, labels and reading order. |
| **5. Scene composition** | Generate Mermaid for compatible diagrams; otherwise map constrained internal schema into Excalidraw elements. | Editable .excalidraw-compatible scene JSON. |
| **6. Validation** | Validate element count, text size, coordinates, IDs, references and output schema. | Valid scene or one bounded repair/retry; never render arbitrary unvalidated model output. |
| **7. Rendering** | Invoke Excalidraw CLI in isolated worker to create PNG/SVG preview and thumbnails. | Export files and dimensions; bounded timeout and cleanup. |
| **8. Persistence** | Save job state, learning plan, scene version, source links and storage paths. | Completed note/version and asset metadata. |
| **9. Delivery** | Notify frontend through SSE/polling. | Editor receives scene, explanation, warnings and preview paths. |

### 9.2 AI planning contract

The first model call should return a compact, machine-readable learning plan, not raw Excalidraw JSON. Example contract (illustrative; implement as a versioned Zod schema):

```json
{
 "schemaVersion": "1.0",
 "title": "TCP Three-Way Handshake",
 "summary": "How a client and server establish a TCP connection.",
 "learningObjectives": ["Identify SYN, SYN-ACK and ACK"],
 "sections": [
 {
 "id": "connection-sequence",
 "title": "Connection establishment",
 "visualType": "sequence",
 "keyConcepts": ["client", "server", "SYN", "SYN-ACK", "ACK"],
 "relationships": [
 {"from": "client", "to": "server", "label": "SYN"},
 {"from": "server", "to": "client", "label": "SYN-ACK"}
 ],
 "explanation": "The client requests a connection...",
 "sourceRefs": [{"page": 4, "snippet": "..."}]
 }
 ],
 "warnings": []
}
```

### 9.3 Visual type decision rules

| Visual type | Use when | Preferred implementation |
| :--- | :--- | :--- |
| **Flowchart** | A process has decisions, branches or ordered actions. | Mermaid flowchart → editable Excalidraw scene. |
| **Sequence diagram** | Entities exchange messages over time. | Mermaid sequence → scene; ensure message labels stay readable. |
| **Mind map / concept map** | One central topic branches into categories and subtopics. | Constrained node-edge schema → direct Excalidraw scene. |
| **Comparison board** | Two or more concepts differ across common dimensions. | Direct layout schema with aligned columns/cards. |
| **Timeline** | Events, versions or stages have chronological order. | Mermaid timeline when suitable; otherwise direct scene schema. |
| **ER / class diagram** | Entities, attributes, methods and relationships matter. | Mermaid ER/class where supported. |
| **Annotated illustration** | A process depends on spatial parts or labels around an object. | Direct scene schema; use image elements only when asset sourcing is permitted. |
| **Multi-frame lesson** | A topic is too dense for one canvas. | Multiple ordered Excalidraw frames/scenes with an outline. |

> **Key engineering decision:** Do not ask the LLM to freely emit a full arbitrary Excalidraw scene as the only generation format. Have it produce a constrained intermediate learning/diagram schema, validate that schema, and let deterministic code build the scene. This lowers malformed-scene risk and makes visual quality easier to improve.

### 9.4 Mermaid and CLI usage

Use the CLI for two focused jobs: (a) convert Mermaid into editable Excalidraw elements and (b) render validated scene files to PNG/SVG. Local `mermaid` and `render` do not require an Excalidraw+ account. The CLI requires Node.js 22+ and an installed browser; the worker container must include Chromium/Chrome and configure its path. [S1][S2]

```bash
# Mermaid source -> editable scene
npx @excalidraw/cli mermaid flow.mmd --out flow.excalidraw

# Scene -> PNG / SVG
npx @excalidraw/cli render flow.excalidraw --out preview.png
npx @excalidraw/cli render flow.excalidraw --out preview.svg

# Multi-frame scene -> ordered image files
npx @excalidraw/cli render lesson.excalidraw --all-frames --out slides/
```

Supported Mermaid diagram types include flowcharts, sequence, class, ER and state diagrams, Gantt charts, quadrant charts and timelines. Some chart types, such as pie charts, may become a single image instead of individually editable elements. The product should disclose or account for this difference. [S2]

### 9.5 Input-specific processing

- **Prompt:** Send prompt plus explicit constraints (audience level, length, style, output count) to the planner.
- **Text PDF:** Extract selectable text and page positions; chunk by page/heading; retain sourceRefs for traceability.
- **Scanned PDF:** Use a vision-capable PDF workflow or rasterize selected pages and run OCR/vision; communicate lower confidence where text is unclear.
- **Image:** Preprocess orientation, size and quality; call multimodal model for handwriting, labels, tables and diagrams; retain an extraction summary for user review.
- **Long material:** Generate a global outline first, then produce visual sections independently while sharing the approved concept map. Avoid one giant prompt that yields an unreadable canvas.

### 9.6 Model reliability and prompt safety

- Use structured outputs / JSON schema where supported; validate again in backend code. Gemini supports schema-constrained structured outputs, including multimodal inputs. [S4]
- Pin model IDs in server configuration and keep a model-change evaluation set; never hardcode model identifiers in frontend code.
- Treat uploaded documents and extracted text as untrusted content, not as system instructions. Ignore instructions embedded in source material that attempt to override application policy.
- Ask for source-grounded diagrams. When a fact is not in the input and is not safe to infer, label it as general context or omit it.
- Limit scene element count, total text length, number of frames and retry attempts. A complex 40-page source should be split rather than rendered as one enormous board.
- Log prompt template version, model ID, schema version, latency and token/cost metadata without storing sensitive raw source content in ordinary logs.

---

## 10. Data model and Supabase design

### 10.1 Supabase responsibilities

- **Supabase Auth:** user identity, email/password, OAuth, session lifecycle and recovery.
- **Supabase Postgres:** profile metadata, notes, folders, source records, jobs, versions, export metadata and usage.
- **Supabase Storage:** private uploaded source files, generated previews/exports and avatars.
- **Row Level Security:** enforce row ownership for every exposed table and file path.
- **Postgres migrations:** all schema, index, trigger and RLS changes are version-controlled under `/supabase/migrations`.

Supabase Auth issues user sessions/tokens that can be used with RLS-protected database access. Create a separate `public.profiles` table linked to `auth.users`; do not expose or modify the managed auth schema directly. [S5][S6]

### 10.2 Proposed tables

| Table | Important columns | Purpose / constraints |
| :--- | :--- | :--- |
| `profiles` | `id` UUID PK → `auth.users.id`; `display_name`; `username` UNIQUE; `avatar_path`; `bio`; `preferences` JSONB; `created_at`; `updated_at` | One profile per Auth user. `id` is the ownership key. |
| `folders` | `id` UUID PK; `owner_id`; `name`; `parent_id` nullable; `sort_order`; `created_at` | User-created folders; parent folder must belong to same owner. |
| `notes` | `id` UUID PK; `owner_id`; `folder_id` nullable; `title`; `description`; `subject`; `topic`; `tags` TEXT[]; `is_favorite`; `is_archived`; `visibility`; `current_version_id`; `source_type`; `created_at`; `updated_at`; `last_opened_at` | Library item. Default visibility private. Index owner, updated_at, title and folder. |
| `note_versions` | `id` UUID PK; `note_id`; `owner_id`; `version_number`; `scene_json` JSONB; `learning_plan` JSONB; `mermaid_source` TEXT nullable; `schema_version`; `created_by_job_id`; `created_at` | Immutable snapshots. Unique(`note_id`, `version_number`). |
| `source_files` | `id` UUID PK; `owner_id`; `note_id` nullable; `bucket`; `object_path`; `original_name`; `mime_type`; `size_bytes`; `checksum`; `page_count`; `extraction_status`; `created_at` | Metadata only; binary lives in private Storage. |
| `generation_jobs` | `id` UUID PK; `owner_id`; `note_id` nullable; `source_file_id` nullable; `input_type`; `input_text` nullable; `settings` JSONB; `status`; `stage`; `progress`; `error_code`; `safe_error_message`; `model_id`; `prompt_version`; `usage` JSONB; `created_at`; `started_at`; `finished_at` | Tracks asynchronous job lifecycle; index owner/status/created_at. |
| `note_exports` | `id` UUID PK; `owner_id`; `note_id`; `version_id`; `format`; `bucket`; `object_path`; `width`; `height`; `created_at` | Export metadata and private Storage location. |
| `usage_events` | `id` UUID PK; `owner_id`; `event_type`; `units`; `metadata` JSONB; `created_at` | Auditing and quota accounting. Avoid storing raw prompt/file content. |

### 10.3 Relationships

```text
auth.users 1 ---- 1 profiles
profiles 1 ---- N folders
profiles 1 ---- N notes
folders 1 ---- N notes
notes 1 ---- N note_versions
notes 1 ---- N source_files
notes 1 ---- N note_exports
profiles 1 ---- N generation_jobs
profiles 1 ---- N usage_events
```

### 10.4 Database rules

- Use UUID primary keys and timestamptz timestamps stored in UTC.
- Use `ON DELETE CASCADE` for user-owned records where deletion should remove the child rows; explicitly handle Storage object deletion because database row deletion does not automatically remove binary objects.
- Use `unique(owner_id, lower(username))` or a normalised username column with a unique constraint if usernames are case-insensitive.
- Use `unique(note_id, version_number)` for immutable version sequencing.
- Add indexes to every ownership filter and frequently used sort/search field. Consider Postgres full-text search for title/description before adding a dedicated search service.
- Keep scene JSONB in Postgres for direct editor hydration. Store heavyweight rendered PNG/SVG and original source files in Storage, not as database blobs.
- Store Storage object paths, not expiring signed URLs, in database rows. Generate signed URLs when the user needs to access a private file.

### 10.5 Row Level Security requirements

> **Mandatory baseline:** Enable RLS on every table exposed through the Supabase Data API. Define explicit SELECT, INSERT, UPDATE and DELETE policies. Grants and policies are separate controls; RLS policies alone do not revoke unnecessary table privileges. Keep `service_role` credentials server-side only. [S7]

```sql
-- Illustrative ownership policy for notes
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own notes"
ON public.notes FOR SELECT TO authenticated
USING ((select auth.uid()) = owner_id);

CREATE POLICY "Users can create their own notes"
ON public.notes FOR INSERT TO authenticated
WITH CHECK ((select auth.uid()) = owner_id);

CREATE POLICY "Users can update their own notes"
ON public.notes FOR UPDATE TO authenticated
USING ((select auth.uid()) = owner_id)
WITH CHECK ((select auth.uid()) = owner_id);

CREATE POLICY "Users can delete their own notes"
ON public.notes FOR DELETE TO authenticated
USING ((select auth.uid()) = owner_id);
```

Apply the same ownership rule to `folders`, `source_files`, `generation_jobs`, `note_exports`, `usage_events` and `profile` rows. For child records such as `note_versions`, verify ownership through the parent note or maintain a redundant `owner_id` and enforce consistency with foreign keys/triggers. Test cross-user reads/writes explicitly. [S7]

### 10.6 Storage buckets and object paths

| Bucket | Visibility | Object path convention | Contents |
| :--- | :--- | :--- | :--- |
| `avatars` | Private (signed URLs) | `{uid}/avatar-{uuid}.webp` | Profile image uploads. |
| `source-files` | Private | `{uid}/{sourceFileId}/original.ext` | User-uploaded PDF and image source files. |
| `note-assets` | Private | `{uid}/{noteId}/{versionId}/preview.png` | Thumbnails and preview images. |
| `note-exports` | Private | `{uid}/{noteId}/{versionId}/export.ext` | PNG, SVG, PDF or ZIP downloads. |

Use `storage.objects` policies to scope file operations to the authenticated user and path prefix. Supabase Storage denies uploads without the relevant RLS policy. Private files should be delivered through short-lived signed URLs after ownership checks. [S8][S9]

```sql
-- Example path ownership predicate for a private bucket
(bucket_id = 'source-files')
AND (storage.foldername(name))[1] = (select auth.uid())::text
```

Do not rely on the object path alone as the only authorisation check in backend code. Confirm the corresponding database record belongs to the same user before processing or issuing a download URL.

### 10.7 Profile creation trigger

Create the profile row when an Auth user is inserted. Keep the trigger function minimal, use a safe search_path, and test sign-up if the trigger fails because a database trigger error can block account creation. [S6]

```sql
-- Illustrative only; adapt columns and grants to the migration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
 INSERT INTO public.profiles (id, display_name)
 VALUES (new.id, COALESCE(new.raw_user_meta_data ->> 'display_name', ''));
 RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

---

## 11. API contract

Authentication: all `/api/v1` routes except health and public metadata require `Authorization: Bearer <Supabase access token>`. The Express API verifies the token with Supabase Auth before using the user ID. Do not trust `owner_id` sent in request bodies; derive it from the verified session.

| Method / Path | Purpose | Request / response notes |
| :--- | :--- | :--- |
| `GET /api/v1/health` | Liveness/readiness endpoint. | No secrets; report API and critical dependency readiness without exposing internal details. |
| `GET /api/v1/me` | Return profile and safe usage summary. | Profile derived from verified user ID. |
| `PATCH /api/v1/me` | Update profile metadata. | Allowlisted fields only; avatar uses Storage path. |
| `POST /api/v1/generations` | Create generation job. | Body: inputType, prompt or sourceFileId, settings; response: jobId, status. |
| `GET /api/v1/generations/:jobId` | Fetch current job state. | Only job owner; includes stage, progress, safe error and result note ID. |
| `GET /api/v1/generations/:jobId/events` | Stream progress via SSE. | SSE events: queued, stage, progress, completed, failed, cancelled; reconnect supported. |
| `POST /api/v1/generations/:jobId/cancel` | Cancel job. | Only owner; idempotent. |
| `POST /api/v1/generations/:jobId/retry` | Retry a recoverable failed job. | Creates a new attempt or job linked to prior job; obey retry/usage rules. |
| `GET /api/v1/notes` | List/filter/sort notes. | Query: q, folderId, tags, favorite, archived, sort, cursor, limit. |
| `POST /api/v1/notes` | Create/save a note from completed result. | Body: jobId, title, folderId; backend confirms job ownership and result completeness. |
| `GET /api/v1/notes/:noteId` | Fetch note + current version metadata. | Do not return huge binary assets; return signed preview URL if authorised. |
| `PATCH /api/v1/notes/:noteId` | Rename, move, update tags/favorite/archive. | Allowlisted metadata patch. |
| `DELETE /api/v1/notes/:noteId` | Delete note and schedule Storage cleanup. | Soft-delete optional; confirm at UI. Ensure child rows and objects are removed. |
| `GET /api/v1/notes/:noteId/versions` | List versions. | Newest first; owner only. |
| `POST /api/v1/notes/:noteId/versions` | Save current editor scene as new version. | Body includes sceneJson and optional description; validate size/schema. |
| `GET /api/v1/notes/:noteId/versions/:versionId` | Fetch specific version. | Ownership check through parent note. |
| `POST /api/v1/notes/:noteId/restore/:versionId` | Restore snapshot as a new current version. | Never destructively overwrite historical version. |
| `POST /api/v1/notes/:noteId/exports` | Request PNG/SVG/PDF/ZIP export. | Queued job; returns exportJobId. |
| `GET /api/v1/exports/:exportId` | Get export status and signed download URL. | Only owner; signed URL short expiry. |
| `GET /api/v1/folders` | List folders. | Current user only. |
| `POST /api/v1/folders` | Create folder. | Validate name and parent ownership. |
| `PATCH /api/v1/folders/:folderId` | Rename/reorder/move folder. | Prevent circular parent references. |
| `DELETE /api/v1/folders/:folderId` | Delete folder. | Choose policy: move contained notes to root, or ask user before delete. |
| `POST /api/v1/notes/:noteId/explain` | Explain selected element. | P1; body: selected element summary and user question. |
| `POST /api/v1/notes/:noteId/quiz` | Generate quiz from note. | P1; return validated question schema. |
| `POST /api/v1/notes/:noteId/flashcards` | Generate flashcards. | P1; return front/back cards tied to current version. |

### 11.1 Standard response envelope

```json
{
 "success": true,
 "data": { "jobId": "uuid", "status": "queued" },
 "error": null,
 "meta": { "requestId": "req_..." }
}
```

```json
{
 "success": false,
 "data": null,
 "error": {
 "code": "FILE_TOO_LARGE",
 "message": "This file exceeds the current upload limit.",
 "details": null
 },
 "meta": { "requestId": "req_..." }
}
```

### 11.2 Job state machine

```text
queued -> validating -> extracting -> planning -> composing
 -> rendering -> persisting -> completed

Any active state -> cancelling -> cancelled
Any active state -> failed
failed -> retrying (new attempt or linked retry job)
```

Progress is a UX signal, not an exact percentage of compute. Use stage-weighted progress and never let it move backwards. SSE should send a heartbeat and support reconnection with Last-Event-ID or the client can fall back to polling `GET /generations/:jobId`.

### 11.3 Example generation request

```http
POST /api/v1/generations
Authorization: Bearer <supabase_access_token>
Content-Type: application/json

{
 "inputType": "prompt",
 "prompt": "Explain database normalization with examples",
 "settings": {
 "audienceLevel": "undergraduate",
 "detail": "standard",
 "visualStyle": "hand_drawn_clean",
 "preferredOutput": "auto",
 "includeExamples": true,
 "targetPages": 3
 }
}
```

---

## 12. Security, privacy and reliability requirements

### 12.1 Authentication and authorisation

- All API endpoints that expose user content require a valid Supabase access token.
- Backend verifies token and derives user ID from the verified user; never accept `owner_id` as authoritative request input.
- RLS protects database rows even if frontend code or API query filters are bypassed.
- Keep Supabase service-role key, Gemini key and Redis credentials only in server/worker secrets.
- Use separate Supabase projects for development/staging and production where practical.
- Implement explicit owner checks in service layer as defence in depth, in addition to RLS.

### 12.2 File upload and processing security

- Allowlist MIME types and verify file signatures; do not trust extension or browser-provided content-type alone.
- Enforce maximum size, PDF page count, image pixel dimensions and decompression limits before model calls.
- Use random object names; retain original file name only as metadata and sanitise it for display.
- Store uploads in private buckets and use short-lived signed URLs for downloads.
- Process files in worker temporary directories created per job; never concatenate user file names into shell commands.
- Invoke CLI with `spawn`/`execFile` argument arrays, not shell interpolation; set strict timeouts, memory/CPU limits and concurrency caps.
- Clean temporary files on success, failure, timeout and cancellation.
- Consider malware scanning and abuse detection before public launch; never serve uploaded files as executable content.

### 12.3 AI and prompt injection safeguards

- Treat text inside PDF/image as untrusted source data, not system/developer instructions.
- Keep system prompts, schemas and tools server-side. Do not permit user content to select arbitrary tools, file paths, URLs or shell commands.
- Use schema validation and hard limits for model outputs. Reject invalid element types and external asset URLs unless explicitly permitted.
- Do not let a model-generated scene reference local filesystem paths or arbitrary remote network resources.
- Use content filters and abuse/rate policies appropriate to a student-facing service; provide a report mechanism if generated content is harmful or misleading.

### 12.4 Privacy and data retention

- Publish clear privacy notice describing what source files and prompts are sent to the configured AI provider.
- Define retention for source files, generated previews, exports, failed job temp artifacts and logs.
- Let users delete individual notes and source files; account deletion removes owned rows and schedules object cleanup.
- Do not log raw prompts, PDF text, image bytes, private signed URLs or access tokens in production logs.
- Do not use private user content for model training unless there is a separate, explicit and informed opt-in.
- Provide data export or account deletion process before broad public launch.

### 12.5 Operational resilience

- Generation jobs are idempotent where possible and carry attempt counters; repeated queue delivery must not create duplicate notes unintentionally.
- Use bounded retries with exponential backoff for transient provider/network errors; do not retry invalid user input.
- Worker health checks verify Redis, Supabase and browser availability.
- Use timeouts for model calls, file extraction, CLI rendering and SSE connections.
- Gracefully degrade: if preview rendering fails but scene JSON is valid, offer editor access and a retry-export option.
- Keep a dead-letter or failed-job inspection path for operator diagnosis without exposing user content.

---

## 13. UX, accessibility and responsive requirements

### 13.1 Visual design direction

- Use a clean, bright learning-workspace aesthetic with warm neutral canvas surroundings and a restrained accent palette.
- Keep the Excalidraw canvas visually central; use panels and cards to support the learning flow rather than overwhelm it.
- Use clear hierarchy, concise labels, visible save status and meaningful progress states.
- Generated diagrams should default to readable contrast and generous spacing; avoid placing explanatory paragraphs inside tiny shapes.
- Offer light/dark editor themes where supported, but keep the generated diagram theme and app theme decisions separate.

### 13.2 Responsive behaviour

| Viewport | Required behaviour |
| :--- | :--- |
| **Desktop ≥ 1200px** | Full three-panel editor: outline left, canvas centre, assistant right. Library grid 3–4 columns. |
| **Tablet 768–1199px** | Collapsible side panels; canvas gets priority; assistant becomes a drawer/tab. Library grid 2 columns. |
| **Mobile < 768px** | Mobile-first create form and library list. Editor may use simplified read/edit mode with explicit “best on larger screen” notice if full editing is impractical. Never make core navigation inaccessible. |

### 13.3 Accessibility

- All controls have visible focus states, accessible names and keyboard operation.
- Use semantic headings, landmarks, labels and error associations.
- Do not convey job status or validation errors using colour alone.
- Provide text summaries/outline for diagrams so users are not forced to interpret the canvas visually.
- Ensure contrast meets WCAG 2.2 AA targets for normal text and interactive controls.
- Respect reduced-motion preferences and avoid flashing progress animations.

---

## 14. Analytics, success metrics and quality evaluation

### 14.1 Product metrics

| Metric | Definition | Why it matters |
| :--- | :--- | :--- |
| **Activation rate** | New users who complete first successful visual generation and save it within 24 hours. | Measures whether the core value is reached. |
| **Generation completion rate** | Completed generation jobs / eligible started jobs. | Measures pipeline reliability. |
| **Time to first useful visual** | Time from generation request to first editable scene preview. | Measures perceived speed. |
| **Save rate** | Completed generations saved to library. | Measures value beyond one-off novelty. |
| **7-day library return** | Users who reopen a saved note within 7 days. | Measures ongoing study utility. |
| **Export rate** | Saved notes with at least one export. | Measures practical usefulness. |
| **Edit engagement** | Share of generated notes receiving a manual edit. | Measures whether editability is used. |
| **Regeneration rate** | Jobs requiring repair/regeneration or user-triggered rerun. | Signals quality or prompt design problems. |
| **Cost per completed visual** | AI + rendering cost divided by successful generation. | Supports quotas and future pricing decisions. |

### 14.2 AI visual quality rubric

| Dimension | Evaluation question | Target behaviour |
| :--- | :--- | :--- |
| **Correctness** | Are facts, labels, relationships and sequences accurate to the source? | No fabricated core claims; uncertainty surfaced. |
| **Coverage** | Are the important concepts represented? | Main concepts included; low-value details omitted intentionally. |
| **Hierarchy** | Can a student understand the reading order? | Clear title, grouping, flow and visual emphasis. |
| **Legibility** | Can the text be read at normal zoom? | No clipping, excessive density or tiny labels. |
| **Visual fit** | Does the chosen diagram type match the concept? | A timeline for chronology, sequence for message exchange, etc. |
| **Editability** | Does the output remain a useful editable scene? | Core shapes/arrows/text are individual elements where supported. |
| **Traceability** | Can users see which source page supports a concept? | Page refs shown when source material supports them. |

Create a small evaluation set before expanding features: 10 prompts, 10 digital PDFs, 10 scanned/image inputs, and representative topics across programming, databases, networking, biology and history. Review outputs manually against the rubric and track regressions when prompts/models change.

### 14.3 Event tracking

- `auth_signup_completed`
- `onboarding_completed`
- `generation_started`
- `generation_stage_changed`
- `generation_completed`
- `generation_failed`
- `note_saved`
- `note_opened`
- `note_edited`
- `note_version_restored`
- `note_exported`
- `folder_created`
- `source_deleted`
- `account_deleted`

Store minimal product analytics. Do not include raw prompts, filenames, source text, private note titles or email addresses in event payloads unless strictly necessary and disclosed.

---

## 15. Testing and acceptance strategy

### 15.1 Test layers

| Layer | Tooling | Coverage |
| :--- | :--- | :--- |
| **Unit** | Vitest | Schema validators, diagram planner adapters, path helpers, quota logic, prompt builders, state reducers. |
| **API integration** | Supertest + test Supabase project | Auth middleware, ownership checks, validation, CRUD, job state transitions and error envelope. |
| **Database security** | Supabase local/test project + SQL tests | RLS policies for each table and Storage bucket; cross-user access must fail. |
| **Worker integration** | Mock Gemini/Redis + test files | Extraction, retry, cancellation, idempotency, timeout and temp-file cleanup. |
| **Rendering integration** | Container with Chromium and CLI | Mermaid -> .excalidraw; scene -> PNG/SVG; multi-frame output. |
| **End-to-end** | Playwright | Signup/login, generate prompt, edit, autosave, save to library, reopen, export and delete. |
| **AI evaluation** | Versioned fixtures + human rubric | Correctness, coverage, visual fit, legibility and source traceability. |

### 15.2 Must-pass launch scenarios

1. User A signs up; profile row exists; User B cannot read or modify A’s profile.
2. User A uploads a PDF; User B cannot list, download or process A’s source object.
3. User enters a valid prompt; job reaches completed; returned scene opens in Excalidraw.
4. User edits a shape; save status reaches Saved; refresh restores the edit.
5. User saves note; note appears in library and can be searched by title/tag.
6. User exports PNG/SVG/.excalidraw; downloads open and render correctly.
7. Invalid Mermaid or malformed model output does not crash worker; bounded repair/fallback is used.
8. Worker restarts mid-job; job can recover or fail with a safe actionable state without duplicate notes.
9. User cancels a queued job; no expensive model call is made.
10. User deletes a note; associated source/export objects are removed or queued for cleanup.
11. Generation provider times out; UI shows failed/retry state and no raw provider error.
12. Rate limit/quota is reached; API rejects request before model execution and UI explains next step.

---

## 16. Deployment, environments and operations

### 16.1 Environments

| Environment | Services | Rules |
| :--- | :--- | :--- |
| **Local** | Vite frontend, Express API, worker, local Redis or managed dev Redis, Supabase local/dev project, local Chromium. | Use `.env.local` files ignored by Git; seed test accounts and sample notes. |
| **Staging** | Vercel preview, Render staging API/worker, staging Supabase project, staging Redis. | Run migrations, RLS tests and smoke tests before production promotion. |
| **Production** | Vercel frontend, Render API service, Render background worker, managed Redis, Supabase production. | Secrets stored in host secret manager; no debug logs; alerts and backups enabled. |

### 16.2 Render worker requirement

Because the CLI relies on a local browser for Mermaid conversion/rendering, do not assume a minimal Node runtime has Chromium installed. Use a Docker-based worker image with Node.js 22+, the CLI and a supported browser binary, plus required fonts. Configure `EXCALIDRAW_BROWSER_PATH` explicitly if auto-discovery is unreliable. The API service does not need to render diagrams; keep the heavy browser workload in a separate worker service. [S1][S2]

### 16.3 Environment variables

| Variable | Where | Purpose / rule |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Frontend | Supabase project URL; public config. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend | Supabase publishable key; safe for browser when RLS is correctly configured. |
| `VITE_API_BASE_URL` | Frontend | Public API origin. |
| `SUPABASE_URL` | API + worker | Project URL. |
| `SUPABASE_PUBLISHABLE_KEY` | API + worker | Public key used for user-scoped server clients where applicable. |
| `SUPABASE_SERVICE_ROLE_KEY` | API + worker only | Privileged operations only; never expose with `VITE_` prefix. |
| `GEMINI_API_KEY` | Worker only | Model provider credential. |
| `GEMINI_MODEL` | Worker only | Configured model identifier. |
| `REDIS_URL` | API + worker | BullMQ connection. |
| `FRONTEND_ORIGIN` | API | Exact allowed CORS origin(s). |
| `EXCALIDRAW_BROWSER_PATH` | Worker | Absolute Chromium/Chrome/Firefox path. |
| `MAX_UPLOAD_BYTES` | API + worker | Configured upload size limit. |
| `MAX_PDF_PAGES` | Worker | Configured page cap. |
| `GENERATION_LIMIT_MONTHLY` | API | Configurable free-tier limit. |
| `SENTRY_DSN` | Frontend / API | Error monitoring DSN; follow provider guidance. |
| `NODE_ENV` | API + worker | `development` / `staging` / `production`. |

> **Secret handling:** Commit only `.env.example` with variable names and safe placeholders. Never commit real API keys, service-role keys, JWT secrets, Redis URLs or user data.

### 16.4 CI/CD and release gates

- **Pull request:** install dependencies, lint, unit tests, build frontend/backend, run schema validation tests.
- **Staging deploy:** apply migrations, deploy API/worker, deploy frontend preview, run smoke tests and RLS checks.
- **Production release:** manual approval initially; apply backward-compatible migrations first, deploy worker/API, then frontend.
- Pin Node major version and package lockfiles. Keep database migrations idempotent and reviewed.
- Provide rollback strategy for application and worker images; database changes should be additive where possible.

### 16.5 Operations and support

- Log `requestId`, user UUID (not email), `jobId`, stage, duration, model ID, retry count and safe error code.
- Monitor job queue depth, oldest queued job, worker heartbeat, failure rate, render duration, provider latency and cost per generation.
- Alert on sustained queue backlog, repeated render failures, elevated 5xx rate, exhausted provider quota and Redis/Supabase outages.
- Provide an internal admin-only job inspector with redacted details; never expose admin controls to normal users.
- Keep a support workflow where users can share a job ID and timestamp without sharing their source document.

---

## 17. Delivery phases and exit criteria

Suggested order for a solo developer or small team. Time estimates are indicative only; phase exit criteria matter more than calendar duration.

| Phase | Scope | Exit criteria |
| :--- | :--- | :--- |
| **Phase 0: Technical spike** | Verify React Excalidraw embed; generate one Mermaid diagram; CLI conversion; Chromium rendering in Docker; test one Gemini structured response. | Prompt-to-scene proof works locally and in a production-like worker container; key risks documented. |
| **Phase 1: Foundation and identity** | Vite/React app shell, Express API, Supabase project, migrations, RLS, signup/login/Google, profile and avatar. | Authenticated user can edit profile; a second user cannot access first user data; staging environment is live. |
| **Phase 2: Prompt-to-visual MVP** | Create form, Gemini learning planner, schema validation, Mermaid/direct-scene adapter, job queue, SSE progress, Excalidraw viewer/editor. | User enters prompt and receives a valid editable scene with explanation and progress feedback. |
| **Phase 3: Save, library and exports** | Notes CRUD, folders, tags, search, favorites, version history, autosave, PNG/SVG/.excalidraw download. | User can save, reopen, modify, version and export a note; data persists securely. |
| **Phase 4: PDF and image inputs** | Private uploads, extraction, scanned-page/vision handling, source preview, page range selection, source references. | Digital PDF, scanned PDF and photo test sets complete within limits with clear failure/warning handling. |
| **Phase 5: Learning companion** | Multi-frame notes, presentation mode, explain selected node, quizzes, flashcards, revision view. | User can learn from a saved note beyond viewing the diagram; generated quiz content is validated. |
| **Phase 6: Launch hardening** | Quota/rate policies, monitoring, privacy/terms, abuse controls, load tests, accessibility, backup/restore drills. | Launch checklist passes; no known cross-user access issue; failure/retry/cancel paths verified. |
| **Phase 7: Expansion** | RAG/source Q&A, share links, teacher spaces, collaboration, billing. | Only start after product metrics validate demand and infrastructure/cost model is understood. |

### 17.1 Phase-by-phase implementation guidance

#### Phase 0: do not skip the spike
- Embed the Excalidraw React package in a plain Vite page and load a sample scene.
- Run the CLI Mermaid conversion and PNG/SVG render commands locally.
- Build the same CLI flow inside a Docker image with Chromium, not only on a developer laptop.
- Test Gemini output against a strict schema; deliberately test malformed JSON and unsupported diagram types.
- Choose the final Mermaid/direct-scene adapter boundary before building the UI around a single representation.

#### Phase 1–3: build one complete path
- Use a single prompt input and a small set of visual types at first.
- Store scene JSON as the canonical editable version. Store preview PNG/SVG separately in Storage.
- Autosave with debounce and show explicit save errors; do not silently discard local editor changes.
- Ship the notes library and export loop before adding multiple input formats.

#### Phase 4–6: expand inputs and learning
- Test PDF extraction separately from AI generation; extraction quality is its own concern.
- Add source review/preview before generation so users can catch wrong OCR early.
- Build multi-frame generation for long notes rather than forcing a huge board.
- Add learning tools only after scene content and source grounding are reliable.
- Use real cost/latency metrics to set quotas rather than guessing a permanent free-tier allowance.

---

## 18. Risks, decisions and launch checklist

### 18.1 Key risks and mitigations

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| **LLM creates confusing or incorrect visual structures.** | Low trust; poor learning outcomes. | Structured plan, source refs, visual QA rubric, constrained schemas, human edit step and representative evaluation set. |
| **Very large PDFs create slow/expensive jobs.** | Timeouts, high cost and queue backlog. | Page caps, page selection, chunking, staged generation, quotas and cancellation. |
| **CLI browser dependency is missing in hosting.** | Rendering fails in production despite working locally. | Docker worker with pinned Node 22+ and Chromium; smoke-test renderer in CI. |
| **Generated scene JSON is malformed or too dense.** | Editor blank/error or unreadable output. | Intermediate schema, deterministic adapter, validation, element/text budgets and safe fallback. |
| **RLS or Storage policy misconfiguration leaks private notes/files.** | Severe privacy issue. | Default deny, explicit policy per operation, cross-user tests, separate projects and pre-launch security review. |
| **AI provider price/limits change.** | Unpredictable cost or failed generation. | Central model config, usage metering, provider abstraction boundary and quota controls. |
| **Scope creep from “many features”.** | MVP never ships. | Phase gates; keep sharing, RAG, billing and collaboration out of first release. |

### 18.2 Product decisions to lock before implementation

| Decision | Recommended default | Reason |
| :--- | :--- | :--- |
| **Working product name** | Visualify (temporary) | Can be renamed after domain/trademark review. |
| **Authentication gate** | Require sign-in before generation/save | Protects AI spend and ensures each generation belongs to a library account. |
| **Canonical generated object** | Excalidraw scene JSON + structured learning plan | Editable source remains independent of preview image. |
| **Diagram strategy** | Mermaid for supported diagrams; deterministic direct scene composer otherwise | Avoids limiting every note to Mermaid and avoids free-form scene JSON. |
| **Database choice** | Supabase Postgres + RLS | Auth, relational metadata and ownership enforcement in one platform. |
| **File visibility** | Private buckets by default | Source notes may contain personal or course material. |
| **Async jobs** | BullMQ + Redis worker | AI/render tasks should not block HTTP request lifetime. |
| **MVP input** | Prompt first; PDF/image after prompt-to-save loop | Validates the core product before adding document ingestion complexity. |
| **Editor** | Official @excalidraw/excalidraw React package | Gives a real editing surface; CLI does not replace the editor. |

### 18.3 Launch checklist

- [ ] Supabase Auth email confirmation, Google OAuth redirect URLs and recovery flow configured.
- [ ] Profile trigger and profile update policies tested.
- [ ] RLS enabled on every exposed table; SELECT/INSERT/UPDATE/DELETE tests pass for owner and non-owner.
- [ ] Storage bucket policies tested for upload, list, read, signed URL and delete.
- [ ] No service-role/Gemini/Redis secrets in frontend bundle or Git history.
- [ ] Worker Docker image includes Node 22+, CLI and Chromium; render smoke test passes in staging.
- [ ] Prompt → scene → editor → save → library → export end-to-end path passes.
- [ ] PDF/image type, size, page-count and corrupt-file handling verified.
- [ ] Generation cancel, timeout, retry, duplicate delivery and worker restart tested.
- [ ] Rate limits, monthly quota and user-facing quota state configured.
- [ ] Privacy policy and terms explain AI provider processing and retention.
- [ ] Account deletion and source/export cleanup tested.
- [ ] Logs redact prompts, file contents, tokens and signed URLs.
- [ ] Accessibility, mobile layout and browser compatibility smoke tests pass.
- [ ] Alerts, backups and basic support/job-ID workflow are enabled.

---

## 19. Appendices

### A. Definition of done

- Implementation matches the requirement and is covered by appropriate tests.
- Loading, empty, success, validation, error and retry states exist.
- Ownership and RLS tests pass for the feature.
- No secrets or source content are written to client-visible logs.
- Feature is usable at supported viewport sizes and keyboard focus is visible.
- Documentation and migrations are updated; staging smoke test passes.

### B. Suggested initial configuration defaults

| Setting | Initial value to configure | Notes |
| :--- | :--- | :--- |
| **Max prompt length** | 8,000 characters | Tune after model/context testing. |
| **Max source file size** | 20 MB | Server-side enforcement; can vary by file type. |
| **Max PDF pages per job** | 100 pages | Allow page selection; raise only after cost tests. |
| **Max image dimensions** | 20 megapixels | Resize before model submission where suitable. |
| **Concurrent active jobs** | 1 per user | Prevents a single account exhausting worker capacity. |
| **Generation retries** | 1 repair attempt for invalid structured output | Provider/network retry policy is separate. |
| **SSE heartbeat** | 15–25 seconds | Keep intermediaries from closing idle connections. |
| **Autosave debounce** | 1–2 seconds after last edit | Also save on explicit action and before navigation. |
| **Signed download URL TTL** | 5–15 minutes | Use least time that supports download UX. |

### C. Terms used in this PRD

| Term | Meaning |
| :--- | :--- |
| **Scene** | An Excalidraw document containing editable elements and app state. |
| **Learning plan** | Structured outline of concepts, objectives, relationships and explanations generated before drawing. |
| **Generation job** | Asynchronous record that tracks processing from input to final visual. |
| **Version** | Immutable snapshot of a saved note’s scene and supporting learning data. |
| **Frame** | A named region/slide in an Excalidraw presentation-style scene. |
| **Source reference** | Pointer to a source page or extracted section used to support a generated concept. |
| **RLS** | Postgres Row Level Security; database-level rules that restrict rows by authenticated identity. |
| **Signed URL** | Time-limited URL granting access to a private Storage object. |

### D. Official technical references

References checked on 24 November 2026. Product and implementation details should be rechecked before release because hosted APIs and package versions can change.

- **[S1] Excalidraw CLI repository.** https://github.com/excalidraw/cli  
  Official features, license, Node version, command overview.
- **[S2] Excalidraw CLI documentation: Mermaid and rendering.** https://plus.excalidraw.com/docs/cli  
  Local Mermaid conversion, browser requirement, output formats and supported diagram behaviour.
- **[S3] Excalidraw React package README.** https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/README.md  
  React embedding, CSS import and client-only rendering guidance.
- **[S4] Gemini API structured outputs.** https://ai.google.dev/gemini-api/docs/structured-output  
  Schema-constrained model response capability and Zod-compatible structured outputs.
- **[S5] Supabase Auth overview.** https://supabase.com/docs/guides/auth  
  Auth providers, sessions and integration with database access.
- **[S6] Supabase user management.** https://supabase.com/docs/guides/auth/managing-user-data  
  Profile table linked to auth.users and profile creation trigger pattern.
- **[S7] Supabase Row Level Security.** https://supabase.com/docs/guides/database/postgres/row-level-security  
  RLS policies, grants, authenticated roles and ownership controls.
- **[S8] Supabase Storage access control.** https://supabase.com/docs/guides/storage/security/access-control  
  Storage object RLS and policies.
- **[S9] Supabase signed URLs.** https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl  
  Private object access through expiring signed URLs.
- **[S10] Google sign-in with Supabase.** https://supabase.com/docs/guides/auth/social-login/auth-google  
  Google OAuth setup.
- **[S11] Express production security practices.** https://expressjs.com/en/advanced/best-practice-security/  
  TLS, Helmet, brute-force/rate controls and dependency hygiene.
- **[S12] Gemini document understanding.** https://ai.google.dev/gemini-api/docs/document-processing  
  PDF input and document understanding capabilities; verify current model/API limits.

> **Final build recommendation:** The first production milestone is not “all features”. It is a trustworthy, complete loop: a student signs in, enters a prompt, receives a well-structured editable visual, corrects it, saves it to a private library and downloads it. Once that loop is reliable, PDF/image ingestion and learning companions become additive features rather than foundations built on sand.
