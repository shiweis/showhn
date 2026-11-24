import test from "node:test";
import assert from "node:assert/strict";
import { displayDomain } from "../src/lib/display-domain";

test("a card shows the site a project lives on, without www", () => {
  assert.equal(displayDomain("https://www.example.com/pricing?ref=hn"), "example.com");
  assert.equal(displayDomain("http://Tools.Example.co.uk"), "tools.example.co.uk");
});

test("a GitHub link shows whose repository it is", () => {
  assert.equal(displayDomain("https://github.com/acme/widget/tree/main/docs"), "github.com/acme/widget");
  assert.equal(displayDomain("https://github.com/acme"), "github.com/acme");
  assert.equal(displayDomain("https://github.com/"), "github.com");
});

test("anything that is not a web address shows no site", () => {
  for (const value of [null, undefined, "", "not a url", "javascript:alert(1)", "ftp://files.example.com/x", "mailto:nobody"]) {
    assert.equal(displayDomain(value), null, String(value));
  }
});
