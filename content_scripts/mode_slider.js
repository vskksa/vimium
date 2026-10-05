// Adjusting sliders (volume, seek bars, native range inputs) from the keyboard.
//
// The "adjust a slider" hint command (see ADJUST_SLIDER in link_hints.js) shows hints for visible
// sliders, for buttons which reveal a hidden slider when hovered (like YouTube's mute button), and
// for playing videos which have no volume slider. Selecting a hint starts SliderMode, in which
// h/j/k/l and the arrow keys change the value.

// Relative changes move the slider by this fraction of its range.
const sliderStepFraction = 0.05;
// Shifted keys (H/J/K/L) move it by this many steps.
const sliderBigStepCount = 5;

const sliderSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sliderClamp = (value, min, max) => Math.min(max, Math.max(min, value));

const parseSliderNumber = (value, fallback) => {
  const number = parseFloat(value);
  return isNaN(number) ? fallback : number;
};

// Returns the text of the elements whose ids are listed in `element`'s `attribute`.
const getTextOfReferencedElements = (element, attribute) => {
  const ids = (element.getAttribute(attribute) || "").trim().split(/\s+/).filter((id) => id);
  const root = element.getRootNode();
  return ids
    .map((id) => root.getElementById?.(id)?.textContent?.trim())
    .filter((text) => text)
    .join(" ");
};

const Sliders = {
  sliderSelector: 'input[type="range"], [role="slider"]',
  buttonSelector: 'button, [role="button"]',
  // How many ancestors of a hidden slider we search for a button which reveals it.
  maxTriggerDepth: 3,
  // How many ancestors of a video we search for a slider, before offering the video's own volume.
  maxPlayerDepth: 4,

  isEnabled(element) {
    if (element.disabled) return false;
    const ariaDisabled = element.getAttribute("aria-disabled");
    return !(ariaDisabled != null && ["", "true"].includes(ariaDisabled.toLowerCase()));
  },

  isVisible(element) {
    return DomUtils.getVisibleClientRect(element) != null;
  },

  // Returns the visible rect of `slider`, or null. Unlike DomUtils.getVisibleClientRect, this
  // accounts for ancestors which clip their content, because sliders which are revealed on hover
  // are often inside a collapsed container with `overflow: hidden`.
  getVisibleRect(slider) {
    let rect = DomUtils.getVisibleClientRect(slider);
    // We stop at the body, because its overflow usually applies to the viewport rather than to the
    // body's own box. E.g. YouTube's body has `overflow: auto` and a height of zero.
    const isRoot = (el) => el === document.body || el === document.documentElement;
    for (let el = this.getParent(slider); rect && el && !isRoot(el);) {
      const style = globalThis.getComputedStyle(el);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") {
        const clip = el.getBoundingClientRect();
        const clipsX = style.overflowX !== "visible";
        const clipsY = style.overflowY !== "visible";
        rect = Rect.intersect(
          rect,
          Rect.create(
            clipsX ? clip.left : rect.left,
            clipsY ? clip.top : rect.top,
            clipsX ? clip.right : rect.right,
            clipsY ? clip.bottom : rect.bottom,
          ),
        );
        if (rect.width < 3 || rect.height < 3) return null;
      }
      el = this.getParent(el);
    }
    return rect;
  },

  getLabel(element) {
    if (element.localName === "video") return "Volume";
    const label = element.getAttribute("aria-label") ||
      getTextOfReferencedElements(element, "aria-labelledby") ||
      element.getAttribute("title") ||
      element.labels?.[0]?.textContent?.trim();
    return label || "Slider";
  },

  getParent(element) {
    return element.parentElement ?? element.getRootNode().host ?? null;
  },

  // For a slider which isn't visible, returns { trigger, scope }: a visible button near the slider
  // which probably reveals it when hovered, and the closest ancestor containing both. Returns null
  // if there's no such button.
  findTrigger(slider, buttonsControllingSliders) {
    const controller = buttonsControllingSliders.get(slider);
    if (controller) return { trigger: controller, scope: this.getParent(controller) };

    let ancestor = slider;
    for (let depth = 0; depth < this.maxTriggerDepth; depth++) {
      ancestor = this.getParent(ancestor);
      if (ancestor == null) return null;
      const descendants = Array.from(ancestor.querySelectorAll("*"));
      const sliderIndex = descendants.findIndex((el) => el === slider || el.contains(slider));
      let best = null;
      let bestDistance = Infinity;
      descendants.forEach((el, index) => {
        if (!el.matches(this.buttonSelector) || el.contains(slider)) return;
        if (!this.isEnabled(el) || !this.isVisible(el)) return;
        const distance = Math.abs(index - sliderIndex);
        if (distance < bestDistance) {
          best = el;
          bestDistance = distance;
        }
      });
      if (best) return { trigger: best, scope: ancestor };
    }
    return null;
  },

  // Returns a map from sliders to the visible buttons which name them (or an ancestor of them) in
  // `aria-controls`.
  getButtonsControllingSliders(elements) {
    const map = new Map();
    for (const button of elements) {
      if (!button.hasAttribute("aria-controls") || !button.matches(this.buttonSelector)) continue;
      if (!this.isVisible(button)) continue;
      const root = button.getRootNode();
      for (const id of button.getAttribute("aria-controls").trim().split(/\s+/)) {
        const controlled = root.getElementById?.(id);
        if (!controlled) continue;
        const sliders = controlled.matches(this.sliderSelector)
          ? [controlled]
          : Array.from(controlled.querySelectorAll(this.sliderSelector));
        for (const slider of sliders) {
          if (!map.has(slider)) map.set(slider, button);
        }
      }
    }
    return map;
  },

  // Returns a list of { element, rect, reason, adjustTarget }, from which link_hints.js builds
  // LocalHints. `element` is where the hint goes, and `adjustTarget` is the slider (or video) which
  // the hint adjusts.
  findAdjustables() {
    if (!document.documentElement) return [];
    const elements = DomUtils.getAllElements(document.documentElement);
    const sliders = elements.filter((el) => el.matches(this.sliderSelector) && this.isEnabled(el));
    const buttonsControllingSliders = this.getButtonsControllingSliders(elements);
    const results = [];
    const triggers = new Set();

    for (const slider of sliders) {
      const label = this.getLabel(slider);
      const rect = this.getVisibleRect(slider);
      if (rect) {
        results.push({ element: slider, rect, reason: label, adjustTarget: slider });
        continue;
      }
      const found = this.findTrigger(slider, buttonsControllingSliders);
      if (found == null || triggers.has(found.trigger)) continue;
      triggers.add(found.trigger);
      results.push({
        element: found.trigger,
        rect: DomUtils.getVisibleClientRect(found.trigger, true),
        reason: label,
        adjustTarget: slider,
      });
    }

    // Videos whose player has no slider get a hint which adjusts the video's own volume. The hint
    // goes on the topmost element at the video's center (usually the player's overlay), so that it
    // isn't removed as being covered by another element.
    for (const { video, rect } of MediaControls.findActiveVideos()) {
      let ancestor = video;
      let playerHasSlider = false;
      for (let depth = 0; depth < this.maxPlayerDepth && ancestor; depth++) {
        ancestor = this.getParent(ancestor);
        if (ancestor?.querySelector(this.sliderSelector)) {
          playerHasSlider = true;
          break;
        }
      }
      if (playerHasSlider) continue;
      const { element } = MediaControls.getHoverTarget(video, rect);
      results.push({ element, rect, reason: "Volume", adjustTarget: video });
    }

    return results;
  },
};

// Each adjuster reads a slider's value with read(), which returns { value, min, max, text }, and
// changes it with the async setValue(value). `value` can be NaN if it's unknown.

class NativeRangeAdjuster {
  constructor(input) {
    this.element = input;
  }

  read() {
    const input = this.element;
    return {
      value: parseSliderNumber(input.value, NaN),
      min: parseSliderNumber(input.min, 0),
      max: parseSliderNumber(input.max, 100),
      text: null,
    };
  }

  setValue(value) {
    const input = this.element;
    const before = input.value;
    // Use the native setter, so that frameworks which track the input's value (e.g. React) see
    // the change.
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    valueSetter.call(input, String(value));
    if (input.value === before && parseSliderNumber(before, NaN) !== value) {
      // The input's own step is larger than our change, so the value snapped back. Move by one of
      // the input's steps instead.
      if (value > parseSliderNumber(before, 0)) input.stepUp();
      else input.stepDown();
    }
    if (input.value !== before) {
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return Promise.resolve();
  }
}

// For elements with role=slider. Most such sliders change their value on arrow keys, so we send
// them synthetic key presses. If a slider ignores those, we click on it at the position of the value
// instead.
class AriaSliderAdjuster {
  constructor(slider) {
    this.element = slider;
    // "keys" or "mouse".
    this.method = "keys";
    // How much one arrow key press changes the value, once we've measured it.
    this.amountPerKeyPress = null;
  }

  read() {
    const slider = this.element;
    return {
      value: parseSliderNumber(slider.getAttribute("aria-valuenow"), NaN),
      min: parseSliderNumber(slider.getAttribute("aria-valuemin"), 0),
      max: parseSliderNumber(slider.getAttribute("aria-valuemax"), 100),
      text: slider.getAttribute("aria-valuetext"),
    };
  }

  // True if the slider declares itself vertical. Sliders are horizontal by default.
  isDeclaredVertical() {
    return this.element.getAttribute("aria-orientation") === "vertical";
  }

  // For the mouse method, we also treat an undeclared slider as vertical if it's taller than it is
  // wide.
  isVertical() {
    const orientation = this.element.getAttribute("aria-orientation");
    if (orientation) return orientation === "vertical";
    const rect = this.element.getBoundingClientRect();
    return rect.height > rect.width;
  }

  pressKey(isIncrease) {
    // We don't guess the orientation from the slider's shape here: a slider which is being
    // revealed can be briefly narrower than it is tall (e.g. YouTube's volume panel), and sliders
    // conventionally accept the left and right keys in either orientation.
    const isVertical = this.isDeclaredVertical();
    const key = isIncrease
      ? (isVertical ? "ArrowUp" : "ArrowRight")
      : (isVertical ? "ArrowDown" : "ArrowLeft");
    const keyCode = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[key];
    for (const type of ["keydown", "keyup"]) {
      const event = new KeyboardEvent(type, {
        key,
        code: key,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        // Many sites (e.g. YouTube) still read these legacy properties. They must be set here
        // rather than defined on the event afterwards: content scripts run in an isolated world,
        // so the page wouldn't see properties which we define on our view of the event.
        keyCode,
        which: keyCode,
      });
      this.element.dispatchEvent(event);
    }
  }

  // Clicks the slider at the position which corresponds to `value`.
  clickAtValue(value) {
    const { min, max } = this.read();
    const fraction = max > min ? sliderClamp((value - min) / (max - min), 0, 1) : 0;
    const rect = this.element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    let x, y;
    if (this.isVertical()) {
      x = rect.left + rect.width / 2;
      y = rect.bottom - fraction * rect.height;
    } else {
      x = rect.left + fraction * rect.width;
      y = rect.top + rect.height / 2;
    }
    // Avoid clicking exactly on the edges, which may fall outside of the slider.
    x = sliderClamp(x, rect.left + 1, rect.right - 1);
    y = sliderClamp(y, rect.top + 1, rect.bottom - 1);
    const target = LocalHints.getElementFromPoint(x, y);
    const isInSlider = target instanceof Element &&
      (this.element.contains(target) || target.contains(this.element));
    DomUtils.simulateClickAt(isInSlider ? target : this.element, x, y);
  }

  // Presses an arrow key once to find out whether the slider responds to keys, and by how much.
  // Returns true if it does. Otherwise, switches to the mouse method.
  async measureKeyPress(isIncrease) {
    const before = this.read().value;
    // A seek bar's value changes by itself while its video plays, so we can't tell whether a key
    // press did anything. Use the mouse for sliders like that.
    await sliderSleep(60);
    if (this.read().value !== before) {
      this.method = "mouse";
      return false;
    }
    this.pressKey(isIncrease);
    // Some sliders update asynchronously.
    await sliderSleep(50);
    const after = this.read().value;
    if (isNaN(after) || after === before) {
      this.method = "mouse";
      return false;
    }
    this.amountPerKeyPress = Math.abs(after - before);
    return true;
  }

  async setValue(value) {
    let { value: current, min, max } = this.read();
    if (value === current) return;
    if (this.method === "keys" && !isNaN(current)) {
      const isIncrease = value > current;
      // When there's any change to make, we press the key at least once.
      let minimumPresses = 1;
      if (this.amountPerKeyPress == null && await this.measureKeyPress(isIncrease)) {
        // Measuring pressed the key once already.
        current = this.read().value;
        minimumPresses = 0;
      }
      if (this.method === "keys") {
        const remaining = isIncrease ? value - current : current - value;
        let presses = Math.max(minimumPresses, Math.round(remaining / this.amountPerKeyPress));
        // When going to either end, press a few extra times so that rounding doesn't leave us just
        // short of it. The slider stops at its end anyway.
        if (value <= min || value >= max) presses += 2;
        for (let i = 0; i < Math.min(presses, 500); i++) this.pressKey(isIncrease);
        return;
      }
    }
    this.clickAtValue(value);
  }
}

class MediaVolumeAdjuster {
  constructor(media) {
    this.element = media;
  }

  read() {
    const media = this.element;
    return {
      value: media.muted ? 0 : Math.round(media.volume * 100),
      min: 0,
      max: 100,
      text: media.muted ? "muted" : null,
    };
  }

  setValue(value) {
    const media = this.element;
    media.volume = sliderClamp(value, 0, 100) / 100;
    media.muted = value <= 0;
    return Promise.resolve();
  }
}

class SliderMode extends Mode {
  // Starts adjusting `target` (a slider or a video). `hintElement` is the element which had the
  // hint: the slider itself, a button which reveals it, or a video's overlay.
  static async activate(hintElement, target) {
    let trigger = null;
    // The closest ancestor of the trigger which contains the slider. When the mode exits, the mouse
    // leaves the trigger and the ancestors up to this one, which collapses a revealed slider.
    let triggerScope = null;
    if (target.localName !== "video" && hintElement !== target) {
      trigger = hintElement;
      triggerScope = DomUtils.getAncestorsAndSelf(trigger).find((el) => el.contains(target));
    }

    // Choose where the mouse stays while the mode is active. This keeps the slider (and the player's
    // controls) shown.
    const hoverElement = trigger ?? hintElement;
    const rect = hoverElement.getBoundingClientRect();
    const hoverTarget = {
      element: hoverElement,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    DomUtils.simulateMouseMove(hoverTarget.element, hoverTarget.x, hoverTarget.y);
    // Give a revealed slider a chance to render.
    if (trigger) await new Promise((resolve) => requestAnimationFrame(resolve));

    let adjuster;
    if (target.localName === "video" || target.localName === "audio") {
      adjuster = new MediaVolumeAdjuster(target);
    } else if (target.localName === "input") {
      adjuster = new NativeRangeAdjuster(target);
    } else {
      adjuster = new AriaSliderAdjuster(target);
    }

    return new SliderMode({ adjuster, label: Sliders.getLabel(target), hoverTarget, triggerScope });
  }

  constructor({ adjuster, label, hoverTarget, triggerScope }) {
    super();
    this.adjuster = adjuster;
    this.label = label;
    this.hoverTarget = hoverTarget;
    // Operations run one at a time, in order.
    this.pending = Promise.resolve();
    // The codes of keys whose keydown we handled, so that we also suppress their keyup.
    this.handledKeyCodes = new Set();

    super.init({
      name: "slider-mode",
      singleton: "slider-mode",
      indicator: this.getIndicatorText(),
      exitOnEscape: true,
      exitOnClick: true,
      suppressTrailingKeyEvents: true,
      keydown: (event) => this.onKeyDown(event),
      keyup: (event) => {
        if (!this.handledKeyCodes.has(event.code)) return this.continueBubbling;
        this.handledKeyCodes.delete(event.code);
        return this.suppressEvent;
      },
    });

    // Focus the slider, so that its focus style shows, and so that sites which only handle keys on
    // the focused slider respond to our key presses. Native range inputs aren't focused, because
    // focusing them enters insert mode.
    const slider = adjuster.element;
    const previousFocus = document.activeElement;
    if (adjuster instanceof AriaSliderAdjuster && slider.tabIndex >= 0) {
      slider.focus({ preventScroll: true });
    }

    const stopKeepAlive = MediaControls.keepHovering([hoverTarget], () => this.modeIsActive);

    this.onExit(() => {
      stopKeepAlive();
      if (document.activeElement === slider) {
        slider.blur();
        if (previousFocus && previousFocus !== document.body && previousFocus.isConnected) {
          previousFocus.focus({ preventScroll: true });
        }
      }
      const { element, x, y } = hoverTarget;
      if (element.isConnected) DomUtils.simulateMouseLeave(element, x, y, triggerScope);
    });
  }

  getIndicatorText() {
    const { value, min, max, text } = this.adjuster.read();
    let valueText = text;
    if (!valueText && !isNaN(value)) {
      valueText = max > min ? `${Math.round(((value - min) / (max - min)) * 100)}%` : `${value}`;
    }
    // The HUD shows one line of about this many characters; longer text wraps and is cut off.
    const maxLength = 44;
    let message = `${this.label}${valueText ? `: ${valueText}` : ""}`;
    // Some sliders have long value texts, e.g. "1 Minute 5 Seconds of 10 Minutes 34 Seconds".
    if (message.length > maxLength && valueText) message = valueText;
    if (message.length > maxLength) message = message.slice(0, maxLength - 1) + "…";
    // Remind the user of the keys when there's room.
    const keys = " (h/l, H/L, 0-9, $)";
    return message.length + keys.length <= maxLength ? message + keys : message;
  }

  updateIndicator() {
    if (this.modeIsActive) this.setIndicator(this.getIndicatorText());
  }

  // Returns a function which computes the new value from { value, min, max }, or null if `keyChar`
  // isn't a slider key.
  getChangeForKey(keyChar) {
    const stepBy = (steps) => ({ value, min, max }) => {
      const base = isNaN(value) ? min : value;
      return sliderClamp(base + steps * sliderStepFraction * (max - min), min, max);
    };
    const jumpTo = (fraction) => ({ min, max }) => min + fraction * (max - min);
    const big = sliderBigStepCount;
    const changes = {
      h: stepBy(-1),
      j: stepBy(-1),
      left: stepBy(-1),
      down: stepBy(-1),
      l: stepBy(1),
      k: stepBy(1),
      right: stepBy(1),
      up: stepBy(1),
      H: stepBy(-big),
      J: stepBy(-big),
      L: stepBy(big),
      K: stepBy(big),
      "$": jumpTo(1),
    };
    if (/^[0-9]$/.test(keyChar)) return jumpTo(parseInt(keyChar) / 10);
    return changes[keyChar] ?? null;
  }

  onKeyDown(event) {
    const keyChar = KeyboardUtils.getKeyChar(event);
    // Let bare modifier keys through, e.g. the Shift of "H".
    if (!keyChar) return this.continueBubbling;

    if (keyChar === "enter") {
      this.exit();
      return this.suppressEvent;
    }

    const change = this.getChangeForKey(keyChar);
    if (change == null) {
      // Any other key ends the mode, and then runs as usual (e.g. as a Vimium command).
      this.exit();
      return this.restartBubbling;
    }

    this.handledKeyCodes.add(event.code);
    this.pending = this.pending
      .then(async () => {
        if (!this.modeIsActive) return;
        await this.adjuster.setValue(change(this.adjuster.read()));
        this.updateIndicator();
        // Some sliders update their value asynchronously.
        await sliderSleep(100);
        this.updateIndicator();
      })
      .catch((error) => console.error("Vimium: couldn't adjust the slider.", error));
    return this.suppressEvent;
  }
}

Object.assign(globalThis, {
  Sliders,
  SliderMode,
  // Exported for tests.
  NativeRangeAdjuster,
  AriaSliderAdjuster,
  MediaVolumeAdjuster,
});
