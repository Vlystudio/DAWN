"""Tracker — a tiny IoU tracker so detections get stable IDs and we can fire a
"new object entered frame" event. Torch-free, no deps.
"""


def _iou(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    return inter / (area_a + area_b - inter + 1e-6)


class Tracker:
    def __init__(self, iou=0.4, max_age=12):
        self.iou_th = iou
        self.max_age = max_age
        self.tracks = {}  # id -> {box, label, age, hits}
        self.next_id = 1

    def update(self, dets):
        """Match detections to tracks; return dets with track ids + which are new."""
        for tr in self.tracks.values():
            tr["age"] += 1
        out = []
        new_labels = []
        used = set()
        for d in dets:
            best_id, best = None, self.iou_th
            for tid, tr in self.tracks.items():
                if tid in used or tr["label"] != d["label"]:
                    continue
                s = _iou(tr["box"], d["box"])
                if s >= best:
                    best, best_id = s, tid
            if best_id is None:
                tid = self.next_id
                self.next_id += 1
                self.tracks[tid] = {"box": d["box"], "label": d["label"], "age": 0, "hits": 1}
                is_new = True
                new_labels.append(d["label"])
            else:
                tid = best_id
                self.tracks[tid].update(box=d["box"], age=0)
                self.tracks[tid]["hits"] += 1
                is_new = False
            used.add(tid)
            out.append({**d, "id": tid, "new": is_new})
        # retire stale tracks
        self.tracks = {tid: tr for tid, tr in self.tracks.items() if tr["age"] <= self.max_age}
        return out, new_labels
