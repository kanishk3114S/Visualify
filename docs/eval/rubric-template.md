# PRD §14.2 Human AI Visual Quality Rubric

Score each dimension from **1** (unusable) to **5** (publication-grade) after reviewing generated scenes.

## Scoring Dimensions

1. **Correctness** — Are facts, labels, relationships and sequences accurate to the source?
2. **Coverage** — Are the important concepts represented?
3. **Hierarchy** — Can a student understand the reading order?
4. **Legibility** — Can the text be read at normal zoom without clipping or tiny dense paragraphs?
5. **Visual fit** — Does the chosen diagram type match the concept (timeline, sequence, comparison, etc.)?
6. **Editability** — Does the output remain a useful editable scene of shapes, arrows, and labels?
7. **Traceability** — Can users see which source page or image supports a concept?

## Evaluation Sheet

| Fixture | Input | Expected Type | Correctness (1-5) | Coverage (1-5) | Hierarchy (1-5) | Legibility (1-5) | Visual fit (1-5) | Editability (1-5) | Traceability (1-5) | Reviewer Notes |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| `prompt-01-http-sequence` | prompt | sequence | | | | | | | N/A | |
| `prompt-02-oauth-sequence` | prompt | sequence | | | | | | | N/A | |
| `prompt-03-web-history-timeline` | prompt | timeline | | | | | | | N/A | |
| `prompt-04-dna-history-timeline` | prompt | timeline | | | | | | | N/A | |
| `prompt-05-sql-vs-nosql` | prompt | comparison | | | | | | | N/A | |
| `prompt-06-mitosis-vs-meiosis` | prompt | comparison | | | | | | | N/A | |
| `prompt-07-compiler-process` | prompt | flowchart | | | | | | | N/A | |
| `prompt-08-query-exec-process` | prompt | flowchart | | | | | | | N/A | |
| `prompt-09-cell-mindmap` | prompt | mindmap | | | | | | | N/A | |
| `prompt-10-acid-mindmap` | prompt | mindmap | | | | | | | N/A | |
| `pdf-01-async-event-loop` | pdf | flowchart | | | | | | |  | |
| `pdf-02-git-branching` | pdf | flowchart | | | | | | |  | |
| `pdf-03-db-indexing` | pdf | comparison | | | | | | |  | |
| `pdf-04-isolation-levels` | pdf | comparison | | | | | | |  | |
| `pdf-05-dns-lookup` | pdf | sequence | | | | | | |  | |
| `pdf-06-bgp-routing` | pdf | mindmap | | | | | | |  | |
| `pdf-07-cellular-respiration` | pdf | flowchart | | | | | | |  | |
| `pdf-08-crispr-cas9` | pdf | flowchart | | | | | | |  | |
| `pdf-09-printing-press` | pdf | timeline | | | | | | |  | |
| `pdf-10-industrial-rev` | pdf | timeline | | | | | | |  | |
| `img-01-rest-vs-graphql` | image | comparison | | | | | | |  | |
| `img-02-docker-layers` | image | flowchart | | | | | | |  | |
| `img-03-er-library` | image | er_diagram | | | | | | |  | |
| `img-04-sharding-vs-repl` | image | comparison | | | | | | |  | |
| `img-05-tcp-congestion` | image | flowchart | | | | | | |  | |
| `img-06-cdn-sequence` | image | sequence | | | | | | |  | |
| `img-07-photosynthesis` | image | flowchart | | | | | | |  | |
| `img-08-immune-response` | image | comparison | | | | | | |  | |
| `img-09-space-race` | image | timeline | | | | | | |  | |
| `img-10-renaissance-map` | image | mindmap | | | | | | |  | |
