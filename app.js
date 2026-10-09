// ========== DocScan Offline PWA ==========
// Funciona offline, instalável, com pastas, câmera, ajuste de quinas e PDF

const { jsPDF } = window.jspdf;

// ---------- Estado global ----------
let currentFolderId = null;
let currentPages = []; // array de dataURL das páginas do documento atual
let stream = null;
let facingMode = 'environment';
let editImage = null; // Image object
let corners = []; // [{x,y}, ...] em coordenadas do canvas
let draggingCorner = -1;
let canvasScale = 1;
let db = null;

// ---------- IndexedDB (pastas e documentos) ----------
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
    const store = tx.objectStore('folders');
    const req = store.getAll();
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

async function saveDoc(doc) {
  return new Promise((resolve) => {
    const tx = db.transaction('docs', 'readwrite');
    tx.objectStore('docs').put(doc);
    tx.oncomplete = () => resolve();
  });
}

async function deleteDoc(id) {
  return new Promise((resolve) => {
    const tx = db.transaction('docs', 'readwrite');
    tx.objectStore('docs').delete(id);
    tx.oncomplete = () => resolve();
  });
}

// ---------- Navegação de telas ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setHeader(title, actionsHtml = '') {
  document.getElementById('headerTitle').textContent = title;
  document.getElementById('headerActions').innerHTML = actionsHtml;
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
    folders.sort((a,b) => b.created - a.created);
    folders.forEach(f => {
      const el = document.createElement('div');
      el.className = 'folder-card';
      el.innerHTML = `<span class="folder-icon">📁</span><div><strong>${escapeHtml(f.name)}</strong><br><small style="color:#888">${new Date(f.created).toLocaleDateString('pt-BR')}</small></div>`;
      el.onclick = () => openFolder(f.id, f.name);
      list.appendChild(el);
    });
  }
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
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
    docs.sort((a,b) => b.created - a.created);
    docs.forEach(d => {
      const el = document.createElement('div');
      el.className = 'doc-card';
      el.innerHTML = `<span class="folder-icon">📄</span><div style="flex:1"><strong>${escapeHtml(d.name)}</strong><br><small style="color:#888">${d.pages} página(s) • ${new Date(d.created).toLocaleString('pt-BR')}</small></div>`;
      el.onclick = () => downloadDoc(d);
      list.appendChild(el);
    });
  }
}

document.getElementById('btnScan').onclick = () => {
  currentPages = [];
  startCamera();
};

// ---------- Câmera ----------
async function startCamera() {
  showScreen('cameraScreen');
  setHeader('Câmera', '');
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    const video = document.getElementById('video');
    video.srcObject = stream;
  } catch (err) {
    alert('Não foi possível acessar a câmera. Verifique as permissões.');
    renderHome();
  }
}

document.getElementById('btnCancelCamera').onclick = () => {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (currentPages.length > 0) {
    showPreview();
  } else {
    openFolder(currentFolderId, document.getElementById('headerTitle').textContent);
  }
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
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  if (stream) stream.getTracks().forEach(t => t.stop());

  editImage = new Image();
  editImage.onload = () => {
    // Inicializa quinas (retângulo inset)
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

// ---------- Editor de quinas (ajuste preciso) ----------
function showEditScreen() {
  showScreen('editScreen');
  setHeader('Ajustar Quinas', '');
  const canvas = document.getElementById('editCanvas');
  const container = canvas.parentElement;
  // Ajusta tamanho do canvas para a tela
  const maxW = container.clientWidth;
  const maxH = container.clientHeight - 80;
  canvasScale = Math.min(maxW / editImage.width, maxH / editImage.height, 1);
  canvas.width = editImage.width * canvasScale;
  canvas.height = editImage.height * canvasScale;
  drawEdit();
}

function drawEdit() {
  const canvas = document.getElementById('editCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(editImage, 0, 0, canvas.width, canvas.height);

  // Polígono
  ctx.beginPath();
  ctx.moveTo(corners[0].x * canvasScale, corners[0].y * canvasScale);
  for (let i = 1; i < 4; i++) {
    ctx.lineTo(corners[i].x * canvasScale, corners[i].y * canvasScale);
  }
  ctx.closePath();
  ctx.strokeStyle = '#1a73e8';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = 'rgba(26,115,232,0.15)';
  ctx.fill();

  // Pontos das quinas
  corners.forEach((c, i) => {
    const x = c.x * canvasScale;
    const y = c.y * canvasScale;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#1a73e8';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    // número
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y);
  });
}

function getCornerAt(x, y) {
  const r = 28; // raio de toque
  for (let i = 0; i < 4; i++) {
    const cx = corners[i].x * canvasScale;
    const cy = corners[i].y * canvasScale;
    if (Math.hypot(x - cx, y - cy) < r) return i;
  }
  return -1;
}

const editCanvas = document.getElementById('editCanvas');
editCanvas.addEventListener('pointerdown', (e) => {
  const rect = editCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  draggingCorner = getCornerAt(x, y);
  if (draggingCorner >= 0) {
    editCanvas.setPointerCapture(e.pointerId);
  }
});
editCanvas.addEventListener('pointermove', (e) => {
  if (draggingCorner < 0) return;
  const rect = editCanvas.getBoundingClientRect();
  let x = (e.clientX - rect.left) / canvasScale;
  let y = (e.clientY - rect.top) / canvasScale;
  // clamp
  x = Math.max(0, Math.min(editImage.width, x));
  y = Math.max(0, Math.min(editImage.height, y));
  corners[draggingCorner] = { x, y };
  drawEdit();
});
editCanvas.addEventListener('pointerup', () => { draggingCorner = -1; });
editCanvas.addEventListener('pointercancel', () => { draggingCorner = -1; });

document.getElementById('btnAutoDetect').onclick = () => {
  // Detecção simples baseada em contraste (funciona bem em fundos escuros)
  try {
    simpleAutoDetect();
    drawEdit();
  } catch (e) {
    alert('Não foi possível detectar automaticamente. Ajuste as quinas manualmente.');
  }
};

function simpleAutoDetect() {
  // Cria canvas temporário em baixa resolução para análise
  const tmp = document.createElement('canvas');
  const scale = 0.25;
  tmp.width = editImage.width * scale;
  tmp.height = editImage.height * scale;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(editImage, 0, 0, tmp.width, tmp.height);
  const data = ctx.getImageData(0, 0, tmp.width, tmp.height).data;

  // Encontra contornos aproximados por limiar
  const threshold = 140;
  let minX = tmp.width, maxX = 0, minY = tmp.height, maxY = 0;
  for (let y = 0; y < tmp.height; y++) {
    for (let x = 0; x < tmp.width; x++) {
      const i = (y * tmp.width + x) * 4;
      const gray = (data[i] + data[i+1] + data[i+2]) / 3;
      if (gray > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  // Expande um pouco e escala de volta
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

// ---------- Transformação de perspectiva (pure JS) ----------
function perspectiveCrop(img, pts) {
  // Ordena pontos: TL, TR, BR, BL
  const ordered = orderPoints(pts);
  const [tl, tr, br, bl] = ordered;

  // Largura e altura do destino
  const widthA = Math.hypot(br.x - bl.x, br.y - bl.y);
  const widthB = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const maxW = Math.max(widthA, widthB);

  const heightA = Math.hypot(tr.x - br.x, tr.y - br.y);
  const heightB = Math.hypot(tl.x - bl.x, tl.y - bl.y);
  const maxH = Math.max(heightA, heightB);

  const dstW = Math.round(maxW);
  const dstH = Math.round(maxH);

  const src = [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y];
  const dst = [0, 0, dstW, 0, dstW, dstH, 0, dstH];

  const matrix = getPerspectiveTransform(src, dst);

  const out = document.createElement('canvas');
  out.width = dstW;
  out.height = dstH;
  const ctx = out.getContext('2d');

  // Desenha com warp manual (bilinear)
  const imgData = getImageData(img);
  const outData = ctx.createImageData(dstW, dstH);

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const srcPt = applyPerspective(matrix, x, y);
      const color = sampleBilinear(imgData, img.width, img.height, srcPt.x, srcPt.y);
      const idx = (y * dstW + x) * 4;
      outData.data[idx] = color[0];
      outData.data[idx+1] = color[1];
      outData.data[idx+2] = color[2];
      outData.data[idx+3] = 255;
    }
  }
  ctx.putImageData(outData, 0, 0);
  return out.toDataURL('image/jpeg', 0.92);
}

function orderPoints(pts) {
  // Ordena: Top-Left, Top-Right, Bottom-Right, Bottom-Left
  const bySum = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => (a.x - a.y) - (b.x - b.y));
  const tl = bySum[0];
  const br = bySum[3];
  const tr = byDiff[3];
  const bl = byDiff[0];
  return [tl, tr, br, bl];
}

function getPerspectiveTransform(src, dst) {
  // Resolve sistema linear 8x8 para homografia
  const A = [];
  for (let i = 0; i < 4; i++) {
    const sx = src[i*2], sy = src[i*2+1];
    const dx = dst[i*2], dy = dst[i*2+1];
    A.push([sx, sy, 1, 0, 0, 0, -dx*sx, -dx*sy, dx]);
    A.push([0, 0, 0, sx, sy, 1, -dy*sx, -dy*sy, dy]);
  }
  // Eliminação de Gauss simplificada (para 8 equações)
  const h = solveHomography(A);
  return h;
}

function solveHomography(A) {
  // Implementação simples de eliminação gaussiana para 8x9
  const m = A.map(row => [...row]);
  const n = 8;
  for (let i = 0; i < n; i++) {
    // Pivot
    let max = i;
    for (let k = i+1; k < n; k++) if (Math.abs(m[k][i]) > Math.abs(m[max][i])) max = k;
    [m[i], m[max]] = [m[max], m[i]];
    const div = m[i][i];
    if (Math.abs(div) < 1e-10) continue;
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

function applyPerspective(h, x, y) {
  // Inverso: destino -> origem
  // Aqui usamos a inversa aproximada
  const a = h[0], b = h[1], c = h[2];
  const d = h[3], e = h[4], f = h[5];
  const g = h[6], hh = h[7], i = h[8];
  // Para mapeamento inverso precisamos da matriz inversa
  // Simplificação: usamos a fórmula direta e resolvemos
  const denom = g * x + hh * y + i;
  return {
    x: (a * x + b * y + c) / denom,
    y: (d * x + e * y + f) / denom
  };
}

// Correção: precisamos da transformada inversa (destino -> origem)
function getInversePerspective(src, dst) {
  // src = pontos originais da imagem, dst = retângulo destino
  // Queremos mapear ponto do destino de volta para a imagem
  return getPerspectiveTransform(dst, src);
}

// Reescreve a função de crop com inversa correta
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

  // Matriz que leva dst -> src (inversa)
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
    return [imgData.data[i], imgData.data[i+1], imgData.data[i+2]];
  };
  const c00 = get(x0, y0), c10 = get(x1, y0), c01 = get(x0, y1), c11 = get(x1, y1);
  return [
    Math.round(c00[0]*(1-dx)*(1-dy) + c10[0]*dx*(1-dy) + c01[0]*(1-dx)*dy + c11[0]*dx*dy),
    Math.round(c00[1]*(1-dx)*(1-dy) + c10[1]*dx*(1-dy) + c01[1]*(1-dx)*dy + c11[1]*dx*dy),
    Math.round(c00[2]*(1-dx)*(1-dy) + c10[2]*dx*(1-dy) + c01[2]*(1-dx)*dy + c11[2]*dx*dy)
  ];
}

// ---------- Preview e PDF ----------
function showPreview() {
  showScreen('previewScreen');
  setHeader(`Documento (${currentPages.length} pág.)`, '');
  const list = document.getElementById('pageList');
  list.innerHTML = '';
  currentPages.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'page-thumb';
    el.innerHTML = `
      <img src="${p}" alt="Página ${i+1}">
      <div style="flex:1">
        <strong>Página ${i+1}</strong><br>
        <button class="btn btn-outline btn-sm" data-idx="${i}" style="margin-top:6px">Remover</button>
      </div>`;
    list.appendChild(el);
  });
  list.querySelectorAll('button[data-idx]').forEach(btn => {
    btn.onclick = (e) => {
      const idx = +e.target.dataset.idx;
      currentPages.splice(idx, 1);
      if (currentPages.length === 0) {
        openFolder(currentFolderId, '...');
      } else {
        showPreview();
      }
    };
  });
}

document.getElementById('btnAddPage').onclick = () => startCamera();
document.getElementById('btnCancelDoc').onclick = () => {
  currentPages = [];
  openFolder(currentFolderId, document.getElementById('headerTitle').textContent);
};

document.getElementById('btnSavePdf').onclick = async () => {
  if (currentPages.length === 0) return;
  const name = prompt('Nome do documento:', `Scan_${new Date().toISOString().slice(0,10)}`) || 'Documento';
  
  // Gera PDF
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 8;

  for (let i = 0; i < currentPages.length; i++) {
    if (i > 0) pdf.addPage();
    const img = currentPages[i];
    // Calcula tamanho mantendo proporção
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

  // Salva no IndexedDB (como blob base64) e também faz download
  const pdfBlob = pdf.output('blob');
  const reader = new FileReader();
  reader.onload = async () => {
    const doc = {
      id: crypto.randomUUID(),
      folderId: currentFolderId,
      name,
      pages: currentPages.length,
      data: reader.result, // dataURL do PDF
      created: Date.now()
    };
    await saveDoc(doc);
    // Download automático
    pdf.save(`${name}.pdf`);
    alert('Documento salvo na pasta e baixado!');
    currentPages = [];
    openFolder(currentFolderId, document.getElementById('headerTitle').textContent);
  };
  reader.readAsDataURL(pdfBlob);
};

async function downloadDoc(doc) {
  // Reconstrói e baixa
  const a = document.createElement('a');
  a.href = doc.data;
  a.download = `${doc.name}.pdf`;
  a.click();
}

// ---------- Service Worker (offline) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(console.warn);
  });
}

// ---------- Inicialização ----------
(async () => {
  db = await openDB();
  // Cria pasta padrão se não existir nenhuma
  const folders = await getFolders();
  if (folders.length === 0) {
    await saveFolder({ id: crypto.randomUUID(), name: 'Meus Documentos', created: Date.now() });
  }
  renderHome();
})();
