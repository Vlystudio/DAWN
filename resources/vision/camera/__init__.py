"""CameraManager — OpenCV webcam capture for DAWN Live Vision.

Owns the camera device: enumerate, open by index, control resolution/FPS, read
frames. The OS camera indicator lights only while a device is open (privacy).

Windows note: OpenCV exposes several capture backends and which one actually
works varies by machine/driver. DSHOW frequently logs "can't be used to capture
by index" on systems where MSMF (Media Foundation) is the working backend (and
vice versa). So we try MSMF -> DSHOW -> ANY and keep the first that yields a
real frame, rather than hard-coding DSHOW.
"""
import threading
import cv2

# Backend preference order for Windows. CAP_ANY lets OpenCV pick.
_BACKENDS = [
    (getattr(cv2, "CAP_MSMF", 1400), "MSMF"),
    (getattr(cv2, "CAP_DSHOW", 700), "DSHOW"),
    (getattr(cv2, "CAP_ANY", 0), "ANY"),
]


def _try_open(index, backend, width=0, height=0, fps=0):
    """Open one (index, backend); return a capture that produced a frame, else None."""
    try:
        cap = cv2.VideoCapture(index, backend)
    except Exception:
        return None
    if not cap or not cap.isOpened():
        if cap:
            cap.release()
        return None
    if width:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    if fps:
        cap.set(cv2.CAP_PROP_FPS, fps)
    ok, _ = cap.read()
    if not ok:
        cap.release()
        return None
    return cap


class CameraManager:
    def __init__(self):
        self.cap = None
        self.device = 0
        self.backend = None        # cv2 backend id that worked
        self.width = 1280
        self.height = 720
        self.fps = 6
        self._lock = threading.Lock()

    @staticmethod
    def list_cameras(max_probe=6):
        """Probe indices across backends for working cameras. Returns [{index, name, backend}]."""
        found = []
        for i in range(max_probe):
            for backend, bname in _BACKENDS:
                cap = _try_open(i, backend)
                if cap is not None:
                    cap.release()
                    found.append({"index": i, "name": f"Camera {i}", "backend": bname})
                    break  # this index works; don't double-list it via another backend
        return found

    def open(self, device=0, width=1280, height=720, fps=6):
        with self._lock:
            self._close_locked()
            self.device, self.width, self.height, self.fps = int(device), int(width), int(height), int(fps)
            last_err = None
            for backend, bname in _BACKENDS:
                cap = _try_open(self.device, backend, self.width, self.height, self.fps)
                if cap is not None:
                    self.cap = cap
                    self.backend = bname
                    return True
                last_err = bname
            raise RuntimeError(f"Could not open camera {self.device} on any backend (tried MSMF/DSHOW/ANY, last={last_err})")

    def read(self):
        with self._lock:
            if self.cap is None:
                return None
            ok, frame = self.cap.read()
            return frame if ok else None

    def is_open(self):
        return self.cap is not None and self.cap.isOpened()

    def _close_locked(self):
        if self.cap is not None:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None

    def close(self):
        with self._lock:
            self._close_locked()
