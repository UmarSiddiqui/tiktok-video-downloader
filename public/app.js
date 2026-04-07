// Dark mode
const html = document.documentElement;
const themeToggle = document.getElementById('theme-toggle');
const iconMoon = document.getElementById('icon-moon');
const iconSun = document.getElementById('icon-sun');

function applyTheme(dark) {
  html.setAttribute('data-theme', dark ? 'dark' : 'light');
  iconMoon.classList.toggle('hidden', dark);
  iconSun.classList.toggle('hidden', !dark);
}

const savedTheme = localStorage.getItem('theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
applyTheme(savedTheme ? savedTheme === 'dark' : prefersDark);

themeToggle.addEventListener('click', () => {
  const dark = html.getAttribute('data-theme') !== 'dark';
  applyTheme(dark);
  localStorage.setItem('theme', dark ? 'dark' : 'light');
});

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
  });
});

// --- Download Tab ---
const downloadBtn = document.getElementById('download-btn');
const urlInput = document.getElementById('tiktok-url');
const downloadStatus = document.getElementById('download-status');
const qualityRow = document.getElementById('quality-row');
const qualitySelect = document.getElementById('quality-select');

function showStatus(el, type, text, isLoading = false) {
  el.className = `status ${type}`;
  el.textContent = '';
  if (isLoading) {
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    el.appendChild(spinner);
    el.appendChild(document.createTextNode(' ' + text));
  } else {
    el.textContent = text;
  }
  el.classList.remove('hidden');
}

// Fetch available qualities when the URL field loses focus or Enter is pressed
let lastFetchedUrl = '';
async function loadQualities() {
  const url = urlInput.value.trim();
  if (!url || url === lastFetchedUrl) return;
  lastFetchedUrl = url;

  qualityRow.classList.add('hidden');
  qualitySelect.innerHTML = '';
  downloadStatus.classList.add('hidden');

  showStatus(downloadStatus, 'loading', 'Fetching available qualities…', true);

  try {
    const res = await fetch('/api/formats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok) {
      showStatus(downloadStatus, 'error', data.error || 'Could not fetch qualities.');
      return;
    }

    downloadStatus.classList.add('hidden');
    data.qualities.forEach(q => {
      const opt = document.createElement('option');
      opt.value = q.formatId;
      opt.textContent = q.label;
      qualitySelect.appendChild(opt);
    });
    qualityRow.classList.remove('hidden');
  } catch (err) {
    showStatus(downloadStatus, 'error', 'Network error. Is the server running?');
  }
}


// Auto-fetch qualities when a valid TikTok URL is pasted/typed
const TIKTOK_URL_RE = /^https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\//;
let debounceTimer;
urlInput.addEventListener('input', () => {
  const url = urlInput.value.trim();
  clearTimeout(debounceTimer);
  if (url !== lastFetchedUrl) {
    qualityRow.classList.add('hidden');
    downloadStatus.classList.add('hidden');
    lastFetchedUrl = '';
    qualitySelect.innerHTML = '';
  }
  if (TIKTOK_URL_RE.test(url)) {
    debounceTimer = setTimeout(loadQualities, 400);
  }
});

downloadBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) {
    showStatus(downloadStatus, 'error', 'Please paste a TikTok URL.');
    return;
  }

  if (!qualitySelect.value) {
    showStatus(downloadStatus, 'error', 'Please wait for qualities to load.');
    return;
  }

  const formatId = qualitySelect.value;
  const qualityLabel = qualitySelect.options[qualitySelect.selectedIndex]?.text || 'Best quality';

  downloadBtn.disabled = true;
  showStatus(downloadStatus, 'loading', `Downloading ${qualityLabel}…`, true);

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formatId }),
    });
    const data = await res.json();

    if (!res.ok) {
      showStatus(downloadStatus, 'error', data.error || 'Something went wrong.');
    } else {
      // Auto-trigger the browser file download
      const a = document.createElement('a');
      a.href = data.downloadUrl;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showStatus(downloadStatus, 'success', 'Download started — check your Downloads folder.');
    }
  } catch (err) {
    showStatus(downloadStatus, 'error', 'Network error. Is the server running?');
  } finally {
    downloadBtn.disabled = false;
  }
});

// --- Extract Frames Tab ---
const extractBtn = document.getElementById('extract-btn');
const videoUpload = document.getElementById('video-upload');
const fileLabelText = document.getElementById('file-label-text');
const fileDropLabel = document.getElementById('file-drop-label');

videoUpload.addEventListener('change', () => {
  const file = videoUpload.files[0];
  if (file) {
    fileLabelText.textContent = file.name;
    fileDropLabel.classList.add('has-file');
  } else {
    fileLabelText.textContent = 'Click to choose a video file';
    fileDropLabel.classList.remove('has-file');
  }
});
const frameCountInput = document.getElementById('frame-count');
const intervalMsInput = document.getElementById('interval-ms');
const extractStatus = document.getElementById('extract-status');
const framesGrid = document.getElementById('frames-grid');

extractBtn.addEventListener('click', async () => {
  const file = videoUpload.files[0];
  if (!file) {
    showStatus(extractStatus, 'error', 'Please select a video file.');
    return;
  }

  const frameCount = parseInt(frameCountInput.value, 10) || 5;
  const intervalMs = parseInt(intervalMsInput.value, 10) ?? 1000;

  if (frameCount < 1 || frameCount > 50) {
    showStatus(extractStatus, 'error', 'Frame count must be between 1 and 50.');
    return;
  }

  extractBtn.disabled = true;
  framesGrid.classList.add('hidden');
  framesGrid.innerHTML = '';
  showStatus(extractStatus, 'loading', 'Extracting frames…', true);

  const formData = new FormData();
  formData.append('video', file);
  formData.append('frameCount', frameCount);
  formData.append('intervalMs', intervalMs);

  try {
    const res = await fetch('/api/extract-frames', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();

    if (!res.ok) {
      showStatus(extractStatus, 'error', data.error || 'Something went wrong.');
    } else if (!data.frames || data.frames.length === 0) {
      showStatus(extractStatus, 'error', 'No frames were extracted. Try a shorter interval.');
    } else {
      showStatus(extractStatus, 'success', `Extracted ${data.frames.length} frame${data.frames.length !== 1 ? 's' : ''}.`, false);
      renderFrames(data.frames);
    }
  } catch (err) {
    showStatus(extractStatus, 'error', 'Network error. Is the server running?');
  } finally {
    extractBtn.disabled = false;
  }
});

function renderFrames(urls) {
  framesGrid.innerHTML = '';
  urls.forEach((url, i) => {
    const item = document.createElement('div');
    item.className = 'frame-item';

    const img = document.createElement('img');
    img.src = url;
    img.alt = `Frame ${i + 1}`;
    img.loading = 'lazy';

    const link = document.createElement('a');
    link.href = url;
    link.download = `frame_${String(i + 1).padStart(3, '0')}.png`;
    link.className = 'frame-download';
    link.title = `Download frame ${i + 1}`;
    link.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

    item.appendChild(img);
    item.appendChild(link);
    framesGrid.appendChild(item);
  });
  framesGrid.classList.remove('hidden');
}
