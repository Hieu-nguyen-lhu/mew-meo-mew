(() => {
  const sections = 60;

  function component(a, b, c, d, t) {
    return b + .5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
  }

  function sample(points, t) {
    const end = points.length - 1;
    const position = t * end;
    const index = Math.min(end - 1, Math.floor(position));
    const a = points[Math.max(0, index - 1)];
    const b = points[index];
    const c = points[index + 1];
    const d = points[Math.min(end, index + 2)];
    const fraction = position - index;
    return [component(a[0], b[0], c[0], d[0], fraction), component(a[1], b[1], c[1], d[1], fraction)];
  }

  function smooth(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  function createTail(art) {
    const { guide, widths, size: [width, height], lengthScale = 1, thickness = 1, taper = .14, loosenCurl = 0 } = art;
    const { pitch = 0, bow = .14, tipLift = .19, steering = 1, flex = 0 } = art.extension ?? {};
    const rest = Array.from({ length: sections + 1 }, (_, i) => sample(guide, i / sections));
    const lengths = new Float32Array(sections);
    const arc = new Float32Array(sections + 1);
    const angles = new Float32Array(sections);
    for (let i = 0; i < sections; i++) {
      const dx = rest[i + 1][0] - rest[i][0];
      const dy = rest[i + 1][1] - rest[i][1];
      const previous = i === 0 ? 0 : angles[i - 1];
      const turn = Math.atan2(dy, dx) - previous;
      angles[i] = previous + Math.atan2(Math.sin(turn), Math.cos(turn));
      lengths[i] = Math.hypot(dx, dy) * lengthScale;
      arc[i + 1] = arc[i] + lengths[i];
    }
    if (loosenCurl) {
      for (let i = 0; i < sections; i++) angles[i] -= loosenCurl * smooth((i / sections - .18) / .68);
    }
    const liveAngles = Float32Array.from(angles);
    const turnVelocity = new Float32Array(sections);
    const radius = .91 * widths[0] * thickness;
    const radii = Float32Array.from(rest, (_, i) => (
      radius * (1 - taper * smooth((i / sections - .36) / .52))
    ));
    const turnLimit = Float32Array.from(lengths, (segment, i) => (
      .87 * (segment + (lengths[i - 1] ?? segment)) / (2 * radius)
    ));
    const drawAngles = new Float32Array(sections);
    const x = new Float32Array(sections + 1);
    const y = new Float32Array(sections + 1);
    let fit = 1;
    let textureBounds = null;
    const tangentX = new Float32Array(sections + 1);
    const tangentY = new Float32Array(sections + 1);
    const compression = new Float32Array(sections + 1);
    const nearRim = new Float32Array(sections + 1);
    const farRim = new Float32Array(sections + 1);
    const vertices = new Float32Array((sections + 1) * 8);
    let previousTime = 0;

    function arcAt(t) {
      const position = Math.max(0, Math.min(1, t)) * sections;
      const i = Math.min(sections - 1, Math.floor(position));
      return arc[i] + lengths[i] * (position - i);
    }

    function turnToward(i, goal, rate, elapsed) {
      const offset = liveAngles[i] - goal;
      const carry = (turnVelocity[i] + rate * offset) * elapsed;
      const decay = Math.exp(-rate * elapsed);
      liveAngles[i] = goal + (offset + carry) * decay;
      turnVelocity[i] = (turnVelocity[i] - rate * carry) * decay;
    }

    function update(time, {
      motion = 0, rootX = 0, rootY = 0, rightLimit = .933, fitMargin = .032,
      stroke = null, releaseAge = Infinity, contactAt = 0, pressure = 0, dragX = 0, dragY = 0,
    } = {}) {
      const elapsed = Math.max(.001, Math.min(.1, (time - previousTime) / 1000));
      previousTime = time;
      const phase = (time / 1000) % 6.7;
      const idleFlick = smooth((phase - .55) / .7) * (1 - smooth((phase - 2.55) / .9));
      const rootPx = rest[0][0] + rootX * width;
      const rootPy = rest[0][1] + rootY * height;
      const progress = stroke?.progress ?? 0;
      const front = stroke?.front ?? 0;
      const open = smooth(progress / .47);
      const complete = smooth((progress - .72) / .26);
      const pad = arcAt(contactAt);
      const slip = Math.tanh(2.4 * dragX);
      x[0] = rootPx;
      y[0] = rootPy;

      let farRight = rootPx;
      for (let i = 0; i < sections; i++) {
        const t = (i + .5) / sections;
        if (!motion) {
          liveAngles[i] = angles[i];
          turnVelocity[i] = 0;
        } else if (stroke) {
          // The part behind the hand is nearly straight. The free end still has its curl.
          const passed = smooth((front + .21 - t) / .39);
          const loosened = Math.max(passed * open, complete) * smooth((t + .055) / .18);
          const arch = bow * Math.sin(t * Math.PI) - tipLift * t;
          const direction = pitch + stroke.heading * steering + arch;
          const goal = angles[i] + (direction - angles[i]) * loosened;
          if (flex) {
            // The grip changes direction first. The free length carries the
            // bend farther along the tail as its slower joints catch up.
            const offset = (arc[i] + lengths[i] * .5 - pad) / arc[sections];
            const before = Math.exp(-(((offset + .13) / .20) ** 2));
            const after = Math.exp(-(((offset - .20) / .25) ** 2));
            const cross = dragY * Math.cos(goal) - dragX * Math.sin(goal);
            const side = Math.tanh(2.7 * cross);
            const pull = side * (before - .78 * after) + .28 * slip * after;
            const freeTip = smooth((offset - .025) / .17) * smooth((t - .52) / .42);
            const curl = freeTip * (.42 + 1.12 * side);
            const grip = .62 + .38 * Math.min(1, pressure * 1.8);
            const give = flex * grip * (smooth(t / .20) * pull + curl);
            const rate = 37 - 25 * smooth((offset + .025) / .46) - 9 * smooth((-offset - .10) / .36);
            turnToward(i, goal + give, rate, elapsed);
          } else {
            liveAngles[i] += (goal - liveAngles[i]) * (1 - Math.exp(-elapsed / (.075 + .065 * t)));
          }
        } else {
          // Wait on release, then let the tip start curling before the root.
          const start = 1.03 + .19 * (1 - t);
          const wake = smooth((releaseAge - start) / .22);
          const wave = Math.sin(phase * 4.5 - t * 3.6) * idleFlick;
          const idleAngle = angles[i] + t * (.12 * wave + .017 * Math.sin(phase * .94));
          const timeConstant = releaseAge < 2.5 ? .17 + .085 * (1 - t) : .075;
          if (flex) {
            const carry = Math.exp(-18 * elapsed);
            liveAngles[i] += turnVelocity[i] * (1 - carry) / 18;
            turnVelocity[i] *= carry;
          }
          liveAngles[i] += (idleAngle - liveAngles[i]) * (1 - Math.exp(-elapsed * wake / timeConstant));
        }
        drawAngles[i] = liveAngles[i];
      }

      // Spread tight turns along the centerline so the inner edge has room for the coat.
      for (let i = sections - 2; i > 0; i--) {
        const limit = turnLimit[i + 1];
        const delta = drawAngles[i + 1] - drawAngles[i];
        drawAngles[i] += .60 * (delta - Math.max(-limit, Math.min(limit, delta)));
      }
      for (let i = 0; i < sections; i++) {
        if (i) {
          const previous = drawAngles[i - 1];
          const limit = turnLimit[i];
          drawAngles[i] = previous + Math.max(-limit, Math.min(limit, drawAngles[i] - previous));
        }
        x[i + 1] = x[i] + Math.cos(drawAngles[i]) * lengths[i];
        y[i + 1] = y[i] + Math.sin(drawAngles[i]) * lengths[i];
        farRight = Math.max(farRight, x[i + 1]);
      }

      // Keep the end inside the scene as the tail lifts and its projected length changes.
      const span = farRight - rootPx;
      const edge = width * rightLimit - rootPx;
      const allowance = width * fitMargin;
      const excess = Math.max(0, span - edge);
      fit = span > edge ? (edge + allowance * (1 - Math.exp(-excess / allowance))) / span : 1;
      for (let i = 0; i <= sections; i++) {
        x[i] = rootPx + (x[i] - rootPx) * fit;
        y[i] = rootPy + (y[i] - rootPy) * fit;
      }

      for (let i = 0; i <= sections; i++) {
        const from = Math.max(0, i - 1);
        const to = Math.min(sections, i + 1);
        const dx = x[to] - x[from];
        const dy = y[to] - y[from];
        const length = Math.hypot(dx, dy) || 1;
        tangentX[i] = dx / length;
        tangentY[i] = dy / length;
      }

      for (let i = 0; i <= sections; i++) {
        const localRadius = radii[i] * fit;
        const footprint = 1 - smooth(Math.abs(arc[i] - pad) / (radius * 1.38));
        const load = motion && stroke ? Math.min(1, pressure * 1.48) * footprint : 0;
        const rate = load > compression[i] ? .035 : .115;
        compression[i] = motion ? load + (compression[i] - load) * Math.exp(-elapsed / rate) : 0;

        // The two rims move inward near the grip, with a slightly deeper
        // indentation under the fingers. The tail's spine keeps its motion.
        const push = compression[i] * (.38 + .62 * smooth(arc[i] / (radius * .66)));
        const bias = .10 * tangentX[i];
        nearRim[i] = localRadius * (1 - push * (.23 + bias));
        farRim[i] = localRadius * (1 - push * (.23 - bias));
        const nx = -tangentY[i];
        const ny = tangentX[i];
        const offset = i * 8;
        vertices[offset] = textureBounds?.[i * 2] ?? 0;
        vertices[offset + 1] = i / sections;
        vertices[offset + 2] = (x[i] - nx * nearRim[i]) / width;
        vertices[offset + 3] = (y[i] - ny * nearRim[i]) / height;
        vertices[offset + 4] = textureBounds?.[i * 2 + 1] ?? 1;
        vertices[offset + 5] = i / sections;
        vertices[offset + 6] = (x[i] + nx * farRim[i]) / width;
        vertices[offset + 7] = (y[i] + ny * farRim[i]) / height;
      }
      return vertices;
    }

    function pointAt(t) {
      const at = Math.max(0, Math.min(1, t)) * sections;
      const i = Math.min(sections - 1, Math.floor(at));
      const mix = at - i;
      return [(x[i] + (x[i + 1] - x[i]) * mix) / width, (y[i] + (y[i + 1] - y[i]) * mix) / height];
    }

    function locate(u, v, opaque, from = 0, to = 1) {
      const px = u * width;
      const py = v * height;
      let nearest = null;
      let best = Infinity;
      const first = Math.max(3, Math.floor(from * sections));
      const last = Math.min(sections, Math.ceil(to * sections));
      for (let i = first; i < last; i++) {
        const dx = x[i + 1] - x[i];
        const dy = y[i + 1] - y[i];
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared < .001) continue;
        const offsetX = px - x[i];
        const offsetY = py - y[i];
        const projection = (offsetX * dx + offsetY * dy) / lengthSquared;
        if (opaque && (projection < 0 || projection > 1)) continue;
        const low = Math.max(0, from * sections - i);
        const high = Math.min(1, to * sections - i);
        const fraction = Math.min(high, Math.max(low, projection));
        const distance = Math.hypot(offsetX - fraction * dx, offsetY - fraction * dy);
        if (distance >= best) continue;
        const at = (i + fraction) / sections;
        if (opaque) {
          const side = (-offsetX * dy + offsetY * dx) / Math.sqrt(lengthSquared);
          const near = nearRim[i] + (nearRim[i + 1] - nearRim[i]) * fraction;
          const far = farRim[i] + (farRim[i + 1] - farRim[i]) * fraction;
          const across = (side + near) / (near + far);
          if (across < 0 || across > 1) continue;
          const lo = vertices[i * 8] + (vertices[(i + 1) * 8] - vertices[i * 8]) * fraction;
          const hi = vertices[i * 8 + 4] + (vertices[(i + 1) * 8 + 4] - vertices[i * 8 + 4]) * fraction;
          if (!opaque(lo + (hi - lo) * across, at)) continue;
        }
        nearest = { at, distance: distance / width };
        best = distance;
      }
      return nearest;
    }

    update(0);
    return {
      update, pointAt,
      setTextureBounds(profile) {
        textureBounds = new Float32Array((sections + 1) * 2);
        for (let i = 0; i <= sections; i++) textureBounds.set(profile(i / sections), i * 2);
      },
      nearest: (u, v, from, to) => locate(u, v, null, from, to),
      segmentAt: (u, v, opaque) => opaque ? locate(u, v, opaque)?.at ?? null : null,
      length: arc[sections] / width,
      vertexCount: (sections + 1) * 2,
    };
  }

  window.createMoTail = createTail;
})();
