// A tiny, dependency-free Markdown renderer — enough to prove that a .md file can
// live in a presentation folder and render in the browser with nothing external.
// For anything richer, vendor a real renderer (e.g. marked.js) into the folder.

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (s) =>
  escapeHtml(s)
    // Images first (![alt](src)) so the link rule doesn't eat the [alt](src) part.
    // src may be relative (./img/x.png) or absolute — drop the file in the folder.
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />')
    .replace(/\[([^\]]+)\]\(((?:https?:|\.\/|\.\.\/|\/)[^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

function renderMarkdown(md) {
  const out = [];
  let list = null; // open <ul> buffer
  const flushList = () => {
    if (list) {
      out.push('<ul>' + list.map((li) => `<li>${inline(li)}</li>`).join('') + '</ul>');
      list = null;
    }
  };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushList(); continue; }
    let m;
    if ((m = line.match(/^###\s+(.*)$/))) { flushList(); out.push(`<h3>${inline(m[1])}</h3>`); }
    else if ((m = line.match(/^##\s+(.*)$/))) { flushList(); out.push(`<h2>${inline(m[1])}</h2>`); }
    else if ((m = line.match(/^#\s+(.*)$/))) { flushList(); out.push(`<h2>${inline(m[1])}</h2>`); }
    else if ((m = line.match(/^[-*]\s+(.*)$/))) { (list ??= []).push(m[1]); }
    else { flushList(); out.push(`<p>${inline(line)}</p>`); }
  }
  flushList();
  return out.join('\n');
}

fetch('./content.md')
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  })
  .then((md) => {
    document.getElementById('content').innerHTML = renderMarkdown(md);
  })
  .catch((err) => {
    document.getElementById('content').innerHTML =
      `<p>Couldn't load <code>content.md</code> (${escapeHtml(String(err.message))}). ` +
      `Serve the folder over HTTP — e.g. <code>python3 -m http.server</code>.</p>`;
  });
