const fileInput = document.querySelector('#video-file');
const fileName = document.querySelector('#file-name');
const generateButton = document.querySelector('#generate');
const video = document.querySelector('#video');
const frameCanvas = document.querySelector('#frame-canvas');
const progressPanel = document.querySelector('#progress-panel');
const progressBar = document.querySelector('#progress-bar');
const progressPercent = document.querySelector('#progress-percent');
const progressDetail = document.querySelector('#progress-detail');
const resultPanel = document.querySelector('#result-panel');
const resultImage = document.querySelector('#result-image');
const resultSize = document.querySelector('#result-size');
const saveButton = document.querySelector('#save');
const shareButton = document.querySelector('#share');
const errorBox = document.querySelector('#error');

let selectedFile = null;
let outputBlob = null;
let outputUrl = null;

fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files?.[0] || null;
  fileName.textContent = selectedFile ? selectedFile.name : 'No video selected';
  generateButton.disabled = !selectedFile;
  resultPanel.hidden = true;
  errorBox.hidden = true;
});

function setProgress(value, detail) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  progressBar.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}%`;
  progressDetail.textContent = detail;
}

function waitForEvent(target, event, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Video decoding timed out.')); }, timeout);
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(event, onEvent); target.removeEventListener('error', onError); };
    const onEvent = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('The video could not be decoded.')); };
    target.addEventListener(event, onEvent, { once: true }); target.addEventListener('error', onError, { once: true });
  });
}

async function seekTo(time) {
  if (Math.abs(video.currentTime - time) >= 0.0005) {
    video.currentTime = time;
    await waitForEvent(video, 'seeked');
  }
  // On Safari, `seeked` can fire before the hardware-decoded frame has been
  // presented. Drawing immediately at that point can capture a black frame.
  if ('requestVideoFrameCallback' in video) {
    await new Promise(resolve => video.requestVideoFrameCallback(() => resolve()));
  } else {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
}

async function generateProjection() {
  if (!selectedFile) return;
  errorBox.hidden = true; resultPanel.hidden = true; progressPanel.hidden = false; generateButton.disabled = true; fileInput.disabled = true;
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  const objectUrl = URL.createObjectURL(selectedFile);
  try {
    video.src = objectUrl; video.load(); await waitForEvent(video, 'loadedmetadata');
    const width = video.videoWidth; const height = video.videoHeight;
    if (!width || !height || !Number.isFinite(video.duration)) throw new Error('This video has no usable picture data.');
    frameCanvas.width = width; frameCanvas.height = height;
    const context = frameCanvas.getContext('2d', { willReadFrequently: true });
    const pixels = width * height * 4; let minimum = new Uint8Array(width * height * 3); let first = true;
    const fps = Number(video.getVideoPlaybackQuality?.().totalVideoFrames) > 0 ? video.getVideoPlaybackQuality().totalVideoFrames / video.duration : 30;
    const frameCount = Math.max(1, Math.ceil(video.duration * Math.min(Math.max(fps || 30, 1), 60)));
    setProgress(0, `Preparing ${width} × ${height} image…`);
    for (let index = 0; index < frameCount; index += 1) {
      const time = Math.min(video.duration - 0.001, index / Math.max(fps || 30, 1));
      await seekTo(Math.max(0, time));
      context.drawImage(video, 0, 0, width, height);
      const source = context.getImageData(0, 0, width, height).data;
      if (first) { for (let p = 0, q = 0; q < minimum.length; p += 4, q += 3) { minimum[q] = source[p]; minimum[q + 1] = source[p + 1]; minimum[q + 2] = source[p + 2]; } first = false; }
      else { for (let p = 0, q = 0; q < minimum.length; p += 4, q += 3) { if (source[p] < minimum[q]) minimum[q] = source[p]; if (source[p + 1] < minimum[q + 1]) minimum[q + 1] = source[p + 1]; if (source[p + 2] < minimum[q + 2]) minimum[q + 2] = source[p + 2]; } }
      if (index % 2 === 0 || index === frameCount - 1) { setProgress((index + 1) / frameCount * 100, `Frame ${index + 1} of approximately ${frameCount}`); await new Promise(requestAnimationFrame); }
    }
    const output = context.createImageData(width, height);
    for (let p = 0, q = 0; q < minimum.length; p += 4, q += 3) { const gray = Math.floor(0.299 * minimum[q] + 0.587 * minimum[q + 1] + 0.114 * minimum[q + 2]); output.data[p] = gray; output.data[p + 1] = gray; output.data[p + 2] = gray; output.data[p + 3] = 255; }
    context.putImageData(output, 0, 0);
    outputBlob = await new Promise(resolve => frameCanvas.toBlob(resolve, 'image/png'));
    outputUrl = URL.createObjectURL(outputBlob); resultImage.src = outputUrl; resultSize.textContent = `${width} × ${height}`; resultPanel.hidden = false; setProgress(100, 'Projection ready.');
    shareButton.hidden = !navigator.share || !navigator.canShare;
  } catch (error) { console.error(error); errorBox.textContent = 'This video could not be processed. Try another video or a shorter recording.'; errorBox.hidden = false; }
  finally { URL.revokeObjectURL(objectUrl); generateButton.disabled = !selectedFile; fileInput.disabled = false; video.removeAttribute('src'); video.load(); }
}

generateButton.addEventListener('click', generateProjection);
saveButton.addEventListener('click', () => { if (!outputBlob) return; const link = document.createElement('a'); link.href = outputUrl; link.download = 'z_master_100_percent.png'; link.click(); });
shareButton.addEventListener('click', async () => { if (!outputBlob) return; try { const file = new File([outputBlob], 'z_master_100_percent.png', { type: 'image/png' }); await navigator.share({ files: [file], title: 'Bird movement projection' }); } catch (error) { if (error.name !== 'AbortError') console.error(error); } });
