import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { app } from 'electron';
import settings from './settings';

/** hardware.ts — detect GPU(s)/VRAM (nvidia-smi), RAM, and free disk on the
 *  models drive, to drive Model Hub recommendations and "fits your hardware". */

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => execFile(cmd, args, { windowsHide: true }, (_e, out) => resolve(out ? String(out) : '')));
}

export interface Hardware {
  ramGB: number;
  gpus: { name: string; vramGB: number }[];
  cuda: boolean;
  diskFreeGB: number;
}

export async function detect(): Promise<Hardware> {
  const ramGB = Math.round(os.totalmem() / 1024 ** 3);

  let gpus: { name: string; vramGB: number }[] = [];
  let cuda = false;
  const smi = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  if (smi.trim()) {
    cuda = true;
    gpus = smi.trim().split(/\r?\n/).map((l) => {
      const [name, mem] = l.split(',').map((x) => x.trim());
      return { name, vramGB: Math.round(Number(mem) / 1024) };
    });
  }

  const root = settings.get().modelsRoot || path.join(app.getPath('userData'), 'models');
  let diskFreeGB = 0;
  try {
    const st: any = (fs as any).statfsSync(root);
    diskFreeGB = Math.round((st.bavail * st.bsize) / 1024 ** 3);
  } catch {
    const drive = root.slice(0, 2);
    const wmic = await run('wmic', ['logicaldisk', 'where', `DeviceID='${drive}'`, 'get', 'FreeSpace', '/value']);
    const m = wmic.match(/FreeSpace=(\d+)/);
    if (m) diskFreeGB = Math.round(Number(m[1]) / 1024 ** 3);
  }

  return { ramGB, gpus, cuda, diskFreeGB };
}

export default { detect };
