import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function findMutableActionRefs(repoRoot = process.cwd()) {
  const workflowDir = path.join(repoRoot, ".github", "workflows");
  if (!fs.existsSync(workflowDir)) {
    return [];
  }

  const violations = [];
  for (const name of fs.readdirSync(workflowDir).sort()) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) {
      continue;
    }

    const workflowPath = path.join(workflowDir, name);
    const lines = fs.readFileSync(workflowPath, "utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const match = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/);
      if (!match) {
        continue;
      }

      const actionRef = match[1];
      if (actionRef.startsWith("./") || actionRef.startsWith("docker://")) {
        continue;
      }

      const separator = actionRef.lastIndexOf("@");
      const revision = separator >= 0 ? actionRef.slice(separator + 1) : "";
      if (!/^[0-9a-f]{40}$/.test(revision)) {
        violations.push(
          `.github/workflows/${name}:${index + 1}: external action must use a full lowercase commit SHA: ${actionRef}`,
        );
      }
    }
  }

  return violations;
}

function main() {
  const violations = findMutableActionRefs();
  if (violations.length > 0) {
    console.error("Mutable GitHub Action reference(s) found:");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("All external GitHub Actions use immutable full commit SHAs.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
