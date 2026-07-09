import { Octokit } from "@octokit/rest";

/**
 * The original GitHub App used installation tokens because a webhook-driven
 * app has to authenticate on behalf of whichever repo triggered it, without
 * a human in the loop at request time.
 *
 * An MCP server is different: a human (or their agent) is invoking the tool
 * directly, in their own session, so a personal access token tied to that
 * person is the simpler and correct model. No JWT signing, no installation
 * lookup — just one token with repo scope.
 */
export function getOctokit() {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. Create a fine-grained personal access token " +
      "with 'Pull requests' (read/write) and 'Contents' (read) permissions, " +
      "then set it in your MCP client config."
    );
  }

  return new Octokit({ auth: token });
}
