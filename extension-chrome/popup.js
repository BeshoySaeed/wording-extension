/* ──────────────────────────────────────────────
   Figma Node Inspector — popup.js
   Manifest V3 · Vanilla JS · No dependencies
────────────────────────────────────────────── */
console.log('on open');

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = 'figma_inspector_inputs';

// ── Element refs ────────────────────────────────
const apiKeyInput    = $('api-key');
const fileIdInput    = $('file-id');
const pageIdInput    = $('page-id');
const fetchBtn       = $('fetch-btn');
const clearBtn       = $('clear-btn');
const statusBar      = $('status-bar');
const statusMsg      = $('status-msg');
const resultPanel    = $('result-panel');
const jsonOutput     = $('json-output');
const copyBtn        = $('copy-btn');
const copyLabel      = copyBtn.querySelector('.copy-label');
const pageNameLabel  = $('page-name-label');

// ── Persist inputs ──────────────────────────────
function saveInputs() {
  const data = {
    apiKey : apiKeyInput.value.trim(),
    fileId : fileIdInput.value.trim(),
    pageId : pageIdInput.value.trim(),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
}

function loadInputs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const { apiKey, fileId, pageId } = JSON.parse(raw);
    if (apiKey) apiKeyInput.value = apiKey;
    if (fileId) fileIdInput.value = fileId;
    if (pageId) pageIdInput.value = pageId;
  } catch (_) {}
}

function clearInputs() {
  apiKeyInput.value = '';
  fileIdInput.value = '';
  pageIdInput.value = '';
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  hideResult();
  hideStatus();
  [apiKeyInput, fileIdInput, pageIdInput].forEach(el => el.classList.remove('error-input'));
}

// ── UI helpers ──────────────────────────────────
function setLoading(on) {
  fetchBtn.classList.toggle('loading', on);
  fetchBtn.disabled = on;
}

function showStatus(msg, isError = false) {
  statusBar.className = 'status-bar visible fade-up ' + (isError ? 'err' : 'ok');
  statusMsg.textContent = msg;
}

function hideStatus() {
  statusBar.className = 'status-bar';
}

function showResult(pageName, jsonObj) {
  pageNameLabel.textContent = pageName || '—';
  jsonOutput.innerHTML = syntaxHighlight(JSON.stringify(jsonObj, null, 2));
  resultPanel.className = 'fade-up';
  resultPanel.id = 'result-panel';
  resultPanel.classList.add('visible');
}

function hideResult() {
  resultPanel.classList.remove('visible');
  jsonOutput.innerHTML = '';
  pageNameLabel.textContent = '—';
}

function markFieldError(el) {
  el.classList.add('error-input');
  el.addEventListener('input', () => el.classList.remove('error-input'), { once: true });
}

// ── JSON syntax highlighter ─────────────────────
function syntaxHighlight(json) {
  // Escape HTML entities first
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(
    /("(\\u[\dA-Fa-f]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-num';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-str';
      } else if (/true|false/.test(match)) {
        cls = 'json-bool';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

// ── Figma API call ──────────────────────────────
async function fetchFigmaNodes(apiKey, fileId, pageId) {
  console.log('Fetching from Figma API with:', { apiKey: '***', fileId, pageId });
  // Encode the page id (colons are valid but let's be safe)
  const encodedId = encodeURIComponent(pageId);
  const url = `https://api.figma.com/v1/files/${fileId}/nodes?ids=${encodedId}`;

  const res = await fetch(url, {
    headers: { 'X-Figma-Token': apiKey },
  });
  console.log('HTTP response status:', res);

  if (res.status === 403 || res.status === 401) {
    throw new FigmaError('Invalid API key or insufficient permissions.', 'auth');
  }
  if (res.status === 404) {
    throw new FigmaError('File not found. Check your File ID.', 'file');
  }
  if (!res.ok) {
    throw new FigmaError(`Figma API error: HTTP ${res.status}`, 'api');
  }

  const data = await res.json();
  const nodeSelector = pageId.replace('-', ':');
  const selectedNode = data?.nodes?.[nodeSelector];

  if (!selectedNode) {
    throw new FigmaError('Page not found in response. Check your Page ID.', 'page');
  }

  const aiPayload = window.WordingProcessor.createAiPayload(
    { nodes: { [nodeSelector]: selectedNode } },
    { fileId, pageId, pageName: data.name }
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  let aiData;

  try {
    const aiReponse = await fetch('http://localhost:3000/copilot-process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aiPayload),
      signal: controller.signal,
    });

    aiData = await aiReponse.json();
    if (!aiReponse.ok) {
      throw new Error(aiData.details || aiData.error || `Copilot server error: HTTP ${aiReponse.status}`);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Copilot server timed out after 30 seconds. Check whether server.js is running and the model request is completing.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  console.log('AI response:', aiData);
  if (data.err) {
    throw new FigmaError(`Figma returned an error: ${data.err}`, 'api');
  }

  return {
    pageName: data.name,
    aiResult: aiData?.response || null
  };
}

// Recursively extracts a clean node summary
function extractNode(node) {
  const out = {
    id   : node.id,
    name : node.name,
    type : node.type,
  };

  // Carry over a few commonly useful fields if present
  if (node.absoluteBoundingBox)  out.bounds = node.absoluteBoundingBox;
  if (node.fills?.length)        out.fills  = node.fills;
  if (node.characters !== undefined) out.characters = node.characters;
  if (node.style)                out.style  = node.style;
  if (node.componentId)          out.componentId = node.componentId;
  if (node.visible === false)    out.visible = false;

  if (node.children?.length) {
    out.children = node.children.map(c => extractNode(c));
  }

  return out;
}

// Custom error class to carry an error category
class FigmaError extends Error {
  constructor(message, category) {
    super(message);
    this.category = category;
  }
}

// ── Validation ──────────────────────────────────
function validateInputs(apiKey, fileId, pageId) {
  let valid = true;
  if (!apiKey) { markFieldError(apiKeyInput); valid = false; }
  if (!fileId) { markFieldError(fileIdInput); valid = false; }
  if (!pageId) { markFieldError(pageIdInput); valid = false; }
  return valid;
}

// ── Main handler ────────────────────────────────
async function handleFetch() {
  const apiKey = apiKeyInput.value.trim();
  const fileId = fileIdInput.value.trim();
  const pageId = pageIdInput.value.trim();

  hideResult();
  hideStatus();

  if (!validateInputs(apiKey, fileId, pageId)) {
    showStatus('Please fill in all three fields.', true);
    return;
  }

  saveInputs();
  setLoading(true);

  try {
    const result = await fetchFigmaNodes(apiKey, fileId, pageId);

    showStatus(
      `✓ Page "${result.pageName}" processed by AI`,
      false
    );

    // Show only OpenAI output
    showResult(result.pageName, result.aiResult || { error: 'Empty AI response' });
  } catch (err) {
    if (err.name === 'TypeError' || err.message.includes('fetch')) {
      showStatus('Network error — check your connection.', true);
    } else {
      showStatus(err.message || 'Unknown error.', true);
    }

    // Highlight offending field
    if (err.category === 'auth') markFieldError(apiKeyInput);
    if (err.category === 'file') markFieldError(fileIdInput);
    if (err.category === 'page') markFieldError(pageIdInput);
  } finally {
    setLoading(false);
  }
}

// ── Copy JSON ───────────────────────────────────
function handleCopy() {
  const text = jsonOutput.innerText;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.classList.add('copied');
    copyLabel.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyLabel.textContent = 'Copy JSON';
    }, 1800);
  }).catch(() => {
    // Fallback for restricted environments
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copyLabel.textContent = 'Copied!';
    setTimeout(() => { copyLabel.textContent = 'Copy JSON'; }, 1800);
  });
}

// ── Enter key shortcut ──────────────────────────
[apiKeyInput, fileIdInput, pageIdInput].forEach(el => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !fetchBtn.disabled) handleFetch();
  });
});

// ── Wire events ─────────────────────────────────
fetchBtn.addEventListener('click', handleFetch);
clearBtn.addEventListener('click', clearInputs);
copyBtn.addEventListener('click', handleCopy);

// ── Boot ─────────────────────────────────────────
loadInputs();
