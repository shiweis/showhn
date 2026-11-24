import test from "node:test";
import assert from "node:assert/strict";
import { backTarget, isListPath, rememberList } from "../src/lib/back-to-browse";

test("the pages that list posts are known as lists, and a post page is not", () => {
  for (const path of ["/", "/category/ai-ml", "/search", "/digest", "/divergence"]) {
    assert.equal(isListPath(path), true, path);
  }
  for (const path of ["/post/123/some-project", "/about", "/categories", "/searching"]) {
    assert.equal(isListPath(path), false, path);
  }
});

test("a post opened from a filtered list goes back to that list, keeping the visitor's place", () => {
  const target = backTarget({
    currentPath: "/post/123/some-project",
    previousUrl: "/category/ai-ml?t=week&sort=points",
    trail: ["/category/ai-ml?t=week&sort=points"],
  });

  assert.deepEqual(target, { kind: "back" });
});

test("a post opened straight from elsewhere goes to the home page", () => {
  const target = backTarget({ currentPath: "/post/123/some-project", previousUrl: null, trail: [] });

  assert.deepEqual(target, { kind: "go", href: "/" });
});

test("a post reached from another post returns to the list the visitor last browsed", () => {
  const target = backTarget({
    currentPath: "/post/456/another-project",
    previousUrl: "/post/123/some-project",
    trail: ["/", "/?t=month&cat=Data"],
  });

  assert.deepEqual(target, { kind: "go", href: "/?t=month&cat=Data" });
});

test("in a new tab there is nothing to go back to, so the remembered list is opened", () => {
  const target = backTarget({ currentPath: "/post/123/some-project", previousUrl: null, trail: ["/category/gaming"] });

  assert.deepEqual(target, { kind: "go", href: "/category/gaming" });
});

test("from the search page it returns to the list before it, not to an earlier search", () => {
  const target = backTarget({
    currentPath: "/search",
    previousUrl: "/search?q=rust",
    trail: ["/?cat=Data", "/search?q=rust", "/search?q=rust+database"],
  });

  assert.deepEqual(target, { kind: "go", href: "/?cat=Data" });
});

test("from the digest it goes back to the list the visitor came from", () => {
  const target = backTarget({ currentPath: "/digest", previousUrl: "/?t=month", trail: ["/?t=month", "/digest"] });

  assert.deepEqual(target, { kind: "back" });
});

test("the remembered lists are the last three different ones, newest last", () => {
  let trail: string[] = [];
  for (const url of ["/", "/category/ai-ml", "/", "/search?q=rust", "/digest"]) trail = rememberList(trail, url);

  assert.deepEqual(trail, ["/", "/search?q=rust", "/digest"]);
});

test("a page that is not a list is not remembered", () => {
  assert.deepEqual(rememberList(["/"], "/post/123/some-project"), ["/"]);
});
