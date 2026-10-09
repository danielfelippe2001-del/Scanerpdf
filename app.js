// ========== DocScan Offline PWA ==========
const { jsPDF } = window.jspdf;

// ---------- Estado global ----------
let currentFolderId = null;
let currentFolderName = '';
let currentPages = [];
let stream = null;
let facingMode = 'environment';
let editImage = null;
let corners = []; // coordenadas na imagem original (pixels)
let draggingCorner = -1;
let canvasScale = 1; // escala de desenho (imagem -> canvas interno)
let displayScaleX = 1; // canvas interno -> pixels na tela
let displayScaleY = 1;
let db = null;

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('DocScanDB', 1);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('folders')) {
        database.createObjectStore('folders', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('docs')) {
        const store = database.createObjectStore('docs', { keyPath: 'id' });
        store.createIndex('folderId', 'folderId', { unique: false });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function getFolders() {
  return new Promise((resolve) => {
    const tx = db.transaction('folders', 'readonly');
    const req = tx.objectStore('folders').getAll();
    req.onsuccess = () => resolve(req.result || []);
  });
}

async function saveFolder(folder) {
  return new Promise((resolve) => {
    const tx = db.transaction('folders', 'readwrite');
    tx.objectStore('folders').put(folder);
    tx.oncomplete = () => resolve();
  });
}

async function getDocs(folderId) {
  return new Promise((resolve) => {
    const tx = db.transaction('docs', 'readonly');
    const index = tx.objectStore('docs').index('folderId');
    const req = index.getAll(folderId);
    req.onsuccess = () => resolve(req.result || []);
  });
}

async function getAllDocs() {
  return new Promise((resolve) => {
    const tx = db.transaction('docs', 'readonly');
    const req = tx.objectStore('docs').getAll();
    req.onsuccess = () => resolve(req.result || []);
  });
}

async function saveDoc(doc) {
  return new Promise((resolve) => {
    const tx = db.transaction('docs', 'readwrite');
    tx.objectStore('docs').put(doc);
    tx.oncomplete = () => resolve();
  });
}

// ---------- Navega莽茫o ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setHeader(title, actionsHtml = '') {
  document.getElementById('headerTitle').textContent = title;
  document.getElementById('headerActions').innerHTML = actionsHtml;
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

// ---------- Home / Pastas ----------
async function renderHome() {
  showScreen('homeScreen');
  setHeader('DocScan Offline', '');
  const folders = await getFolders();
  const list = document.getElementById('folderList');
  const empty = document.getElementById('emptyFolders');
  list.innerHTML = '';
  if (folders.length === 0) {
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    folders.sort((a, b) => b.created - a.created);
    folders.forEach(f => {
      const el = document.createElement('div');
      el.className = 'folder-card';
      el.innerHTML = `<span class="folder-icon">馃搧</span><div><strong>${escapeHtml(f.name)}</strong><br><small style="color:#888">${new Date(f.created).toLocaleDateString('pt-BR')}</small></div>`;
      el.onclick = () => openFolder(f.id, f.name);
      list.appendChild(el);
    });
  }
}

document.getElementById('btnNewFolder').onclick = () => {
  document.getElementById('folderNameInput').value = '';
  document.getElementById('folderModal').classList.add('active');
  document.getElementById('folderNameInput').focus();
};
document.getElementById('btnCancelFolder').onclick = () => {
  document.getElementById('folderModal').classList.remove('active');
};
document.getElementById('btnCreateFolder').onclick = async () => {
  const name = document.getElementById('folderNameInput').value.trim() || 'Nova Pasta';
  const folder = { id: crypto.randomUUID(), name, created: Date.now() };
  await saveFolder(folder);
  document.getElementById('folderModal').classList.remove('active');
  renderHome();
};

// ---------- Pasta aberta ----------
async function openFolder(id, name) {
  currentFolderId = id;
  currentFolderName = name;
  showScreen('folderScreen');
  setHeader(name, `<button class="btn btn-outline btn-sm" id="btnBackHome">Voltar</button>`);
  document.getElementById('btnBackHome').onclick = renderHome;

  const docs = await getDocs(id);
  const list = document.getElementById('docList');
  const empty = document.getElementById('emptyDocs');
  list.innerHTML = '';
  if (docs.length === 0) {
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    docs.sort((a, b) => b.created - a.created);
    docs.forEach(d => {
      const el = document.createElement('div');
      el.className = 'doc-card';
      el.innerHTML = `<span class="folder-icon">馃搫</span><div style="flex:1"><strong>${escapeHtml(d.name)}</strong><br><small style="color:#888">${d.pages} p谩gina(s) 鈥� ${new Date(d.created).toLocaleString('pt-BR')}</small></div>`;
      el.onclick = () => downloadDoc(d);
      list.appendChild(el);
    });
  }
}

document.getElementById('btnScan').onclick = () => {
  currentPages = [];
  startCamera();
};

// ---------- C芒mera ----------
async function startCamera() {
  showScreen('cameraScreen');
  setHeader('C芒mera', '');
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    document.getElementById('video').srcObject = stream;
  } catch (err) {
    alert('N茫o foi poss铆vel acessar a c芒mera. Verifique as permiss玫es.');
    if (currentFolderId) openFolder(currentFolderId, currentFolderName);
    else renderHome();
  }
}

document.getElementById('btnCancelCamera').onclick = () => {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (currentPages.length > 0) showPreview();
  else if (currentFolderId) openFolder(currentFolderId, currentFolderName);
  else renderHome();
};

document.getElementById('btnSwitchCam').onclick = () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  startCamera();
};

document.getElementById('btnCapture').onclick = () => {
  const video = document.getElementById('video');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  if (stream) stream.getTracks().forEach(t => t.stop());

  editImage = new Image();
  editImage.onload = () => {
    const w = editImage.width;
    const h = editImage.height;
    const margin = Math.min(w, h) * 0.08;
    corners = [
      { x: margin, y: margin },
      { x: w - margin, y: margin },
      { x: w - margin, y: h - margin },
      { x: margin, y: h - margin }
    ];
    showEditScreen();
  };
  editImage.src = canvas.toDataURL('image/jpeg', 0.92);
};

// ---------- Editor de quinas (CORRIGIDO + LUPA) ----------
function showEditScreen() {
  showScreen('editScreen');
  setHeader('Ajustar Quinas', '');
  const canvas = document.getElementById('editCanvas');
  const wrap = document.getElementById('editCanvasWrap');

  // Espera o layout
  requestAnimationFrame(() => {
    const maxW = wrap.clientWidth;
    const maxH = wrap.clientHeight;
    canvasScale = Math.min(maxW / editImage.width, maxH / editImage.height, 1);

    // Resolu莽茫o interna do canvas = tamanho de desenho
    canvas.width = Math.round(editImage.width * canvasScale);
    canvas.height = Math.round(editImage.height * canvasScale);

    // CSS = exatamente o tamanho interno (evita distor莽茫o de coordenadas)
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';

    displayScaleX = 1;
    displayScaleY = 1;

    drawEdit();
    hideLoupe();
  });
}

function drawEdit() {
  const canvas = document.getElementById('editCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(editImage, 0, 0, canvas.width, canvas.height);

  // Pol铆gono
  ctx.beginPath();
  ctx.moveTo(corners[0].x * canvasScale, corners[0].y * canvasScale);
  for (let i = 1; i < 4; i++) {
    ctx.lineTo(corners[i].x * canvasScale, corners[i].y * canvasScale);
  }
  ctx.closePath();
  ctx.strokeStyle = '#1a73e8';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = 'rgba(26,115,232,0.18)';
  ctx.fill();

  // Quinas
  corners.forEach((c, i) => {
    const x = c.x * canvasScale;
    const y = c.y * canvasScale;
    // anel externo maior (谩rea de toque visual)
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(26,115,232,0.35)';
    ctx.fill();
    // c铆rculo principal
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#1a73e8';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // n煤mero
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y);
  });
}

function getEventPos(e) {
  const canvas = document.getElementById('editCanvas');
  const rect = canvas.getBoundingClientRect();
  // Coordenadas no canvas interno (j谩 que style = width/height internos)
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  return { x, y };
}

function getCornerAt(cx, cy) {
  const hitRadius = 36; // 谩rea de toque generosa (em pixels do canvas)
  for (let i = 0; i < 4; i++) {
    const px = corners[i].x * canvasScale;
    const py = corners[i].y * canvasScale;
    if (Math.hypot(cx - px, cy - py) <= hitRadius) return i;
  }
  return -1;
}

function showLoupe(imgX, imgY, screenX, screenY) {
  const loupe = document.getElementById('loupe');
  const loupeCanvas = document.getElementById('loupeCanvas');
  const lctx = loupeCanvas.getContext('2d');
  const zoom = 2.5;
  const size = 120;
  const half = size / 2;

  // Fonte: regi茫o da imagem original ao redor do ponto
  const srcSize = size / zoom;
  const sx = imgX - srcSize / 2;
  const sy = imgY - srcSize / 2;

  lctx.clearRect(0, 0, size, size);
  lctx.fillStyle = '#111';
  lctx.fillRect(0, 0, size, size);

  // Desenha a regi茫o ampliada
  lctx.drawImage(
    editImage,
    sx, sy, srcSize, srcSize,
    0, 0, size, size
  );

  // Cruz central
  lctx.strokeStyle = '#1a73e8';
  lctx.lineWidth = 1.5;
  lctx.beginPath();
  lctx.moveTo(half - 12, half);
  lctx.lineTo(half + 12, half);
  lctx.moveTo(half, half - 12);
  lctx.lineTo(half, half + 12);
  lctx.stroke();
  lctx.beginPath();
  lctx.arc(half, half, 4, 0, Math.PI * 2);
  lctx.stroke();

  // Posiciona a lupa acima do dedo (n茫o cobre o ponto)
  const wrap = document.getElementById('editCanvasWrap');
  const wrapRect = wrap.getBoundingClientRect();
  let lx = screenX - wrapRect.left - half;
  let ly = screenY - wrapRect.top - size - 30; // acima do dedo

  // Mant茅m dentro da tela
  lx = Math.max(4, Math.min(wrap.clientWidth - size - 4, lx));
  ly = Math.max(4, Math.min(wrap.clientHeight - size - 4, ly));

  loupe.style.left = lx + 'px';
  loupe.style.top = ly + 'px';
  loupe.style.display = 'block';
}

function hideLoupe() {
  document.getElementById('loupe').style.display = 'none';
}

const editCanvas = document.getElementById('editCanvas');

editCanvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const pos = getEventPos(e);
  draggingCorner = getCornerAt(pos.x, pos.y);
  if (draggingCorner >= 0) {
    editCanvas.setPointerCapture(e.pointerId);
    const imgX = corners[draggingCorner].x;
    const imgY = corners[draggingCorner].y;
    showLoupe(imgX, imgY, e.clientX, e.clientY);
  }
});

editCanvas.addEventListener('pointermove', (e) => {
  if (draggingCorner < 0) return;
  e.preventDefault();
  const pos = getEventPos(e);

  // Converte de canvas para coordenadas da imagem original
  let imgX = pos.x / canvasScale;
  let imgY = pos.y / canvasScale;

  // Limita dentro da imagem
  imgX = Math.max(0, Math.min(editImage.width, imgX));
  imgY = Math.max(0, Math.min(editImage.height, imgY));

  corners[draggingCorner] = { x: imgX, y: imgY };
  drawEdit();
  showLoupe(imgX, imgY, e.clientX, e.clientY);
});

editCanvas.addEventListener('pointerup', (e) => {
  draggingCorner = -1;
  hideLoupe();
});
editCanvas.addEventListener('pointercancel', () => {
  draggingCorner = -1;
  hideLoupe();
});

// Impede scroll/zoom enquanto arrasta
editCanvas.addEventListener('touchstart', (e) => {
  if (draggingCorner >= 0) e.preventDefault();
}, { passive: false });
editCanvas.addEventListener('touchmove', (e) => {
  if (draggingCorner >= 0) e.preventDefault();
}, { passive: false });

document.getElementById('btnAutoDetect').onclick = () => {
  try {
    simpleAutoDetect();
    drawEdit();
  } catch (e) {
    alert('N茫o foi poss铆vel detectar automaticamente. Ajuste as quinas manualmente.');
  }
};

function simpleAutoDetect() {
  const tmp = document.createElement('canvas');
  const scale = 0.25;
  tmp.width = Math.round(editImage.width * scale);
  tmp.height = Math.round(editImage.height * scale);
  const ctx = tmp.getContext('2d');
  ctx.drawImage(editImage, 0, 0, tmp.width, tmp.height);
  const data = ctx.getImageData(0, 0, tmp.width, tmp.height).data;

  const threshold = 140;
  let minX = tmp.width, maxX = 0, minY = tmp.height, maxY = 0;
  for (let y = 0; y < tmp.height; y++) {
    for (let x = 0; x < tmp.width; x++) {
      const i = (y * tmp.width + x) * 4;
      const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (gray > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const pad = 8;
  minX = Math.max(0, (minX - pad) / scale);
  maxX = Math.min(editImage.width, (maxX + pad) / scale);
  minY = Math.max(0, (minY - pad) / scale);
  maxY = Math.min(editImage.height, (maxY + pad) / scale);

  if (maxX - minX > 50 && maxY - minY > 50) {
    corners = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ];
  }
}

document.getElementById('btnConfirmCrop').onclick = () => {
  const cropped = perspectiveCrop(editImage, corners);
  currentPages.push(cropped);
  showPreview();
};

document.getElementById('btnRetake').onclick = () => startCamera();

// ---------- Perspectiva ----------
function orderPoints(pts) {
  const bySum = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => (a.x - a.y) - (b.x - b.y));
  return [bySum[0], byDiff[3], bySum[3], byDiff[0]]; // TL, TR, BR, BL
}

function getPerspectiveTransform(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const sx = src[i * 2], sy = src[i * 2 + 1];
    const dx = dst[i * 2], dy = dst[i * 2 + 1];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy, dx]);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy, dy]);
  }
  return solveHomography(A);
}

function solveHomography(A) {
  const m = A.map(row => [...row]);
  const n = 8;
  for (let i = 0; i < n; i++) {
    let max = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(m[k][i]) > Math.abs(m[max][i])) max = k;
    [m[i], m[max]] = [m[max], m[i]];
    const div = m[i][i];
    if (Math.abs(div) < 1e-12) continue;
    for (let j = i; j <= n; j++) m[i][j] /= div;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = m[k][i];
      for (let j = i; j <= n; j++) m[k][j] -= factor * m[i][j];
    }
  }
  const h = new Array(9).fill(0);
  for (let i = 0; i < n; i++) h[i] = m[i][n];
  h[8] = 1;
  return h;
}

function applyHomography(h, x, y) {
  const denom = h[6] * x + h[7] * y + h[8];
  return {
    x: (h[0] * x + h[1] * y + h[2]) / denom,
    y: (h[3] * x + h[4] * y + h[5]) / denom
  };
}

function getImageData(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

function sampleBilinear(imgData, w, h, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1, y1 = y0 + 1;
  const dx = x - x0, dy = y - y0;
  if (x0 < 0 || y0 < 0 || x1 >= w || y1 >= h) return [255, 255, 255];
  const get = (px, py) => {
    const i = (py * w + px) * 4;
    return [imgData.data[i], imgData.data[i + 1], imgData.data[i + 2]];
  };
  const c00 = get(x0, y0), c10 = get(x1, y0), c01 = get(x0, y1), c11 = get(x1, y1);
  return [
    Math.round(c00[0] * (1 - dx) * (1 - dy) + c10[0] * dx * (1 - dy) + c01[0] * (1 - dx) * dy + c11[0] * dx * dy),
    Math.round(c00[1] * (1 - dx) * (1 - dy) + c10[1] * dx * (1 - dy) + c01[1] * (1 - dx) * dy + c11[1] * dx * dy),
    Math.round(c00[2] * (1 - dx) * (1 - dy) + c10[2] * dx * (1 - dy) + c01[2] * (1 - dx) * dy + c11[2] * dx * dy)
  ];
}

function perspectiveCrop(img, pts) {
  const ordered = orderPoints(pts);
  const [tl, tr, br, bl] = ordered;

  const widthA = Math.hypot(br.x - bl.x, br.y - bl.y);
  const widthB = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const maxW = Math.round(Math.max(widthA, widthB));
  const heightA = Math.hypot(tr.x - br.x, tr.y - br.y);
  const heightB = Math.hypot(tl.x - bl.x, tl.y - bl.y);
  const maxH = Math.round(Math.max(heightA, heightB));

  const srcPts = [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y];
  const dstPts = [0, 0, maxW, 0, maxW, maxH, 0, maxH];
  // Matriz destino -> origem
  const matrix = getPerspectiveTransform(dstPts, srcPts);

  const out = document.createElement('canvas');
  out.width = maxW;
  out.height = maxH;
  const ctx = out.getContext('2d');
  const imgData = getImageData(img);
  const outData = ctx.createImageData(maxW, maxH);

  for (let y = 0; y < maxH; y++) {
    for (let x = 0; x < maxW; x++) {
      const srcPt = applyHomography(matrix, x, y);
      const color = sampleBilinear(imgData, img.width, img.height, srcPt.x, srcPt.y);
      const idx = (y * maxW + x) * 4;
      outData.data[idx] = color[0];
      outData.data[idx + 1] = color[1];
      outData.data[idx + 2] = color[2];
      outData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(outData, 0, 0);
  return out.toDataURL('image/jpeg', 0.9);
}

// ---------- Preview e PDF ----------
function showPreview() {
  showScreen('previewScreen');
  setHeader(`Documento (${currentPages.length} p谩g.)`, '');
  const list = document.getElementById('pageList');
  list.innerHTML = '';
  currentPages.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'page-thumb';
    el.innerHTML = `
      <img src="${p}" alt="P谩gina ${i + 1}">
      <div style="flex:1">
        <strong>P谩gina ${i + 1}</strong><br>
        <button class="btn btn-outline btn-sm" data-idx="${i}" style="margin-top:6px">Remover</button>
      </div>`;
    list.appendChild(el);
  });
  list.querySelectorAll('button[data-idx]').forEach(btn => {
    btn.onclick = (e) => {
      const idx = +e.target.dataset.idx;
      currentPages.splice(idx, 1);
      if (currentPages.length === 0) {
        openFolder(currentFolderId, currentFolderName);
      } else {
        showPreview();
      }
    };
  });
}

document.getElementById('btnAddPage').onclick = () => startCamera();
document.getElementById('btnCancelDoc').onclick = () => {
  currentPages = [];
  openFolder(currentFolderId, currentFolderName);
};

document.getElementById('btnSavePdf').onclick = async () => {
  if (currentPages.length === 0) return;
  const name = prompt('Nome do documento:', `Scan_${new Date().toISOString().slice(0, 10)}`) || 'Documento';

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 8;

  for (let i = 0; i < currentPages.length; i++) {
    if (i > 0) pdf.addPage();
    const img = currentPages[i];
    const props = pdf.getImageProperties(img);
    const ratio = props.width / props.height;
    let w = pageW - margin * 2;
    let h = w / ratio;
    if (h > pageH - margin * 2) {
      h = pageH - margin * 2;
      w = h * ratio;
    }
    const x = (pageW - w) / 2;
    const y = (pageH - h) / 2;
    pdf.addImage(img, 'JPEG', x, y, w, h);
  }

  const pdfBlob = pdf.output('blob');
  const reader = new FileReader();
  reader.onload = async () => {
    const doc = {
      id: crypto.randomUUID(),
      folderId: currentFolderId,
      name,
      pages: currentPages.length,
      data: reader.result,
      created: Date.now()
    };
    await saveDoc(doc);
    pdf.save(`${name}.pdf`);
    alert('Documento salvo na pasta e baixado!');
    currentPages = [];
    openFolder(currentFolderId, currentFolderName);
  };
  reader.readAsDataURL(pdfBlob);
};

function downloadDoc(doc) {
  const a = document.createElement('a');
  a.href = doc.data;
  a.download = `${doc.name}.pdf`;
  a.click();
}

// ---------- Compartilhamento rede local ----------
document.getElementById('btnShareNetwork').onclick = () => {
  document.getElementById('shareModal').classList.add('active');
};

document.getElementById('btnCloseShare').onclick = () => {
  document.getElementById('shareModal').classList.remove('active');
};

document.getElementById('btnWebShare').onclick = async () => {
  const docs = await getAllDocs();
  if (docs.length === 0) {
    alert('Nenhum PDF salvo ainda. Escaneie algum documento primeiro.');
    return;
  }
  // Web Share com o 煤ltimo PDF (navegadores limitam m煤ltiplos arquivos)
  const last = docs.sort((a, b) => b.created - a.created)[0];
  try {
    const res = await fetch(last.data);
    const blob = await res.blob();
    const file = new File([blob], `${last.name}.pdf`, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: last.name,
        text: 'Documento escaneado com DocScan Offline'
      });
    } else if (navigator.share) {
      await navigator.share({ title: last.name, text: 'Documento escaneado' });
      downloadDoc(last);
    } else {
      downloadDoc(last);
      alert('Seu navegador n茫o suporta compartilhamento nativo. O PDF foi baixado.');
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      downloadDoc(last);
      alert('Compartilhamento cancelado ou indispon铆vel. PDF baixado.');
    }
  }
};

document.getElementById('btnDownloadAll').onclick = async () => {
  const docs = await getAllDocs();
  if (docs.length === 0) {
    alert('Nenhum PDF salvo ainda.');
    return;
  }
  for (const d of docs) {
    downloadDoc(d);
    await new Promise(r => setTimeout(r, 400)); // pequeno atraso entre downloads
  }
  alert(`${docs.length} PDF(s) enviados para download.`);
};

// ---------- Service Worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(console.warn);
  });
}

// ---------- Init ----------
(async () => {
  db = await openDB();
  const folders = await getFolders();
  if (folders.length === 0) {
    await saveFolder({ id: crypto.randomUUID(), name: 'Meus Documentos', created: Date.now() });
  }
  renderHome();
})();
