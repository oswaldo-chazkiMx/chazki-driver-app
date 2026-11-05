const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "chazki-ops-header-"));
const repo = path.join(temp, "repo");
function run(args, cwd = repo) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed with status ${result.status}`);
  return result.stdout || "";
}
try {
  run(["clone", "--branch", "main", "--single-branch", "https://github.com/oswaldo-chazkiMx/chazki-driver-app.git", repo], temp);
  fs.copyFileSync(path.join(root, "ops.html"), path.join(repo, "ops.html"));
  run(["add", "--", "ops.html"]);
  run(["diff", "--cached", "--check"]);
  run(["-c", "user.name=Copilot", "-c", "user.email=223556219+Copilot@users.noreply.github.com", "commit", "-m", "Keep operations header fixed while scrolling", "-m", "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"]);
  run(["push", "origin", "HEAD:main"]);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
