# pr-reviewer-mcp

An MCP server exposing AI-powered GitHub PR review as tools, adapted from
[codewarrior](https://github.com/srivastava-aryan/codewarrior) (a webhook-driven
GitHub App) into an on-demand tool server.

## Why this exists

The original app reviews automatically when a PR opens — event-driven.
This version reviews when explicitly asked, by you or by an agent —
tool-driven. Same review pipeline (LangChain + Gemini), different trigger
model and a different auth model (PAT instead of GitHub App installation
tokens, since there's a human in the loop at call time instead of a webhook).

## Tools

| Tool | Description |
|---|---|
| `list_open_prs` | List open PRs for a repo |
| `get_pr_diff` | Fetch the raw diff, no AI |
| `review_file` | AI review of a single file in a PR |
| `review_pr` | Full AI review: all files in parallel + synthesized summary |
| `post_review_comment` | Post a review as a PR comment |

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `GITHUB_TOKEN` — fine-grained PAT with **Pull requests** (read/write) and
  **Contents** (read) permissions on the repos you want to review
- `GOOGLE_GEN_AI_API_KEY` — from Google AI Studio

## Running locally

```bash
npm start
```

This starts the server on stdio. It won't print anything to stdout (that
channel is reserved for the MCP protocol) — status logs go to stderr.

## Connecting to Claude Desktop or Claude Code

Add to your MCP config (`claude_desktop_config.json` or equivalent):

```json
{
  "mcpServers": {
    "pr-reviewer": {
      "command": "node",
      "args": ["/absolute/path/to/pr-reviewer-mcp/src/index.js"],
      "env": {
        "GITHUB_TOKEN": "your-token-here",
        "GOOGLE_GEN_AI_API_KEY": "your-key-here"
      }
    }
  }
}
```

Restart Claude Desktop/Code, then you can ask things like:

> "Review PR #12 on srivastava-aryan/dsa-tracker"

and Claude will call `review_pr`, decide whether to post it, and call
`post_review_comment` if you confirm.

## What changed from the original app

- **Auth**: `github-auth.js` now uses a personal access token via
  `@octokit/rest` directly, instead of `@octokit/auth-app` + installation
  tokens. No webhook server, no Express, no `smee-client`.
- **Trigger**: no webhook listener. Review happens when a tool is called.
- **Logging**: `console.log` → `console.error` in the review pipeline,
  since stdout is reserved for MCP protocol messages on stdio transport.
- **Everything else** — prompts, parallel file review, synthesis step — is
  unchanged from the original `reviewer.js` and `diff-fetcher.js`.

## Next steps worth exploring

- Swap stdio transport for HTTP/SSE if you want to host this remotely
  instead of running it locally per-user
- Add a `list_recent_reviews` tool backed by a small DB, so repeated
  reviews on the same PR don't re-run from scratch
- Add resource support (`server.resource`) to expose PR diffs as
  browsable MCP resources rather than only tool outputs
