import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { findMutableActionRefs } from "./verify-github-actions-pins.mjs";

function fixture(workflow) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "action-pins-"));
  const workflowDir = path.join(root, ".github", "workflows");
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(path.join(workflowDir, "ci.yml"), workflow);
  return root;
}

test("accepts immutable external, local, and docker action references", () => {
  const root = fixture(`jobs:
  verify:
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
      - uses: ./local-action
      - uses: docker://alpine:3.22
`);
  assert.deepEqual(findMutableActionRefs(root), []);
});

test("rejects mutable tags and missing revisions", () => {
  const root = fixture(`jobs:
  verify:
    steps:
      - uses: actions/checkout@v6
      - uses: example/no-ref
`);
  const violations = findMutableActionRefs(root);
  assert.equal(violations.length, 2);
  assert.match(violations[0], /actions\/checkout@v6/);
  assert.match(violations[1], /example\/no-ref/);
});

test("rejects abbreviated and uppercase revisions", () => {
  const root = fixture(`jobs:
  verify:
    steps:
      - uses: actions/checkout@df4cb1c
      - uses: actions/checkout@DF4CB1C069E1874EDD31B4311F1884172CEC0E10
`);
  assert.equal(findMutableActionRefs(root).length, 2);
});
