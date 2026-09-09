async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const form = document.getElementById('captureForm');
const statusEl = document.getElementById('captureStatus');
const queueEl = document.getElementById('queueContent');
const treeList = document.getElementById('treeList');
const fileContent = document.getElementById('fileContent');
const pathInput = document.getElementById('pathInput');

document.getElementById('loadQueueBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/file?path=governance/input-queue.md');
    queueEl.textContent = data.content;
  } catch (e) {
    queueEl.textContent = `Failed: ${e.message}`;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = 'Saving...';
  const fd = new FormData(form);
  const payload = {
    type: fd.get('type'),
    source: fd.get('source'),
    capturedBy: fd.get('capturedBy'),
    channel: fd.get('channel'),
    confidence: fd.get('confidence'),
    tags: String(fd.get('tags') || '').split(',').map(s => s.trim()).filter(Boolean),
    attachments: String(fd.get('attachments') || '').split(',').map(s => s.trim()).filter(Boolean),
    note: fd.get('note'),
  };
  try {
    const result = await api('/api/capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    statusEl.textContent = `Saved: ${result.path} (source ${result.source_id})`;
    form.reset();
  } catch (err) {
    statusEl.textContent = `Failed: ${err.message}`;
  }
});

async function loadPath(p) {
  const data = await api(`/api/tree?path=${encodeURIComponent(p)}`);
  treeList.innerHTML = '';
  fileContent.textContent = '';
  if (data.type === 'file') {
    const file = await api(`/api/file?path=${encodeURIComponent(p)}`);
    fileContent.textContent = file.content;
    return;
  }

  for (const entry of data.entries || []) {
    const li = document.createElement('li');
    const full = (p === '.' || p === '') ? entry.name : `${p}/${entry.name}`;
    li.textContent = `${entry.type === 'dir' ? '📁' : '📄'} ${entry.name}`;
    li.addEventListener('click', async () => {
      pathInput.value = full;
      if (entry.type === 'dir') {
        await loadPath(full);
      } else {
        const file = await api(`/api/file?path=${encodeURIComponent(full)}`);
        fileContent.textContent = file.content;
      }
    });
    treeList.appendChild(li);
  }
}

document.getElementById('loadPathBtn').addEventListener('click', async () => {
  try {
    await loadPath(pathInput.value.trim() || '.');
  } catch (e) {
    treeList.innerHTML = `<li>Failed: ${e.message}</li>`;
  }
});

loadPath('2-summaries').catch(() => {});
