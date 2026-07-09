import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getOctokit } from "./github-auth.js";
import { fetchPRFiles, fetchPRMetadata } from "./diff-fetcher.js";
import { generateReview, reviewFile } from "./reviewer.js";

const server = new McpServer({
  name: "pr-reviewer-mcp",
  version: "1.0.0",
});

// ─── Tool: list_open_prs ───────────────────────────────────────────────────
// Lets an agent decide what's worth reviewing before spending tokens on it.

server.tool(
  "list_open_prs",
  "List open pull requests for a GitHub repo, so you can decide which to review.",
  {
    owner: z.string().describe("Repo owner, e.g. 'srivastava-aryan'"),
    repo: z.string().describe("Repo name, e.g. 'codewarrior'"),
  },
  async ({ owner, repo }) => {
    const octokit = getOctokit();
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      state: "open",
      per_page: 25,
    });

    if (prs.length === 0) {
      return { content: [{ type: "text", text: `No open PRs on ${owner}/${repo}.` }] };
    }

    const summary = prs
      .map((pr) => `#${pr.number} — ${pr.title} (${pr.user.login}, ${pr.head.ref} → ${pr.base.ref})`)
      .join("\n");

    return { content: [{ type: "text", text: summary }] };
  }
);

// ─── Tool: get_pr_diff ─────────────────────────────────────────────────────
// Raw diff, no AI — for when the caller wants to review manually or feed
// the diff into a different pipeline.

server.tool(
  "get_pr_diff",
  "Fetch the raw file-by-file diff for a pull request, with no AI review applied.",
  {
    owner: z.string(),
    repo: z.string(),
    pull_number: z.number().describe("The PR number"),
  },
  async ({ owner, repo, pull_number }) => {
    const octokit = getOctokit();
    const files = await fetchPRFiles(octokit, { owner, repo, pull_number });

    if (files.length === 0) {
      return { content: [{ type: "text", text: "No reviewable file changes found." }] };
    }

    const text = files
      .map((f) => `### ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n\`\`\`diff\n${f.patch}\n\`\`\``)
      .join("\n\n");

    return { content: [{ type: "text", text }] };
  }
);

// ─── Tool: review_file ─────────────────────────────────────────────────────
// Granular control — review one file's diff without touching the rest of the PR.

server.tool(
  "review_file",
  "Run an AI code review on a single file within a pull request.",
  {
    owner: z.string(),
    repo: z.string(),
    pull_number: z.number(),
    filename: z.string().describe("Exact filename as it appears in the PR diff"),
  },
  async ({ owner, repo, pull_number, filename }) => {
    const octokit = getOctokit();
    const [metadata, files] = await Promise.all([
      fetchPRMetadata(octokit, { owner, repo, pull_number }),
      fetchPRFiles(octokit, { owner, repo, pull_number }),
    ]);

    const file = files.find((f) => f.filename === filename);
    if (!file) {
      return {
        content: [{ type: "text", text: `File "${filename}" not found in PR #${pull_number}'s reviewable changes.` }],
        isError: true,
      };
    }

    const result = await reviewFile(metadata, file);
    return { content: [{ type: "text", text: result }] };
  }
);

// ─── Tool: review_pr ────────────────────────────────────────────────────────
// The main event — full diff, parallel per-file review, synthesized summary.

server.tool(
  "review_pr",
  "Run a full AI code review on a pull request: fetches the diff, reviews every changed file in parallel, and returns a synthesized markdown review.",
  {
    owner: z.string(),
    repo: z.string(),
    pull_number: z.number(),
  },
  async ({ owner, repo, pull_number }) => {
    const octokit = getOctokit();
    const [metadata, files] = await Promise.all([
      fetchPRMetadata(octokit, { owner, repo, pull_number }),
      fetchPRFiles(octokit, { owner, repo, pull_number }),
    ]);

    if (files.length === 0) {
      return { content: [{ type: "text", text: "No reviewable file changes found in this PR." }] };
    }

    const review = await generateReview(metadata, files);
    return { content: [{ type: "text", text: review }] };
  }
);

// ─── Tool: post_review_comment ─────────────────────────────────────────────
// Writes back to GitHub. Kept separate from review_pr so an agent (or you)
// can inspect the review before it goes public.

server.tool(
  "post_review_comment",
  "Post a review (typically the output of review_pr) as a comment on the pull request.",
  {
    owner: z.string(),
    repo: z.string(),
    pull_number: z.number(),
    body: z.string().describe("Markdown body of the comment to post"),
  },
  async ({ owner, repo, pull_number, body }) => {
    const octokit = getOctokit();
    const { data: comment } = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pull_number, // PR comments use the issues endpoint
      body,
    });

    return {
      content: [{ type: "text", text: `Posted comment: ${comment.html_url}` }],
    };
  }
);

// ─── Start server ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[pr-reviewer-mcp] Server running on stdio");
}

main().catch((err) => {
  console.error("[pr-reviewer-mcp] Fatal error:", err);
  process.exit(1);
});
