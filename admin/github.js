/* ============================================================
   github.js — 레포트를 깃허브에 한꺼번에 올리기

   Contents API 로 파일을 하나씩 올리면 40명 = 커밋 40개가 되고
   Pages 재빌드도 40번 돈다. 느리고 지저분하다.

   그래서 Git Data API 를 쓴다. 파일이 몇 개든 커밋은 하나다.

     1) 지금 main 이 가리키는 커밋을 읽는다
     2) 파일마다 blob 을 만든다  (여러 개를 동시에, 진행률 표시)
     3) 그 blob 들로 tree 를 만든다  (기존 tree 위에 얹는다)
     4) commit 을 하나 만든다
     5) main 을 그 커밋으로 옮긴다

   토큰은 이 브라우저에만 둔다. 저장소 코드에는 절대 넣지 않는다.
   ============================================================ */

(function (global) {
  'use strict';

  /* 저장소는 config.js 에 적혀 있다 */
  var OWNER  = global.CONFIG.github.owner;
  var REPO   = global.CONFIG.github.repo;
  var BRANCH = global.CONFIG.github.branch;
  var API = 'https://api.github.com';

  /* 한 번에 보내는 blob 개수. 너무 크게 잡으면 깃허브가 막는다. */
  var CONCURRENCY = 6;

  function headers(token) {
    return {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }

  function call(token, path, options) {
    options = options || {};
    return fetch(API + path, {
      method: options.method || 'GET',
      headers: headers(token),
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok) throw translate(res.status, data, path);
        return data;
      });
    }, function () {
      throw new Error('깃허브에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    });
  }

  function translate(status, data, path) {
    var msg = (data && data.message) || '';

    if (status === 401) {
      return new Error('토큰이 올바르지 않습니다. 다시 발급해 넣어 주세요.');
    }
    if (status === 403 && /rate limit/i.test(msg)) {
      return new Error('깃허브 요청 한도를 넘었습니다. 잠시 뒤에 다시 시도해 주세요.');
    }
    if (status === 403 || status === 404) {
      /* fine-grained 토큰은 권한이 없으면 404 를 준다 */
      return new Error(
        '저장소에 쓸 권한이 없습니다. 토큰을 만들 때 ' +
        'Repository access 에서 ' + REPO + ' 를 고르고, ' +
        'Contents 를 Read and write 로 주었는지 확인해 주세요.'
      );
    }
    if (status === 409) {
      return new Error('저장소가 방금 바뀌었습니다. 새로고침한 뒤 다시 올려 주세요.');
    }
    if (status === 422) {
      return new Error('깃허브가 내용을 거부했습니다: ' + msg);
    }
    return new Error('깃허브 오류 (' + status + ') ' + msg + ' [' + path + ']');
  }

  /* ---------- 토큰 확인 ---------- */

  /* 토큰이 이 저장소에 쓸 수 있는지 미리 본다.
     발행 버튼을 누른 뒤에 실패하면 학생 40명분을 다시 해야 하므로 먼저 확인한다. */
  function checkToken(token) {
    if (!token || !token.trim()) return Promise.reject(new Error('토큰을 입력해 주세요.'));

    return call(token, '/repos/' + OWNER + '/' + REPO).then(function (repo) {
      if (!repo.permissions || !repo.permissions.push) {
        throw new Error('이 토큰에는 쓰기 권한이 없습니다. Contents 를 Read and write 로 주세요.');
      }
      return {
        repo: repo.full_name,
        private: repo.private,
        canPush: true
      };
    });
  }

  /* ---------- 발행 ---------- */

  /* files: [{ path: '/r/2026/0601-haneul-a7f3.html', content: '<!DOCTYPE html>…' }]
     onProgress(done, total, label) */
  function publish(token, files, message, onProgress) {
    if (!files || !files.length) return Promise.reject(new Error('올릴 파일이 없습니다.'));

    var total = files.length + 4;      /* blob 들 + ref·commit·tree·ref 갱신 */
    var done = 0;
    function step(label) {
      done++;
      if (onProgress) onProgress(done, total, label);
    }

    var baseCommitSha, baseTreeSha;

    return call(token, '/repos/' + OWNER + '/' + REPO + '/git/ref/heads/' + BRANCH)
      .then(function (ref) {
        baseCommitSha = ref.object.sha;
        step('저장소 상태 확인');
        return call(token, '/repos/' + OWNER + '/' + REPO + '/git/commits/' + baseCommitSha);
      })
      .then(function (commit) {
        baseTreeSha = commit.tree.sha;
        step('기준 커밋 읽기');

        /* blob 을 몇 개씩 나눠 올린다 */
        return mapLimit(files, CONCURRENCY, function (f) {
          return call(token, '/repos/' + OWNER + '/' + REPO + '/git/blobs', {
            method: 'POST',
            body: { content: toBase64(f.content), encoding: 'base64' }
          }).then(function (blob) {
            step('파일 올리는 중');
            return { path: f.path.replace(/^\//, ''), mode: '100644', type: 'blob', sha: blob.sha };
          });
        });
      })
      .then(function (treeItems) {
        return call(token, '/repos/' + OWNER + '/' + REPO + '/git/trees', {
          method: 'POST',
          body: { base_tree: baseTreeSha, tree: treeItems }
        });
      })
      .then(function (tree) {
        step('묶는 중');
        return call(token, '/repos/' + OWNER + '/' + REPO + '/git/commits', {
          method: 'POST',
          body: { message: message, tree: tree.sha, parents: [baseCommitSha] }
        });
      })
      .then(function (commit) {
        step('커밋 만드는 중');
        return call(token, '/repos/' + OWNER + '/' + REPO + '/git/refs/heads/' + BRANCH, {
          method: 'PATCH',
          body: { sha: commit.sha, force: false }
        }).then(function () {
          return { sha: commit.sha, count: files.length };
        });
      });
  }

  /* 한글이 든 문자열을 base64 로. btoa 는 한글을 그대로 못 받는다. */
  function toBase64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    var CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  /* 동시에 몇 개씩만 처리한다 */
  function mapLimit(list, limit, fn) {
    var results = new Array(list.length);
    var next = 0;
    var failed = null;

    function worker() {
      if (failed) return Promise.resolve();
      var i = next++;
      if (i >= list.length) return Promise.resolve();
      return Promise.resolve()
        .then(function () { return fn(list[i], i); })
        .then(function (r) { results[i] = r; return worker(); })
        .catch(function (e) { failed = failed || e; });
    }

    var workers = [];
    for (var k = 0; k < Math.min(limit, list.length); k++) workers.push(worker());

    return Promise.all(workers).then(function () {
      if (failed) throw failed;
      return results;
    });
  }

  /* ---------- 반영 확인 ----------
     커밋한 뒤 Pages 가 다시 빌드될 때까지 1~2분 걸린다.
     실제로 열리는지 확인한 다음에 링크를 넘겨야 사고가 없다. */
  function waitForPages(urls, onTick) {
    var deadline = Date.now() + 5 * 60 * 1000;
    var remaining = urls.slice();

    function round() {
      return Promise.all(remaining.map(function (u) {
        return fetch(u, { method: 'GET', cache: 'no-store' })
          .then(function (r) { return r.ok ? u : null; })
          .catch(function () { return null; });
      })).then(function (results) {
        var okList = results.filter(Boolean);
        remaining = remaining.filter(function (u) { return okList.indexOf(u) === -1; });
        if (onTick) onTick(urls.length - remaining.length, urls.length);

        if (!remaining.length) return true;
        if (Date.now() > deadline) return false;
        return new Promise(function (res) { setTimeout(res, 8000); }).then(round);
      });
    }
    return round();
  }

  global.GH = {
    OWNER: OWNER, REPO: REPO, BRANCH: BRANCH,
    SITE: 'https://' + OWNER + '.github.io/' + REPO,
    checkToken: checkToken,
    publish: publish,
    waitForPages: waitForPages,
    toBase64: toBase64,
    mapLimit: mapLimit
  };

})(window);
