/**
 * hardwareDetectionService.ts — builds a full HardwareProfile for the optimizer:
 * OS, CPU (name/cores/threads), RAM (total/available), GPU(s) + VRAM, free disk,
 * models dir + installed GGUFs, and which backends are available. Everything is
 * best-effort and wrapped in try/catch — unknown values become undefined and the
 * caller renders "Unknown" rather than crashing.
 *
 * Reuses DAWN's existing detection where possible (nvidia-smi, models dir, runtime exe).
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { app } from 'electron';
import settings from '../settings';
import models from '../models';
import runtime from '../runtime';
import { GpuInfo, HardwareProfile, Vendor } from './optimizerTypes';

const GB = 1024 ** 3;

function run(cmd: string, args: string[], timeoutMs = 4000): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { windowsHide: true, timeout: timeoutMs }, (_e, out) => resolve(out ? String(out) : ''));
    } catch { resolve(''); }
  });
}

function osName(): string {
  switch (process.platform) {
    case 'win32': return 'Windows';
    case 'darwin': return 'macOS';
    case 'linux': return 'Linux';
    default: return process.platform;
  }
}

function vendorOf(name: string): Vendor {
  const n = name.toLowerCase();
  if (/nvidia|geforce|rtx|gtx|quadro|tesla/.test(n)) return 'nvidia';
  if (/amd|radeon|rx\s|instinct/.test(n)) return 'amd';
  if (/apple|m1|m2|m3|m4/.test(n)) return 'apple';
  if (/intel|arc|iris|uhd/.test(n)) return 'intel';
  return 'unknown';
}

async function detectCpu(): Promise<{ name?: string; cores?: number; threads?: number }> {
  let name: string | undefined, cores: number | undefined;
  const threads = os.cpus()?.length || undefined;
  try { name = os.cpus()?.[0]?.model?.trim() || undefined; } catch { /* */ }
  if (process.platform === 'win32') {
    const out = await run('wmic', ['cpu', 'get', 'NumberOfCores', '/value']);
    const nums = [...out.matchAll(/NumberOfCores=(\d+)/g)].map((m) => Number(m[1]));
    if (nums.length) cores = nums.reduce((a, b) => a + b, 0);
  }
  if (!cores && threads) cores = Math.max(1, Math.round(threads / 2));
  return { name, cores, threads };
}

async function detectGpus(): Promise<{ gpus: GpuInfo[]; cuda: boolean }> {
  const gpus: GpuInfo[] = [];
  let cuda = false;

  // NVIDIA (accurate VRAM)
  const smi = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  if (smi.trim()) {
    cuda = true;
    for (const line of smi.trim().split(/\r?\n/)) {
      const [name, mem] = line.split(',').map((x) => x.trim());
      if (name) gpus.push({ name, vramGB: Math.round(Number(mem) / 1024), vendor: 'nvidia', cudaAvailable: true });
    }
  }

  // Non-NVIDIA on Windows (AMD/Intel) — names via wmic; AdapterRAM is unreliable for >4GB
  if (process.platform === 'win32') {
    const out = await run('wmic', ['path', 'win32_VideoController', 'get', 'Name,AdapterRAM', '/format:csv']);
    for (const line of out.split(/\r?\n/)) {
      const cols = line.split(',').map((x) => x.trim());
      if (cols.length < 3) continue;
      const ram = Number(cols[1]); const name = cols[2];
      if (!name || /name/i.test(name)) continue;
      if (gpus.some((g) => g.name.toLowerCase() === name.toLowerCase())) continue;       // already have it (NVIDIA)
      if (/nvidia|geforce|rtx|gtx/i.test(name)) continue;                                 // covered by nvidia-smi
      const v = vendorOf(name);
      // 32-bit AdapterRAM caps at ~4.29GB — treat that sentinel as unknown VRAM
      const vramGB = ram > 0 && ram < 4_290_000_000 ? Math.round(ram / GB) : undefined;
      gpus.push({ name, vramGB, vendor: v, directMLAvailable: true });
    }
  }

  // Apple Silicon — unified memory acts as VRAM
  if (process.platform === 'darwin' && !gpus.length) {
    gpus.push({ name: 'Apple GPU (unified memory)', vramGB: Math.round(os.totalmem() / GB), vendor: 'apple', metalAvailable: true });
  }
  return { gpus, cuda };
}

function detectDiskFreeGB(root: string): Promise<number> {
  return (async () => {
    try {
      const st: any = (fs as any).statfsSync(root);
      return Math.round((st.bavail * st.bsize) / GB);
    } catch {
      const drive = root.slice(0, 2);
      const wmic = await run('wmic', ['logicaldisk', 'where', `DeviceID='${drive}'`, 'get', 'FreeSpace', '/value']);
      const m = wmic.match(/FreeSpace=(\d+)/);
      return m ? Math.round(Number(m[1]) / GB) : 0;
    }
  })();
}

async function ollamaUp(): Promise<boolean> {
  try {
    const url = (settings.get().agentosOllamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch { return false; }
}

function hashProfile(p: HardwareProfile): string {
  const sig = [p.os, p.cpuName, p.cpuThreads, p.totalRamGB, ...(p.gpus || []).map((g) => `${g.name}:${g.vramGB ?? '?'}`)].join('|');
  let h = 0;
  for (let i = 0; i < sig.length; i++) { h = (h * 31 + sig.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(16);
}

let cache: HardwareProfile | null = null;

export async function detectProfile(force = false): Promise<HardwareProfile> {
  if (cache && !force) return cache;

  const totalRamGB = Math.round(os.totalmem() / GB);
  const availableRamGB = Math.round((os.totalmem() / GB) * 0.8); // stable, generous (Windows "free" understates reclaimable cache)

  const [cpu, gpuRes] = await Promise.all([detectCpu(), detectGpus()]);

  let modelsDir = ''; let installedModels: string[] = [];
  try { modelsDir = models.modelsDir(); } catch { /* */ }
  try { installedModels = models.list().map((m) => m.name); } catch { /* */ }

  const root = modelsDir || settings.get().modelsRoot || path.join(app.getPath('userData'), 'models');
  const diskFreeGB = await detectDiskFreeGB(root);

  let llamaCpp = false;
  try { llamaCpp = runtime.isInstalled(); } catch { /* */ }
  const ollama = await ollamaUp();

  const hasGpu = gpuRes.gpus.length > 0;
  const hasAmd = gpuRes.gpus.some((g) => g.vendor === 'amd');
  const profile: HardwareProfile = {
    os: osName(),
    arch: process.arch,
    cpuName: cpu.name,
    cpuCores: cpu.cores,
    cpuThreads: cpu.threads,
    totalRamGB,
    availableRamGB,
    gpus: gpuRes.gpus,
    diskFreeGB,
    modelsDir,
    installedModels,
    backends: {
      ollama,
      llamaCpp,
      cuda: gpuRes.cuda,
      directML: process.platform === 'win32' && hasGpu,
      metal: process.platform === 'darwin',
      rocm: process.platform === 'linux' && hasAmd,
      cpuOnly: !hasGpu,
    },
    detectedAt: new Date().toISOString(),
  };
  profile.hash = hashProfile(profile);
  cache = profile;
  return profile;
}

export function cachedProfile(): HardwareProfile | null { return cache; }

export default { detectProfile, cachedProfile };
