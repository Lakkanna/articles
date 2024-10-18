const gthub = require("@actions/github");
const actionCore = require("@actions/core");

console.log("------------- code review -------------");

function analyzeDiff(diff) {
  const issues = [];
  const lines = diff.split("\n");
  let currentFile = "";
  let lineNumber = 0;

  for (const line of lines) {
    if (line.startsWith("+++")) {
      currentFile = line.substring(4).trim();
      lineNumber = 0;
    } else if (line.startsWith("+")) {
      lineNumber++;
      const code = line.substring(1);

      // Check for console.log statements
      if (code.includes("console.log")) {
        issues.push({
          file: currentFile,
          line: lineNumber,
          message: "Avoid using console.log in production code",
        });
      }

      // Check for 'any' type in TypeScript
      if (code.includes(": any")) {
        issues.push({
          file: currentFile,
          line: lineNumber,
          message:
            'Avoid using the "any" type. Specify a more precise type instead',
        });
      }

      // Check for non-null assertion
      if (code.includes("!.") || code.endsWith("!")) {
        issues.push({
          file: currentFile,
          line: lineNumber,
          message:
            "Avoid using non-null assertions (!). Use optional chaining (?.) instead",
        });
      }

      // Check for useState without explicit type
      if (code.includes("useState(") && !code.includes("useState<")) {
        issues.push({
          file: currentFile,
          line: lineNumber,
          message: "Specify explicit type for useState",
        });
      }

      // Check for inline styles
      if (code.includes("style={{")) {
        issues.push({
          file: currentFile,
          line: lineNumber,
          message:
            "Avoid inline styles. Use styled-components or CSS modules instead",
        });
      }

      // Check for hardcoded strings that might need internationalization
      if (code.match(/"[A-Za-z\s]{10,}"/)) {
        issues.push({
          file: currentFile,
          line: lineNumber,
          message:
            "Consider using internationalization for user-facing strings",
        });
      }

      // Check for TODO comments
      if (code.toLowerCase().includes("todo")) {
        issues.push({
          file: currentFile,
          line: lineNumber,
          message: "TODO found. Consider creating an issue instead",
        });
      }
    }
  }

  return issues;
}

async function run() {
  try {
    const context = gthub.context;
    const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
    console.log("GITHUB_TOKEN", process.env.GITHUB_TOKEN);
    console.log("core token", actionCore.getInput("github-token"));
    console.log("token", actionCore.getInput("github-token"));
    const { data: pullRequest } = await octokit.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
    });

    const { data: diff } = await octokit.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
      mediaType: { format: "diff" },
    });

    const issues = analyzeDiff(diff);

    for (const issue of issues) {
      try {
        const { data: fileContent } = await octokit.request(
          "GET /repos/{owner}/{repo}/contents/{path}",
          {
            owner: context.repo.owner,
            repo: context.repo.repo,
            path: issue.file,
            ref: pullRequest.head.sha,
          }
        );

        const fileLines = Buffer.from(fileContent.content, "base64")
          .toString()
          .split("\n");
        const startLine = Math.max(1, issue.line - 3);
        const endLine = Math.min(fileLines.length, issue.line + 3);
        const diffHunk = fileLines.slice(startLine - 1, endLine).join("\n");

        await octokit.rest.pulls.createReviewComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          pull_number: context.payload.pull_request.number,
          body: issue.message,
          commit_id: pullRequest.head.sha,
          path: issue.file,
          line: issue.line,
          side: "RIGHT",
          start_line: startLine,
          start_side: "RIGHT",
          diff_hunk: `@@ -${startLine},${
            endLine - startLine + 1
          } +${startLine},${endLine - startLine + 1} @@\n${diffHunk}`,
        });
      } catch (error) {
        console.error(`Error fetching file content: ${error.message}`);
        console.error(`Status: ${error.status}`);
        console.error(`Response: ${JSON.stringify(error.response)}`);
        actionCore.setFailed(error.message);
      }
    }

    console.log(`Added ${issues.length} review comments.`);
  } catch (error) {
    actionCore.setFailed(error.message);
  }
}

run();
