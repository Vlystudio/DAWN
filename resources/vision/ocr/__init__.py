"""OcrEngine — local OCR via RapidOCR (PaddleOCR models on onnxruntime, no
torch). Lazy-loaded: the models only load the first time text is read.
"""


class OcrEngine:
    def __init__(self):
        self._engine = None

    def available(self):
        try:
            import rapidocr_onnxruntime  # noqa: F401
            return True
        except Exception:
            return False

    def _ensure(self):
        if self._engine is None:
            from rapidocr_onnxruntime import RapidOCR
            self._engine = RapidOCR()
        return self._engine

    def read(self, frame):
        eng = self._ensure()
        result, _ = eng(frame)
        lines = []
        if result:
            for box, text, score in result:
                xs = [p[0] for p in box]
                ys = [p[1] for p in box]
                lines.append({
                    "text": text,
                    "conf": round(float(score), 3),
                    "box": [int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))],
                })
        return {"text": "\n".join(l["text"] for l in lines), "lines": lines}
