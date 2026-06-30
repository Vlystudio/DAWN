import { EventEmitter } from 'events';
import { net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import models from './models';
import logger from './logger';

/**
 * download.ts — resumable GGUF download manager.
 *
 * Uses Electron's `net` module (Chromium network stack) rather than Node fetch,
 * so it honors the **Windows system certificate store and proxy** — essential on
 * machines behind a corporate TLS proxy (where Node's bundled CA fails). Streams
 * to a .part file with HTTP Range resume; pause/resume/retry/cancel; verifies the
 * final size; then moves the file into models/<family>/.
 */

type Status = 'downloading' | 'paused' | 'verifying' | 'done' | 'error';

interface Job {
  id: string;
  modelId: string;
  family: string;
  filename: string;
  url: string;
  dest: string;
  tmp: string;
  total: number;
  received: number;
  status: Status;
  error?: string;
  sha256?: string;       // computed after download (final verification)
  expectedSha?: string;  // optional, from the catalog
  verified?: boolean;    // size (and sha, if expected) verified
  abort?: () => void;
}

/** Stream-hash a file with SHA-256 without loading it into memory. */
function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(file);
    rs.on('data', (d) => h.update(d));
    rs.on('end', () => resolve(h.digest('hex')));
    rs.on('error', reject);
  });
}

class DownloadManager extends EventEmitter {
  private jobs = new Map<string, Job>();

  list() {
    return [...this.jobs.values()].map((j) => ({
      id: j.id, modelId: j.modelId, filename: j.filename, total: j.total, received: j.received,
      status: j.status, error: j.error, sha256: j.sha256, verified: j.verified,
    }));
  }
  private emitP() {
    this.emit('progress', this.list());
  }

  async start(modelId: string, family: string, filename: string, url: string, sha?: string) {
    const dir = path.join(models.modelsDir(), family);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, filename);
    const tmp = dest + '.part';
    if (fs.existsSync(dest)) return { ok: true, already: true };
    const id = `${modelId}/${filename}`;
    if (this.jobs.get(id)?.status === 'downloading') return { ok: true, id };
    const received = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
    const job: Job = { id, modelId, family, filename, url, dest, tmp, total: 0, received, status: 'downloading', expectedSha: sha };
    this.jobs.set(id, job);
    this.run(job);
    return { ok: true, id };
  }

  private run(job: Job) {
    const headers: Record<string, string> = {};
    if (job.received > 0) headers['Range'] = `bytes=${job.received}-`;
    logger.step('hub', `Downloading ${job.filename}${job.received ? ` (resume @ ${job.received})` : ''}`);

    const out = fs.createWriteStream(job.tmp, { flags: job.received > 0 ? 'a' : 'w' });
    const request = net.request({ method: 'GET', url: job.url, redirect: 'follow' });
    for (const [k, v] of Object.entries(headers)) request.setHeader(k, v);
    job.abort = () => { try { request.abort(); } catch { /* */ } };
    let lastEmit = 0;

    request.on('response', (response: any) => {
      const code = response.statusCode;
      if (code !== 200 && code !== 206) {
        out.close();
        job.status = 'error';
        job.error = `HTTP ${code}`;
        this.emitP();
        try { request.abort(); } catch { /* */ }
        return;
      }
      const len = Number(response.headers['content-length'] || 0);
      job.total = job.received + len;
      response.on('data', (chunk: Buffer) => {
        if (!out.write(chunk)) {
          response.pause();
          out.once('drain', () => response.resume());
        }
        job.received += chunk.length;
        const now = Date.now();
        if (now - lastEmit > 400) {
          lastEmit = now;
          this.emitP();
        }
      });
      response.on('end', () => {
        out.end(() => {
          if (job.status !== 'downloading') return;
          try {
            const finalSize = fs.statSync(job.tmp).size;
            if (job.total && finalSize < job.total) {
              job.status = 'paused'; // server closed early — resume continues
              job.error = 'connection closed early — press resume';
              this.emitP();
              return;
            }
            job.status = 'verifying';
            this.emitP();
            // Final verification: compute SHA-256 (and check the expected hash if the catalog has one).
            hashFile(job.tmp).then((sha) => {
              job.sha256 = sha;
              if (job.expectedSha && job.expectedSha.toLowerCase() !== sha.toLowerCase()) {
                job.status = 'error';
                job.error = `hash mismatch — expected ${job.expectedSha.slice(0, 12)}…, got ${sha.slice(0, 12)}…`;
                job.verified = false;
                this.emitP();
                logger.error('hub', `Hash mismatch for ${job.filename}`);
                return;
              }
              job.verified = true;
              fs.renameSync(job.tmp, job.dest);
              job.status = 'done';
              this.emitP();
              logger.info('hub', `Installed ${job.filename} (sha256 ${sha.slice(0, 16)}…, ${finalSize} bytes)`);
            }).catch((e) => {
              // Hashing failed — still install (size already verified) but flag unverified.
              job.verified = false;
              try { fs.renameSync(job.tmp, job.dest); job.status = 'done'; } catch { job.status = 'error'; job.error = e.message; }
              this.emitP();
            });
          } catch (e: any) {
            job.status = 'error';
            job.error = e.message;
            this.emitP();
            logger.error('hub', e.message);
          }
        });
      });
    });
    request.on('error', (e: any) => {
      try { out.close(); } catch { /* */ }
      if (job.status === 'downloading') {
        job.status = 'error';
        job.error = e.message;
        this.emitP();
        logger.error('hub', `Download failed (${job.filename}): ${e.message}`);
      }
    });
    request.on('abort', () => {
      try { out.close(); } catch { /* */ }
      if (job.status === 'downloading') {
        job.status = 'paused';
        this.emitP();
      }
    });
    request.end();
  }

  pause(id: string) {
    const j = this.jobs.get(id);
    if (j && j.status === 'downloading') {
      j.status = 'paused';
      j.abort?.();
      this.emitP();
    }
  }
  resume(id: string) {
    const j = this.jobs.get(id);
    if (j && (j.status === 'paused' || j.status === 'error')) {
      j.received = fs.existsSync(j.tmp) ? fs.statSync(j.tmp).size : 0;
      j.status = 'downloading';
      j.error = undefined;
      this.emitP();
      this.run(j);
    }
  }
  cancel(id: string) {
    const j = this.jobs.get(id);
    if (!j) return;
    j.abort?.();
    try {
      if (fs.existsSync(j.tmp)) fs.unlinkSync(j.tmp);
    } catch {
      /* ignore */
    }
    this.jobs.delete(id);
    this.emitP();
  }
}

export default new DownloadManager();
