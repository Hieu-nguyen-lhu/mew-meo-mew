(() => {
  const photo = document.getElementById("photo");
  const background = document.getElementById("room-photo");
  const moonRoom = document.getElementById("night-room-photo");
  const canvas = document.getElementById("scene");
  const scene = canvas.parentElement;
  const hand = document.getElementById("hand");
  const handImage = hand.querySelector(".hand-open");
  const gripImage = hand.querySelector(".hand-grip");
  const coat = document.getElementById("coat");
  const viewButton = document.getElementById("view");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const touchLayout = matchMedia("(hover: none) and (pointer: coarse)");

  const target = { x: .43, y: .45, area: null, pressure: 0, dx: 1, dy: 0 };
  const handPose = { ...target, opacity: 0 };
  const fur = window.moFur.create();
  const furContact = window.moFur.createContact(handImage, document.getElementById("fur-contact"));
  const regions = {
    head: { value: 0, velocity: 0 },
    back: { value: 0, velocity: 0 },
  };
  const roomArt = window.moArt;
  const moonlight = window.moMoonlight;
  const overhead = window.moOverhead;
  const silverViews = [
    { body: roomArt.body, still: roomArt.cat,
      tail: {
        ...roomArt.tail, lengthScale: .80, thickness: .95, taper: .22, loosenCurl: .49,
        extension: { pitch: .16, bow: .23, tipLift: .36, steering: .72, flex: .64 },
      },
      head: [.36, .43, .26, .46], ears: [.216, .133, .291, .323], earBases: [.223, .205, .263, .300] },
    { ...overhead, tail: { ...roomArt.tail, ...overhead.tail, lengthScale: 1.22, extension: { flex: .64 } },
      earBases: [.196, .402, .204, .552] },
  ];
  const makeView = (art) => ({
    ...art,
    image: new Image(),
    tailImage: new Image(),
    rootX: art.tail.guide[0][0] / art.tail.size[0],
    rootY: art.tail.guide[0][1] / art.tail.size[1],
    tailFloor: Math.max(...art.tail.guide.map(([, y]) => {
      const root = art.tail.guide[0][1];
      return root + (y - root) * art.tail.lengthScale + art.tail.widths[0] * .78;
    })) / art.tail.size[1],
  });
  const coats = new Map([["silver", silverViews.map(makeView)]]);
  const extraCoats = new Set(["calico", "snow", "tuxedo", "brown", "siamese"]);
  const loadingCoats = new Set();

  function registerCoat(name, artViews) {
    coats.set(name, silverViews.map((base, i) => {
      const art = artViews[i];
      return makeView({ ...base, ...art, tail: { ...base.tail, ...art.tail } });
    }));
  }
  for (const [name, artViews] of Object.entries(window.moCoatArt ?? {})) registerCoat(name, artViews);
  let requestedAngle = 0;
  let view = coats.get("silver")[0];
  let tail = window.createMoTail(view.tail);
  const [tailWidth, tailHeight] = roomArt.tail.size;
  const artAspect = tailWidth / tailHeight;
  const actorSize = .84;
  const minimumActorAspect = 1.55;
  const defaultLeft = .027;
  const tailRight = .952;
  const spine = .49;
  let catSize = 1;
  let bodyWidth = 1;
  let stageAspect = artAspect;
  let handSize = .27;
  let actorScaleX = actorSize;
  let actorScaleY = actorSize;
  let actorLeft = defaultLeft;
  let actorTop = .07;
  let backX = 0;
  let backY = 0;
  let breath = 0;
  const screenX = (x) => x * actorScaleX + actorLeft;
  const screenY = (y) => y * actorScaleY + actorTop;
  const artX = (x) => (x - actorLeft) / actorScaleX;
  const artY = (y) => (y - actorTop) / actorScaleY;
  let tailRootX = screenX(view.rootX);
  let tailRootY = screenY(view.rootY);
  let handInScene = false;
  let motionDirection = 1;
  let earAt = -2000;
  let tappedEar = 0;
  let tailStroke;
  let parkedStroke;
  let tailReleasedAt = -Infinity;
  let contactAt = .15;
  let closure = 0;
  let closureSpeed = 0;
  let gripAngle = 0;
  let keyboardAt = 0;
  let frame = 0;
  let lastTime = 0;
  let lastMoveAt = -Infinity;
  let lastPaint = 0;
  let renderer;

  function roomCrop() {
    const x = Math.min(1, stageAspect / artAspect);
    const y = Math.min(1, artAspect / stageAspect);
    return [x, y, (1 - x) * .5, (1 - y) * .5];
  }

  function moonAt(x, y) {
    const [sx, sy, ox, oy] = roomCrop();
    return moonlight?.at(ox + x * sx, oy + y * sy) ?? .18;
  }

  function bodyWidthAt(x) {
    const shoulder = Math.max(0, Math.min(1, (x - .255) / .285));
    return 1 + (bodyWidth - 1) * shoulder * shoulder * (3 - 2 * shoulder);
  }

  function bodyY(x, y) {
    return spine + (y - spine) * bodyWidthAt(x);
  }

  function backWeight(x) {
    const t = Math.max(0, Math.min(1, (x - .23) / .25));
    return t * t * (3 - 2 * t);
  }

  function breathOffset(u, v) {
    const x = u - .54;
    const y = v - .50;
    const expansion = breath * Math.exp(-((x / .35) ** 2 + (y / .43) ** 2));
    return [x * .012 * expansion, y * .052 * expansion];
  }

  function anchorTail() {
    const weight = backWeight(view.rootX);
    const [riseX, riseY] = breathOffset(view.rootX, view.rootY);
    const x = screenX(view.rootX + backX * weight + riseX);
    const y = screenY(bodyY(view.rootX, view.rootY) + backY * weight + riseY);
    const [dx, dy] = fur.offset(x, y, stageAspect);
    tailRootX = x + dx;
    tailRootY = y + dy;
  }

  function heightBounds() {
    let top = .08;
    let bottom = .90;
    if (view.alpha?.bands.length) {
      top = Infinity;
      bottom = -Infinity;
      for (const [x, upper, lower] of view.alpha.bands) {
        top = Math.min(top, bodyY(x, upper));
        bottom = Math.max(bottom, bodyY(x, lower));
      }
    }
    const rootOffset = bodyY(view.rootX, view.rootY) - view.rootY;
    return [top, Math.max(bottom, view.tailFloor + rootOffset)];
  }

  function syncLayout() {
    if (!scene.clientHeight) return;
    stageAspect = scene.clientWidth / scene.clientHeight;
    const defaultScaleY = actorSize * Math.min(1, stageAspect / minimumActorAspect);
    const defaultScaleX = defaultScaleY * artAspect / stageAspect;
    const [upper, lower] = heightBounds();
    actorScaleY = Math.min(defaultScaleY * catSize, .95 / (lower - upper));
    actorScaleX = actorScaleY * artAspect / stageAspect;
    const wideMargin = touchLayout.matches ? Math.max(0, (1 - 1.88 / stageAspect) * .5) : 0;
    const idealLeft = defaultLeft + wideMargin - (actorScaleX - defaultScaleX) * .39;
    const minLeft = .014 - (view.alpha?.left ?? .075) * actorScaleX;
    actorLeft = Math.max(minLeft, Math.min(idealLeft, .80 - view.rootX * actorScaleX));
    const idealTop = .07 + (actorSize - actorScaleY) * .5;
    actorTop = Math.min(1 - .025 - lower * actorScaleY, Math.max(.025 - upper * actorScaleY, idealTop));
    anchorTail();
    const handWidth = .186 * artAspect / Math.max(stageAspect, minimumActorAspect);
    handSize = handWidth * stageAspect;
    scene.style.setProperty("--hand-width", (handWidth * 100) + "%");
    const stillScaleY = actorScaleY * bodyWidth;
    const stillTop = actorTop + spine * (actorScaleY - stillScaleY);
    const [stillWidth, stillHeight] = view.stillSize ?? [tailWidth, tailHeight];
    photo.style.width = (stillWidth / tailWidth * 100) + "%";
    photo.style.height = (stillHeight / tailHeight * 100) + "%";
    photo.style.transform = "translate(" + (actorLeft * scene.clientWidth) + "px," + (stillTop * scene.clientHeight) + "px) scale(" + actorScaleX + "," + stillScaleY + ")";
    activate();
  }

  function alphaLookup(image, measure = false) {
    const matte = document.createElement("canvas");
    matte.width = 192;
    matte.height = 128;
    const ctx = matte.getContext("2d");
    ctx.drawImage(image, 0, 0, matte.width, matte.height);
    const { data } = ctx.getImageData(0, 0, matte.width, matte.height);
    const contains = (x, y) => {
      if (x < 0 || x >= 1 || y < 0 || y >= 1) return false;
      const pixel = Math.floor(y * matte.height) * matte.width + Math.floor(x * matte.width);
      return data[pixel * 4 + 3] >= 76;
    };
    const bands = [];
    if (measure) {
      for (let x = 0; x < matte.width; x++) {
        let upper = 0;
        let lower = matte.height - 1;
        while (upper < matte.height && data[(upper * matte.width + x) * 4 + 3] < 18) upper++;
        if (upper === matte.height) continue;
        while (lower > upper && data[(lower * matte.width + x) * 4 + 3] < 18) lower--;
        bands.push([(x + .5) / matte.width, upper / matte.height, (lower + 1) / matte.height]);
      }
    }
    return { contains, bands, left: bands[0]?.[0] };
  }

  function tailTextureBounds(contains) {
    function edges(y) {
      const columns = 192;
      let left = 0;
      let right = columns - 1;
      while (left < right && !contains((left + .5) / columns, y)) left++;
      while (right > left && !contains((right + .5) / columns, y)) right--;
      return [left / columns, (right + 1) / columns];
    }
    function smoothedEdges(at) {
      let left = 0;
      let right = 0;
      for (const delta of [-.014, -.007, 0, .007, .014]) {
        const [lo, hi] = edges(Math.max(.038, Math.min(.974, at + delta)));
        left += lo / 5;
        right += hi / 5;
      }
      return [left, right];
    }
    const capStart = .89;
    const [capLo, capHi] = smoothedEdges(capStart);
    return (at) => {
      const [left, right] = smoothedEdges(at);
      const center = (left + right) * .5;
      // Normalize the textured sides, then let the original rounded tip taper.
      const half = (at < capStart ? right - left : capHi - capLo) * .5 + .024;
      return [center - half, center + half];
    };
  }

  function nearestTail(x, y, from, to) {
    return tail.nearest(artX(x), artY(y), from, to);
  }

  function tailReach() {
    return Math.min(tailRight, tailRootX + tail.length * actorScaleX);
  }

  function bodyAreaAt(x, y) {
    const [px, py] = fur.input(x, y, stageAspect);
    const hitU = artX(px), hitV = artY(py);
    const u = hitU - backX * backWeight(hitU - backX * backWeight(hitU));
    const v = hitV - backY * backWeight(u);
    const width = renderer ? bodyWidthAt(u) : bodyWidth;
    const [riseX, riseY] = breathOffset(u, spine + (v - spine) / width);
    const restV = spine + (v - riseY - spine) / width;
    if (!view.alpha?.contains(u - riseX, restV)) return null;
    return u - riseX < view.head[3] - .06 && restV < .68 ? "head" : "back";
  }

  function areaAt(x, y, slide = false) {
    if (!view.alpha) return null;
    const body = bodyAreaAt(x, y);
    const atSocket = x > tailRootX - .046 && x < tailRootX + .042
      && Math.abs(y - tailRootY) < .095;
    if (slide && tailStroke) {
      if (x < tailRootX + .006 && x < target.x && (body || atSocket)) return body ?? "back";
      const tip = screenX(tail.pointAt(1)[0]);
      if (tailStroke.progress > .87 && x > Math.max(tip, tailReach()) + .025) return null;
      const reach = (nearestTail(x, y)?.distance ?? 1) * actorScaleX;
      if (atSocket || reach < .076 || (x >= tailRootX - .012 && x < tailReach() + .025 && Math.abs(y - tailRootY) < .125)) return "tail";
    }
    const tailHit = tail.segmentAt(artX(x), artY(y), view.tailAlpha);
    if (slide && target.area === "back" && atSocket) {
      if (x > target.x && x >= tailRootX - .007 && (tailHit !== null || x >= tailRootX + .012)) return "tail";
      return "back";
    }
    return body ?? (tailHit !== null ? "tail" : null);
  }

  function trackTailStroke(x, y, time) {
    if (!tailStroke) {
      const hit = nearestTail(x, y);
      contactAt = target.area === "back" ? Math.min(hit?.at ?? .09, .18) : hit?.at ?? .17;
      const [, centerY] = tail.pointAt(contactAt);
      const parked = parkedStroke && Math.max(0, 1 - Math.max(0, time - tailReleasedAt - 1030) / 1020);
      const inherited = parked ? parkedStroke.progress * parked : 0;
      tailStroke = {
        x, y, entryAt: contactAt, offsetY: y - screenY(centerY), inherited,
        progress: inherited, front: inherited, heading: 0,
      };
    }
    const stroke = tailStroke;
    const distance = Math.hypot(x - stroke.x, (y - stroke.y) / stageAspect);
    const offset = stroke.offsetY * Math.max(0, 1 - distance / .09);
    const end = tailReach() - .012;
    const traveled = Math.max(0, x - stroke.x) / Math.max(.10, end - stroke.x);
    const opened = stroke.inherited + (1 - stroke.inherited) * Math.min(1, traveled);
    stroke.progress = Math.max(stroke.progress, opened);
    stroke.front = stroke.entryAt + (1 - stroke.entryAt) * stroke.progress;
    const angle = Math.atan2((y - offset - tailRootY) / stageAspect, Math.max(.069, x - tailRootX));
    stroke.heading = Math.max(-.48, Math.min(.43, angle));
  }

  function leaveTail(time) {
    if (!tailStroke) return;
    parkedStroke = tailStroke;
    tailReleasedAt = time;
    tailStroke = undefined;
  }

  function point(x, y, area, pressure, dx, dy) {
    const now = performance.now();
    if (Math.hypot(x - target.x, (y - target.y) / stageAspect) > .0007) lastMoveAt = now;
    if (handPose.opacity < .01) {
      handPose.x = x;
      handPose.y = y + (reduced.matches ? 0 : .025);
    }
    if (area === "head" && (target.area !== "head" || (Math.abs(dx) > .35 && now - earAt > 610))) {
      earAt = now;
      const [ax, ay, bx, by] = view.ears;
      const u = artX(x), v = artY(y);
      tappedEar = Math.hypot((u - ax) * artAspect, v - ay) < Math.hypot((u - bx) * artAspect, v - by) ? 0 : 1;
    }
    if (area === "tail") trackTailStroke(x, y, now);
    else leaveTail(now);
    if (Math.abs(dx) > .07) motionDirection = Math.sign(dx);

    Object.assign(target, { x, y, area, pressure, dx, dy });
    keyboardAt = 0;
    handInScene = area !== null;
    scene.classList.toggle("is-pointing", handInScene && handImage.naturalWidth > 0);
    activate();
  }

  function release() {
    target.pressure = 0;
    target.area = null;
    leaveTail(performance.now());
    keyboardAt = 0;
    handInScene = false;
    scene.classList.remove("is-pointing");
  }

  function pet() {
    point(screenX(.34), screenY(bodyY(.34, .42)), "head", .86, 1, .13);
    scene.classList.remove("is-pointing");
    keyboardAt = performance.now();
  }

  function activate() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(draw);
  }

  function updatePose(dt, time) {
    for (const [area, spring] of Object.entries(regions)) {
      const goal = target.area === area ? .52 + .48 * target.pressure : 0;
      spring.velocity += (75 * (goal - spring.value) - 12 * spring.velocity) * dt;
      spring.value = Math.max(0, Math.min(1.15, spring.value + spring.velocity * dt));
    }
    const back = .012 * regions.back.value;
    backX = handPose.dx * back;
    backY = back;
    const phase = time * (2 * Math.PI / 3850);
    breath = .91 * Math.sin(phase) + .09 * Math.sin(2 * phase - .6);
  }

  function earFlick(age) {
    const ramp = (t) => {
      const u = Math.max(0, Math.min(1, t));
      return u * u * (3 - 2 * u);
    };
    return ramp(age / 75) * (1 - ramp((age - 75) / 170))
      - .23 * ramp((age - 190) / 68) * (1 - ramp((age - 258) / 115));
  }

  function resetPose() {
    for (const spring of Object.values(regions)) {
      spring.value = 0;
      spring.velocity = 0;
    }
    backX = 0;
    backY = 0;
    breath = 0;
    lastMoveAt = -Infinity;
    fur.reset();
    anchorTail();
  }

  function draw(time) {
    frame = 0;
    if (document.hidden) return;
    const elapsed = Math.max(.001, Math.min((time - lastTime) / 1000, .12));
    const dt = Math.min(elapsed, .032);
    lastTime = time;

    if (keyboardAt) {
      const step = Math.max(0, Math.min(1, (time - keyboardAt) / 830));
      if (step >= 1) release();
      else {
        const advance = step * step * (3 - 2 * step);
        target.x = screenX(.34 + advance * .28);
        target.y = screenY(bodyY(.34 + advance * .28, .42 + advance * .07));
        target.area = step < .38 ? "head" : "back";
      }
    }

    const ease = reduced.matches ? 1 : 1 - Math.exp(-dt / .051);
    const previousX = handPose.x, previousY = handPose.y;
    handPose.x += (target.x - handPose.x) * ease;
    handPose.y += (target.y + (handInScene ? 0 : .035) - handPose.y) * ease;
    const dragX = (handPose.x - previousX) / elapsed;
    const dragY = (handPose.y - previousY) / (elapsed * stageAspect);
    handPose.pressure += (target.pressure - handPose.pressure) * ease;
    handPose.opacity += ((handInScene ? 1 : 0) - handPose.opacity) * ease;
    handPose.dx += (target.dx - handPose.dx) * ease;
    handPose.dy += (target.dy - handPose.dy) * ease;
    const closureGoal = tailStroke ? 1 : 0;
    if (reduced.matches) {
      closure = closureGoal;
      closureSpeed = 0;
    } else {
      const rate = tailStroke ? 16 : 18;
      const error = closure - closureGoal;
      const step = (closureSpeed + rate * error) * elapsed;
      const decay = Math.exp(-rate * elapsed);
      closure = Math.max(0, Math.min(1, closureGoal + (error + step) * decay));
      closureSpeed = (closureSpeed - rate * step) * decay;
    }
    if (tailStroke) {
      const hit = nearestTail(handPose.x, handPose.y, Math.max(.05, contactAt - .24), Math.min(1, contactAt + .24));
      if (hit) contactAt += (hit.at - contactAt) * (1 - Math.exp(-elapsed / .052));
      gripAngle += (tailStroke.heading * 18 - gripAngle) * (1 - Math.exp(-elapsed / .075));
    }

    const tilt = reduced.matches ? 0 : (handPose.dx * 8 - 9) * (1 - closure) + closure * gripAngle;
    if (renderer && !reduced.matches) {
      updatePose(dt, time);
      fur.update({
        hand: handPose,
        aspect: stageAspect,
        handSize,
        angle: tilt * Math.PI / 180,
        pressure: target.area === "head" || target.area === "back" ? target.pressure : 0,
        skull: target.area === "head",
        moving: keyboardAt ? .72 : Math.exp(-Math.max(0, time - lastMoveAt - 45) / 138),
        elapsed,
        canReach: bodyAreaAt,
      });
      anchorTail();
    }
    const palm = fur.palm(stageAspect);
    const palmX = handPose.x + palm.dx * .86;
    const palmY = handPose.y + palm.dy * .86;
    const active = handInScene || handPose.opacity > .004;
    if (renderer && (active || reduced.matches || time - lastPaint >= 29)) {
      renderer.draw(time, dragX, dragY);
      lastPaint = time;
    }

    if (handPose.opacity > .004) {
      const [contactU, contactV] = tail.pointAt(contactAt);
      // Both sprites share the cuff position. Put the center of the closed
      // fingers over the tail before interpolating the sleeve position.
      const angle = tilt * Math.PI / 180;
      const pinX = -.014 * handSize, pinY = .46 * handSize;
      const gripX = screenX(contactU) - (pinX * Math.cos(angle) - pinY * Math.sin(angle)) / stageAspect;
      const gripY = screenY(contactV) - (pinX * Math.sin(angle) + pinY * Math.cos(angle));
      const displayX = palmX + (gripX - palmX) * closure;
      const displayY = palmY + (gripY - palmY) * closure;
      const handX = displayX * scene.clientWidth;
      const handY = displayY * scene.clientHeight;
      hand.style.transform = "translate3d(" + handX + "px," + handY + "px,0) rotate(" + tilt + "deg)";
      const mix = Math.max(0, Math.min(1, (closure - .10) / .80));
      hand.style.setProperty("--grip", gripImage.naturalWidth ? String(mix * mix * (3 - 2 * mix)) : "0");
      hand.style.setProperty("--seat", String(palm.load * (1 - closure)));
      hand.style.opacity = String(handPose.opacity);
      if (scene.hasAttribute("data-night")) {
        const light = moonAt(displayX, displayY + handSize * .34);
        hand.style.setProperty("--moon-light", String(light));
      }
      if (renderer) {
        const strength = Math.min(1, palm.load * 1.65) * handPose.opacity * (1 - closure);
        furContact.draw(canvas, handX, handY, angle, handSize * scene.clientHeight, strength, bodyAreaAt);
      }
    } else if (hand.style.opacity !== "0") {
      hand.style.opacity = "0";
      furContact.hide();
    }

    if (active || (renderer && !reduced.matches)) activate();
  }

  function prepareFallbackMoon() {
    if (renderer || !moonlight || moonRoom.src || !background.naturalWidth || !scene.hasAttribute("data-night")) return;
    moonRoom.src = moonlight.fallbackRoom(background);
  }

  function fallback() {
    renderer = undefined;
    furContact.hide();
    resetPose();
    scene.classList.remove("is-rendered");
    prepareFallbackMoon();
  }

  function setup() {
    if (!view.image.naturalWidth || !view.tailImage.naturalWidth || !background.naturalWidth) return;
    view.alpha ??= alphaLookup(view.image, true);
    if (!view.tailAlpha) {
      view.tailAlpha = alphaLookup(view.tailImage).contains;
      view.tailTextureBounds = tailTextureBounds(view.tailAlpha);
    }
    tail.setTextureBounds(view.tailTextureBounds);
    try {
      renderer ??= createRenderer();
      scene.classList.add("is-rendered");
    } catch {
      fallback();
    }
    syncLayout();
  }

  function selectArt() {
    const name = coat.value;
    const selected = coats.get(name);
    if (!selected) {
      if (!extraCoats.has(name) || loadingCoats.has(name)) return;
      loadingCoats.add(name);
      viewButton.disabled = true;
      scene.setAttribute("aria-busy", "true");
      const script = document.createElement("script");
      script.src = "assets/mo-coat-" + name + ".js";
      const loaded = () => {
        loadingCoats.delete(name);
        script.remove();
        const artViews = window.moCoatArt?.[name];
        if (artViews) registerCoat(name, artViews);
        if (coat.value !== name) return;
        if (!artViews) coat.value = scene.dataset.coat ?? "silver";
        selectArt();
      };
      script.onload = script.onerror = loaded;
      document.head.append(script);
      return;
    }

    for (const profile of selected) {
      if (profile.image.src) continue;
      profile.image.addEventListener("load", selectArt, { once: true });
      profile.tailImage.addEventListener("load", selectArt, { once: true });
      profile.image.src = profile.body;
      profile.tailImage.src = profile.tail.texture;
    }
    viewButton.disabled = selected.some((item) => !item.image.naturalWidth || !item.tailImage.naturalWidth);
    const next = selected[requestedAngle];
    if (!next.image.naturalWidth || !next.tailImage.naturalWidth) {
      scene.setAttribute("aria-busy", "true");
      return;
    }
    scene.removeAttribute("aria-busy");
    scene.dataset.coat = name;
    if (view === next) {
      if (!view.alpha) setup();
      return;
    }
    release();
    view = next;
    tail = window.createMoTail(view.tail);
    parkedStroke = undefined;
    tailReleasedAt = -Infinity;
    contactAt = .15;
    closure = 0;
    closureSpeed = 0;
    gripAngle = 0;
    earAt = -2000;
    handPose.opacity = 0;
    resetPose();
    const fromAbove = requestedAngle === 1;
    viewButton.setAttribute("aria-pressed", String(fromAbove));
    scene.dataset.view = fromAbove ? "overhead" : "angled";
    scene.setAttribute("aria-label", fromAbove ? "Mơ nằm trên đệm vải xanh, nhìn từ trên xuống" : "Mơ nằm trên đệm vải xanh");
    photo.src = view.still;
    syncLayout();
    setup();
  }

  viewButton.addEventListener("click", () => {
    requestedAngle = 1 - requestedAngle;
    selectArt();
  });

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    fallback();
  });
  canvas.addEventListener("webglcontextrestored", setup);
  coat.addEventListener("change", selectArt);
  reduced.addEventListener("change", () => {
    tailStroke = undefined;
    parkedStroke = undefined;
    tailReleasedAt = -Infinity;
    closure = 0;
    closureSpeed = 0;
    gripAngle = 0;
    resetPose();
    activate();
  });
  new ResizeObserver(syncLayout).observe(scene);
  new MutationObserver(prepareFallbackMoon).observe(scene, { attributeFilter: ["data-night"] });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) release();
    else activate();
  });

  background.addEventListener("load", setup);
  background.src = roomArt.background;
  moonRoom.addEventListener("load", () => scene.setAttribute("data-night-art", ""));
  photo.src = view.still;
  photo.style.transformOrigin = "top left";
  syncLayout();
  selectArt();
  function setProportions(size, width) {
    if (size === catSize && width === bodyWidth) return;
    catSize = size;
    bodyWidth = width;
    release();
    fur.reset();
    syncLayout();
  }

  window.moScene = { areaAt, point, release, pet, activate, setProportions };

  function createRenderer() {
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false });
    if (!gl) throw new Error("WebGL unavailable");
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ? "highp" : "mediump";
    const varyings = "varying " + precision + " vec2 vUv, vWorld;";
    const sceneMetric = "uniform " + precision + " float uSceneAspect;";

    const vertex = [
      "attribute vec2 aUv;",
      "attribute vec2 aTailPosition;",
      varyings,
      "uniform mediump int uPass;",
      "uniform vec3 uHead;",
      "uniform vec4 uHeadShape;",
      "uniform vec4 uEars, uEarBases;",
      "uniform vec2 uEarTurns;",
      "uniform float uBreath;",
      "uniform vec2 uBackShift;",
      "uniform vec2 uBuild;",
      "uniform vec4 uActor;",
      sceneMetric,
      window.moFur.shader,
      "vec2 earOffset(vec2 uv, vec2 center, vec2 base, float angle) {",
      "  vec2 zone = (uv - center) / vec2(.060, .088);",
      "  vec2 tip = (uv - base) * vec2(1.5, 1.);",
      "  float c = cos(angle), s = sin(angle);",
      "  vec2 rotated = vec2(c * tip.x - s * tip.y, s * tip.x + c * tip.y);",
      "  return (rotated - tip) * vec2(.667, 1.) * exp(-dot(zone, zone));",
      "}",
      "void main() {",
      "  vec2 uv = aUv;",
      "  vec2 point = uv;",
      "  if (uPass >= 3) point = aTailPosition;",
      "  else if (uPass != 0) {",
      "    float head = (1. - smoothstep(uHeadShape.z, uHeadShape.w, uv.x)) * (1. - smoothstep(.57, .80, uv.y));",
      "    vec2 neck = (uv - uHeadShape.xy) * vec2(1.5, 1.);",
      "    float c = cos(uHead.z), s = sin(uHead.z);",
      "    vec2 turned = vec2(c * neck.x - s * neck.y, s * neck.x + c * neck.y);",
      "    point += ((turned - neck) * vec2(.667, 1.) + uHead.xy) * head;",
      "    point += earOffset(uv, uEars.xy, uEarBases.xy, uEarTurns.x);",
      "    point += earOffset(uv, uEars.zw, uEarBases.zw, uEarTurns.y);",
      "    vec2 ribs = uv - vec2(.54, .50);",
      "    vec2 chest = ribs / vec2(.35, .43);",
      "    point += ribs * vec2(.012, .052) * exp(-dot(chest, chest)) * uBreath;",
      "    point += uBackShift * smoothstep(.23, .48, uv.x);",
      "    point.y += (uv.y - uBuild.x) * uBuild.y * smoothstep(.255, .54, uv.x);",
      "  }",
      "  if (uPass != 0) {",
      "    point = uActor.zw + point * uActor.xy;",
      "    if (uPass <= 2) point += furDisplacement(point);",
      "    if (uPass == 1 || uPass == 3) point += vec2(.003, .012) * uActor.xy;",
      "  }",
      "  vUv = uv;",
      "  vWorld = point;",
      "  gl_Position = vec4(point * vec2(2., -2.) + vec2(-1., 1.), 0., 1.);",
      "}",
    ].join("\n");

    const fragment = [
      "precision " + precision + " float;",
      "uniform mediump int uPass;",
      "uniform sampler2D uArt, uMoonMap;",
      "uniform vec4 uRoomCrop;",
      "uniform float uNight;",
      sceneMetric,
      varyings,
      "vec2 roomUv(vec2 p) { return uRoomCrop.zw + p * uRoomCrop.xy; }",
      "float moon(vec2 p) { return texture2D(uMoonMap, roomUv(p)).r; }",
      moonlight?.shader ?? "vec3 moonRoomColor(vec3 rgb, float light) { return rgb; }",
      "void main() {",
      "  if (uPass == 0) {",
      "    vec4 room = texture2D(uArt, roomUv(vUv));",
      "    if (uNight > .5) room.rgb = moonRoomColor(room.rgb, moon(vUv));",
      "    gl_FragColor = room;",
      "    return;",
      "  }",
      "  if (uPass == 1 || uPass == 3) {",
      "    float across = uPass == 3 ? .035 : .009;",
      "    float a = texture2D(uArt, vUv).a * .40;",
      "    a += texture2D(uArt, vUv + vec2(across, .001)).a * .15;",
      "    a += texture2D(uArt, vUv - vec2(across, .001)).a * .15;",
      "    a += texture2D(uArt, vUv + vec2(0., .012)).a * .15;",
      "    a += texture2D(uArt, vUv - vec2(0., .012)).a * .15;",
      "    if (uNight > .5) { gl_FragColor = vec4(.025, .037, .073, a * (.29 + .14 * moon(vWorld))); return; }",
      "    gl_FragColor = vec4(vec3(.095, .105, .075), a * .29);",
      "    return;",
      "  }",
      "  vec4 original = texture2D(uArt, vUv);",
      "  if (original.a < .002) discard;",
      "  vec3 color = original.rgb / max(.001, original.a);",
      "  if (uNight > .5) {",
      "    float light = moon(vWorld);",
      "    vec3 tint = mix(vec3(.23, .27, .40), vec3(.83, .92, 1.05), light);",
      "    float gray = dot(color, vec3(.24, .62, .14));",
      "    color = mix(vec3(gray), color, .62) * tint + vec3(.012, .021, .040);",
      "  }",
      "  gl_FragColor = vec4(color, original.a);",
      "}",
    ].join("\n");

    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const position = gl.getAttribLocation(program, "aUv");
    const tailPosition = gl.getAttribLocation(program, "aTailPosition");
    gl.enableVertexAttribArray(position);
    const names = ["Pass", "Head", "HeadShape", "Ears", "EarBases", "EarTurns", "Breath", "BackShift", "Build", "Actor", "RoomCrop", "SceneAspect", "FurFlow", "Night", "MoonMap"];
    const uniforms = Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, "u" + name)]));
    gl.uniform1i(uniforms.MoonMap, 1);
    const furPads = gl.getUniformLocation(program, "uFurPads[0]");
    function vertexBuffer(vertices) {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      return buffer;
    }

    const backdropQuad = vertexBuffer([0, 0, 1, 0, 0, 1, 1, 1]);
    const columns = 84;
    const rows = 64;
    const vertices = [];
    const indices = [];
    for (let y = 0; y <= rows; y++) {
      for (let x = 0; x <= columns; x++) {
        vertices.push(x / columns, y / rows);
        if (x !== columns && y !== rows) {
          const a = y * (columns + 1) + x;
          const b = a + columns + 1;
          indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    }
    const mesh = vertexBuffer(vertices);
    const tailMesh = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tailMesh);
    gl.bufferData(gl.ARRAY_BUFFER, tail.vertexCount * 4 * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    function texture(image, filtered = false) {
      const result = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, result);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtered ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      let source = image;
      if (filtered) {
        source = document.createElement("canvas");
        source.width = 2 ** Math.ceil(Math.log2(image.naturalWidth));
        source.height = 2 ** Math.ceil(Math.log2(image.naturalHeight));
        const context = source.getContext("2d");
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, source.width, source.height);
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      if (filtered) {
        gl.generateMipmap(gl.TEXTURE_2D);
        const filtering = gl.getExtension("EXT_texture_filter_anisotropic");
        if (filtering) {
          const max = gl.getParameter(filtering.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
          gl.texParameterf(gl.TEXTURE_2D, filtering.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, max));
        }
      }
      if (gl.getError() !== gl.NO_ERROR) throw new Error("Texture unavailable");
      return result;
    }
    const roomArt = texture(background);
    let moonTexture;
    const viewTextures = new Map();
    let textureView;
    let textures;

    function draw(time, dragX, dragY) {
      if (textureView !== view) {
        textures = viewTextures.get(view);
        if (textures) viewTextures.delete(view);
        else textures = { body: texture(view.image), tail: texture(view.tailImage, true) };
        viewTextures.set(view, textures);
        textureView = view;
        if (viewTextures.size > 5) {
          const [oldest, unused] = viewTextures.entries().next().value;
          gl.deleteTexture(unused.body);
          gl.deleteTexture(unused.tail);
          viewTextures.delete(oldest);
        }
      }
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      const pixelRatio = Math.min(devicePixelRatio, 1.5, 2200 / cssWidth, 1300 / cssHeight);
      const width = Math.max(1, Math.round(cssWidth * pixelRatio));
      const height = Math.max(1, Math.round(cssHeight * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      const night = !!moonlight && scene.hasAttribute("data-night");
      if (night && !moonTexture) moonTexture = texture(moonlight.map);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, night ? moonTexture : roomArt);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(uniforms.Night, night ? 1 : 0);
      gl.uniform4f(uniforms.Actor, actorScaleX, actorScaleY, actorLeft, actorTop);
      gl.uniform4f(uniforms.RoomCrop, ...roomCrop());
      gl.uniform1f(uniforms.SceneAspect, stageAspect);
      gl.uniform4fv(furPads, fur.pads);
      gl.uniform2fv(uniforms.FurFlow, fur.flow);

      const motion = reduced.matches ? 0 : 1;
      const head = regions.head.value * motion;
      const touchFlick = .72 * earFlick(time - earAt);
      const first = earFlick((time + 5900) % 7500) + (tappedEar === 0 ? touchFlick : 0);
      const second = earFlick((time + 5250) % 9100) + (tappedEar === 1 ? touchFlick : 0);
      gl.uniform3f(uniforms.Head, head * .016 * motionDirection, -.021 * head, head * (.13 + .033 * motionDirection));
      gl.uniform4fv(uniforms.HeadShape, view.head);
      gl.uniform4fv(uniforms.Ears, view.ears);
      gl.uniform4fv(uniforms.EarBases, view.earBases);
      gl.uniform2f(uniforms.EarTurns, .16 * Math.min(1.38, first) * motion, -.14 * Math.min(1.38, second) * motion);
      gl.uniform1f(uniforms.Breath, breath);
      gl.uniform2f(uniforms.BackShift, backX, backY);
      gl.uniform2f(uniforms.Build, spine, bodyWidth - 1);

      gl.uniform1i(uniforms.Pass, 0);
      gl.bindTexture(gl.TEXTURE_2D, roomArt);
      gl.bindBuffer(gl.ARRAY_BUFFER, backdropQuad);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      const tailVertices = tail.update(time, {
        motion,
        rootX: artX(tailRootX) - view.rootX,
        rootY: artY(tailRootY) - view.rootY,
        stroke: tailStroke,
        releaseAge: (time - tailReleasedAt) / 1000,
        contactAt,
        pressure: closure * handPose.pressure,
        dragX,
        dragY,
        rightLimit: artX(tailRight - .024),
        fitMargin: .024 / actorScaleX,
      });
      gl.bindTexture(gl.TEXTURE_2D, textures.tail);
      gl.bindBuffer(gl.ARRAY_BUFFER, tailMesh);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, tailVertices);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(tailPosition);
      gl.vertexAttribPointer(tailPosition, 2, gl.FLOAT, false, 16, 8);
      gl.uniform1i(uniforms.Pass, 3);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, tail.vertexCount);
      gl.uniform1i(uniforms.Pass, 4);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, tail.vertexCount);
      gl.disableVertexAttribArray(tailPosition);

      gl.bindTexture(gl.TEXTURE_2D, textures.body);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(uniforms.Pass, 1);
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
      gl.uniform1i(uniforms.Pass, 2);
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);

    }

    return { draw };
  }
})();
