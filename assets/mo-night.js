(() => {
  const width = 192, height = 128;
  const map = document.createElement("canvas");
  map.width = width;
  map.height = height;
  const pen = map.getContext("2d");
  if (!pen) return;

  const pixels = pen.createImageData(width, height);
  const { data } = pixels;
  const ramp = (a, b, value) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  // Project the panes of an off-screen window onto the original quilt.
  function projectedLight(x, y) {
    const side = x - .57 * y + .085;
    const forward = y - .32 * x;
    const softness = .022 + .031 * ramp(-.10, .72, forward);
    const first = ramp(-.14, -.14 + softness, side);
    const last = 1 - ramp(.345 - softness, .345, side);
    const end = 1 - ramp(.64, .77, forward);
    const verticalBar = .23 + .77 * ramp(.010, softness + .013, Math.abs(side - .097));
    const crossBar = .21 + .79 * ramp(.010, softness + .011, Math.abs(forward - .302));
    const spread = 1 - .68 * ramp(.04, .76, forward);
    const halo = .19 * Math.exp(-(((x - .09) / .36) ** 2 + ((y - .18) / .43) ** 2));
    return Math.min(1, halo + .93 * first * last * end * verticalBar * crossBar * spread);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(255 * projectedLight((x + .5) / width, (y + .5) / height));
      data[i + 3] = 255;
    }
  }
  pen.putImageData(pixels, 0, 0);

  function at(x, y) {
    const u = Math.max(0, Math.min(width - 1, x * width - .5));
    const v = Math.max(0, Math.min(height - 1, y * height - .5));
    const left = Math.floor(u), top = Math.floor(v);
    const right = Math.min(width - 1, left + 1), bottom = Math.min(height - 1, top + 1);
    const p = (top * width + left) * 4, q = (bottom * width + left) * 4;
    const a = data[p] + (data[(top * width + right) * 4] - data[p]) * (u - left);
    const b = data[q] + (data[(bottom * width + right) * 4] - data[q]) * (u - left);
    return (a + (b - a) * (v - top)) / 255;
  }

  // Compress the original sunlight before exposing the scene to the blue moon.
  const shader = [
    "vec3 moonRoomColor(vec3 rgb, float light) {",
    "  float luma = dot(rgb, vec3(.23, .60, .17));",
    "  float excess = max(0., luma - .49);",
    "  float diffuse = luma - excess + .058 * (1. - exp(-excess / .058));",
    "  vec3 cloth = mix(vec3(luma), rgb, .42) * diffuse / max(luma, .001);",
    "  vec3 exposure = mix(vec3(.17, .246, .34), vec3(.74, .90, 1.10), light);",
    "  return cloth * exposure + vec3(.010, .019, .031);",
    "}",
  ].join("\n");

  function fallbackRoom(image) {
    const still = document.createElement("canvas");
    const scale = Math.min(1, 850 / image.naturalWidth);
    still.width = Math.round(image.naturalWidth * scale);
    still.height = Math.round(image.naturalHeight * scale);
    const ink = still.getContext("2d");
    if (!ink) return "";
    ink.drawImage(image, 0, 0, still.width, still.height);
    const read = ink.getImageData(0, 0, still.width, still.height);
    const out = read.data;
    for (let y = 0; y < still.height; y++) {
      for (let x = 0; x < still.width; x++) {
        const i = (y * still.width + x) * 4;
        const gray = .23 * out[i] + .60 * out[i + 1] + .17 * out[i + 2];
        const excess = Math.max(0, gray - 124.95);
        const neutral = (gray - excess + 14.79 * (1 - Math.exp(-excess / 14.79))) / Math.max(gray, .255);
        const light = at((x + .5) / still.width, (y + .5) / still.height);
        out[i] = (.58 * gray + .42 * out[i]) * neutral * (.17 + .57 * light) + 2.55;
        out[i + 1] = (.58 * gray + .42 * out[i + 1]) * neutral * (.246 + .654 * light) + 4.845;
        out[i + 2] = (.58 * gray + .42 * out[i + 2]) * neutral * (.34 + .76 * light) + 7.905;
      }
    }
    ink.putImageData(read, 0, 0);
    return still.toDataURL("image/webp", .89);
  }

  window.moMoonlight = { map, at, shader, fallbackRoom };
})();
