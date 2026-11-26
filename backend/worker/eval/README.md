# Visualify AI Quality Evaluation Set (PRD §14.2)

This directory contains the versioned **30-fixture AI evaluation suite** required by PRD §14.2 before locking the default production model:

- **`prompts.json`**: `10` text prompts across `programming`, `databases`, `networking`, `biology`, and `history` (`2` `sequence`, `2` `timeline`, `2` `comparison`, `2` `flowchart`/process, `2` `mindmap`/concept-map).
- **`sources/`**:
  - `pdf-01` .. `pdf-10` (`*.pdf`): `10` synthetic educational PDF documents (`< 200 KB` each, zero PII).
  - `img-01` .. `img-10` (`*.png`): `10` synthetic lecture-note / whiteboard diagram PNG fixtures (`< 200 KB` each, zero PII).
  - `sources.json`: fixture manifest mapping each PDF/image file to its domain, expected visual type, and synthetic license metadata.

## License & Provenance
All fixtures (`prompts.json` and files in `sources/`) are **100% synthetic original educational examples** created specifically for Visualify evaluation (CC0 / MIT inside this repository). They contain zero third-party copyrighted text and zero personal data.

## Usage
```powershell
npm run eval:quality -- --model gemini-3.5-flash-lite --model gemini-3.5-flash
```
- Reads `GEMINI_API_KEY` from server-side environment / `.env.local` (refuses to run under `NODE_ENV=production`).
- Outputs structured JSON + Markdown summary reports under `docs/eval/` and generates `docs/eval/rubric-template.md` with the 7 PRD §14.2 human evaluation dimensions.
