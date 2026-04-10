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

  // If qualities couldn't be fetched (backend down / rate limited / blocked),
  // still allow a best-quality download via server-side defaults.
  const formatId = qualitySelect.value || null;
  const qualityLabel = qualitySelect.value
    ? (qualitySelect.options[qualitySelect.selectedIndex]?.text || 'Selected quality')
    : 'Best quality';

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

// --- Extract Frames Tab (fully client-side — no server required) ---
const extractBtn = document.getElementById('extract-btn');
const videoUpload = document.getElementById('video-upload');
const fileLabelText = document.getElementById('file-label-text');
const fileDropLabel = document.getElementById('file-drop-label');
const frameCountInput = document.getElementById('frame-count');
const intervalMsInput = document.getElementById('interval-ms');
const extractStatus = document.getElementById('extract-status');
const framesGrid = document.getElementById('frames-grid');

// Enable drag & drop onto the upload area.
// Also prevent the browser from navigating away when a file is dropped.
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
  document.addEventListener(evt, (e) => e.preventDefault());
});
['dragenter', 'dragover'].forEach(evt => {
  fileDropLabel.addEventListener(evt, (e) => {
    e.preventDefault();
    fileDropLabel.classList.add('dragging');
  });
});
['dragleave', 'drop'].forEach(evt => {
  fileDropLabel.addEventListener(evt, (e) => {
    e.preventDefault();
    fileDropLabel.classList.remove('dragging');
  });
});
fileDropLabel.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!file.type || !file.type.startsWith('video/')) {
    showStatus(extractStatus, 'error', 'Please drop a video file.');
    return;
  }
  const dt = new DataTransfer();
  dt.items.add(file);
  videoUpload.files = dt.files;
  videoUpload.dispatchEvent(new Event('change', { bubbles: true }));
});

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

// Seek a video element to a given time and resolve when the frame is ready.
function seekTo(video, timeS) {
  return new Promise(resolve => {
    const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = timeS;
  });
}

// Extract frames purely in the browser using <video> + <canvas>.
function extractFramesInBrowser(file, frameCount, intervalMs) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const blobUrl = URL.createObjectURL(file);

    video.addEventListener('error', () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('Could not load video file. Make sure it is a supported format.'));
    });

    video.addEventListener('loadedmetadata', async () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      const frames = [];

      for (let i = 0; i < frameCount; i++) {
        const timeS = (i * intervalMs) / 1000;
        if (timeS > video.duration) break;
        await seekTo(video, timeS);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL('image/png'));
      }

      URL.revokeObjectURL(blobUrl);
      resolve(frames);
    });

    video.src = blobUrl;
    video.load();
  });
}

extractBtn.addEventListener('click', async () => {
  const file = videoUpload.files[0];
  if (!file) {
    showStatus(extractStatus, 'error', 'Please select a video file.');
    return;
  }

  const frameCount = Math.min(Math.max(parseInt(frameCountInput.value, 10) || 5, 1), 50);
  const intervalMs = Math.max(parseInt(intervalMsInput.value, 10) || 1000, 0);

  extractBtn.disabled = true;
  framesGrid.classList.add('hidden');
  framesGrid.innerHTML = '';
  showStatus(extractStatus, 'loading', 'Extracting frames…', true);

  try {
    const frames = await extractFramesInBrowser(file, frameCount, intervalMs);
    if (!frames.length) {
      showStatus(extractStatus, 'error', 'No frames extracted — video may be shorter than the interval.');
    } else {
      showStatus(extractStatus, 'success', `Extracted ${frames.length} frame${frames.length !== 1 ? 's' : ''}.`);
      renderFrames(frames);
    }
  } catch (err) {
    showStatus(extractStatus, 'error', err.message || 'Failed to extract frames.');
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
