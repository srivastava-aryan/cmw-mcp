/**
 * Fetches and parses a PR diff into a list of file-level chunks.
 *
 * Why parse the diff ourselves instead of using the files endpoint?
 * The /pulls/:pr/files endpoint gives us individual file patches but caps at
 * 300 files and 3000 lines. For most PRs that's fine, but parsing the raw diff
 * lets us keep file content and its patch together — useful context for the LLM.
 */

const SKIPPED_EXTENSIONS = new Set([
  ".lock", ".png", ".jpg", ".jpeg", ".gif", ".svg",
  ".ico", ".woff", ".woff2", ".ttf", ".eot", ".pdf",
  ".mp4", ".mp3", ".zip", ".tar", ".gz",
]);

const MAX_PATCH_CHARS = 6000; // ~1500 tokens — keeps cost reasonable per file

/**
 * @param {import("@octokit/rest").Octokit} octokit
 * @param {object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.pull_number
 * @returns {Promise<Array<{filename: string, status: string, patch: string}>>}
 */
export async function fetchPRFiles(octokit, { owner, repo, pull_number }) {
  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number,
    per_page: 100, // max allowed by GitHub
  });

  const reviewable = files
    .filter((f) => {
      const ext = "." + f.filename.split(".").pop().toLowerCase();
      if (SKIPPED_EXTENSIONS.has(ext)) return false;
      if (!f.patch) return false; // renamed with no content change
      return true;
    })
    .map((f) => ({
      filename: f.filename,
      status: f.status, // added | modified | removed | renamed
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch.length > MAX_PATCH_CHARS
        ? f.patch.slice(0, MAX_PATCH_CHARS) + "\n\n[... patch truncated for length ...]"
        : f.patch,
    }));

  return reviewable;
}

/**
 * Fetches basic PR metadata to give the LLM context about what's being reviewed.
 */
export async function fetchPRMetadata(octokit, { owner, repo, pull_number }) {
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number });
  return {
    title: pr.title,
    body: pr.body || "(no description provided)",
    base: pr.base.ref,
    head: pr.head.ref,
    author: pr.user.login,
  };
}
