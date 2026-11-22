import test from "node:test";
import assert from "node:assert/strict";
import { buildPostText } from "../src/lib/ai/llm";
import { stripGitHubChrome } from "../src/lib/page-text";

// The shape of a repository page's text as GitHub serves it: the page title, about
// 2,000 characters of site navigation, then the repository itself.
const NAVIGATION =
  "Skip to content Navigation Menu Sign in Products Platform GitHub Repository hosting, code review, and collaboration " +
  "Copilot AI coding agent ".repeat(80) +
  "Sign up Notifications You must be signed in to change notification settings";
const REPOSITORY = "Fork 0 Star 8 main Branches Tags Folders and files README.md Repository files navigation README TinyApp builds apps in C.";
const GITHUB_PAGE = `GitHub - someone/tinyapp: a small C app framework · GitHub ${NAVIGATION} ${REPOSITORY}`;

test("GitHub's navigation menu is dropped from a repository page's text", () => {
  assert.equal(stripGitHubChrome(GITHUB_PAGE), `GitHub - someone/tinyapp: a small C app framework · GitHub ${REPOSITORY}`);
});

test("page text without GitHub's navigation is left exactly as it is", () => {
  const ordinary = "Acme Notes. A tiny notes app. Skip to content is also a link on plenty of other sites.";
  assert.equal(stripGitHubChrome(ordinary), ordinary);

  const deepInPage = `${"Long article text. ".repeat(40)}Skip to content Navigation Menu ... You must be signed in to change notification settings`;
  assert.equal(stripGitHubChrome(deepInPage), deepInPage);

  const cutBeforeTheEnd = GITHUB_PAGE.slice(0, 400);
  assert.equal(stripGitHubChrome(cutBeforeTheEnd), cutBeforeTheEnd);
});

test("the judge is shown a GitHub repository's own text, not GitHub's navigation menu", () => {
  const text = buildPostText({
    id: 1,
    title: "Show HN: TinyApp",
    url: "https://github.com/someone/tinyapp",
    pageContent: GITHUB_PAGE,
    storyText: null,
  });

  assert.ok(!text.includes("Navigation Menu"));
  assert.ok(text.includes("Page content (truncated):\nGitHub - someone/tinyapp: a small C app framework · GitHub Fork 0 Star 8"));
  assert.ok(text.includes("TinyApp builds apps in C."));
});
