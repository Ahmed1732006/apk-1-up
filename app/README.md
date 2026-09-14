MIDAD app refactor

- index.html is intentionally unchanged.
- 2.html is only a compatibility bridge to app/index.html.
- app/index.html contains the single shared authenticated application.
- app/theme-system.js handles theme selection without navigation.
- app/theme-common.js contains shared theme UI styles.
- app/themes/*.js contain styling/decorations for individual themes only.

Theme HTML duplicates were removed so application logic/content exists in one place.
