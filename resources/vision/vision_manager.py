"""
DAWN Live Vision sidecar — a small local HTTP service that owns the webcam and
runs real-time perception. Camera + YOLO object detection + OCR, served over
127.0.0.1 only. Camera is OFF until /start; nothing is uploaded anywhere; frames
are only written to disk when /snapshot is called with an explicit path.

DAWN's main process spawns this (lazily, on first Live Vision use), waits for the
VISION_READY line on stderr, then drives it over HTTP.

Endpoints:
  GET  /health      -> 200 ok
  GET  /cameras     -> [{index,name}]
  POST /start       -> {device,width,height,fps,conf,draw}  start capture+detect
  POST /stop        -> stop capture, release camera
  GET  /status      -> {running, fps, device, providers, detections, ...}
  GET  /preview     -> MJPEG stream (annotated)
  GET  /detections  -> latest detections JSON
  POST /ocr         -> read text from the latest frame
  GET  /frame       -> latest raw JPEG (for the VLM)
  POST /snapshot    -> {path, annotated} save the latest frame
  GET  /context     -> rolling visual-memory summary
  POST /forget      -> clear visual memory
"""
import sys
import os
import json
import time
import threading
import argparse
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from camera import CameraManager  # noqa: E402
from detectors import RealTimeDetector  # noqa: E402
from ocr import OcrEngine  # noqa: E402
from tracking import Tracker  # noqa: E402
from context import ContextStore  # noqa: E402


class Vision:
    def __init__(self, model_path, providers):
        self.model_path = model_path
        self.providers = providers
        self.cam = CameraManager()
        self.detector = None
        self.ocr = OcrEngine()
        self.tracker = Tracker()
        self.ctx = ContextStore()
        self.lock = threading.Lock()
        self.running = False
        self.thread = None
        self.draw = True
        self.conf = 0.35
        self.fps_target = 6
        self.latest_frame = None      # raw BGR np.array
        self.latest_jpeg = None       # annotated JPEG bytes
        self.latest_dets = []
        self.measured_fps = 0.0
        self.last_err = ''

    def ensure_detector(self):
        if self.detector is not None:
            return True
        if not self.model_path or not os.path.exists(self.model_path):
            self.last_err = 'detector model not found'
            return False
        try:
            self.detector = RealTimeDetector(self.model_path, providers=self.providers, conf=self.conf)
            return True
        except Exception as e:
            self.last_err = f'detector load failed: {e}'
            return False

    def start(self, device=0, width=1280, height=720, fps=6, conf=0.35, draw=True):
        self.stop()
        self.conf = float(conf)
        self.fps_target = max(1, int(fps))
        self.draw = bool(draw)
        self.last_err = ''
        try:
            self.cam.open(device, width, height, fps)
        except Exception as e:
            # No camera attached / in use by another app / blocked by privacy settings.
            self.last_err = f'camera unavailable: {e}'
            self.running = False
            return False
        self.ensure_detector()  # ok if it fails — we still show the feed
        if self.detector:
            self.detector.conf = self.conf
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()
        return True

    def stop(self):
        self.running = False
        t = self.thread
        if t and t.is_alive():
            t.join(timeout=2)
        self.thread = None
        self.cam.close()
        with self.lock:
            self.latest_frame = None
            self.latest_jpeg = None
            self.latest_dets = []

    def _loop(self):
        period = 1.0 / self.fps_target
        last = time.time()
        while self.running:
            frame = self.cam.read()
            if frame is None:
                time.sleep(0.03)
                continue
            dets = self.detector.detect(frame) if self.detector else []
            tracked, new_labels = self.tracker.update(dets)
            self.ctx.set_objects(tracked)
            for nl in new_labels:
                self.ctx.add_event('new_object', nl)
            annotated = RealTimeDetector.draw(frame, tracked) if self.draw else frame
            ok, buf = cv2.imencode('.jpg', annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
            now = time.time()
            dt = now - last
            last = now
            with self.lock:
                self.latest_frame = frame
                if ok:
                    self.latest_jpeg = buf.tobytes()
                self.latest_dets = tracked
                self.measured_fps = round(1.0 / dt, 1) if dt > 0 else 0.0
            sleep = period - (time.time() - now)
            if sleep > 0:
                time.sleep(sleep)

    def raw_jpeg(self):
        with self.lock:
            if self.latest_frame is None:
                return None
            ok, buf = cv2.imencode('.jpg', self.latest_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
            return buf.tobytes() if ok else None

    def run_ocr(self):
        with self.lock:
            frame = None if self.latest_frame is None else self.latest_frame.copy()
        if frame is None:
            return {'ok': False, 'error': 'no frame'}
        try:
            r = self.ocr.read(frame)
            self.ctx.set_ocr(r['text'])
            if r['text']:
                self.ctx.add_event('text', r['text'][:80])
            return {'ok': True, **r}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def status(self):
        return {
            'running': self.running,
            'device': self.cam.device,
            'fps': self.measured_fps,
            'fps_target': self.fps_target,
            'providers': self.detector.providers if self.detector else [],
            'detector': bool(self.detector),
            'detections': len(self.latest_dets),
            'has_frame': self.latest_frame is not None,
            'error': self.last_err,
        }


VIS = None


def make_handler():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, data, ctype='application/json'):
            if isinstance(data, (dict, list)):
                data = json.dumps(data).encode()
            elif isinstance(data, str):
                data = data.encode()
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)

        def _body(self):
            n = int(self.headers.get('content-length', 0))
            if not n:
                return {}
            try:
                return json.loads(self.rfile.read(n) or b'{}')
            except Exception:
                return {}

        def do_GET(self):
            p = self.path.split('?')[0]
            try:
                if p == '/health':
                    return self._send(200, b'ok', 'text/plain')
                if p == '/cameras':
                    return self._send(200, CameraManager.list_cameras())
                if p == '/status':
                    return self._send(200, VIS.status())
                if p == '/detections':
                    return self._send(200, {'objects': VIS.latest_dets})
                if p == '/context':
                    return self._send(200, VIS.ctx.summary())
                if p == '/frame':
                    jpg = VIS.raw_jpeg()
                    if not jpg:
                        return self._send(404, {'error': 'no frame'})
                    return self._send(200, jpg, 'image/jpeg')
                if p == '/preview':
                    return self._stream_preview()
                return self._send(404, {'error': 'not found'})
            except Exception as e:
                self._send(500, {'error': str(e), 'trace': traceback.format_exc()[:400]})

        def do_POST(self):
            p = self.path.split('?')[0]
            try:
                b = self._body()
                if p == '/start':
                    VIS.start(b.get('device', 0), b.get('width', 1280), b.get('height', 720),
                              b.get('fps', 6), b.get('conf', 0.35), b.get('draw', True))
                    return self._send(200, VIS.status())
                if p == '/stop':
                    VIS.stop()
                    return self._send(200, {'ok': True})
                if p == '/ocr':
                    return self._send(200, VIS.run_ocr())
                if p == '/snapshot':
                    path = b.get('path')
                    if not path:
                        return self._send(400, {'error': 'no path'})
                    with VIS.lock:
                        frame = None if VIS.latest_frame is None else VIS.latest_frame.copy()
                        ann = VIS.latest_jpeg
                    if b.get('annotated') and ann:
                        open(path, 'wb').write(ann)
                    elif frame is not None:
                        cv2.imwrite(path, frame)
                    else:
                        return self._send(404, {'error': 'no frame'})
                    return self._send(200, {'ok': True, 'path': path})
                if p == '/forget':
                    VIS.ctx.forget()
                    return self._send(200, {'ok': True})
                return self._send(404, {'error': 'not found'})
            except Exception as e:
                self._send(500, {'error': str(e), 'trace': traceback.format_exc()[:400]})

        def _stream_preview(self):
            self.send_response(200)
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            try:
                while True:
                    with VIS.lock:
                        jpg = VIS.latest_jpeg
                    if jpg:
                        self.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ')
                        self.wfile.write(str(len(jpg)).encode())
                        self.wfile.write(b'\r\n\r\n')
                        self.wfile.write(jpg)
                        self.wfile.write(b'\r\n')
                    time.sleep(max(0.03, 1.0 / max(1, VIS.fps_target)))
                    if not VIS.running and not jpg:
                        break
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

    return Handler


def main():
    global VIS
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, required=True)
    ap.add_argument('--model', default='')
    ap.add_argument('--providers', default='')
    args = ap.parse_args()
    providers = [p for p in args.providers.split(',') if p] or None
    VIS = Vision(args.model, providers)

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        request_queue_size = 64

    server = Server(('127.0.0.1', args.port), make_handler())
    sys.stderr.write('VISION_READY\n')
    sys.stderr.flush()
    server.serve_forever()


if __name__ == '__main__':
    main()
