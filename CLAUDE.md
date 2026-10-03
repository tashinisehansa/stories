# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Story Studio is a home writing app for one child author (Tashini). The flow is: write → autosave → "I'm Finished" →
AI review → cartoon pictures → preview → she approves → publish to GitHub Pages. `requirements.md` is the product
spec; README.md covers running it.

## Commands

```bash
npm start                    # server on 0.0.0.0:4321 (reads .env)
npm run dev                  # MOCK_AI=1 MOCK_GITHUB=1 with --watch: no keys needed; publishes to data/mock-repo/
npm test                     # node:test, all of test/
node --test test/workflow.test.js                     # one file
node --test --test-name-pattern="publish" test/       # by test name
npm run validate:site [dir]  # what pages.yml runs before deploying (defaults to site/)
npm run rebuild:index        # regenerate site/index.html + site/stories.json from story.json files (-- --pages re-renders pages)
node src/cli.js help         # agent/shell CLI; needs a running server
```

Node ≥ 22, ESM, no build step, and no frontend framework.

## Architecture

- **One core, many front doors.** `src/core/studio.js#createStudio` wires the services: `StoryService`,
  `ReviewService`, `ImageService`, `PublishService` and `JobRunner`.
  - `src/server.js` is the only process that touches `data/`. It serves the studio UI (`studio/`), `/api/*`,
    `/preview/*` and `/mcp`.
  - The CLI (`src/cli.js`) and the stdio MCP server (`src/mcp.js`) are HTTP clients of that server. They both use
    the tool catalogue in `src/agent/tools.js`.
  - To add an agent capability, add a REST route in `buildRoutes` and a tool in `tools.js`.
- **Storage** is JSON files under `data/` (gitignored): `stories/<id>.json`, `revisions/<id>/`, `reviews/<id>.json`,
  `images/<id>/` and `secrets.json`. `JsonStore.update`/`withLock` serialise read-modify-write per file. Always mutate
  a story through `StoryService.mutate` (locked); never read, change and write it yourself.
- **The state machine** is in `src/core/states.js`. Every `*_FAILED` state must stay retryable.
  - Editing a READY_TO_PUBLISH or PUBLISHED story sends it back to REVIEWING and clears `approvedAt`. So does
    changing a picture (`resetApproval` in images.js).
  - `createStudio` → `recover()` turns work interrupted by a restart into failed states.
- **Background jobs.** Review, pictures and publishing run as `JobRunner` jobs. HTTP callers can pass `wait` (in
  seconds) to block. Finishing the review automatically starts picture generation (`onReviewed`).
- **The AI review** (`review.js`) calls an OpenAI-compatible chat API (`providers/llm-chat.js`; `REVIEW_PROVIDER` = deepseek | openrouter, chosen in `studio.js#createReviewLlm`). It uses the versioned prompt `prompts/story-review.v2.md`, and its output is
  validated against `schemas/review.schema.json` with one retry. Invalid output → REVIEW_FAILED.
  - Grammar suggestions are applied one at a time by exact (or whitespace-tolerant) substring replace.
  - `writingIdeas` are kept separate from grammar fixes on purpose.
  - If you change the prompt, bump the version (add a new file) so stored reviews stay traceable.
  - Every check is kept: a new check archives the current one to `data/review-history/<id>/<timestamp>.json`, including
    Tashini's choices. The feedback page (`studio/feedback.html`) and `GET /api/stories/:id/feedback[/:key]` show them.
  - Chinese text gets per-character pinyin from the server (`core/pinyin.js`, pinyin-pro, context-aware). The UI shows
    it as ruby text (`studio/js/feedback-view.js`, shared by the review and feedback pages) with an on/off switch.
- **Pictures** (`images.js`) combine `prompts/image-style.v1.md` with the story's `characters` list for consistency.
  Each scene gets N candidates, converted to webp. A scene's `beforeParagraph` decides where its picture appears.
- **Rendering** (`render.js`) is shared by the preview and publishing, so the preview matches the live page. All
  text goes through `escapeHtml`. Pages use relative URLs; `SITE_URL` is used only for OG/canonical tags.
  `scripts/validate-site.js` checks the published HTML is valid and contains no scripts other than
  `assets/js/library.js`.
- **Publishing** (`publish.js` + `github.js`) writes a single atomic commit through the Git Data API. That commit
  holds the story folder plus `site/stories.json` and `site/index.html`, which are merged with `mergeIndex`.
  - `assertPublishPath` is the allowlist of paths the publisher may write. Don't widen it casually.
  - `LocalRepo` has the same interface and backs the tests and MOCK_GITHUB.
  - `.github/workflows/pages.yml` validates the site and deploys **only `site/`**.

## Invariants

- **Approval.** Nothing publishes without `approvedAt`. Agents (bearer `AGENT_TOKEN`) get 403 on
  `/approve` unless `AGENT_CAN_APPROVE=1`. Only a parent (admin cookie) can override.
- **Who can call.** `src/auth.js#identify` decides who is calling. A valid bearer token is an `agent`, and may connect
  from anywhere. An admin cookie is a `parent`. Anyone else on the home network (`ALLOWED_NETWORKS`) is `studio`,
  meaning Tashini. Everything else gets 403.
- **Child-facing wording.** Errors shown to Tashini are friendly `StudioError.friendly` text with no technical
  terms. `detail` is only returned to agents and parents, and logs go to `data/logs/app.log`.
- **Privacy.** Drafts, reviews and internal metadata never go into `site/`. The test
  `publish: approval required, one atomic commit…` checks for leaks. A PII scan (`scanPrivateInfo`) blocks publishing.
- **Secrets.** Secrets come from `.env` or `data/secrets.json` and never appear in `studio/` code or API responses.
- **The child's voice.** Agents must not write stories for Tashini (see `agents/hermes/story-studio/SKILL.md`).
