// Generates the DAWN app icon (a golden reactor/energy orb on a dark tile) as a
// multi-size build/icon.ico (+ icon.png). Run with Electron:
//   electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZES = [256, 128, 64, 48, 32, 16];

const drawFn = `
function draw(S){
  const c=document.createElement('canvas'); c.width=c.height=S;
  const ctx=c.getContext('2d'); const cx=S/2, cy=S/2;
  ctx.clearRect(0,0,S,S);
  const r=S*0.22;
  ctx.beginPath();
  if(ctx.roundRect) ctx.roundRect(0,0,S,S,r); else ctx.rect(0,0,S,S);
  const bg=ctx.createLinearGradient(0,0,S,S); bg.addColorStop(0,'#0d1122'); bg.addColorStop(1,'#05060c');
  ctx.fillStyle=bg; ctx.fill();
  // neural filaments
  ctx.strokeStyle='rgba(255,205,110,0.5)'; ctx.lineWidth=Math.max(0.6,S*0.006); ctx.lineCap='round';
  const N=11;
  for(let i=0;i<N;i++){ const a=(i/N)*Math.PI*2+0.4; const r1=S*0.13, r2=S*0.33;
    ctx.beginPath(); ctx.moveTo(cx+Math.cos(a)*r1,cy+Math.sin(a)*r1);
    const mx=cx+Math.cos(a+0.12)*((r1+r2)/2), my=cy+Math.sin(a+0.12)*((r1+r2)/2);
    ctx.lineTo(mx,my); ctx.lineTo(cx+Math.cos(a-0.1)*r2,cy+Math.sin(a-0.1)*r2); ctx.stroke(); }
  // reactor ring
  ctx.lineWidth=Math.max(1,S*0.022); ctx.strokeStyle='rgba(255,176,32,0.9)';
  ctx.beginPath(); ctx.arc(cx,cy,S*0.355,0,Math.PI*2); ctx.stroke();
  // glow orb
  let g=ctx.createRadialGradient(cx,cy,0,cx,cy,S*0.33);
  g.addColorStop(0,'rgba(255,238,180,0.98)'); g.addColorStop(0.35,'rgba(255,176,32,0.92)');
  g.addColorStop(0.75,'rgba(255,122,24,0.35)'); g.addColorStop(1,'rgba(255,122,24,0)');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,S*0.33,0,Math.PI*2); ctx.fill();
  // bright core
  let c2=ctx.createRadialGradient(cx,cy,0,cx,cy,S*0.15);
  c2.addColorStop(0,'rgba(255,252,240,1)'); c2.addColorStop(1,'rgba(255,205,100,0)');
  ctx.fillStyle=c2; ctx.beginPath(); ctx.arc(cx,cy,S*0.15,0,Math.PI*2); ctx.fill();
  return c.toDataURL('image/png');
}
`;

function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];
  images.forEach((img, i) => {
    const o = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(img.png.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += img.png.length; blobs.push(img.png);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 320, height: 320, show: false });
  await win.loadURL('data:text/html,<html><body></body></html>');
  await win.webContents.executeJavaScript(drawFn);
  const images = [];
  for (const S of SIZES) {
    const dataUrl = await win.webContents.executeJavaScript('draw(' + S + ')');
    images.push({ size: S, png: Buffer.from(dataUrl.split(',')[1], 'base64') });
  }
  const ico = buildIco(images);
  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
  fs.writeFileSync(path.join(outDir, 'icon.png'), images[0].png);
  console.log('ICON: build/icon.ico (' + ico.length + ' bytes), build/icon.png written');
  app.exit(0);
});
