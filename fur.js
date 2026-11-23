(() => {
  const count = 4;

  function settle(state, target, elapsed, frequency, damping) {
    const steps = Math.ceil(elapsed * 144);
    const h = elapsed / steps;
    const w = 2 * Math.PI * frequency;
    for (let i = 0; i < steps; i++) {
      state.speed += (w * w * (target - state.value) - 2 * damping * w * state.speed) * h;
      state.value += state.speed * h;
    }
    return state.value;
  }

  function field(pads, flow, x, y, aspect) {
    let shiftX = 0;
    let shiftY = 0;
    for (let i = 0; i < pads.length; i += 4) {
      const force = pads[i + 2];
      if (Math.abs(force) < .0001) continue;
      const radius = pads[i + 3];
      const dx = (x - pads[i]) * aspect;
      const dy = y - pads[i + 1];
      // Let adjacent fur move together along a slanted strip under the hand.
      const across = (dx - dy * .32) / radius;
      const along = dy / (radius * 1.38);
      const weight = force * Math.exp(-2 * (across * across + along * along));
      shiftX += weight * (radius * .48 * flow[0] - dx * .14);
      shiftY += weight * (radius * (.27 + .30 * flow[1]) - dy * .15);
    }
    return [shiftX / aspect, shiftY];
  }

  // This is the same field evaluated by the CPU for the hand, hit testing and the tail root.
  const shader = [
    "uniform vec4 uFurPads[" + count + "];",
    "uniform vec2 uFurFlow;",
    "vec2 furDisplacement(vec2 p) {",
    "  vec2 metric = vec2(uSceneAspect, 1.);",
    "  vec2 shift = vec2(0.);",
    "  for (int i = 0; i < " + count + "; i++) {",
    "    vec4 pad = uFurPads[i];",
    "    if (abs(pad.z) < .0001) continue;",
    "    vec2 delta = (p - pad.xy) * metric;",
    "    vec2 local = vec2(delta.x - delta.y * .32, delta.y / 1.38) / pad.w;",
    "    float weight = pad.z * exp(-2. * dot(local, local));",
    "    vec2 pull = pad.w * vec2(.48 * uFurFlow.x, .27 + .30 * uFurFlow.y);",
    "    shift += weight * (pull - delta * vec2(.14, .15));",
    "  }",
    "  return shift / metric;",
    "}",
  ].join("\n");

  function create() {
    const pads = new Float32Array(count * 4);
    const flow = new Float32Array(2);
    const [press, bulk, relief, shearX, shearY] = Array.from({ length: 5 }, () => ({ value: 0, speed: 0 }));
    let palmX = 0;
    let palmY = 0;
    let held = 0;
    let load = 0;

    function offset(x, y, aspect) {
      return field(pads, flow, x, y, aspect);
    }

    function input(x, y, aspect) {
      let u = x, v = y;
      for (let i = 0; i < 3; i++) {
        const [dx, dy] = offset(u, v, aspect);
        u = x - dx;
        v = y - dy;
      }
      return [u, v];
    }

    function write(index, x, y, force, radius) {
      pads.set([x, y, force, radius], index * 4);
    }

    function update({ hand, aspect, handSize, angle, pressure, skull, moving, elapsed, canReach }) {
      const active = pressure > .025;
      const radius = Math.max(.085, Math.min(.153, handSize * .54));
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      function padAt(x, y) {
        const dx = (x * c - y * s) * handSize / aspect;
        const dy = (x * s + y * c) * handSize;
        if (canReach(hand.x + dx, hand.y + dy)) return [hand.x + dx, hand.y + dy];
        if (canReach(hand.x + dx * .48, hand.y + dy * .48)) return [hand.x + dx * .48, hand.y + dy * .48];
        return [hand.x, hand.y];
      }

      if (active) {
        [palmX, palmY] = padAt(.055, .40);
      }

      held = active ? held + elapsed : 0;
      const strength = active ? Math.pow(pressure, .78) * (skull ? .67 : 1) : 0;
      load = Math.max(0, settle(press, strength, elapsed, 4.1, .86));
      const care = Math.min(1, Math.max(0, (held - .18) / .55));
      const rebound = settle(relief, strength * care * care * (3 - 2 * care), elapsed, 3.2, .91);
      const surrounding = .30 * settle(bulk, strength, elapsed, 2.9, .9) - .13 * rebound;
      const goalX = active ? Math.tanh(hand.dx * 1.35) * moving : 0;
      const goalY = active ? Math.tanh(hand.dy * 1.35 / aspect) * moving : 0;
      flow[0] = settle(shearX, goalX, elapsed, 4.6, .86);
      flow[1] = settle(shearY, goalY, elapsed, 4.6, .86);

      write(0, palmX, palmY, load, radius);
      for (const [i, x, y] of [[1, -.115, .11], [2, .158, .17]]) {
        if (active) {
          const [px, py] = padAt(x, y);
          write(i, px, py, .29 * load, radius * .62);
        } else {
          pads[i * 4 + 2] = .29 * load;
        }
      }
      if (active) {
        const [x, y] = padAt(.04, -.17);
        write(3, x, y, surrounding, radius * 1.65);
      } else {
        pads[14] = surrounding;
      }
    }

    function reset() {
      pads.fill(0);
      flow.fill(0);
      for (const state of [press, bulk, relief, shearX, shearY]) {
        state.value = 0;
        state.speed = 0;
      }
      load = 0;
      held = 0;
    }

    function palm(aspect) {
      const [dx, dy] = offset(palmX, palmY, aspect);
      return { dx, dy, load };
    }

    return { pads, flow, update, reset, offset, input, palm };
  }

  function createContact(image, cutout) {
    // Open-hand silhouette, sampled at six-pixel intervals on each finger.
    // Keeping the outline here lets the local file work without a pixel readback.
    const edges = [
      [255, 1, 1, [63, 59, 58, 59, 61, 63, 66, 69, 71, 72, 73, 74, 75, 75, 76]],
      [62, 1, 1.05, [146, 144, 142, 142, 142, 143, 144, 144, 146, 147, 149, 152, 154, 156, 157, 159, 160, 161, 163]],
      [67, -1, .58, [189, 192, 195, 198, 201, 203, 205, 207, 209, 211, 214, 217, 221]],
      [19, 1, 1, [270, 264, 261, 259, 258, 258, 258, 258, 258, 258, 259, 260, 262, 262, 262, 263, 263, 264, 264, 265]],
      [26, -1, .66, [303, 306, 308, 310, 311, 312, 314, 315, 316, 317, 317, 318, 319, 321, 322]],
      [73, 1, .91, [345, 341, 339, 339, 340, 340, 341, 342, 343, 344, 346, 347, 348, 348]],
      [77, -1, .56, [381, 385, 387, 389, 391, 393, 395, 396, 397, 397]],
      [159, 1, .86, [442, 436, 434, 432, 432, 431, 432, 432, 432, 433, 434]],
      [161, -1, .52, [463, 466, 469, 472, 474, 476, 478, 480, 481]],
    ].map(([top, inward, depth, outline], finger) => {
      const points = [];
      const segments = (outline.length - 1) * 3;
      function noise(index) {
        const value = Math.sin((index + 1) * 12.9898 + finger * 78.233) * 43758.5453;
        return value - Math.floor(value);
      }
      for (let i = 0; i <= segments; i++) {
        const a = Math.floor(i / 3);
        const x = outline[a] + ((outline[a + 1] ?? outline[a]) - outline[a]) * (i % 3) / 3;
        const y = top + i * 2;
        const t = i / segments;
        const envelope = Math.min(1, t * 9, (1 - t) * 6);
        const position = i / (4.5 + finger % 3);
        const knot = Math.floor(position);
        const blend = position - knot;
        const uneven = noise(knot) * (1 - blend) + noise(knot + 1) * blend;
        points.push([x, y, depth * envelope * (1.5 + 8 * uneven + 2.6 * noise(i + 37))]);
      }
      return { points, inward };
    });
    const context = cutout.getContext("2d");
    const sprite = document.createElement("canvas");

    function hide() {
      cutout.hidden = true;
      image.hidden = false;
    }

    function draw(scene, x, y, angle, width, load, canReach) {
      if (load < .045 || !context || !image.naturalWidth) return hide();

      const w = scene.clientWidth, h = scene.clientHeight;
      const scale = width / image.naturalWidth;
      const c = Math.cos(angle), s = Math.sin(angle);
      function onCoat(px, py) {
        const dx = (px - image.naturalWidth * .5) * scale;
        const dy = (py - image.naturalHeight * .007) * scale;
        return canReach((x + dx * c - dy * s) / w, (y + dx * s + dy * c) / h);
      }
      const touched = edges.filter(({ points, inward }) => {
        const edge = points[Math.floor(points.length * .35)];
        return edge && onCoat(edge[0] - 12 * inward, edge[1]) && onCoat(edge[0] + 10 * inward, edge[1] + 6);
      });
      if (!touched.length) return hide();

      const pixels = Math.max(1, Math.round(width * Math.min(1.5, scene.width / w)));
      const rows = Math.round(pixels * image.naturalHeight / image.naturalWidth);
      if (sprite.width !== pixels || sprite.height !== rows) {
        sprite.width = cutout.width = pixels;
        sprite.height = cutout.height = rows;
        sprite.getContext("2d").drawImage(image, 0, 0, sprite.width, sprite.height);
      }

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = "copy";
      context.drawImage(sprite, 0, 0);
      context.globalCompositeOperation = "destination-out";
      context.setTransform(pixels / image.naturalWidth, 0, 0, cutout.height / image.naturalHeight, 0, 0);
      // Build a soft, translucent edge. Deeper pixels keep more of the hand.
      for (const [reach, opacity] of [[1, .12], [.68, .18], [.38, .23]]) {
        context.globalAlpha = load * opacity;
        for (const { points, inward } of touched) {
          context.beginPath();
          for (const [px, py, depth] of points) context.lineTo(px + inward * depth * reach * load, py);
          for (let i = points.length - 1; i >= 0; i--) {
            const [px, py] = points[i];
            context.lineTo(px - inward * 6, py);
          }
          context.closePath();
          context.fill();
        }
      }
      cutout.hidden = false;
      image.hidden = true;
    }

    return { draw, hide };
  }

  window.moFur = { create, createContact, shader };
})();
