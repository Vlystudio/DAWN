"""ContextStore — DAWN's rolling short-term VISUAL memory: the last detected
objects, the last scene summary, the last OCR text, recent events + timestamps.
Lets DAWN answer "what am I looking at / holding" with live camera context.
"""
import time
from collections import deque


class ContextStore:
    def __init__(self, max_events=40):
        self.objects = []        # latest [{label, conf, id}]
        self.object_counts = {}  # label -> count
        self.scene = ''          # last VLM / scene summary
        self.ocr_text = ''       # last OCR text
        self.events = deque(maxlen=max_events)  # {kind, detail, ts}
        self.updated = 0.0

    def set_objects(self, dets):
        self.objects = [{'label': d['label'], 'conf': d['conf'], 'id': d.get('id')} for d in dets]
        counts = {}
        for d in dets:
            counts[d['label']] = counts.get(d['label'], 0) + 1
        self.object_counts = counts
        self.updated = time.time()

    def add_event(self, kind, detail):
        self.events.appendleft({'kind': kind, 'detail': detail, 'ts': time.time()})

    def set_scene(self, s):
        self.scene = s or ''
        self.updated = time.time()

    def set_ocr(self, t):
        self.ocr_text = t or ''
        self.updated = time.time()

    def _objects_str(self):
        return ', '.join(
            (f"{c}x {l}" if c > 1 else l)
            for l, c in sorted(self.object_counts.items(), key=lambda x: -x[1])
        )

    def summary(self):
        return {
            'objects': self.objects,
            'object_summary': self._objects_str(),
            'scene': self.scene,
            'ocr_text': self.ocr_text,
            'events': list(self.events)[:10],
            'updated': self.updated,
        }

    def text_block(self):
        lines = []
        if self.object_counts:
            lines.append(f"Visible objects: {self._objects_str()}")
        if self.scene:
            lines.append(f"Scene: {self.scene}")
        if self.ocr_text:
            lines.append(f"Text seen: {self.ocr_text[:400]}")
        return '\n'.join(lines)

    def forget(self):
        self.objects = []
        self.object_counts = {}
        self.scene = ''
        self.ocr_text = ''
        self.events.clear()
        self.updated = time.time()
