let commandCount = null;
let commandName = null;

// Some tests have side effects on the handler stack and the active mode, so these are reset on
// setup. Also, some tests affect the focus (e.g. Vomnibar tests), so we make sure the window has
// the focus.
const initializeModeState = () => {
  globalThis.focus();
  Mode.reset();
  handlerStack.reset();
  const normalMode = installModes();
  normalMode.setPassKeys("p");
  normalMode.setKeyMapping({
    m: { options: {}, command: "m" }, // A mapped key.
    p: { options: {}, command: "p" }, // A pass key.
    z: { p: { options: {}, command: "zp" } }, // Not a pass key.
  });
  normalMode.setCommandHandler(({ command, count }) => {
    [commandName, commandCount] = [command.command, count];
  });
  commandName = null;
  commandCount = null;
  return normalMode;
};

//
// Retrieve the hint markers as an array object.
//
const getHintMarkerEls = () => Array.from(document.querySelectorAll(".vimiumHintMarker"));

const stubSettings = (key, value) => stub(Settings._settings, key, value);

HintCoordinator.sendMessage = (name, request) => {
  if (request == null) {
    request = {};
  }
  if (HintCoordinator[name]) {
    HintCoordinator[name](request);
  }
  return request;
};

const activateLinkHintsMode = () => {
  HintCoordinator.getHintDescriptors({ modeIndex: 0 }, {}, () => {});
  HintCoordinator.activateMode({
    frameIdToHintDescriptors: {},
    modeIndex: 0,
    originatingFrameId: frameId,
  });
  return HintCoordinator.linkHintsMode;
};

//
// Generate tests that are common to both default and filtered
// link hinting modes.
//
const createGeneralHintTests = (isFilteredMode) => {
  globalThis.vimiumOnClickAttributeName = "does-not-matter";

  context("Link hints", () => {
    setup(() => {
      initializeModeState();
      const testContent = "<a>test</a><a>tress</a>";
      document.getElementById("test-div").innerHTML = testContent;
      stubSettings("filterLinkHints", isFilteredMode);
      stubSettings("linkHintCharacters", "ab");
      stubSettings("linkHintNumbers", "12");
      stub(globalThis, "windowIsFocused", () => true);
    });

    teardown(() => document.getElementById("test-div").innerHTML = "");

    should("create hints when activated, discard them when deactivated", () => {
      const mode = activateLinkHintsMode();
      assert.isFalse(mode.containerEl == null);
      mode.deactivateMode();
      assert.isTrue(mode.containerEl == null);
    });

    should("position items correctly", () => {
      const assertStartPosition = (element1, element2) => {
        assert.equal(element1.getClientRects()[0].left, element2.getClientRects()[0].left);
        assert.equal(element1.getClientRects()[0].top, element2.getClientRects()[0].top);
      };
      stub(document.body.style, "position", "static");
      let mode = activateLinkHintsMode();
      let markerEls = getHintMarkerEls();
      assertStartPosition(document.getElementsByTagName("a")[0], markerEls[0]);
      assertStartPosition(document.getElementsByTagName("a")[1], markerEls[1]);
      mode.deactivateMode();
      stub(document.body.style, "position", "relative");
      mode = activateLinkHintsMode();
      markerEls = getHintMarkerEls();
      assertStartPosition(document.getElementsByTagName("a")[0], markerEls[0]);
      assertStartPosition(document.getElementsByTagName("a")[1], markerEls[1]);
      mode.deactivateMode();
    });
  });
};

createGeneralHintTests(false);
createGeneralHintTests(true);

context("False positives in link-hint", () => {
  setup(() => {
    const testContent = '<span class="buttonWrapper">false positive<a>clickable</a></span>' +
      '<span class="buttonWrapper">clickable</span>';
    document.getElementById("test-div").innerHTML = testContent;
    stubSettings("filterLinkHints", true);
    stubSettings("linkHintNumbers", "12");
    stub(globalThis, "windowIsFocused", () => true);
  });

  teardown(() => document.getElementById("test-div").innerHTML = "");

  should("handle false positives", () => {
    const mode = activateLinkHintsMode();
    mode.deactivateMode();
    assert.equal(["clickable", "clickable"], mode.hintMarkers.map((m) => m.linkText));
  });
});

context("jsaction matching", () => {
  let element;

  setup(() => {
    stubSettings("filterLinkHints", true);
    const testContent = '<p id="test-paragraph">clickable</p>';
    document.getElementById("test-div").innerHTML = testContent;
    element = document.getElementById("test-paragraph");
  });

  teardown(() => document.getElementById("test-div").innerHTML = "");

  should("select jsaction elements", () => {
    for (const text of ["click:namespace.actionName", "namespace.actionName"]) {
      element.setAttribute("jsaction", text);
      const mode = activateLinkHintsMode();
      mode.deactivateMode();
      assert.equal(1, mode.hintMarkers.length);
      assert.equal("clickable", mode.hintMarkers[0].linkText);
      assert.equal(element, mode.hintMarkers[0].localHint.element);
    }
  });

  should("not select inactive jsaction elements", () => {
    const attributes = [
      "mousedown:namespace.actionName",
      "click:namespace._",
      "none",
      "namespace:_",
    ];
    for (const attribute of attributes) {
      element.setAttribute("jsaction", attribute);
      const linkHints = activateLinkHintsMode();
      const hintMarkers = getHintMarkerEls().filter((marker) => marker.linkText !== "Frame.");
      linkHints.deactivateMode();
      assert.equal(0, hintMarkers.length);
    }
  });
});

context("link hints for image maps", () => {
  setup(() => {
    const testContent = '<img usemap="#the-map" style="width: 50px; height: 50px">' +
      '<map name="the-map">' +
      '<area shape="rect" coords="0,0,20,50" href="#">' +
      '<area shape="rect" coords="0,30,30,50" href="#">' +
      "</area>";
    document.getElementById("test-div").innerHTML = testContent;
  });

  teardown(() => document.getElementById("test-div").innerHTML = "");

  should("generate a hint for each area in the image map", () => {
    const mode = activateLinkHintsMode();
    const markerEls = getHintMarkerEls();
    assert.equal(2, markerEls.length);
    mode.deactivateMode();
  });
});

const sendKeyboardEvent = (key, type, extra) => {
  if (type == null) type = "keydown";
  if (extra == null) extra = {};
  handlerStack.bubbleEvent(
    type,
    Object.assign(extra, {
      type,
      key,
      preventDefault() {},
      stopImmediatePropagation() {},
    }),
  );
};

const sendKeyboardEvents = (keys) => {
  for (const key of keys.split("")) {
    sendKeyboardEvent(key);
  }
};

// TODO(philc): For some reason, this test corrupts the state linkhints state for other tests, in particular,
// the alphabet hints tests. I haven't yet dug into why.
// const inputs = [];
// context("Test link hints for focusing input elements correctly", () => {
//   let linkHintsMode;

//   setup(() => {
//     let input;
//     initializeModeState();
//     const testDiv = document.getElementById("test-div");
//     testDiv.innerHTML = "";

//     stubSettings("filterLinkHints", false);
//     stubSettings("linkHintCharacters", "ab");

//     // Every HTML5 input type except for hidden. We should be able to activate all of them with link hints.
//     // NOTE(philc): I'm not sure why, but "image" doesn't get a link hint in Puppeteer, so I've omitted it.
//     const inputTypes = ["button", "checkbox", "color", "date", "datetime", "datetime-local", "email", "file",
//       "month", "number", "password", "radio", "range", "reset", "search", "submit", "tel", "text",
//       "time", "url", "week"];

//     for (let type of inputTypes) {
//       input = document.createElement("input");
//       input.type = type;
//       testDiv.appendChild(input);
//       inputs.push(input);
//     }

//     // Manually add also a select element to test focus.
//     input = document.createElement("select");
//     testDiv.appendChild(input);
//     inputs.push(input);
//   });

//   teardown(() => {
//     document.getElementById("test-div").innerHTML = "";
//     // linkHintsMode.deactivateMode(); // TODO(philc): I don't think this should be necessary.
//   });

//   should("Focus each input when its hint text is typed", () => {
//     for (var input of inputs) {
//       input.scrollIntoView(); // Ensure the element is visible so we create a link hint for it.

//       const activeListener = ensureCalled(function(event) {
//         if (event.type === "focus") { return input.blur(); }
//       });
//       input.addEventListener("focus", activeListener, false);
//       input.addEventListener("click", activeListener, false);

//       linkHintsMode = activateLinkHintsMode();
//       const [hint] = getHintMarkerEls().
//             filter(hint => input === HintCoordinator.getLocalHint(hint.hintDescriptor).element);

//       for (let char of hint.hintString)
//         sendKeyboardEvent(char);
//       linkHintsMode.deactivateMode();

//       input.removeEventListener("focus", activeListener, false);
//       input.removeEventListener("click", activeListener, false);
//     }
//   });
// });

context("Test link hints for changing mode", () => {
  let linkHints;

  setup(() => {
    initializeModeState();
    const testDiv = document.getElementById("test-div");
    testDiv.innerHTML = "<a>link</a>";
    linkHints = activateLinkHintsMode();
  });

  teardown(() => {
    document.getElementById("test-div").innerHTML = "";
    linkHints.deactivateMode();
  });

  should("change mode on shift", () => {
    assert.equal("open-in-current-tab", linkHints.mode.name);
    sendKeyboardEvent("Shift", "keydown");
    assert.equal("open-in-new-background-tab", linkHints.mode.name);
    sendKeyboardEvent("Shift", "keyup");
    assert.equal("open-in-current-tab", linkHints.mode.name);
  });

  should("change mode on ctrl", () => {
    assert.equal("open-in-current-tab", linkHints.mode.name);
    sendKeyboardEvent("Control", "keydown");
    assert.equal("open-in-new-foreground-tab", linkHints.mode.name);
    sendKeyboardEvent("Control", "keyup");
    assert.equal("open-in-current-tab", linkHints.mode.name);
  });
});

const createLinks = function (n) {
  for (let i = 0, end = n; i < end; i++) {
    const link = document.createElement("a");
    link.textContent = "test";
    document.getElementById("test-div").appendChild(link);
  }
};

context("Alphabet link hints", () => {
  let mode;
  setup(() => {
    initializeModeState();
    stubSettings("filterLinkHints", false);
    stubSettings("linkHintCharacters", "ab");
    stub(globalThis, "windowIsFocused", () => true);

    document.getElementById("test-div").innerHTML = "";
    // Three hints will trigger double hint chars.
    createLinks(3);
    mode = activateLinkHintsMode();
  });

  teardown(() => {
    mode.deactivateMode();
    document.getElementById("test-div").innerHTML = "";
  });

  should("label the hints correctly", () => {
    assert.equal(
      ["aa", "b", "ab"],
      mode.hintMarkers.map((m) => m.hintString),
    );
  });

  should("narrow the hints", () => {
    sendKeyboardEvent("a");
    assert.equal(
      ["", "none", ""],
      mode.hintMarkers.map((m) => m.element.style.display),
    );
  });

  should("generate the correct number of alphabet hints", () => {
    const alphabetHints = new AlphabetHints();
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const hintStrings = alphabetHints.hintStrings(n);
      assert.equal(n, hintStrings.length);
    }
  });

  should("generate non-overlapping alphabet hints", () => {
    const alphabetHints = new AlphabetHints();
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const hintStrings = alphabetHints.hintStrings(n);
      for (const h1 of hintStrings) {
        for (const h2 of hintStrings) {
          if (h1 !== h2) {
            assert.isFalse(0 === h1.indexOf(h2));
          }
        }
      }
    }
  });
});

context("Filtered link hints", () => {
  // In all of these tests, the order of the elements returned by getHintMarkerEls() may be
  // different from the order they are listed in the test HTML content. This is because
  // LinkHints.activateMode() sorts the elements.

  let mode;

  setup(() => {
    stubSettings("filterLinkHints", true);
    stubSettings("linkHintNumbers", "0123456789");
    stub(globalThis, "windowIsFocused", () => true);
  });

  context("Text hints", () => {
    setup(() => {
      initializeModeState();
      const testContent = "<a>test</a><a>tress</a><a>trait</a><a>track<img alt='alt text'/></a>";
      document.getElementById("test-div").innerHTML = testContent;
      mode = activateLinkHintsMode();
    });

    teardown(() => {
      document.getElementById("test-div").innerHTML = "";
      mode.deactivateMode();
    });

    should("label the hints", () => {
      const hintMarkers = getHintMarkerEls();
      const expectedMarkers = [1, 2, 3, 4].map((m) => m.toString());
      const actualMarkers = [0, 1, 2, 3].map((i) => hintMarkers[i].textContent.toLowerCase());
      assert.equal(expectedMarkers.length, actualMarkers.length);
      for (const marker of expectedMarkers) {
        assert.isTrue(actualMarkers.includes(marker));
      }
    });

    should("narrow the hints", () => {
      sendKeyboardEvent("t");
      sendKeyboardEvent("r");
      assert.equal(
        ["none", "", "", ""],
        mode.hintMarkers.map((m) => m.element.style.display),
      );
      assert.equal("3", mode.hintMarkers[1].hintString);
      sendKeyboardEvent("a");
      assert.equal("1", mode.hintMarkers[3].hintString);
    });

    // This test is the same as above, but with an extra non-matching character. The effect should
    // be the same.
    should("narrow the hints and ignore typing mistakes", () => {
      sendKeyboardEvent("t");
      sendKeyboardEvent("r");
      sendKeyboardEvent("x");
      assert.equal(
        ["none", "", "", ""],
        mode.hintMarkers.map((m) => m.element.style.display),
      );
      assert.equal("3", mode.hintMarkers[1].hintString);
      sendKeyboardEvent("a");
      assert.equal("1", mode.hintMarkers[3].hintString);
    });
  });

  context("Image hints", () => {
    setup(() => {
      initializeModeState();
      const testContent = "<a><img alt='alt text' width='10px' height='10px'/></a>" +
        "<a><img alt='alt text' title='some title' width='10px' height='10px'/></a>" +
        "<a><img title='some title' width='10px' height='10px'/></a>" +
        "<a><img src='' width='320px' height='100px'/></a>";
      document.getElementById("test-div").innerHTML = testContent;
      mode = activateLinkHintsMode();
    });

    teardown(() => {
      document.getElementById("test-div").innerHTML = "";
      mode.deactivateMode();
    });

    should("label the images", () => {
      let hintMarkers = getHintMarkerEls().map((m) => m.textContent.toLowerCase());
      // We don't know the actual hint numbers which will be assigned, so we replace them with "N".
      hintMarkers = hintMarkers.map((str) => str.replace(/^[1-4]/, "N"));
      assert.equal(4, hintMarkers.length);
      assert.isTrue(hintMarkers.includes("N: alt text"));
      assert.isTrue(hintMarkers.includes("N: some title"));
      assert.isTrue(hintMarkers.includes("N: alt text"));
      assert.isTrue(hintMarkers.includes("N"));
    });
  });

  context("Input hints", () => {
    setup(() => {
      initializeModeState();
      const testContent =
        `<input type='text' value='some value'/><input type='password' value='some value'/> \
<textarea>some text</textarea><label for='test-input'/>a label</label> \
<input type='text' id='test-input' value='some value'/> \
<label for='test-input-2'/>a label: </label><input type='text' id='test-input-2' value='some value'/>`;
      document.getElementById("test-div").innerHTML = testContent;
      mode = activateLinkHintsMode();
    });

    teardown(() => {
      document.getElementById("test-div").innerHTML = "";
      mode.deactivateMode();
    });

    should("label the input elements", () => {
      let hintMarkers = getHintMarkerEls();
      hintMarkers = getHintMarkerEls().map((m) => m.textContent.toLowerCase());
      // We don't know the actual hint numbers which will be assigned, so we replace them with "N".
      hintMarkers = hintMarkers.map((str) => str.replace(/^[0-9]+/, "N"));
      assert.equal(5, hintMarkers.length);
      assert.isTrue(hintMarkers.includes("N"));
      assert.isTrue(hintMarkers.includes("N"));
      assert.isTrue(hintMarkers.includes("N: a label"));
      assert.isTrue(hintMarkers.includes("N: a label"));
      assert.isTrue(hintMarkers.includes("N"));
    });
  });

  context("Text hint scoring", () => {
    let getActiveHintMarker;

    setup(() => {
      initializeModeState();
      const testContent = [
        { id: 0, text: "the xboy stood on the xburning deck" }, // Noise.
        { id: 1, text: "the boy stood on the xburning deck" }, // Whole word (boy).
        { id: 2, text: "on the xboy stood the xburning deck" }, // Start of text (on).
        { id: 3, text: "the xboy stood on the xburning deck" }, // Noise.
        { id: 4, text: "the xboy stood on the xburning deck" }, // Noise.
        { id: 5, text: "the xboy stood on the xburning" }, // Shortest text..
        { id: 6, text: "the xboy stood on the burning xdeck" }, // Start of word (bu)
        { id: 7, text: "test abc one - longer" }, // For tab test - 2.
        { id: 8, text: "test abc one" }, // For tab test - 1.
        { id: 9, text: "test abc one - longer still" }, // For tab test - 3.
      ].map(({ id, text }) => `<a id=\"${id}\">${text}</a>`).join(" ");
      document.getElementById("test-div").innerHTML = testContent;
      mode = activateLinkHintsMode();

      getActiveHintMarker = () => {
        return HintCoordinator.getLocalHint(
          mode.markerMatcher.activeHintMarker.hintDescriptor,
        ).element.id;
      };
    });

    teardown(() => {
      document.getElementById("test-div").innerHTML = "";
      mode.deactivateMode();
    });

    should("score start-of-word matches highly", () => {
      sendKeyboardEvents("bu");
      assert.equal("6", getActiveHintMarker());
    });

    should("score start-of-text matches highly (br)", () => {
      sendKeyboardEvents("on");
      assert.equal("2", getActiveHintMarker());
    });

    should("score whole-word matches highly", () => {
      sendKeyboardEvents("boy");
      assert.equal("1", getActiveHintMarker());
    });

    should("score shorter texts more highly", () => {
      sendKeyboardEvents("stood");
      assert.equal("5", getActiveHintMarker());
    });

    should("use tab to select the active hint", () => {
      sendKeyboardEvents("abc");
      assert.equal("8", getActiveHintMarker());
      sendKeyboardEvent("Tab", "keydown");
      assert.equal("7", getActiveHintMarker());
      sendKeyboardEvent("Tab", "keydown");
      assert.equal("9", getActiveHintMarker());
    });
  });
});

context("Input focus", () => {
  setup(() => {
    initializeModeState();
    const testContent = `<input type='text' id='first'/><input style='display:none;' id='second'/> \
<input type='password' id='third' value='some value'/>`;
    document.getElementById("test-div").innerHTML = testContent;
  });

  teardown(() => document.getElementById("test-div").innerHTML = ""),
    should("focus the first element", () => {
      NormalModeCommands.focusInput(1);
      assert.equal("first", document.activeElement.id);
    });

  should("focus the nth element", () => {
    NormalModeCommands.focusInput(100);
    assert.equal("third", document.activeElement.id);
  });

  should("activate insert mode on the first element", () => {
    NormalModeCommands.focusInput(1);
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("activate insert mode on the first element", () => {
    NormalModeCommands.focusInput(100);
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("activate the most recently-selected input if the count is 1", () => {
    NormalModeCommands.focusInput(3);
    NormalModeCommands.focusInput(1);
    assert.equal("third", document.activeElement.id);
  });

  should("not trigger insert if there are no inputs", () => {
    document.getElementById("test-div").innerHTML = "";
    NormalModeCommands.focusInput(1);
    assert.isFalse(InsertMode.permanentInstance.isActive());
  });
});

// TODO: these find prev/next link tests could be refactored into unit tests which invoke a function
// which has a tighter contract than goNext(), since they test minor aspects of goNext()'s link
// matching behavior, and we don't need to construct external state many times over just to test
// that. i.e. these tests should look something like:
// assert.equal(findLink(html("<a href=...">))[0].href, "first")
// These could then move outside of the dom_tests file.
context("Find prev / next links", () => {
  setup(() => {
    initializeModeState();
    globalThis.location.hash = "";
  });

  should("find exact matches", () => {
    document.getElementById("test-div").innerHTML = `\
<a href='#first'>nextcorrupted</a>
<a href='#second'>next page</a>\
`;
    stubSettings("nextPatterns", "next");
    NormalModeCommands.goNext();
    assert.equal("#second", globalThis.location.hash);
  });

  should("match against non-word patterns", () => {
    document.getElementById("test-div").innerHTML = `\
<a href='#first'>&gt;&gt;</a>\
`;
    stubSettings("nextPatterns", ">>");
    NormalModeCommands.goNext();
    assert.equal("#first", globalThis.location.hash);
  });

  should("favor matches with fewer words", () => {
    document.getElementById("test-div").innerHTML = `\
<a href='#first'>lorem ipsum next</a>
<a href='#second'>next!</a>\
`;
    stubSettings("nextPatterns", "next");
    NormalModeCommands.goNext();
    assert.equal("#second", globalThis.location.hash);
  });

  should("find link relation in header", () => {
    document.getElementById("test-div").innerHTML = `\
<link rel='next' href='#first'>\
`;
    NormalModeCommands.goNext();
    assert.equal("#first", globalThis.location.hash);
  });

  should("favor link relation to text matching", () => {
    document.getElementById("test-div").innerHTML = `\
<link rel='next' href='#first'>
<a href='#second'>next</a>\
`;
    NormalModeCommands.goNext();
    assert.equal("#first", globalThis.location.hash);
  });

  should("match mixed case link relation", () => {
    document.getElementById("test-div").innerHTML = `\
<link rel='Next' href='#first'>\
`;
    NormalModeCommands.goNext();
    assert.equal("#first", globalThis.location.hash);
  });

  should("match against the title attribute", () => {
    document.getElementById("test-div").innerHTML = `\
<a title='Next page' href='#first'>unhelpful text</a>\
`;
    NormalModeCommands.goNext();
    assert.equal("#first", globalThis.location.hash);
  });

  should("match against the aria-label attribute", () => {
    document.getElementById("test-div").innerHTML = `\
<a aria-label='Next page' href='#first'>unhelpful text</a>\
`;
    NormalModeCommands.goNext();
    assert.equal("#first", globalThis.location.hash);
  });
});

context("Key mapping", () => {
  let normalMode, handlerCalled, handlerCalledCount;

  setup(() => {
    normalMode = initializeModeState();
    handlerCalled = false;
    handlerCalledCount = 0;
    normalMode.setCommandHandler(({ count }) => {
      handlerCalled = true;
      handlerCalledCount = count;
    });
  });

  should("recognize first mapped key", () => {
    assert.isTrue(normalMode.isMappedKey("m"));
  });

  should("recognize second mapped key", () => {
    assert.isFalse(normalMode.isMappedKey("p"));
    sendKeyboardEvent("z");
    assert.isTrue(normalMode.isMappedKey("p"));
  });

  should("recognize pass keys", () => {
    assert.isTrue(normalMode.isPassKey("p"));
  });

  should("not mis-recognize pass keys", () => {
    assert.isFalse(normalMode.isMappedKey("p"));
    sendKeyboardEvent("z");
    assert.isTrue(normalMode.isMappedKey("p"));
  });

  should("recognize initial count keys", () => {
    assert.isTrue(normalMode.isCountKey("1"));
    assert.isTrue(normalMode.isCountKey("9"));
  });

  should("not recognize '0' as initial count key", () => {
    assert.isFalse(normalMode.isCountKey("0"));
  });

  should("recognize subsequent count keys", () => {
    sendKeyboardEvent("1");
    assert.isTrue(normalMode.isCountKey("0"));
    assert.isTrue(normalMode.isCountKey("9"));
  });

  should("set and call command handler", () => {
    sendKeyboardEvent("m");
    assert.isTrue(handlerCalled);
  });

  should("not call command handler for pass keys", () => {
    sendKeyboardEvent("p");
    assert.isFalse(handlerCalled);
  });

  should("accept a count prefix with a single digit", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("m");
    assert.equal(2, handlerCalledCount);
  });

  should("accept a count prefix with multiple digits", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("0");
    sendKeyboardEvent("m");
    assert.equal(20, handlerCalledCount);
  });

  should("cancel a count prefix", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("z");
    sendKeyboardEvent("m");
    assert.equal(true, handlerCalled);
    assert.equal(null, handlerCalledCount);
  });

  should("accept a count prefix for multi-key command mappings", () => {
    sendKeyboardEvent("5");
    sendKeyboardEvent("z");
    sendKeyboardEvent("p");
    assert.equal(5, handlerCalledCount);
  });

  should("cancel a key prefix", () => {
    sendKeyboardEvent("z");
    assert.equal(false, handlerCalled);
    sendKeyboardEvent("m");
    assert.equal(true, handlerCalled);
  });

  should("cancel a count prefix after a prefix key", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("z");
    sendKeyboardEvent("m");
    assert.equal(null, handlerCalledCount);
  });

  should("cancel a prefix key on escape", () => {
    sendKeyboardEvent("z");
    sendKeyboardEvent("Escape", "keydown");
    sendKeyboardEvent("p");
    assert.equal(0, handlerCalledCount);
  });
});

context("Normal mode", () => {
  setup(() => initializeModeState());

  should("invoke commands for mapped keys", () => {
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });

  should("invoke commands for mapped keys with a mapped prefix", () => {
    sendKeyboardEvent("z");
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });

  should("invoke commands for mapped keys with an unmapped prefix", () => {
    sendKeyboardEvent("a");
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });

  should("not invoke commands for pass keys", () => {
    sendKeyboardEvent("p");
    assert.equal(null, commandName);
  });

  should("not invoke commands for pass keys with an unmapped prefix", () => {
    sendKeyboardEvent("a");
    sendKeyboardEvent("p");
    assert.equal(null, commandName);
  });

  should("invoke commands for pass keys with a count", () => {
    sendKeyboardEvent("1");
    sendKeyboardEvent("p");
    assert.equal("p", commandName);
  });

  should("invoke commands for pass keys with a key queue", () => {
    sendKeyboardEvent("z");
    sendKeyboardEvent("p");
    assert.equal("zp", commandName);
  });

  should("accept count prefixes of length 1", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("m");
    assert.equal(2, commandCount);
  });

  should("accept count prefixes of length 2", () => {
    sendKeyboardEvents("12");
    sendKeyboardEvent("m");
    assert.equal(12, commandCount);
  });

  should("get the correct count for mixed inputs (single key)", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("z");
    sendKeyboardEvent("m");
    assert.equal(null, commandCount);
  });

  should("get the correct count for mixed inputs (multi key)", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("z");
    sendKeyboardEvent("p");
    assert.equal(2, commandCount);
  });

  should("get the correct count for mixed inputs (multi key, duplicates)", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("z");
    sendKeyboardEvent("z");
    sendKeyboardEvent("p");
    assert.equal(null, commandCount);
  });

  should("get the correct count for mixed inputs (with leading mapped keys)", () => {
    sendKeyboardEvent("z");
    sendKeyboardEvent("2");
    sendKeyboardEvent("m");
    assert.equal(2, commandCount);
  });

  should("get the correct count for mixed inputs (with leading unmapped keys)", () => {
    sendKeyboardEvent("a");
    sendKeyboardEvent("2");
    sendKeyboardEvent("m");
    assert.equal(2, commandCount);
  });

  should("not get a count after unmapped keys", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("a");
    sendKeyboardEvent("m");
    assert.equal(null, commandCount);
  });

  should("get the correct count after unmapped keys", () => {
    sendKeyboardEvent("2");
    sendKeyboardEvent("a");
    sendKeyboardEvent("3");
    sendKeyboardEvent("m");
    assert.equal(3, commandCount);
  });

  should("not handle unmapped keys", () => {
    sendKeyboardEvent("u");
    assert.equal(null, commandCount);
  });
});

context("Insert mode", () => {
  let insertMode;

  setup(() => {
    initializeModeState();
    insertMode = new InsertMode({ global: true });
  });

  should("exit on escape", () => {
    assert.isTrue(insertMode.modeIsActive);
    sendKeyboardEvent("Escape", "keydown");
    assert.isFalse(insertMode.modeIsActive);
  });

  should("resume normal mode after leaving insert mode", () => {
    assert.equal(null, commandName);
    insertMode.exit();
    sendKeyboardEvent("m");
    assert.equal("m", commandName);
  });
});

context("Triggering insert mode", () => {
  setup(() => {
    initializeModeState();

    const testContent = `<input type='text' id='first'/> \
<input style='display:none;' id='second'/> \
<input type='password' id='third' value='some value'/> \
<p id='fourth' contenteditable='true'/> \
<p id='fifth'/>`;
    document.getElementById("test-div").innerHTML = testContent;
  });

  teardown(() => {
    if (document.activeElement != null) {
      document.activeElement.blur();
    }
    document.getElementById("test-div").innerHTML = "";
  });

  should("trigger insert mode on focus of text input", () => {
    assert.isFalse(InsertMode.permanentInstance.isActive());
    document.getElementById("first").focus();
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("trigger insert mode on focus of password input", () => {
    assert.isFalse(InsertMode.permanentInstance.isActive());
    document.getElementById("third").focus();
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("trigger insert mode on focus of contentEditable elements", () => {
    assert.isFalse(InsertMode.permanentInstance.isActive());
    document.getElementById("fourth").focus();
    assert.isTrue(InsertMode.permanentInstance.isActive());
  });

  should("not trigger insert mode on other elements", () => {
    assert.isFalse(InsertMode.permanentInstance.isActive());
    document.getElementById("fifth").focus();
    assert.isFalse(InsertMode.permanentInstance.isActive());
  });
});

// NOTE(philc): I'm disabling the caret and visual mode tests because I think they're fallen into
// disrepair, or we merged changes to master and neglected to update the tests. We should return to
// these and fix+re-enable them.

// context("Caret mode",
//   setup(() => {
//     document.getElementById("test-div").innerHTML = `\
// <p><pre>
//   It is an ancient Mariner,
//   And he stoppeth one of three.
//   By thy long grey beard and glittering eye,
//   Now wherefore stopp'st thou me?
// </pre></p>\
// `;
//     initializeModeState();
//     this.initialVisualMode = new VisualMode;
//   });

//   teardown(() => document.getElementById("test-div").innerHTML = ""),

//   should("enter caret mode", () => {
//     assert.isFalse(this.initialVisualMode.modeIsActive);
//     assert.equal("I", getSelection());
//   });

//   should("exit caret mode on escape", () => {
//     sendKeyboardEvent("Escape", "keydown");
//     assert.equal("", getSelection());
//   });

//   should("move caret with l and h", () => {
//     assert.equal("I", getSelection());
//     sendKeyboardEvent("l");
//     assert.equal("t", getSelection());
//     sendKeyboardEvent("h");
//     assert.equal("I", getSelection());
//   });

//   should("move caret with w and b", () => {
//     assert.equal("I", getSelection());
//     sendKeyboardEvent("w");
//     assert.equal("i", getSelection());
//     sendKeyboardEvent("b");
//     assert.equal("I", getSelection());
//   });

//   should("move caret with e", () => {
//     assert.equal("I", getSelection());
//     sendKeyboardEvent("e");
//     assert.equal(" ", getSelection());
//     sendKeyboardEvent("e");
//     assert.equal(" ", getSelection());
//   });

//   should("move caret with j and k", () => {
//     assert.equal("I", getSelection());
//     sendKeyboardEvent("j");
//     assert.equal("A", getSelection());
//     sendKeyboardEvent("k");
//     assert.equal("I", getSelection());
//   });

//   should("re-use an existing selection", () => {
//     assert.equal("I", getSelection());
//     sendKeyboardEvents("ww");
//     assert.equal("a", getSelection());
//     sendKeyboardEvent("Escape", "keydown");
//     new VisualMode;
//     assert.equal("a", getSelection());
//   });

//   should("not move the selection on caret/visual mode toggle", () => {
//     sendKeyboardEvents("ww");
//     assert.equal("a", getSelection());
//     for (let key of "vcvcvc".split()) {
//       sendKeyboardEvent(key);
//       assert.equal("a", getSelection());
//     }
//   })
// );

// // TODO(philc): Re-enable
// context("Visual mode",
//   setup(() => {
//     document.getElementById("test-div").innerHTML = `\
// <p><pre>
//   It is an ancient Mariner,
//   And he stoppeth one of three.
//   By thy long grey beard and glittering eye,
//   Now wherefore stopp'st thou me?
// </pre></p>\
// `;
//     initializeModeState();
//     this.initialVisualMode = new VisualMode;
//     sendKeyboardEvent("w");
//     sendKeyboardEvent("w");
//     // We should now be at the "a" of "an".
//     sendKeyboardEvent("v");
//   });

//   teardown(() => document.getElementById("test-div").innerHTML = ""),

//   should("select word with e", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvent("e");
//     assert.equal("an", getSelection());
//     sendKeyboardEvent("e");
//     assert.equal("an ancient", getSelection());
//   });

//   should("select opposite end of the selection with o", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvent("e");
//     assert.equal("an", getSelection());
//     sendKeyboardEvent("e");
//     assert.equal("an ancient", getSelection());
//     sendKeyboardEvents("ow");
//     assert.equal("ancient", getSelection());
//     sendKeyboardEvents("oe");
//     assert.equal("ancient Mariner", getSelection());
//   });

//   should("accept a count", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("2e");
//     assert.equal("an ancient", getSelection());
//   });

//   should("select a word", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("aw");
//     assert.equal("an", getSelection());
//   });

//   should("select a word with a count", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("2aw");
//     assert.equal("an ancient", getSelection());
//   });

//   should("select a word with a count", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("2aw");
//     assert.equal("an ancient", getSelection());
//   });

//   should("select to start of line", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("0");
//     assert.equal("It is", getSelection().trim());
//   });

//   should("select to end of line", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("$");
//     assert.equal("an ancient Mariner,", getSelection());
//   });

//   should("re-enter caret mode", () => {
//     assert.equal("a", getSelection());
//     sendKeyboardEvents("cww");
//     assert.equal("M", getSelection());
//   })
// );

const createMode = (options) => {
  const mode = new Mode();
  mode.init(options);
  return mode;
};

context("Mode utilities", () => {
  setup(() => {
    initializeModeState();

    const testContent = `<input type='text' id='first'/> \
<input style='display:none;' id='second'/> \
<input type='password' id='third' value='some value'/>`;
    document.getElementById("test-div").innerHTML = testContent;
  });

  teardown(() => document.getElementById("test-div").innerHTML = "");

  should("not have duplicate singletons", () => {
    let mode;
    let count = 0;
    class Test extends Mode {
      constructor() {
        count += 1;
        super();
        super.init({ singleton: "test" });
      }
      exit() {
        count -= 1;
        return super.exit();
      }
    }
    assert.isTrue(count === 0);
    for (let i = 1; i <= 10; i++) {
      mode = new Test();
      assert.isTrue(count === 1);
    }
    mode.exit();
    assert.isTrue(count === 0);
  });

  should("exit on escape", () => {
    const test = createMode({ exitOnEscape: true });
    assert.isTrue(test.modeIsActive);
    sendKeyboardEvent("Escape", "keydown");
    assert.isFalse(test.modeIsActive);
  });

  should("not exit on escape if not enabled", () => {
    const test = createMode({ exitOnEscape: false });
    assert.isTrue(test.modeIsActive);
    sendKeyboardEvent("Escape", "keydown");
    assert.isTrue(test.modeIsActive);
  });

  should("exit on blur", () => {
    const element = document.getElementById("first");
    element.focus();
    const test = createMode({ exitOnBlur: element });
    assert.isTrue(test.modeIsActive);
    element.blur();
    assert.isFalse(test.modeIsActive);
  });

  should("not exit on blur if not enabled", () => {
    const element = document.getElementById("first");
    element.focus();
    const test = createMode({ exitOnBlur: false });
    assert.isTrue(test.modeIsActive);
    element.blur();
    assert.isTrue(test.modeIsActive);
  });
});

context("PostFindMode", () => {
  let postFindMode;

  setup(() => {
    initializeModeState();
    const testContent = "<input type='text' id='first'/>";
    document.getElementById("test-div").innerHTML = testContent;
    document.getElementById("first").focus();
    postFindMode = new PostFindMode();
  });

  teardown(() => document.getElementById("test-div").innerHTML = ""),
    should("be a singleton", () => {
      assert.isTrue(postFindMode.modeIsActive);
      new PostFindMode();
      assert.isFalse(postFindMode.modeIsActive);
    });

  should("suppress unmapped printable keys", () => {
    sendKeyboardEvent("a");
    assert.equal(null, commandCount);
  });

  should("be deactivated on click events", () => {
    handlerStack.bubbleEvent("click", { target: document.activeElement });
    assert.isFalse(postFindMode.modeIsActive);
  });

  should("enter insert mode on immediate escape", () => {
    sendKeyboardEvent("Escape", "keydown");
    assert.equal(null, commandCount);
    assert.isFalse(postFindMode.modeIsActive);
  });

  should("not enter insert mode on subsequent escapes", () => {
    sendKeyboardEvent("a");
    sendKeyboardEvent("Escape", "keydown");
    assert.isTrue(postFindMode.modeIsActive);
  });
});

context("LinkHintsMode confirmation", () => {
  let exitIsSuccess;

  setup(() => {
    initializeModeState();
    document.getElementById("test-div").innerHTML = "<a>test</a><a>tress</a>";
    stubSettings("filterLinkHints", true);
    stub(globalThis, "windowIsFocused", () => true);
    exitIsSuccess = "not called";
    HintCoordinator.onExit = [(isSuccess) => exitIsSuccess = isSuccess];
  });

  teardown(() => {
    if (HintCoordinator.linkHintsMode != null) {
      HintCoordinator.exit({ isSuccess: false });
    }
    document.getElementById("test-div").innerHTML = "";
  });

  context("waitForEnterForFilteredHints", () => {
    let mode;

    setup(() => {
      stubSettings("waitForEnterForFilteredHints", true);
      mode = activateLinkHintsMode();
      sendKeyboardEvent("t");
      sendKeyboardEvent("e"); // Uniquely matches "test"; "tress" doesn't start with "te".
    });

    should("show the confirmation indicator, not the regular mode indicator", () => {
      assert.equal("Hit <Enter> to proceed...", mode.hintMode.options.indicator);
    });

    should("confirm successfully on Enter", () => {
      sendKeyboardEvent("Enter", "keydown");
      assert.equal(true, exitIsSuccess);
    });

    should("cancel on Escape", () => {
      sendKeyboardEvent("Escape", "keydown");
      assert.equal(false, exitIsSuccess);
    });

    should("not exit on other keyboard events", () => {
      sendKeyboardEvents("xyz");
      assert.equal("not called", exitIsSuccess);
    });
  });

  context("timeout variant (waitForEnterForFilteredHints off)", () => {
    setup(() => {
      stubSettings("waitForEnterForFilteredHints", false);
      // Fire the confirmation delay immediately, rather than waiting on a real 200ms timer.
      stub(Utils, "setTimeout", (_delay, fn) => fn());
      activateLinkHintsMode();
    });

    should("confirm successfully once the user stops typing", () => {
      sendKeyboardEvent("t");
      sendKeyboardEvent("e"); // Uniquely matches "test"; the (stubbed, immediate) timer then fires.
      assert.equal(true, exitIsSuccess);
    });
  });
});

context("GrabBackFocus", () => {
  setup(() => {
    const testContent = "<input type='text' value='some value' id='input'/>";
    document.getElementById("test-div").innerHTML = testContent;
    stubSettings("grabBackFocus", true);
  });

  teardown(() => document.getElementById("test-div").innerHTML = ""),
    should("blur an already focused input", () => {
      document.getElementById("input").focus();
      assert.isTrue(document.activeElement);
      assert.isTrue(DomUtils.isEditable(document.activeElement));
      initializeModeState();
      assert.isTrue(document.activeElement);
      assert.isFalse(DomUtils.isEditable(document.activeElement));
    });

  should("blur a newly focused input", () => {
    initializeModeState();
    document.getElementById("input").focus();
    assert.isTrue(document.activeElement);
    assert.isFalse(DomUtils.isEditable(document.activeElement));
  });

  should("exit on a key event", () => {
    initializeModeState();
    sendKeyboardEvent("a");
    document.getElementById("input").focus();
    assert.isTrue(document.activeElement);
    assert.isTrue(DomUtils.isEditable(document.activeElement));
  });

  should("exit on a mousedown event", () => {
    initializeModeState();
    handlerStack.bubbleEvent("mousedown", { target: document.body });
    document.getElementById("input").focus();
    assert.isTrue(document.activeElement);
    assert.isTrue(DomUtils.isEditable(document.activeElement));
  });
});

context("Revealing media controls", () => {
  let player, mouseEvents;

  setup(() => {
    initializeModeState();
    stub(globalThis, "windowIsFocused", () => true);
    stubSettings("revealMediaControls", true);
    stub(MediaControls, "isVideoInUse", () => true);
    document.getElementById("test-div").innerHTML = `
      <div id="player" style="position: relative; width: 400px; height: 200px">
        <video style="width: 400px; height: 200px; display: block"></video>
        <div id="overlay" style="position: absolute; inset: 0"></div>
        <button id="play" style="position: absolute; left: 0; bottom: 0">Play</button>
      </div>`;
    player = document.getElementById("player");
    mouseEvents = [];
    for (const type of ["mouseover", "mouseenter", "mousemove", "pointermove"]) {
      player.addEventListener(type, (event) => mouseEvents.push(event));
    }
  });

  teardown(() => {
    HintCoordinator.exit({ isSuccess: false });
    document.getElementById("test-div").innerHTML = "";
  });

  should("move the mouse over the center of an active video when hints are activated", () => {
    activateLinkHintsMode();
    const types = mouseEvents.map((e) => e.type);
    assert.isTrue(types.includes("mouseover"));
    assert.isTrue(types.includes("mouseenter"));
    assert.isTrue(types.includes("pointermove"));
    const move = mouseEvents.find((e) => e.type === "mousemove");
    assert.equal(document.getElementById("overlay"), move.target);
    const rect = player.getBoundingClientRect();
    assert.equal(rect.left + rect.width / 2, move.clientX);
    assert.equal(rect.top + rect.height / 2, move.clientY);
  });

  should("keep the controls shown until hints exit", () => {
    activateLinkHintsMode();
    assert.isTrue(MediaControls.isKeepAliveRunning());
    HintCoordinator.exit({ isSuccess: false });
    assert.isFalse(MediaControls.isKeepAliveRunning());
  });

  should("skip videos which aren't in use", () => {
    stub(MediaControls, "isVideoInUse", () => false);
    activateLinkHintsMode();
    assert.equal(0, mouseEvents.length);
    assert.isFalse(MediaControls.isKeepAliveRunning());
  });

  should("skip videos which are too small to be a player", () => {
    player.querySelector("video").style.height = "50px";
    player.style.height = "50px";
    activateLinkHintsMode();
    assert.equal(0, mouseEvents.length);
  });

  should("do nothing when the setting is off", () => {
    stubSettings("revealMediaControls", false);
    activateLinkHintsMode();
    assert.equal(0, mouseEvents.length);
  });
});

context("Scroll areas", () => {
  const filler = (width, height) => `<div style="width: ${width}px; height: ${height}px"></div>`;

  setup(() => {
    initializeModeState();
    stub(globalThis, "windowIsFocused", () => true);
    stubSettings("filterLinkHints", false);
    stubSettings("linkHintCharacters", "ab");
    Scroller.reset();
    document.getElementById("test-div").innerHTML = `
      <div id="sidebar" style="width: 150px; height: 100px; overflow-y: auto">${
      filler(100, 500)
    }</div>
      <div id="main" style="width: 300px; height: 100px; overflow: auto">${filler(100, 500)}</div>
      <pre id="code" style="width: 200px; height: 60px; overflow-x: auto">${"x".repeat(500)}</pre>
      <div id="hidden" style="width: 200px; height: 100px; overflow: hidden">${
      filler(100, 500)
    }</div>
      <div id="short" style="width: 200px; height: 100px; overflow: auto">${filler(100, 50)}</div>
      <div id="tiny" style="width: 20px; height: 20px; overflow: auto">${filler(10, 500)}</div>`;
  });

  teardown(() => {
    HintCoordinator.exit({ isSuccess: false });
    Scroller.reset();
    document.getElementById("test-div").innerHTML = "";
  });

  const getElementAreas = () => Scroller.getScrollAreas().filter((area) => !area.isPage);

  should("find visible areas which scroll, with their axes", () => {
    const areas = getElementAreas();
    assert.equal(["sidebar", "main", "code"], areas.map((area) => area.element.id));
    assert.equal(["y", "y", "x"], areas.map((area) => area.axes));
  });

  should("mark the activated element as active", () => {
    Scroller.setActivatedElement(document.getElementById("main"));
    const areas = getElementAreas();
    assert.equal([false, true, false], areas.map((area) => area.isActive));
  });

  should("forget the activated element once it's removed from the page", () => {
    stubSettings("smoothScroll", false);
    const main = document.getElementById("main");
    Scroller.setActivatedElement(main);
    main.remove();
    Scroller.scrollBy("y", 1);
    assert.isFalse(Scroller.getActivatedElement() === main);
  });

  should("make the selected area the scroll target", () => {
    stubSettings("smoothScroll", false);
    const modeIndex = availableModes.findIndex((m) => m.name === "select-scroll-area");
    HintCoordinator.getHintDescriptors({ modeIndex }, {});
    HintCoordinator.activateMode({
      frameIdToHintDescriptors: {},
      modeIndex,
      originatingFrameId: frameId,
    });
    const mode = HintCoordinator.linkHintsMode;
    const main = document.getElementById("main");
    const marker = mode.hintMarkers.find((m) => m.localHint.element === main);
    assert.isTrue(marker != null);
    // Each hint has an outline around its area.
    assert.equal(
      mode.hintMarkers.length,
      document.querySelectorAll(".vimium-area-outline").length,
    );
    sendKeyboardEvents(marker.hintString);
    assert.equal(main, Scroller.getActivatedElement());
    Scroller.scrollBy("y", 20);
    assert.equal(20, main.scrollTop);
  });

  should("cycle through the areas", () => {
    const ids = () => Scroller.getActivatedElement().id || "page";
    Scroller.setActivatedElement(document.getElementById("sidebar"));
    Scroller.selectAdjacentScrollArea(1);
    assert.equal("main", ids());
    Scroller.selectAdjacentScrollArea(1);
    assert.equal("code", ids());
    Scroller.selectAdjacentScrollArea(-2);
    assert.equal("sidebar", ids());
  });
});

context("Adjusting sliders", () => {
  const modeName = "adjust-slider";
  let events;

  const activateSliderHints = () => {
    const modeIndex = availableModes.findIndex((m) => m.name === modeName);
    HintCoordinator.getHintDescriptors({ modeIndex }, {});
    HintCoordinator.activateMode({
      frameIdToHintDescriptors: {},
      modeIndex,
      originatingFrameId: frameId,
    });
    return HintCoordinator.linkHintsMode;
  };

  // Selects the hint for `element`, and returns the SliderMode which that starts.
  const selectHintFor = async (element) => {
    const mode = activateSliderHints();
    const marker = mode.hintMarkers.find((m) => m.localHint.element === element);
    assert.isTrue(marker != null);
    sendKeyboardEvents(marker.hintString);
    // SliderMode.activate waits for an animation frame when revealing a slider.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return Mode.modes.find((m) => m.name === "slider-mode");
  };

  // Sends a keydown, and waits for the slider mode's queued operations to finish.
  const pressKey = async (sliderMode, key, extra) => {
    sendKeyboardEvent(key, "keydown", Object.assign({ code: `Key${key}` }, extra));
    await sliderMode.pending;
  };

  // An ARIA slider which changes by 10 on arrow keys, and optionally sets its value from the
  // position of a mousedown.
  const makeAriaSlider = (slider, { handlesKeys, handlesMouse }) => {
    const setValue = (value) => {
      slider.setAttribute("aria-valuenow", String(Math.max(0, Math.min(100, value))));
    };
    if (handlesKeys) {
      slider.addEventListener("keydown", (event) => {
        const now = parseFloat(slider.getAttribute("aria-valuenow"));
        if (event.key === "ArrowRight") setValue(now + 10);
        if (event.key === "ArrowLeft") setValue(now - 10);
      });
    }
    if (handlesMouse) {
      slider.addEventListener("mousedown", (event) => {
        const rect = slider.getBoundingClientRect();
        setValue(Math.round(((event.clientX - rect.left) / rect.width) * 100));
      });
    }
  };

  setup(() => {
    initializeModeState();
    stub(globalThis, "windowIsFocused", () => true);
    stubSettings("filterLinkHints", false);
    stubSettings("linkHintCharacters", "ab");
    events = [];
    document.getElementById("test-div").innerHTML = `
      <input id="range" type="range" min="0" max="200" value="100" style="width: 200px" />
      <div id="keys-slider" role="slider" tabindex="0" aria-label="Keys"
        aria-valuenow="50" aria-valuemin="0" aria-valuemax="100"
        style="width: 200px; height: 20px; background: #ccc"></div>
      <div id="mouse-slider" role="slider" aria-valuenow="50"
        style="width: 200px; height: 20px; background: #aaa"></div>
      <div id="volume-area">
        <button id="mute">Mute</button>
        <div id="volume-panel" style="display: inline-block; width: 0; overflow: hidden">
          <div id="volume" role="slider" tabindex="0" aria-label="Volume"
            aria-valuenow="50" aria-valuemin="0" aria-valuemax="100"
            style="width: 100px; height: 20px"></div>
        </div>
      </div>`;
    const range = document.getElementById("range");
    range.addEventListener("input", () => events.push("input"));
    range.addEventListener("change", () => events.push("change"));
    makeAriaSlider(document.getElementById("keys-slider"), { handlesKeys: true });
    makeAriaSlider(document.getElementById("mouse-slider"), { handlesMouse: true });
    const volume = document.getElementById("volume");
    makeAriaSlider(volume, { handlesKeys: true });
    document.getElementById("volume-area").addEventListener("mouseenter", () => {
      document.getElementById("volume-panel").style.width = "100px";
    });
    document.getElementById("volume-area").addEventListener("mouseleave", () => {
      document.getElementById("volume-panel").style.width = "0";
    });
  });

  teardown(() => {
    for (const mode of Mode.modes.filter((m) => m.name === "slider-mode")) mode.exit();
    HintCoordinator.exit({ isSuccess: false });
    // Selecting a hint flashes its element for a while, which would cover it in the next test. We
    // hide the flash rather than remove it, because LinkHintsMode removes it itself later.
    for (const el of document.querySelectorAll(".vimium-flash")) el.style.display = "none";
    document.getElementById("test-div").innerHTML = "";
  });

  should("offer visible sliders, and buttons which reveal hidden sliders", () => {
    const mode = activateSliderHints();
    const ids = mode.hintMarkers.map((m) => m.localHint.element.id);
    assert.equal(["range", "keys-slider", "mouse-slider", "mute"], ids);
    const muteHint = mode.hintMarkers[3].localHint;
    assert.equal(document.getElementById("volume"), muteHint.adjustTarget);
  });

  should("change a native range input by 5% steps, and jump with digits", async () => {
    const range = document.getElementById("range");
    const sliderMode = await selectHintFor(range);
    await pressKey(sliderMode, "l");
    assert.equal("110", range.value);
    await pressKey(sliderMode, "h");
    await pressKey(sliderMode, "h");
    assert.equal("90", range.value);
    await pressKey(sliderMode, "L", { shiftKey: true });
    assert.equal("140", range.value);
    await pressKey(sliderMode, "3", { code: "Digit3" });
    assert.equal("60", range.value);
    await pressKey(sliderMode, "$", { code: "Digit4", shiftKey: true });
    assert.equal("200", range.value);
    assert.isTrue(events.includes("input"));
    assert.isTrue(events.includes("change"));
  });

  should("change an ARIA slider with synthetic arrow keys", async () => {
    const slider = document.getElementById("keys-slider");
    const sliderMode = await selectHintFor(slider);
    assert.equal(slider, document.activeElement);
    await pressKey(sliderMode, "l");
    assert.equal("60", slider.getAttribute("aria-valuenow"));
    await pressKey(sliderMode, "L", { shiftKey: true });
    // 5 steps of 5% is 25, which rounds to 3 key presses of 10.
    assert.equal("90", slider.getAttribute("aria-valuenow"));
    sliderMode.exit();
    assert.isFalse(slider === document.activeElement);
  });

  should("fall back to clicking an ARIA slider which ignores keys", async () => {
    const slider = document.getElementById("mouse-slider");
    const sliderMode = await selectHintFor(slider);
    await pressKey(sliderMode, "l");
    assert.equal("55", slider.getAttribute("aria-valuenow"));
    await pressKey(sliderMode, "2", { code: "Digit2" });
    assert.equal("20", slider.getAttribute("aria-valuenow"));
  });

  should("leave a slider alone when it's already at the requested value", async () => {
    const slider = document.getElementById("keys-slider");
    slider.setAttribute("aria-valuenow", "100");
    let mouseDowns = 0;
    slider.addEventListener("mousedown", () => mouseDowns++);
    const sliderMode = await selectHintFor(slider);
    await pressKey(sliderMode, "$", { code: "Digit4", shiftKey: true });
    await pressKey(sliderMode, "l");
    assert.equal("100", slider.getAttribute("aria-valuenow"));
    assert.equal(0, mouseDowns);
  });

  should("reveal a hidden slider by hovering its button, and adjust the slider", async () => {
    const volume = document.getElementById("volume");
    const panel = document.getElementById("volume-panel");
    const sliderMode = await selectHintFor(document.getElementById("mute"));
    assert.equal("100px", panel.style.width);
    await pressKey(sliderMode, "j");
    assert.equal("40", volume.getAttribute("aria-valuenow"));
    sliderMode.exit();
    assert.equal("0px", panel.style.width);
  });

  should("exit on other keys, and pass them on to normal mode", async () => {
    const range = document.getElementById("range");
    const sliderMode = await selectHintFor(range);
    sendKeyboardEvent("m");
    assert.isFalse(sliderMode.modeIsActive);
    assert.equal("m", commandName);
    assert.equal("100", range.value);
  });

  should("not exit on modifier keys", async () => {
    const sliderMode = await selectHintFor(document.getElementById("range"));
    sendKeyboardEvent("Shift");
    assert.isTrue(sliderMode.modeIsActive);
  });
});
