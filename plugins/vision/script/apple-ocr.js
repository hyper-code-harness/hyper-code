// JXA: osascript -l JavaScript apple-ocr.js <imagePath> <langsCsv> <level:accurate|fast>
ObjC.import('Vision'); ObjC.import('Foundation');
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const req = $.VNRecognizeTextRequest.alloc.init;
  req.recognitionLanguages = $((argv[1] || 'ru-RU,en-US').split(','));
  req.recognitionLevel = argv[2] === 'fast' ? 1 : 0;
  req.usesLanguageCorrection = true;
  const h = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $());
  const err = Ref();
  if (!h.performRequestsError($([req]), err)) return JSON.stringify({ error: 'Vision request failed' });
  const res = req.results, out = [];
  for (let i = 0; i < res.count; i++) {
    const o = res.objectAtIndex(i), c = o.topCandidates(1).objectAtIndex(0), b = o.boundingBox;
    // Vision boxes are normalized with bottom-left origin; convert to top-left.
    out.push({ text: c.string.js, confidence: c.confidence,
      box: { x: b.origin.x, y: 1 - b.origin.y - b.size.height, w: b.size.width, h: b.size.height },
      quad: [o.topLeft, o.topRight, o.bottomRight, o.bottomLeft].map(p => ({ x: p.x, y: 1 - p.y })) });
  }
  return JSON.stringify({ lines: out });
}
