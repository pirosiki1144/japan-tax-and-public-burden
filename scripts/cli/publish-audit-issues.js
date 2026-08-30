import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

function githubClient({ repository, token, fetchImpl = globalThis.fetch }) {
  const request = async (path, init = {}) => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...init.headers
      }
    });
    if (!response.ok) throw new Error(`GitHub API failed (${response.status}): ${await response.text()}`);
    return response.json();
  };
  return {
    async findOpen(marker) {
      const query = encodeURIComponent(`repo:${repository} is:issue is:open "${marker}" in:body`);
      const result = await request(`/search/issues?q=${query}&per_page=1`);
      return result.items?.[0] ?? null;
    },
    async create(candidate) {
      return request(`/repos/${repository}/issues`, { method: "POST", body: JSON.stringify({ title: candidate.title, body: candidate.body }) });
    },
    async comment(issueNumber, candidate) {
      return request(`/repos/${repository}/issues/${issueNumber}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: `## 自動監査による再検知\n\n同じ重複判定キーの事象を再検知しました。過去の記録を削除せず、今回の監査結果を追記します。\n\n${candidate.body}` })
      });
    }
  };
}

export async function publishAuditIssues({ candidates, findOpen, create, comment = async () => {} }) {
  const results = [];
  for (const candidate of candidates) {
    const existing = await findOpen(candidate.marker);
    if (existing) {
      await comment(existing.number, candidate);
      results.push({ topic_key: candidate.topic_key, status: "updated", number: existing.number, url: existing.html_url });
    }
    else {
      const created = await create(candidate);
      results.push({ topic_key: candidate.topic_key, status: "created", number: created.number, url: created.html_url });
    }
  }
  return results;
}

const reportPath = option("report");
if (process.argv[1]?.endsWith("publish-audit-issues.js")) {
  if (!reportPath) {
    console.error("Usage: node scripts/audit/publish-audit-issues.js --report <audit.json>");
    process.exitCode = 2;
  } else {
    try {
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      const repository = process.env.GITHUB_REPOSITORY;
      const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
      if (!repository || !token) throw new Error("GITHUB_REPOSITORY and GH_TOKEN are required");
      const client = githubClient({ repository, token });
      const results = await publishAuditIssues({ candidates: report.issue_candidates ?? [], findOpen: client.findOpen, create: client.create, comment: client.comment });
      console.log(JSON.stringify({ status: "complete", results }));
    } catch (error) {
      console.error(JSON.stringify({ status: "error", error: error.message }));
      process.exitCode = 1;
    }
  }
}
