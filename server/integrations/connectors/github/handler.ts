import { createRestHandler } from "../../kernel/baseConnectorHandler";
import { githubManifest } from "./manifest";

const API_BASE = "https://api.github.com";

export const handler = createRestHandler(githubManifest, API_BASE, {
  "github_search_issues": { path: "/search/issues", method: "GET" },
  "github_create_issue": { path: "/repos/{owner}/{repo}/issues", method: "POST" },
});
