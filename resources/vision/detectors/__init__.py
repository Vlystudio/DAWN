"""RealTimeDetector — fast object detection with a YOLOv8 ONNX model on
onnxruntime (GPU via DirectML on Windows, CPU fallback). No torch.

Exposes detect(frame) -> [{label, conf, box:[x1,y1,x2,y2]}] and draw(frame,dets).
"""
import cv2
import numpy as np
import onnxruntime as ort

COCO = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
    "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
    "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
    "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
    "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
    "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier",
    "toothbrush",
]


class RealTimeDetector:
    def __init__(self, model_path, providers=None, conf=0.35, iou=0.45):
        self.conf = float(conf)
        self.iou = float(iou)
        avail = ort.get_available_providers()
        want = providers or ["DmlExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"]
        prov = [p for p in want if p in avail] or ["CPUExecutionProvider"]
        self.sess = ort.InferenceSession(model_path, sess_options=ort.SessionOptions(), providers=prov)
        self.providers = self.sess.get_providers()
        self.inp = self.sess.get_inputs()[0].name
        shp = self.sess.get_inputs()[0].shape
        self.imgsz = shp[2] if isinstance(shp[2], int) else 640

    def _letterbox(self, img):
        new = self.imgsz
        h, w = img.shape[:2]
        r = min(new / h, new / w)
        nh, nw = int(round(h * r)), int(round(w * r))
        resized = cv2.resize(img, (nw, nh))
        canvas = np.full((new, new, 3), 114, dtype=np.uint8)
        top, left = (new - nh) // 2, (new - nw) // 2
        canvas[top:top + nh, left:left + nw] = resized
        return canvas, r, left, top

    def detect(self, frame):
        if frame is None:
            return []
        img, r, left, top = self._letterbox(frame)
        blob = img[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
        blob = np.ascontiguousarray(blob)
        out = self.sess.run(None, {self.inp: blob})[0]
        out = np.squeeze(out, 0)
        if out.shape[0] < out.shape[1]:
            out = out.T  # -> (num, 4+classes)
        boxes = out[:, :4]
        scores = out[:, 4:]
        cls = scores.argmax(1)
        conf = scores.max(1)
        keep = conf > self.conf
        boxes, conf, cls = boxes[keep], conf[keep], cls[keep]
        if len(boxes) == 0:
            return []
        cx, cy, bw, bh = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        x1 = (cx - bw / 2 - left) / r
        y1 = (cy - bh / 2 - top) / r
        x2 = (cx + bw / 2 - left) / r
        y2 = (cy + bh / 2 - top) / r
        rects = np.stack([x1, y1, x2 - x1, y2 - y1], 1)
        idxs = cv2.dnn.NMSBoxes(rects.tolist(), conf.tolist(), self.conf, self.iou)
        if idxs is None or len(idxs) == 0:
            return []
        H, W = frame.shape[:2]
        results = []
        for i in np.array(idxs).flatten():
            ci = int(cls[i])
            results.append({
                "label": COCO[ci] if ci < len(COCO) else str(ci),
                "conf": round(float(conf[i]), 3),
                "box": [int(max(0, x1[i])), int(max(0, y1[i])), int(min(W, x2[i])), int(min(H, y2[i]))],
            })
        results.sort(key=lambda d: d["conf"], reverse=True)
        return results

    @staticmethod
    def draw(frame, dets):
        """Draw amber boxes + labels onto a copy of the frame (for the preview)."""
        out = frame.copy()
        for d in dets:
            x1, y1, x2, y2 = d["box"]
            cv2.rectangle(out, (x1, y1), (x2, y2), (32, 176, 255), 2)  # BGR ~ amber/gold
            txt = f"{d['label']} {int(d['conf'] * 100)}%"
            (tw, th), _ = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(out, (x1, y1 - th - 6), (x1 + tw + 6, y1), (32, 176, 255), -1)
            cv2.putText(out, txt, (x1 + 3, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (10, 20, 40), 1, cv2.LINE_AA)
        return out
