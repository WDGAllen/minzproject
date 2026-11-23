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
const resultImages = document.querySelector('#result-images');
const resultSize = document.querySelector('#result-size');
const previewPanel = document.querySelector('#preview-panel');
const previewImage = document.querySelector('#preview-image');
const previewFrame = document.querySelector('#preview-frame');
const errorBox = document.querySelector('#error');
const debugLog = document.querySelector('#debug-log');

let selectedFile = null;
let outputUrls = [];
let previewUrl = null;

function debug(message, details = '') {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${message}${details ? `\n  ${details}` : ''}`;
  debugLog.textContent = `${debugLog.textContent === 'Waiting for a processing run.' ? '' : `${debugLog.textContent}\n`}${line}`;
  console.debug('[Bird Projection]', message, details);
}

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
  // Safari can report `seeked` just before the hardware-decoded frame is
  // presented. A short bounded delay avoids capturing a black frame without
  // relying on requestVideoFrameCallback, which may not fire while paused.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function generateProjection() {
  if (!selectedFile) return;
  errorBox.hidden = true; resultPanel.hidden = true; previewPanel.hidden = true; progressPanel.hidden = false; generateButton.disabled = true; fileInput.disabled = true;
  outputUrls.forEach(URL.revokeObjectURL); outputUrls = []; resultImages.replaceChildren();
  if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
  const objectUrl = URL.createObjectURL(selectedFile);
  try {
    video.src = objectUrl; video.load(); await waitForEvent(video, 'loadedmetadata');
    const width = video.videoWidth; const height = video.videoHeight;
    if (!width || !height || !Number.isFinite(video.duration)) throw new Error('This video has no usable picture data.');
    debugLog.textContent = '';
    debug('Metadata loaded', `file=${selectedFile.name}\nvideo=${width}x${height}\nduration=${video.duration.toFixed(3)} s\nreadyState=${video.readyState}\nnetworkState=${video.networkState}`);
    frameCanvas.width = width; frameCanvas.height = height;
    const context = frameCanvas.getContext('2d', { willReadFrequently: true });
    const variants = [{ step: 1, offset: 0, title: 'FULL PROJECTION', label: '' }];
    if (document.querySelector('#every-2').checked) for (let offset=0; offset<2; offset++) variants.push({step:2,offset,title:'EVERY 2ND FRAME',label:String.fromCharCode(65+offset)});
    if (document.querySelector('#every-3').checked) for (let offset=0; offset<3; offset++) variants.push({step:3,offset,title:'EVERY 3RD FRAME',label:String.fromCharCode(65+offset)});
    document.querySelectorAll('.extra-step:checked').forEach(input => {
      const step=Number(input.dataset.step);
      for(let offset=0;offset<step;offset++) variants.push({step,offset,title:`EVERY ${step}TH FRAME`,label:String.fromCharCode(65+offset)});
    });
    variants.forEach(v => { v.minimum = new Uint8Array(width*height*3); v.first=true; });
    const livePreview = document.querySelector('#live-preview').checked;
    let lastPreviewAt = 0;
    const displayScale=Math.min(1,720/width,480/height);
    const previewCanvas = livePreview ? document.createElement('canvas') : null;
    if (previewCanvas) { previewCanvas.width=Math.max(1,Math.round(width*displayScale)); previewCanvas.height=Math.max(1,Math.round(height*displayScale)); previewPanel.hidden=false; }
    const fps = Number(video.getVideoPlaybackQuality?.().totalVideoFrames) > 0 ? video.getVideoPlaybackQuality().totalVideoFrames / video.duration : 30;
    const frameCount = Math.max(1, Math.ceil(video.duration * Math.min(Math.max(fps || 30, 1), 60)));
    debug('Frame plan', `estimatedFps=${(fps || 30).toFixed(3)}\nframes=${frameCount}\ncanvas=${frameCanvas.width}x${frameCanvas.height}`);
    setProgress(0, `Preparing ${width} × ${height} image…`);
    for (let index = 0; index < frameCount; index += 1) {
      const time = Math.min(video.duration - 0.001, index / Math.max(fps || 30, 1));
      await seekTo(Math.max(0, time));
      context.drawImage(video, 0, 0, width, height);
      const source = context.getImageData(0, 0, width, height).data;
      let sourceMax = Math.max(source[0], source[1], source[2]);
      if (index < 3 || index === frameCount - 1) {
        let nonBlack = 0;
        for (let p = 0; p < source.length; p += 4) if (source[p] || source[p + 1] || source[p + 2]) nonBlack += 1;
        debug(`Decoded frame ${index + 1}`, `time=${video.currentTime.toFixed(3)}\nreadyState=${video.readyState}\npixel[0]=rgb(${source[0]},${source[1]},${source[2]})\nnonBlackPixels=${nonBlack}/${width * height}\nsourceMax=${sourceMax}`);
      }
      // Safari can return a completely black canvas for the first read at
      // time 0 even though the video metadata is ready. Do not seed the
      // minimum accumulator with that transient empty read.
      if (variants.every(v=>v.first) && sourceMax === 0) {
        for (let p=4; p<source.length && sourceMax===0; p+=4) sourceMax=Math.max(sourceMax,source[p],source[p+1],source[p+2]);
      }
      if (variants.every(v=>v.first) && sourceMax === 0) {
        debug(`Skipped empty decoded frame ${index + 1}`, 'The first canvas read was all black; accumulator not initialized.');
        continue;
      }
      for (const v of variants) if (index >= v.offset && (index-v.offset)%v.step===0) { const minimum=v.minimum; if(v.first){for(let p=0,q=0;q<minimum.length;p+=4,q+=3){minimum[q]=source[p];minimum[q+1]=source[p+1];minimum[q+2]=source[p+2];}v.first=false;} else {for(let p=0,q=0;q<minimum.length;p+=4,q+=3){minimum[q]=Math.min(minimum[q],source[p]);minimum[q+1]=Math.min(minimum[q+1],source[p+1]);minimum[q+2]=Math.min(minimum[q+2],source[p+2]);}} }
      const now=performance.now();
      if (livePreview && !variants[0].first && (now-lastPreviewAt>=10000 || index===frameCount-1)) {
        const previewContext=previewCanvas.getContext('2d'); const image=previewContext.createImageData(previewCanvas.width,previewCanvas.height); const minimum=variants[0].minimum;
        for(let y=0;y<previewCanvas.height;y++)for(let x=0;x<previewCanvas.width;x++){const source=(Math.floor(y/displayScale)*width+Math.floor(x/displayScale))*3;const p=(y*previewCanvas.width+x)*4;const gray=Math.floor(.299*minimum[source]+.587*minimum[source+1]+.114*minimum[source+2]);image.data[p]=image.data[p+1]=image.data[p+2]=gray;image.data[p+3]=255;}
        previewContext.putImageData(image,0,0);
        previewCanvas.toBlob(blob=>{if(blob){if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);previewImage.src=previewUrl;previewFrame.textContent=`Frame ${index+1} of about ${frameCount}`;}},'image/jpeg',0.82);
        lastPreviewAt=now;
      }
      if (index % 2 === 0 || index === frameCount - 1) { setProgress((index + 1) / frameCount * 100, `Reading frame ${index + 1} of about ${frameCount}`); await new Promise(requestAnimationFrame); }
    }
    if (variants.some(v=>v.first)) throw new Error('Not enough non-empty video frames were decoded.');
    for (const v of variants) {
      const output=context.createImageData(width,height);
      for(let p=0,q=0;q<v.minimum.length;p+=4,q+=3){const gray=Math.floor(.299*v.minimum[q]+.587*v.minimum[q+1]+.114*v.minimum[q+2]);output.data[p]=output.data[p+1]=output.data[p+2]=gray;output.data[p+3]=255;}
      context.putImageData(output,0,0); const blob=await new Promise(resolve=>frameCanvas.toBlob(resolve,'image/png')); const url=URL.createObjectURL(blob); outputUrls.push(url);
      if (!v.label) resultSize.textContent=`${width} × ${height}`;
      let group=resultImages.querySelector(`[data-group="${v.title}"]`);
      if(!group){group=document.createElement('section');group.dataset.group=v.title;group.className='projection-group';const heading=document.createElement('h3');heading.textContent=v.title;group.append(heading);resultImages.append(group);}
      const article=document.createElement('article'); if(v.label){const label=document.createElement('h4');label.textContent=`Image ${v.label}`;article.append(label);}
      const wrap=document.createElement('div');wrap.className='image-wrap';const img=document.createElement('img');img.src=url;img.width=width;img.height=height;img.alt=`${v.title}${v.label?` ${v.label}`:''} minimum-intensity projection`;wrap.append(img);article.append(wrap);
      const save=document.createElement('button');save.className='secondary save-image';save.textContent='Save image';save.addEventListener('click',()=>{const a=document.createElement('a');a.href=url;a.download=`projection-${v.step}-offset-${v.offset}.png`;a.click();});article.append(save);group.append(article);
    }
    resultPanel.hidden=false; previewPanel.hidden=true; setProgress(100,'Projections ready.');
  } catch (error) { console.error(error); debug('ERROR', `${error?.name || 'Error'}: ${error?.message || error}`); errorBox.textContent = 'This video could not be processed. Try another video or a shorter recording.'; errorBox.hidden = false; }
  finally { progressPanel.hidden=true; generateButton.disabled = !selectedFile; fileInput.disabled = false; video.removeAttribute('src'); video.load(); }
}

generateButton.addEventListener('click', generateProjection);

document.querySelector('#toggle-extended').addEventListener('click', event => {
  const options = document.querySelector('#extended-options');
  const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
  event.currentTarget.setAttribute('aria-expanded', String(!expanded));
  options.hidden = expanded;
  event.currentTarget.textContent = expanded ? 'Show options for every 4th–10th frame' : 'Hide options for every 4th–10th frame';
});
