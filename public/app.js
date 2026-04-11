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

function showDownloadSuccessWithPrompt(data) {
  downloadStatus.className = 'status success';
  downloadStatus.textContent = '';

  const message = document.createElement('div');
  message.innerHTML = '<strong>Download started!</strong><br>Check your Downloads folder.';
  downloadStatus.appendChild(message);

  // AI Analysis button
  const aiBtn = document.createElement('button');
  aiBtn.className = 'btn-primary';
  aiBtn.style.marginTop = '12px';
  aiBtn.style.padding = '8px 16px';
  aiBtn.style.fontSize = '14px';
  aiBtn.style.background = 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)';
  aiBtn.innerHTML = '🤖 AI Analysis';
  aiBtn.addEventListener('click', () => analyzeVideoWithAI(data));
  downloadStatus.appendChild(aiBtn);

  const promptText = document.createElement('div');
  promptText.style.marginTop = '16px';
  promptText.style.fontSize = '14px';
  promptText.style.opacity = '0.8';
  promptText.textContent = 'Or extract frames from the video?';
  downloadStatus.appendChild(promptText);

  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.style.marginTop = '8px';
  btn.style.padding = '8px 16px';
  btn.style.fontSize = '14px';
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 6px;"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>Extract Frames';
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'));
    const extractTab = document.querySelector('.tab[data-tab="extract"]');
    extractTab.classList.add('active');
    extractTab.setAttribute('aria-selected', 'true');
    document.getElementById('tab-extract').classList.remove('hidden');
    document.getElementById('video-upload').focus();
  });
  downloadStatus.appendChild(btn);

  downloadStatus.classList.remove('hidden');
}

// AI Analysis function
async function analyzeVideoWithAI(videoData) {
  showStatus(downloadStatus, 'loading', '🤖 AI is analyzing the video…', true);

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl: videoData.downloadUrl,
        videoData: { title: videoData.title }
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      showStatus(downloadStatus, 'error', data.error || 'AI analysis failed.');
      return;
    }

    // Show AI analysis results
    downloadStatus.className = 'status success';
    downloadStatus.textContent = '';

    const title = document.createElement('div');
    title.innerHTML = '<strong>🤖 AI Analysis Results</strong>';
    title.style.marginBottom = '12px';
    downloadStatus.appendChild(title);

    if (data.description) {
      const desc = document.createElement('div');
      desc.style.marginBottom = '10px';
      desc.innerHTML = `<strong>Description:</strong> ${escapeHtml(data.description)}`;
      downloadStatus.appendChild(desc);
    }

    if (data.category) {
      const cat = document.createElement('div');
      cat.style.marginBottom = '10px';
      cat.innerHTML = `<strong>Category:</strong> ${escapeHtml(data.category)}`;
      downloadStatus.appendChild(cat);
    }

    if (data.hashtags && data.hashtags.length) {
      const tags = document.createElement('div');
      tags.style.marginBottom = '10px';
      tags.innerHTML = `<strong>Suggested Hashtags:</strong> ${data.hashtags.join(' ')}`;
      downloadStatus.appendChild(tags);
    }

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-primary';
    copyBtn.style.marginTop = '12px';
    copyBtn.style.padding = '8px 16px';
    copyBtn.style.fontSize = '14px';
    copyBtn.textContent = '📋 Copy Analysis';
    copyBtn.addEventListener('click', () => {
      const text = `Description: ${data.description || ''}\nCategory: ${data.category || ''}\nHashtags: ${data.hashtags?.join(' ') || ''}`;
      navigator.clipboard.writeText(text);
      copyBtn.textContent = '✅ Copied!';
      setTimeout(() => copyBtn.textContent = '📋 Copy Analysis', 2000);
    });
    downloadStatus.appendChild(copyBtn);

  } catch (err) {
    showStatus(downloadStatus, 'error', 'AI analysis failed. Please try again.');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const TIKTOK_URL_RE = /^https?:\/\/(www\.|vm\.|vt\.|m\.)?tiktok\.com\//;

// Store last downloaded video data for AI analysis
let lastVideoData = null;

downloadBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) {
    showStatus(downloadStatus, 'error', 'Please paste a TikTok URL.');
    return;
  }
  if (!TIKTOK_URL_RE.test(url)) {
    showStatus(downloadStatus, 'error', 'That doesn\'t look like a TikTok URL.');
    return;
  }

  downloadBtn.disabled = true;
  showStatus(downloadStatus, 'loading', 'Fetching video… this may take a few seconds.', true);

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok) {
      showStatus(downloadStatus, 'error', data.error || 'Something went wrong.');
    } else {
      // Store for AI analysis
      lastVideoData = data;
      // Fetch the video and force download via blob (avoids browser preview)
      showStatus(downloadStatus, 'loading', 'Downloading video…', true);
      try {
        const videoRes = await fetch(data.downloadUrl, { referrerPolicy: 'no-referrer' });
        if (!videoRes.ok) throw new Error('Failed to fetch video');
        const blob = await videoRes.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${data.title || 'tiktok-video'}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        showDownloadSuccessWithPrompt(data);
      } catch (fetchErr) {
        // Fallback: open in new tab if CORS blocks the fetch
        const a = document.createElement('a');
        a.href = data.downloadUrl;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showDownloadSuccessWithPrompt(data);
      }
    }
  } catch (err) {
    showStatus(downloadStatus, 'error', 'Network error. Please try again.');
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
