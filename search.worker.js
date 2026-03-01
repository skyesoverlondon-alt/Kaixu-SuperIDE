/*
  search.worker.js — Background web worker for workspace-wide search indexing.
  Receives messages: { type: 'search', files: [{path,content}], query, options }
  Posts back:        { type: 'results', results: [{path, matches:[...]}] }
                     { type: 'progress', done, total }
*/

self.onmessage = function (e) {
  const msg = e.data;
  if (msg.type === 'search') {
    const results = _runSearch(msg.files || [], msg.query, msg.options || {});
    self.postMessage({ type: 'results', results });
  } else if (msg.type === 'index') {
    // Future: build a trigram/inverted index and cache it.
    // For now, just ack.
    self.postMessage({ type: 'indexed', count: (msg.files || []).length });
  }
};

function _buildPattern(raw, options) {
  const { useRegex, caseSensitive, wholeWord } = options;
  const flags = 'g' + (caseSensitive ? '' : 'i');
  let src = useRegex ? raw : raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) src = '\\b' + src + '\\b';
  try { return new RegExp(src, flags); }
  catch { return null; }
}

function _runSearch(files, raw, options) {
  if (!raw) return [];
  const pattern = _buildPattern(raw, options);
  if (!pattern) return [];

  const results = [];
  const total   = files.length;
  let done      = 0;

  for (const f of files) {
    const content = f.content || '';
    // Skip binary blobs
    if (content.startsWith('__b64__:') || content.startsWith('data:')) {
      done++;
      continue;
    }

    const lines      = content.split('\n');
    const fileMatches = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(line)) !== null) {
        fileMatches.push({
          line:       i + 1,
          col:        m.index + 1,
          text:       line,
          matchStart: m.index,
          matchLen:   m[0].length,
        });
        if (!pattern.global) break;
      }
    }

    if (fileMatches.length) results.push({ path: f.path, matches: fileMatches });

    done++;
    // Post progress every 50 files
    if (done % 50 === 0) {
      self.postMessage({ type: 'progress', done, total });
    }
  }

  return results;
}
