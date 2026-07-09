import { ChatGoogle } from "@langchain/google";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";

// ─── Prompts ──────────────────────────────────────────────────────────────────

const FILE_REVIEW_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are an expert code reviewer. Your job is to review a single file's diff from a pull request.

Be concise and actionable. Focus on:
- Bugs or logic errors
- Security vulnerabilities (SQL injection, XSS, secrets in code, etc.)
- Performance issues
- Code clarity and maintainability
- Missing error handling
- Anything that would block merging

DO NOT comment on code style or formatting unless it causes real problems.
DO NOT repeat what the code does — only flag issues.
If the file looks good, say so briefly.

Respond in this exact format:
ISSUES: <bullet list of problems found, or "None">
SUGGESTIONS: <bullet list of optional improvements, or "None">
VERDICT: <LGTM | NEEDS CHANGES | CRITICAL ISSUES>`,
  ],
  [
    "human",
    `PR Title: {pr_title}
PR Description: {pr_description}

File: {filename} ({status})
+{additions} additions, -{deletions} deletions

Diff:
\`\`\`
{patch}
\`\`\``,
  ],
]);

const SYNTHESIS_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a senior engineer writing a final pull request review summary.
You have already reviewed each file individually. Now synthesize a single cohesive review.

Write in a direct, helpful tone — like a senior colleague, not a robot.
Be specific and reference filenames when calling out issues.

Format your response EXACTLY as follows (use these exact headings):

## 🤖 AI PR Review

### Summary
<2-4 sentences describing what this PR does and your overall take>

### Issues Found
<bullet list — each item starts with the filename in backticks, then the issue>
<if none, write: ✅ No critical issues found>

### Suggestions
<bullet list of optional improvements with filenames>
<if none, write: 💡 No additional suggestions>

### Verdict
<one of: ✅ **LGTM** | ⚠️ **Needs Minor Changes** | 🚨 **Needs Major Changes**>

---
*Review generated via MCP · Powered by ${process.env.GOOGLE_GEN_AI_MODEL || "Google Generative AI"}*`,
  ],
  [
    "human",
    `PR: {pr_title}
Author: {pr_author}
Branch: {pr_head} → {pr_base}

Individual file reviews:
{file_reviews}`,
  ],
]);

// ─── LLM Setup ────────────────────────────────────────────────────────────────

function getLLM() {
  return new ChatGoogle({
    model: process.env.GOOGLE_GEN_AI_MODEL || "gemini-2.5-flash",
    apiKey: process.env.GOOGLE_GEN_AI_API_KEY,
    temperature: 0.2,
    maxTokens: 1500,
  });
}

// ─── Review Pipeline ──────────────────────────────────────────────────────────

/**
 * Reviews a single file's diff.
 * Returns a string with issues/suggestions/verdict for that file.
 */
export async function reviewFile(prMetadata, file) {
  const llm = getLLM();
  const chain = RunnableSequence.from([
    FILE_REVIEW_PROMPT,
    llm,
    new StringOutputParser(),
  ]);

  const result = await chain.invoke({
    pr_title: prMetadata.title,
    pr_description: prMetadata.body,
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
  });

  return `### \`${file.filename}\`\n${result}`;
}

/**
 * Synthesizes all file reviews into a final structured comment.
 */
async function synthesizeReview(prMetadata, fileReviews) {
  const llm = getLLM();
  const chain = RunnableSequence.from([
    SYNTHESIS_PROMPT,
    llm,
    new StringOutputParser(),
  ]);

  return chain.invoke({
    pr_title: prMetadata.title,
    pr_author: prMetadata.author,
    pr_head: prMetadata.head,
    pr_base: prMetadata.base,
    file_reviews: fileReviews.join("\n\n---\n\n"),
  });
}

/**
 * Main entry point.
 * Takes PR metadata + list of file diffs, returns a markdown review string.
 *
 * @param {object} prMetadata - title, body, base, head, author
 * @param {Array}  files      - [{filename, status, additions, deletions, patch}]
 * @returns {Promise<string>} - markdown review ready to post as a PR comment
 */
export async function generateReview(prMetadata, files) {
  console.error(`[reviewer] Reviewing ${files.length} file(s) for PR: "${prMetadata.title}"`);

  // Review all files in parallel — much faster than sequential for large PRs
  const fileReviews = await Promise.all(
    files.map((file) => reviewFile(prMetadata, file))
  );

  console.error(`[reviewer] File reviews complete. Synthesizing final review...`);

  const finalReview = await synthesizeReview(prMetadata, fileReviews);

  return finalReview;
}
