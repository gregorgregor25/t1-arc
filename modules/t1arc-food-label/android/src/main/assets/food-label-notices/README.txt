T1 Arc nutrition-label OCR dependencies

English PP-OCRv4 mobile recognition model, PaddlePaddle / PaddleOCR (Apache-2.0).
Unmodified ONNX conversion distributed by RapidAI / RapidOCR (Apache-2.0).
Model source pinned to the RapidOCR v3.9.2 model manifest:
https://github.com/RapidAI/RapidOCR/blob/v3.9.2/python/rapidocr/default_models.yaml
https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv4/rec/en_PP-OCRv4_rec_mobile.onnx
SHA-256: e8770c967605983d1570cdf5352041dfb68fa0c21664f49f47b155abd3e0e318
The build downloads and verifies this model, then bundles it for offline first use.
It is not trained or modified using T1 Arc user photos.

Recognition preprocessing and CTC decoding follow PaddleOCR/RapidOCR's published
algorithm. The Kotlin implementation adapts that algorithm for Android bitmaps,
bounded single-word crops and ONNX Runtime Java; it does not bundle Python code.
Copyright (c) 2020 PaddlePaddle Authors. All Rights Reserved.
Copyright (c) RapidAI contributors. Licensed under Apache License 2.0.
Full licenses: PaddleOCR-LICENSE.txt and RapidOCR-LICENSE.txt.

ONNX Runtime Android 1.24.3, Microsoft Corporation, MIT License.
https://github.com/microsoft/onnxruntime/tree/v1.24.3
Full license and bundled third-party notices are included beside this file.

ML Kit text recognition 16.0.1 locates text before word recognition.
https://developers.google.com/ml-kit/terms
It remains subject to Google's SDK terms, including SDK metrics. Images and
recognized text stay on-device. No paid service or runtime model download is used.
