# 📚 Tashini's Story Studio

A friendly home writing studio for a young author. Tashini writes a story, and her work autosaves. When she's
finished, she gets kind grammar help and writing tips, picks cartoon illustrations, previews the story and presses
**Publish**. The story then appears on her public story website at **https://tashinisehansa.github.io/stories/**.

> Tashini focuses on writing. The app handles the technical work.

The full product spec is in [`requirements.md`](requirements.md).

## How it fits together

```
Tashini's browser (home Wi-Fi)          Hermes / Claude Code / any agent
  http://<this-pc>:4321                   MCP (stdio or HTTP) · CLI · REST + token
            \                                   /
             Story Studio server (Node, this computer)
               data/  ← drafts, revisions, reviews, picture candidates (private, never committed)
               │  DeepSeek or OpenRouter (story review) · OpenAI Images (pictures)
               ▼
             GitHub API: one atomic commit to site/stories/<slug>/ + site/index.html
               ▼
             GitHub Actions: validate site → deploy GitHub Pages
```

- **Drafts are local-first.** Each change saves instantly to the browser's IndexedDB, then syncs to the server.
  Writing survives refreshes and Wi-Fi drop-outs. Older versions can be restored.
- **AI never overwrites her writing.** Each grammar fix is "Use Suggestion" or "Keep My Sentence". Style ideas are
  kept separate and optional. Her original story is always one click away.
- **Nothing goes public without her approval**, including when an agent triggers publishing.
- **The public site is plain static HTML.** Pages use relative links, so a custom domain needs no code changes.
  The site lives in [`site/`](site/).

## Run it

```bash
npm install
cp .env.example .env        # add DEEPSEEK_API_KEY (or OPENROUTER_API_KEY) and OPENAI_API_KEY
npm start                   # prints the home-network address, e.g. http://192.168.1.144:4321
```

Want to try it without API keys? `npm run dev` uses fake AI and a local folder instead of GitHub.

To let other devices on the home network reach the server, open the port once:

```bash
sudo firewall-cmd --add-port=4321/tcp --permanent && sudo firewall-cmd --reload
```

To keep it running in the background and start it at boot:

```bash
mkdir -p ~/.config/systemd/user && cp deploy/story-studio.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now story-studio
loginctl enable-linger $USER
journalctl --user -u story-studio -f      # logs
```

**Parent page:** `/admin.html`. The password is `ADMIN_PASSWORD` in `.env`. If that isn't set, a generated password
is stored in `data/secrets.json`. From the parent page you can:
- see every story;
- re-run the check or redraw pictures;
- publish on Tashini's behalf;
- hide a story from the library, or remove it from the website;
- delete drafts;
- view the agent token and logs.

## Agents (Hermes and others)

See [`agents/README.md`](agents/README.md). In short:

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  story_studio:
    command: "node"
    args: ["/home/manoj/projects/tashini/stories/src/mcp.js"]
    timeout: 300
```

Also link the skill: `ln -s $PWD/agents/hermes/story-studio ~/.hermes/skills/story-studio`.

## Development

```bash
npm test                    # all tests (node:test)
node --test test/render.test.js                      # one file
node --test --test-name-pattern="publish" test/      # tests matching a name
npm run validate:site       # the same checks GitHub Actions runs before deploying
npm run rebuild:index       # regenerate site/index.html + stories.json (add -- --pages to re-render story pages)
```

## Publishing details

- **Commit.** Publishing creates one commit through the GitHub Git Data API, titled `Add story: <Title>` (or
  `Update story: …`). The commit touches only `site/index.html`, `site/stories.json` and `site/stories/<slug>/…`.
  The server refuses to write any other path.
- **Token.** The server uses `TASHINI_GITHUB_TOKEN`. If that isn't set, it uses `gh auth token --user tashinisehansa`.
  The token never reaches the browser.
- **Deploy.** `.github/workflows/pages.yml` checks the site, then deploys it to GitHub Pages. It checks:
  - every story.json matches the schema;
  - every picture is a real webp under 1 MB;
  - the index matches the stories;
  - the HTML is valid, with no unexpected scripts;
  - nothing looks like private information.
- **Private information.** Before publishing, the server also scans the story for phone numbers, email addresses,
  street addresses and links. If it finds any, it stops and shows a friendly explanation.
