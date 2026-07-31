# Talk Today Speaking Placement — GitHub Pages front end

This is the production student interface. It is a normal top-level HTTPS page, so the browser can request microphone permission directly. Apps Script remains the private server through a hidden allow-listed bridge.

## Deploy

1. Create a GitHub repository, for example `talk-today-speaking-placement`.
2. Copy the contents of this folder to the repository root.
3. `config.js` already contains the existing Apps Script `/exec` URL. Update it only if the deployment URL changes.
4. In Apps Script Script Properties, set:
   - `STUDENT_FRONTEND_URL` to the final GitHub Pages URL.
   - `STUDENT_FRONTEND_ORIGIN` to its origin only, for example `https://jamalmorelli-dev.github.io`.
5. Enable GitHub Pages from the main branch root or use the included workflow.
6. Give students the GitHub Pages URL, not the Apps Script `/exec` URL.

The candidate taps **Start speaking test** once. The page asks for microphone permission once and retains that stream through mic check, Task 1, and Task 2.
