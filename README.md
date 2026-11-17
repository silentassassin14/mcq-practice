# MCQ Practice App

An interactive, responsive single-page web application for practicing Multiple Choice Questions (MCQs) with support for passage-based reading comprehension sets, rich tables, admin publishing, keyboard navigation, and dark/light modes.

## Features

- **Robust Question Formats**: Supports both standard standalone questions (Format A) and passage sets (Format B) where passages and data tables stay pinned on screen while students answer related sub-questions.
- **Rich Text & Tables**: Automatically renders markdown-style tables and formatted paragraphs in questions and passages.
- **Interactive Quiz Modes**: Randomized question order, shuffled options on every attempt, instant feedback, scoring breakdown, review of incorrect answers, and retest capabilities.
- **New UX Enhancements**:
  - **Light / Dark Mode**: Toggle instantly with persistence in `localStorage`.
  - **Skip Question**: Skip difficult questions and review/retest them at the end.
  - **Best Score Tracking**: Automatically tracks and displays your best quiz percentage across attempts.
  - **Keyboard Navigation**: Press <kbd>A</kbd>–<kbd>D</kbd> to pick options, <kbd>↑</kbd><kbd>↓</kbd> to move, <kbd>Enter</kbd> to submit/next, and <kbd>S</kbd> to skip.
- **Admin Tools**: Built-in login to add, edit, or delete questions locally, and export/copy clean JSON formatted for Blogger or GitHub hosting.
- **Offline & Multi-File Support**: Automatically discovers quiz files in the `qp/` directory or falls back to `questions.json` with robust local caching.

## Project Structure

- `index.html`: Main entry point with splash screen support for Capacitor/native apps.
- `app.js`: Core single-page application logic, quiz engine, normalization, and keyboard shortcuts.
- `styles.css`: Modern responsive design with custom CSS variables supporting light and dark themes.
- `questions.json`: Default question bank (50 validated questions).
- `qp/`: Directory for multiple quiz question files.

## Running Locally

Simply open `index.html` in any modern web browser or serve the folder using a static file server (e.g., `python3 -m http.server`).
