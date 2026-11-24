(() => {
  const zone = document.getElementById("cat");
  const scene = zone.parentElement;
  const room = document.getElementById("room");
  const theme = document.getElementById("theme");
  const expand = document.getElementById("expand");
  const visual = window.moScene;
  const sound = document.getElementById("sound");
  const coat = document.getElementById("coat");
  const coatMenu = document.getElementById("coat-menu");
  const coatSummary = coatMenu.querySelector("summary");
  const coatOptions = coatMenu.querySelector(".coat-options");
  const mobile = matchMedia("(hover: none) and (pointer: coarse)");
  const turned = matchMedia("(hover: none) and (pointer: coarse) and (orientation: portrait)");
  const proportionsToggle = document.getElementById("proportions-toggle");
  const proportionsPanel = document.getElementById("proportions-panel");
  const menu = proportionsToggle.parentElement;
  const sizeInput = document.getElementById("cat-size");
  const widthInput = document.getElementById("cat-width");
  const sizeValue = document.getElementById("size-value");
  const widthValue = document.getElementById("width-value");
  const sizeStops = [65, 72, 79, 86, 93, 100, 103, 106, 108, 111, 114];
  const widthStops = [80, 84, 88, 92, 96, 100, 108, 116, 124, 132, 140];
  const proportionsKey = "mo.proportions";
  const Audio = window.AudioContext || window.webkitAudioContext;
  let gesture;
  let holdingTail = false;
  let lastPoint;
  let audio;
  let soundEnabled = false;
  let audioPetting = false;
  let rumpStroke;
  let greeted = false;
  let lastMeow = -Infinity;
  const recordings = window.moCatSounds;
  sound.hidden = !Audio || !recordings;

  for (const option of coat.options) {
    const button = document.createElement("button");
    button.type = "button";
    button.value = option.value;
    button.textContent = option.textContent;
    button.addEventListener("click", () => {
      coat.value = option.value;
      coat.dispatchEvent(new Event("change", { bubbles: true }));
      coatMenu.open = false;
      coatSummary.focus({ preventScroll: true });
    });
    coatOptions.append(button);
  }
  function syncCoatMenu() {
    const value = scene.dataset.coat ?? coat.value;
    for (const button of coatOptions.children) {
      const selected = button.value === value;
      button.setAttribute("aria-pressed", String(selected));
      if (selected) coatSummary.textContent = button.textContent;
    }
  }
  syncCoatMenu();
  new MutationObserver(syncCoatMenu).observe(scene, { attributeFilter: ["data-coat"] });

  function setProportionsOpen(open) {
    proportionsPanel.hidden = !open;
    proportionsToggle.setAttribute("aria-expanded", String(open));
  }

  function applyProportions() {
    const size = sizeStops[sizeInput.valueAsNumber];
    const width = widthStops[widthInput.valueAsNumber];
    sizeValue.textContent = size + "%";
    widthValue.textContent = width + "%";
    sizeInput.setAttribute("aria-valuetext", sizeValue.textContent);
    widthInput.setAttribute("aria-valuetext", widthValue.textContent);
    visual.setProportions(size / 100, width / 100);
  }

  function saveProportions() {
    try {
      localStorage.setItem(proportionsKey, JSON.stringify([sizeInput.valueAsNumber, widthInput.valueAsNumber]));
    } catch {}
  }

  try {
    const saved = JSON.parse(localStorage.getItem(proportionsKey));
    if (Array.isArray(saved)) {
      if (Number.isInteger(saved[0]) && sizeStops[saved[0]]) sizeInput.value = String(saved[0]);
      if (Number.isInteger(saved[1]) && widthStops[saved[1]]) widthInput.value = String(saved[1]);
    }
  } catch {}
  for (const slider of [sizeInput, widthInput]) {
    slider.addEventListener("input", applyProportions);
    slider.addEventListener("change", saveProportions);
  }
  applyProportions();

  proportionsToggle.addEventListener("click", (event) => {
    const opening = proportionsPanel.hidden;
    setProportionsOpen(opening);
    if (opening && event.detail === 0) sizeInput.focus({ preventScroll: true });
  });
  for (const type of ["pointerdown", "focusin"]) {
    document.addEventListener(type, (event) => {
      if (!proportionsPanel.hidden && !menu.contains(event.target)) setProportionsOpen(false);
      if (coatMenu.open && !coatMenu.contains(event.target)) coatMenu.open = false;
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (coatMenu.open) {
      event.preventDefault();
      coatMenu.open = false;
      coatSummary.focus({ preventScroll: true });
      return;
    }
    if (proportionsPanel.hidden) return;
    event.preventDefault();
    setProportionsOpen(false);
    proportionsToggle.focus({ preventScroll: true });
  });

  function makeFurRustle(context, buffer) {
    const volume = context.createGain();
    volume.gain.value = 0;
    volume.connect(context.destination);
    const tone = context.createBiquadFilter();
    tone.type = "highshelf";
    tone.frequency.value = 2100;
    tone.gain.value = -3.5;
    tone.connect(volume);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = .48;
    source.connect(tone);
    source.start(0, Math.random() * buffer.duration);
    return { volume, rate: source.playbackRate, lastMotion: -Infinity, motionStart: 0, speed: 0 };
  }

  function makeCatAudio() {
    const context = new Audio();
    const volume = context.createGain();
    volume.gain.value = 0;
    volume.connect(context.destination);
    const voice = context.createGain();
    voice.gain.value = .36;
    voice.connect(context.destination);
    const player = { context, volume, voice, purrUntil: 0, nextPurr: 0, nextMeow: 0 };
    const decode = (encoded) => context.decodeAudioData(
      Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0)).buffer
    );
    const voices = [recordings.meow, ...(recordings.extraMeows ?? [])];
    player.ready = Promise.all([decode(recordings.purr), ...voices.map(decode)]).then(([purr, ...meows]) => {
      const loop = context.createBufferSource();
      loop.buffer = purr;
      loop.loop = true;
      loop.connect(volume);
      loop.start();
      player.meows = meows;
    });
    if (recordings.rustle) {
      decode(recordings.rustle).then((buffer) => {
        if (context.state !== "closed") player.rustle = makeFurRustle(context, buffer);
      }).catch(() => {});
    }
    if (recordings.rump) {
      decode(recordings.rump).then((buffer) => {
        player.rump = buffer;
      }).catch(() => {});
    }
    return player;
  }

  function targetSound(gain, value, now, smoothing) {
    if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
    else {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
    }
    gain.setTargetAtTime(value, now, smoothing);
  }

  function rustleFur(speed, pressure) {
    if (!audio?.rustle) return;
    const rustle = audio.rustle;
    const gain = rustle.volume.gain;
    const now = audio.context.currentTime;
    if (!pressure) {
      rustle.lastMotion = -Infinity;
      targetSound(gain, 0, now, .018);
      return;
    }

    const gap = now - rustle.lastMotion;
    const intensity = Math.min(1, speed / 1.1);
    const starting = gap > .15;
    if (starting) {
      rustle.motionStart = now;
      rustle.speed = intensity;
    } else {
      rustle.speed += (intensity - rustle.speed) * (1 - Math.exp(-gap / .095));
    }
    rustle.lastMotion = now;
    targetSound(rustle.rate, .48 + .52 * Math.sqrt(rustle.speed), now, starting ? .042 : .15);

    const sustained = Math.max(0, Math.min(1, (now - rustle.motionStart - .18) / .36));
    const nearStill = 1 - Math.min(1, rustle.speed / .10);
    const level = (.29 + .12 * rustle.speed) * (1 - .44 * sustained * rustle.speed) * (1 - .84 * nearStill);
    const hold = .095 - .044 * rustle.speed + .080 * nearStill;
    const release = .045 - .018 * rustle.speed;
    targetSound(gain, level, now, .048 + .040 * nearStill);
    gain.setTargetAtTime(0, now + hold, release);
  }

  function purr(pressure) {
    if (!audio) return;
    const now = audio.context.currentTime;
    if (pressure > 0) {
      if (now >= audio.nextPurr) {
        audio.purrUntil = now + 1.25 + Math.random() * .45;
        audio.nextPurr = audio.purrUntil + 1.80 + Math.random() * .70;
      }
      if (now >= audio.purrUntil) return;
    }

    const intensity = pressure > 0 ? .161 + pressure * .224 : 0;
    const gain = audio.volume.gain;
    targetSound(gain, intensity, now, intensity ? .12 : .16);
    if (intensity) gain.setTargetAtTime(0, Math.min(now + .32, audio.purrUntil), .19);
  }

  function petSound(pressure, voiceAllowed) {
    if (!soundEnabled) return;
    audioPetting = true;
    purr(pressure);
    if (!voiceAllowed || greeted || !audio?.meows) return;
    greeted = true;
    const now = audio.context.currentTime;
    if (now - lastMeow < 8.5) return;
    lastMeow = now;
    const source = audio.context.createBufferSource();
    source.buffer = audio.meows[audio.nextMeow];
    audio.nextMeow = (audio.nextMeow + 1) % audio.meows.length;
    source.connect(audio.voice);
    audio.call = source;
    source.onended = () => {
      if (audio?.call === source) audio.call = undefined;
    };
    source.start();
  }

  function endPetSound(stopRustle = true) {
    if (audioPetting) purr(0);
    if (stopRustle) {
      rustleFur(0, 0);
      rumpStroke = undefined;
    }
    audioPetting = false;
    greeted = false;
  }

  function trackRumpStroke(overRump, moving, time) {
    if (!soundEnabled) return;
    if (!overRump) {
      if (rumpStroke) rumpStroke.leftAt ??= time;
      return;
    }
    if (rumpStroke?.leftAt !== undefined) {
      if (time - rumpStroke.leftAt > 160) rumpStroke = undefined;
      else rumpStroke.leftAt = undefined;
    }
    if (!moving || rumpStroke?.played || !audio?.rump) return;
    if (!rumpStroke || time - rumpStroke.lastMove > 380) {
      rumpStroke = { start: time, lastMove: time, played: false };
      return;
    }
    rumpStroke.lastMove = time;
    if (time - rumpStroke.start < 3000) return;

    rumpStroke.played = true;
    audio.rumpSound?.stop();
    const source = audio.context.createBufferSource();
    const volume = audio.context.createGain();
    source.buffer = audio.rump;
    volume.gain.value = .24;
    source.connect(volume).connect(audio.context.destination);
    audio.rumpSound = source;
    source.onended = () => {
      source.disconnect();
      volume.disconnect();
      if (audio?.rumpSound === source) audio.rumpSound = undefined;
    };
    source.start();
  }

  sound.addEventListener("click", async () => {
    soundEnabled = !soundEnabled;
    sound.setAttribute("aria-pressed", String(soundEnabled));
    if (!soundEnabled) {
      endPetSound();
      audio?.call?.stop();
      audio?.rumpSound?.stop();
      return;
    }

    try {
      audio ??= makeCatAudio();
      await Promise.all([audio.context.resume(), audio.ready]);
    } catch {
      soundEnabled = false;
      sound.setAttribute("aria-pressed", "false");
      endPetSound();
      audio?.context.close().catch(() => {});
      audio = undefined;
    }
  });

  theme.addEventListener("click", () => {
    const night = document.documentElement.dataset.theme !== "night";
    document.documentElement.dataset.theme = night ? "night" : "day";
    scene.toggleAttribute("data-night", night);
    theme.setAttribute("aria-pressed", String(night));
    document.querySelector('meta[name="theme-color"]').content = night ? "#171e21" : "#f4f4ed";
    visual.activate();
  });

  expand.hidden = !document.fullscreenEnabled || !room.requestFullscreen;
  const fullscreenOpen = () => document.fullscreenElement === room || document.fullscreenElement === document.documentElement;
  expand.addEventListener("click", async () => {
    try {
      if (fullscreenOpen()) await document.exitFullscreen();
      else {
        await (mobile.matches ? document.documentElement : room).requestFullscreen();
        if (mobile.matches) {
          try { await screen.orientation?.lock?.("landscape"); } catch {}
        }
      }
    } catch {
      expand.setAttribute("aria-pressed", "false");
    }
  });
  document.addEventListener("fullscreenchange", () => {
    const full = fullscreenOpen();
    expand.setAttribute("aria-pressed", String(full));
    expand.setAttribute("aria-label", full ? "Thoát toàn màn hình" : "Toàn màn hình");
    expand.title = expand.getAttribute("aria-label");
  });

  function position(event) {
    const rect = zone.getBoundingClientRect();
    if (turned.matches) {
      return {
        x: (event.clientY - rect.top) / rect.height,
        y: (rect.right - event.clientX) / rect.width,
        metric: rect.width / rect.height,
      };
    }
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      metric: rect.height / rect.width,
    };
  }

  function move(event, firstContact = false) {
    const positionInScene = position(event);
    let { x, y } = positionInScene;
    if (!holdingTail && (x < 0 || x > 1 || y < 0 || y > 1)) {
      visual.release();
      lastPoint = undefined;
      endPetSound();
      return;
    }
    if (holdingTail) {
      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));
    }
    const previous = lastPoint ?? { x, y, time: event.timeStamp };
    const dx = x - previous.x;
    const dy = y - previous.y;
    const distance = Math.hypot(dx, dy * positionInScene.metric);
    const area = visual.areaAt(x, y, true);
    const overCat = area !== null;
    const moving = distance > 0 && event.type === "pointermove";
    const force = event.pressure > 0 && event.pressure !== .5 ? event.pressure : .5;
    const pressure = overCat ? Math.min(.95, .2 + force * .34 + distance * 8) : 0;
    visual.point(x, y, area, pressure, Math.max(-1, Math.min(1, dx * 42)), Math.max(-1, Math.min(1, dy * 42)));

    lastPoint = { x, y, time: event.timeStamp };
    if (pressure > 0 && (firstContact || distance > .0015)) {
      petSound(pressure, area !== "tail");
    } else if (!overCat) endPetSound(false);
    if (soundEnabled && pressure > 0 && moving) {
      const elapsed = Math.max(.008, Math.min(.24, (event.timeStamp - previous.time) / 1000));
      audioPetting = true;
      rustleFur(distance / elapsed, pressure);
    }
    if (soundEnabled) trackRumpStroke(visual.rumpAt(x, y, area), moving, event.timeStamp);
  }

  zone.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0 || gesture !== undefined) return;
    const { x, y } = position(event);
    holdingTail = event.pointerType === "mouse" && visual.areaAt(x, y) === "tail";
    if (event.pointerType !== "mouse" || holdingTail) {
      zone.setPointerCapture(event.pointerId);
      gesture = event.pointerId;
    }
    move(event, true);
  });

  for (const type of ["pointerenter", "pointermove"]) {
    zone.addEventListener(type, (event) => {
      if (!event.isPrimary || (gesture !== undefined && gesture !== event.pointerId)) return;
      if (event.pointerType === "mouse" || gesture === event.pointerId) move(event);
    });
  }

  function release() {
    lastPoint = undefined;
    holdingTail = false;
    visual.release();
    endPetSound();
  }

  turned.addEventListener("change", () => {
    const captured = gesture;
    gesture = undefined;
    if (captured !== undefined && zone.hasPointerCapture(captured)) zone.releasePointerCapture(captured);
    release();
  });

  zone.addEventListener("pointerleave", () => {
    if (gesture === undefined) release();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    zone.addEventListener(type, (event) => {
      if (gesture === event.pointerId) {
        gesture = undefined;
        release();
      }
    });
  }

  zone.addEventListener("click", (event) => {
    if (event.detail !== 0) return;
    visual.pet();
    greeted = false;
    petSound(.65, true);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    endPetSound();
    audio?.call?.stop();
    audio?.rumpSound?.stop();
  });
})();
