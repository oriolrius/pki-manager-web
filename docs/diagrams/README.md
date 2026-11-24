# Documentation diagrams

Diagrams for the docs are PlantUML files here (`NN-name.puml`), never ASCII art.

- Theme: `../ssh/explainer/diagrams/theme-oriolrius.puml` (oriolrius.me palette), with `!include`.
- Render: `node docs/site/scripts/plantuml.mjs` renders every diagram here and in
  `docs/ssh/explainer/diagrams/` with https://plantuml.joor.net into `svg/`.
  Commit the SVGs: GitHub shows them, and the docs site build renders them again.
- Use in Markdown: `![what the diagram shows](svg/NN-name.svg)` (relative path).
