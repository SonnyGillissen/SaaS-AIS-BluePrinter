'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const workflow = readFileSync(join(__dirname, '..', '.github/workflows/publish-wiki.yml'), 'utf8');
const script = workflow.split('        run: |\n')[1].split('\n')
  .map((line) => line.replace(/^          /, '')).join('\n');

function runPublish(token, cloneStatus = 0, diffStatus = 0) {
  return spawnSync('bash', ['-e', '-c', `
    git() {
      printf 'git %s\\n' "$*"
      case "$1" in
        clone) return ${cloneStatus} ;;
        diff) return ${diffStatus} ;;
      esac
    }
    rsync() { echo rsync; }
    find() { echo find; }
    cd() { :; }
    ${script}
  `], {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: token, REPO: 'owner/repository', GITHUB_SHA: 'test-sha' }
  });
}

test('wiki publishing uses a dedicated secret without checkout credential interference', () => {
  assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.WIKI_TOKEN \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /contents: read/);
});

test('wiki publishing skips safely when its token is not configured', () => {
  const result = runPublish('');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /::warning::.*WIKI_TOKEN/);
  assert.doesNotMatch(result.stdout, /git |rsync|find/);
});

test('wiki clone failure reports setup guidance and does not publish', () => {
  const result = runPublish('test-token', 128);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /::error::.*Enable Wikis.*first page.*WIKI_TOKEN/);
  assert.doesNotMatch(result.stdout, /rsync|find|git commit|git push/);
});

test('configured wiki publishing keeps no-change and changed-content behavior', () => {
  for (const diffStatus of [0, 1]) {
    const result = runPublish('test-token', 0, diffStatus);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /git clone https:\/\/x-access-token:test-token@github.com\/owner\/repository\.wiki\.git/);
    assert.match(result.stdout, /rsync\nfind\n/);
    if (diffStatus === 0) {
      assert.match(result.stdout, /Wiki is up to date/);
      assert.doesNotMatch(result.stdout, /git commit|git push/);
    } else {
      assert.match(result.stdout, /git commit -m Update wiki from test-sha/);
      assert.match(result.stdout, /git push/);
    }
  }
});
