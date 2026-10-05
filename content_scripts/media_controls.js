// Reveals the auto-hidden controls of video players, so that link hints land on visible buttons.
//
// Most web players (YouTube, Vimeo, Twitch, ...) hide their control bar with `opacity: 0` while the
// video plays, and show it again when the mouse moves over the player. Vimium still finds those
// transparent buttons, so without this their hints float over the video with nothing visible under
// them. We simulate the mouse moving over each video that's in use, and keep moving it slightly so
// that the player doesn't hide its controls again while hints are showing.

const MediaControls = {
  // Videos smaller than this are thumbnails or previews, not players.
  minVideoWidth: 200,
  minVideoHeight: 100,
  // Players hide their controls after 2-3 seconds without mouse movement.
  keepAliveIntervalMs: 1000,
  // If link-hints mode never starts (e.g. no frame had any hints), stop the keep-alive after this.
  hintsStartTimeoutMs: 5000,

  stopRevealKeepAlive: null,

  // True if the video is playing or has been played. This skips muted previews which only start
  // playing when hovered, such as thumbnails on YouTube's home page.
  isVideoInUse(video) {
    return !video.paused || video.currentTime > 0;
  },

  // Returns a list of { video, rect } for the videos in this frame which are visible, large enough
  // to be a player, and in use.
  findActiveVideos() {
    if (!document.documentElement) return [];
    const results = [];
    for (const element of DomUtils.getAllElements(document.documentElement)) {
      if (element.localName !== "video") continue;
      const rect = DomUtils.getVisibleViewportRect(element);
      if (rect == null) continue;
      if (rect.width < this.minVideoWidth || rect.height < this.minVideoHeight) continue;
      if (!this.isVideoInUse(element)) continue;
      results.push({ video: element, rect });
    }
    return results;
  },

  // Returns the topmost element at the center of `rect`, which is where we point the mouse. For a
  // video this is usually the player's overlay rather than the video itself, so events go through
  // the same elements that a real mouse event would.
  getHoverTarget(element, rect) {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const target = LocalHints.getElementFromPoint(x, y);
    return {
      element: target instanceof Element ? target : element,
      x,
      y,
    };
  },

  // Moves the mouse onto each of `targets` (a list of { element, x, y }).
  hover(targets) {
    for (const { element, x, y } of targets) {
      DomUtils.simulateMouseMove(element, x, y);
      // Some players (e.g. YouTube) only react once the mouse has moved from where it entered.
      DomUtils.simulateMouseMove(element, x + 1, y, { isEntering: false });
    }
  },

  // Keeps moving the mouse over `targets` every keepAliveIntervalMs, for as long as
  // `shouldContinue()` returns true. Returns a function which stops it.
  keepHovering(targets, shouldContinue) {
    let tick = 0;
    const timer = setInterval(() => {
      if (!shouldContinue()) {
        clearInterval(timer);
        return;
      }
      // Some players ignore mousemove events whose coordinates haven't changed, so we jitter by
      // a pixel.
      const offset = (tick++ % 2 === 0) ? 1 : 0;
      for (const { element, x, y } of targets) {
        if (element.isConnected) {
          DomUtils.simulateMouseMove(element, x + offset, y, { isEntering: false });
        }
      }
    }, this.keepAliveIntervalMs);
    return () => clearInterval(timer);
  },

  // Shows the controls of every active video in this frame, and keeps them shown until
  // stopKeepAlive() is called. Returns the number of videos revealed.
  reveal() {
    this.stopKeepAlive();
    const targets = this.findActiveVideos().map(({ video, rect }) =>
      this.getHoverTarget(video, rect)
    );
    if (targets.length === 0) return 0;
    this.hover(targets);

    const startTime = Date.now();
    const shouldContinue = () => {
      const linkHintsMode = HintCoordinator.linkHintsMode;
      const isActive = linkHintsMode == null
        ? (Date.now() - startTime) < this.hintsStartTimeoutMs
        : linkHintsMode.hintMode?.modeIsActive ?? false;
      if (!isActive) this.stopRevealKeepAlive = null;
      return isActive;
    };
    this.stopRevealKeepAlive = this.keepHovering(targets, shouldContinue);
    return targets.length;
  },

  // We don't send a mouseout. The player's own idle timer hides the controls, as it would after a
  // real mouse stops moving.
  stopKeepAlive() {
    if (this.stopRevealKeepAlive) {
      this.stopRevealKeepAlive();
      this.stopRevealKeepAlive = null;
    }
  },

  isKeepAliveRunning() {
    return this.stopRevealKeepAlive != null;
  },
};

globalThis.MediaControls = MediaControls;
