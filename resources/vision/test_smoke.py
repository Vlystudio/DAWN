"""Smoke test — exercises the detector + OCR on a synthetic image (no camera),
so it can run in CI / setup verification. Run with the vision venv python."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
import cv2  # noqa: E402


def main():
    img = np.full((480, 640, 3), 28, np.uint8)
    cv2.putText(img, 'DAWN VISION', (70, 250), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (235, 235, 235), 3)

    model = os.path.join(os.path.dirname(__file__), 'models', 'yolov8n.onnx')
    if os.path.exists(model):
        from detectors import RealTimeDetector
        d = RealTimeDetector(model)
        dets = d.detect(img)
        print('DETECT: providers=%s count=%d' % (d.providers, len(dets)))
    else:
        print('DETECT: model missing (run setup-vision.ps1)')

    try:
        from ocr import OcrEngine
        eng = OcrEngine()
        if eng.available():
            r = eng.read(img)
            print('OCR: %r' % (r['text'][:60],))
        else:
            print('OCR: rapidocr not installed')
    except Exception as e:
        print('OCR error:', e)

    print('SMOKE OK')


if __name__ == '__main__':
    main()
