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

// --- Shared State ---
let downloadedVideoBlob = null;
let downloadedVideoName = null;

// Tab switching with smooth animation
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    switchTab(tab.dataset.tab);
  });
});

function switchTab(tabName) {
  const currentTab = document.querySelector('.tab.active');
  const currentTabName = currentTab?.dataset.tab;

  if (currentTabName === tabName) return;

  // Animate out current content
  const currentContent = document.getElementById(`tab-${currentTabName}`);
  if (currentContent) {
    currentContent.style.opacity = '0';
    currentContent.style.transform = 'translateY(-10px)';
  }

  setTimeout(() => {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-content').forEach(s => {
      s.classList.add('hidden');
      s.style.opacity = '';
      s.style.transform = '';
    });

    const newTab = document.querySelector(`.tab[data-tab="${tabName}"]`);
    newTab.classList.add('active');
    newTab.setAttribute('aria-selected', 'true');
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
  }, 150);
}

// --- Download Tab ---
const downloadBtn = document.getElementById('download-btn');
const urlInput = document.getElementById('tiktok-url');
const downloadStatus = document.getElementById('download-status');

function showStatus(el, type, text, isLoading = false) {
  el.className = `status ${type}`;
  el.innerHTML = '';
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

function showDownloadSuccessWithExtract() {
  downloadStatus.className = 'status success';
  downloadStatus.innerHTML = '';

  const message = document.createElement('div');
  message.innerHTML = '<strong>✓ Download complete!</strong><br>Video saved to your Downloads folder.';
  downloadStatus.appendChild(message);

  const promptText = document.createElement('div');
  promptText.style.marginTop = '16px';
  promptText.style.fontSize = '14px';
  promptText.style.opacity = '0.9';
  promptText.innerHTML = 'Ready to extract frames from this video?';
  downloadStatus.appendChild(promptText);

  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.style.marginTop = '12px';
  btn.style.padding = '10px 20px';
  btn.style.fontSize = '15px';
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="9" y1="21" x2="9" y2="9"/>
    </svg>
    Extract Frames Automatically`;
  btn.addEventListener('click', () => {
    // Switch to extract tab with auto-loaded video
    switchTab('extract');
    // The extract tab will check for the downloaded video
    setTimeout(() => loadDownloadedVideoIntoExtract(), 200);
  });
  downloadStatus.appendChild(btn);

  downloadStatus.classList.remove('hidden');
}

const TIKTOK_URL_RE = /^https?:\/\/(www\.|vm\.|vt\.|m\.)?tiktok\.com\//;

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
  showStatus(downloadStatus, 'loading', 'Fetching video info…', true);

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
      // Fetch the video and force download via blob
      showStatus(downloadStatus, 'loading', 'Downloading video…', true);
      try {
        const videoRes = await fetch(data.downloadUrl, { referrerPolicy: 'no-referrer' });
        if (!videoRes.ok) throw new Error('Failed to fetch video');

        // Store the blob for seamless extraction
        downloadedVideoBlob = await videoRes.blob();
        downloadedVideoName = `${data.title || 'tiktok-video'}.mp4`;

        // Create download
        const blobUrl = URL.createObjectURL(downloadedVideoBlob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = downloadedVideoName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Clean up object URL after a delay
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

        showDownloadSuccessWithExtract();
      } catch (fetchErr) {
        // Fallback: open in new tab
        const a = document.createElement('a');
        a.href = data.downloadUrl;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showStatus(downloadStatus, 'success', 'Video opened in new tab. Right-click to save, then upload here to extract frames.');
      }
    }
  } catch (err) {
    showStatus(downloadStatus, 'error', 'Network error. Please try again.');
  } finally {
    downloadBtn.disabled = false;
  }
});

// --- Extract Frames Tab ---
const extractBtn = document.getElementById('extract-btn');
const videoUpload = document.getElementById('video-upload');
const fileLabelText = document.getElementById('file-label-text');
const fileDropLabel = document.getElementById('file-drop-label');
const frameCountInput = document.getElementById('frame-count');
const intervalMsInput = document.getElementById('interval-ms');
const extractStatus = document.getElementById('extract-status');
const framesGrid = document.getElementById('frames-grid');

// Auto-load downloaded video into extract tab
function loadDownloadedVideoIntoExtract() {
  if (!downloadedVideoBlob) {
    showStatus(extractStatus, 'error', 'No video available. Please download a video first.');
    return;
  }

  // Create a File from the Blob
  const file = new File([downloadedVideoBlob], downloadedVideoName, { type: 'video/mp4' });

  // Set it to the file input
  const dt = new DataTransfer();
  dt.items.add(file);
  videoUpload.files = dt.files;

  // Update UI
  fileLabelText.textContent = downloadedVideoName + ' (auto-loaded)';
  fileDropLabel.classList.add('has-auto-file');
  fileDropLabel.classList.add('has-file');

  // Show success message
  showStatus(extractStatus, 'success', 'Video automatically loaded! Click "Extract Frames" to proceed.');

  // Scroll to the button
  extractBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Enable drag & drop
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

  // Clear auto-file styling when user drops a new file
  fileDropLabel.classList.remove('has-auto-file');

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
    // Remove auto-file indicator if user manually selects
    if (file.name !== downloadedVideoName) {
      fileDropLabel.classList.remove('has-auto-file');
    }
  } else {
    fileLabelText.textContent = 'Click to choose a video file';
    fileDropLabel.classList.remove('has-file');
    fileDropLabel.classList.remove('has-auto-file');
  }
});

// Seek a video element to a given time
function seekTo(video, timeS) {
  return new Promise(resolve => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = timeS;
  });
}

// Extract frames
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
      showStatus(extractStatus, 'success', `✓ Extracted ${frames.length} frame${frames.length !== 1 ? 's' : ''}`);
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
    item.style.animationDelay = `${i * 0.05}s`;
    item.style.animation = 'fadeIn 0.4s ease forwards';

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

// Check for URL param to auto-switch tabs
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('tab') === 'extract') {
  switchTab('extract');
}
