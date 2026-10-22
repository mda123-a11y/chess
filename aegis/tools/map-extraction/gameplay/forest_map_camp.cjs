module.exports = {
  patches: [
    // gridChunk computed per-vertex AO but never uploaded it: the shader then read aAO=0 and the ground rendered black
    ['g.setAttribute("aSplat", new THREE8.Float32BufferAttribute(spl, 4));\n  g.setIndex(idx2);\n  g.computeBoundingSphere();\n  g.computeBoundingBox();', 'g.setAttribute("aSplat", new THREE8.Float32BufferAttribute(spl, 4));\n  g.setAttribute("aAO", new THREE8.Float32BufferAttribute(ao, 1));\n  g.setIndex(idx2);\n  g.computeBoundingSphere();\n  g.computeBoundingBox();'],
  ],
};
