import type { FetchLike } from "../../src/adapters/githubClient.js";

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

export function rateLimitHeaders(remaining = 59): Record<string, string> {
  return {
    "x-ratelimit-limit": "60",
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-used": String(60 - remaining),
    "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
  };
}

export function repoObject(
  owner: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    full_name: `${owner}/${name}`,
    name,
    owner: { login: owner },
    html_url: `https://github.com/${owner}/${name}`,
    description: `${name} — a sample repository`,
    stargazers_count: 1200,
    forks_count: 300,
    open_issues_count: 20,
    watchers_count: 1200,
    subscribers_count: 50,
    language: "TypeScript",
    topics: ["cli", "tool"],
    license: { key: "mit", name: "MIT License", spdx_id: "MIT" },
    archived: false,
    disabled: false,
    pushed_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    updated_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    created_at: "2020-01-01T00:00:00Z",
    default_branch: "main",
    size: 5000,
    ...overrides,
  };
}

const README_TEXT = `# Demo

## Installation

\`\`\`bash
npm install demo
\`\`\`

## Usage

\`\`\`ts
import demo from "demo";
demo();
\`\`\`

## Examples

See the examples/ directory.
`;

function readmeObject(): Record<string, unknown> {
  return {
    path: "README.md",
    encoding: "base64",
    content: Buffer.from(README_TEXT, "utf-8").toString("base64"),
  };
}

function treeObject(): Record<string, unknown> {
  return {
    sha: "tree-sha",
    truncated: false,
    tree: [
      { path: "package.json", type: "blob", size: 100, sha: "a1" },
      { path: "README.md", type: "blob", size: 300, sha: "a2" },
      { path: "LICENSE", type: "blob", size: 1000, sha: "a3" },
      { path: "Dockerfile", type: "blob", size: 50, sha: "a4" },
      { path: "src", type: "tree", sha: "a5" },
      { path: "src/index.ts", type: "blob", size: 200, sha: "a6" },
      { path: "test", type: "tree", sha: "a7" },
      { path: "test/index.test.ts", type: "blob", size: 80, sha: "a8" },
      { path: "examples", type: "tree", sha: "a9" },
      { path: "examples/demo.ts", type: "blob", size: 60, sha: "a10" },
      { path: ".github/workflows/ci.yml", type: "blob", size: 40, sha: "a11" },
      { path: "docs", type: "tree", sha: "a12" },
      { path: "docs/guide.md", type: "blob", size: 120, sha: "a13" },
    ],
  };
}

export interface FakeGitHubOptions {
  remaining?: number;
  /** Override specific responses; return undefined to fall through to defaults. */
  handler?: (url: string) => Response | undefined;
}

export interface FakeGitHubFetch extends FetchLike {
  calls: string[];
}

/** Build a fetch implementation that serves canned GitHub REST responses. */
export function makeGitHubFetch(options: FakeGitHubOptions = {}): FakeGitHubFetch {
  const headers = rateLimitHeaders(options.remaining ?? 59);
  const calls: string[] = [];

  const fetchImpl: FakeGitHubFetch = (url: string): Promise<Response> => {
    calls.push(url);
    const custom = options.handler?.(url);
    if (custom) return Promise.resolve(custom);

    const { pathname } = new URL(url);

    if (pathname === "/search/repositories") {
      return Promise.resolve(
        jsonResponse(
          {
            total_count: 2,
            items: [
              repoObject("acme", "repo-a", { stargazers_count: 5000 }),
              repoObject("globex", "repo-b", { stargazers_count: 800 }),
            ],
          },
          { headers },
        ),
      );
    }
    const repoMatch = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(pathname);
    if (repoMatch) {
      const owner = repoMatch[1];
      const name = repoMatch[2];
      const sub = repoMatch[3] ?? "";
      if (sub === "") return Promise.resolve(jsonResponse(repoObject(owner, name), { headers }));
      if (sub === "/readme") return Promise.resolve(jsonResponse(readmeObject(), { headers }));
      if (sub === "/license") {
        return Promise.resolve(
          jsonResponse(
            { license: { key: "mit", name: "MIT License", spdx_id: "MIT" } },
            { headers },
          ),
        );
      }
      if (sub.startsWith("/git/trees/")) {
        const full = treeObject();
        // Honor the recursive flag so callers that omit it observe a shallower
        // tree (root entries only) — makes the `recursive` argument testable.
        if (!url.includes("recursive=1")) {
          const tree = (full.tree as Array<{ path: string }>).filter((e) => !e.path.includes("/"));
          return Promise.resolve(jsonResponse({ ...full, tree }, { headers }));
        }
        return Promise.resolve(jsonResponse(full, { headers }));
      }
      if (sub.startsWith("/releases")) return Promise.resolve(jsonResponse([], { headers }));
      if (sub.startsWith("/commits")) {
        return Promise.resolve(
          jsonResponse([{ commit: { committer: { date: new Date().toISOString() } } }], {
            headers,
          }),
        );
      }
      if (sub.startsWith("/contents/")) {
        return Promise.resolve(
          jsonResponse(
            {
              type: "file",
              encoding: "base64",
              size: 12,
              path: sub.replace("/contents/", ""),
              content: Buffer.from("hello world\n", "utf-8").toString("base64"),
            },
            { headers },
          ),
        );
      }
    }
    return Promise.resolve(jsonResponse({ message: "Not Found" }, { status: 404, headers }));
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
