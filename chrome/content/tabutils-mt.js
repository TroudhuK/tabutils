//Multi-row tabs
tabutils._multirowTabs = function() {
  gBrowser.mTabContainer.enterBlockMode = function enterBlockMode() {
    if (this.orient == "horizontal" && this.getAttribute("overflow") == "true" && this.getAttribute("showAllTabs") == "true") {
      this.mTabstrip._lineHeight = this.mTabstrip.boxObject.height;
      this.setAttribute("multirow", true);
      this._revertTabSizing();

      let evt = document.createEvent("UIEvent");
      evt.initUIEvent("underflow", true, false, window, 1);
      this.mTabstrip._scrollbox.dispatchEvent(evt);
    }
  };

  gBrowser.mTabContainer.exitBlockMode = function exitBlockMode() {
    if (!this.hasAttribute("multirow"))
      return;

    if (this.orient == "horizontal" &&
        this.getAttribute("showAllTabs") == "true" &&
        (this.getAttribute("overflow") == "true" || this.mTabstrip.boxObject.height / this.mTabstrip._lineHeight > 1.35))
      return;

    this.removeAttribute("multirow");
    this.stylePinnedTabs();
  };

  tabutils.addEventListener(gBrowser.mTabContainer, "overflow", function(event) {
    if (event.target.tagName == "tab") {
      event.stopPropagation();
      return;
    }
    this.enterBlockMode();
  }, false);

  tabutils.addEventListener(gBrowser.mTabContainer, "TabClose", function(event) {
    setTimeout(function() {
      this.exitBlockMode();
    }.bind(this), 250);
  }, false);

  tabutils.addEventListener(window, "resize", function(event) {
    gBrowser.mTabContainer.exitBlockMode();
    if (window.fullScreen && FullScreen._isChromeCollapsed)
      gNavToolbox.style.marginTop = -gNavToolbox.getBoundingClientRect().height + "px";
  }, false);

  TU_hookCode("gBrowser.mTabContainer._getDropIndex",
    [/event.screenX.*width \/ 2/g, function(s) s + " && " + s.replace(/screenX/g, "screenY").replace("width / 2", "height")
                                                 + " || " + s.replace(/screenX/g, "screenY").replace("width / 2", "height * 0")]
  );

  tabutils.addEventListener(gBrowser.mTabContainer, "dragover", function(event) {
    var ind = this._tabDropIndicator.parentNode;
    if (!this.hasAttribute("multirow")) {
      ind.style.position = "";
      return;
    }
    ind.style.position = "fixed";
    ind.style.zIndex = 100;

    var newIndex = this._getDropIndex(event);
    var tab = this.childNodes[newIndex < this.childNodes.length ? newIndex : newIndex - 1];
    var ltr = getComputedStyle(this).direction == "ltr";
    var [start, end] = ltr ? ["left", "right"] : ["right", "left"];
    var startPos = this.getBoundingClientRect()[start];
    if (tab.boxObject.screenY > event.screenY && newIndex > 0) {
      tab = this.childNodes[newIndex - 1];
      startPos += tab.getBoundingClientRect()[end] - this.mTabstrip._scrollbox.getBoundingClientRect()[start];
    }
    ind.style[start] = startPos - ind.clientWidth / 2 * (ltr ? 1 : -1) + "px";

    ind.style.top = tab.getBoundingClientRect().top + "px";
    ind.style.lineHeight = tab.getBoundingClientRect().height + "px";
    ind.firstChild.style.verticalAlign = "bottom";
    
    ////////// copy/paste to enable tabDropIndicator at move without animation
    var effects = this._getDropEffectForTabDrag(event);

    var ind = this._tabDropIndicator;
    if (effects == "" || effects == "none") {
      ind.collapsed = true;
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    var tabStrip = this.mTabstrip;
    var ltr = (window.getComputedStyle(this, null).direction == "ltr");

    if (effects == "move" &&
        this == event.dataTransfer.mozGetDataAt(TAB_DROP_TYPE, 0).parentNode &&
        !TU_getPref("extensions.tabutils.disableTabMoveAnimation", true)) {
      ind.collapsed = true;
      this._animateTabMove(event);
      return;
    }

    this._finishAnimateTabMove();

    if (effects == "link") {
      let tab = this._getDragTargetTab(event, true);
      if (tab) {
        if (!this._dragTime)
          this._dragTime = Date.now();
        if (Date.now() >= this._dragTime + this._dragOverDelay)
          this.selectedItem = tab;
        ind.collapsed = true;
        return;
      }
    }

    var rect = tabStrip.getBoundingClientRect();
    var newMargin;
    {
      let newIndex = this._getDropIndex(event, effects == "link");
      if (newIndex == this.childNodes.length) {
        let tabRect = this.childNodes[newIndex-1].getBoundingClientRect();
        if (ltr)
          newMargin = tabRect.right - rect.left;
        else
          newMargin = rect.right - tabRect.left;
      }
      else {
        let tabRect = this.childNodes[newIndex].getBoundingClientRect();
        if (ltr)
          newMargin = tabRect.left - rect.left;
        else
          newMargin = rect.right - tabRect.right;
      }
    }

    ind.collapsed = false;

    newMargin += ind.clientWidth / 2;
    if (!ltr)
      newMargin *= -1;

    ind.style.transform = "translate(" + Math.round(newMargin) + "px)";
    ind.style.marginInlineStart = (-ind.clientWidth) + "px";
  }, true);

  TU_hookCode("gBrowser.mTabContainer._animateTabMove", "{", function() {
    if (TU_getPref("extensions.tabutils.disableTabMoveAnimation", true)) {
      TU_hookFunc(arguments.callee.caller.toString().match(/^.*{|var (ind|tabStrip|ltr).*|var pixelsToScroll[\s\S]*$/g).join("\n"),
        [/.*scrollByPixels.*/, ";"],
        [/.*effects == "move"[\s\S]*?(?=var (newIndex|scrollRect|rect))/, ""] // needs fix
      ).apply(this, arguments);
      return;
    }
    else {
      let draggedTab = event.dataTransfer.mozGetDataAt(TAB_DROP_TYPE, 0);

      if (this.getAttribute("movingtab") != "true") {
        this.setAttribute("movingtab", "true");
        this.selectedItem = draggedTab;
      }

      if (!("animLastScreenX" in draggedTab._dragData))
        draggedTab._dragData.animLastScreenX = draggedTab._dragData.screenX;

      let screenX = event.screenX;
      if (screenX == draggedTab._dragData.animLastScreenX)
        return;

      let draggingRight = screenX > draggedTab._dragData.animLastScreenX;
      draggedTab._dragData.animLastScreenX = screenX;

      let rtl = (window.getComputedStyle(this).direction == "rtl");
      let pinned = draggedTab.pinned;
      let numPinned = this.tabbrowser._numPinnedTabs;
      let tabs = this.tabbrowser.visibleTabs
                    .slice(pinned ? 0 : numPinned,
                       pinned ? numPinned : undefined);
      if (rtl)
        tabs.reverse();
      let tabWidth = draggedTab.getBoundingClientRect().width;

      // Move the dragged tab based on the mouse position.

      let leftTab = tabs[0];
      let rightTab = tabs[tabs.length - 1];
      let tabScreenX = draggedTab.boxObject.screenX;
      let translateX = screenX - draggedTab._dragData.screenX;
      if (!pinned)
        translateX += this.mTabstrip.scrollPosition - draggedTab._dragData.scrollX;
      let leftBound = leftTab.boxObject.screenX - tabScreenX;
      let rightBound = (rightTab.boxObject.screenX + rightTab.boxObject.width) -
               (tabScreenX + tabWidth);
      translateX = Math.max(translateX, leftBound);
      translateX = Math.min(translateX, rightBound);
      draggedTab.style.transform = "translateX(" + translateX + "px)";

      // Determine what tab we're dragging over.
      // * Point of reference is the center of the dragged tab. If that
      //   point touches a background tab, the dragged tab would take that
      //   tab's position when dropped.
      // * We're doing a binary search in order to reduce the amount of
      //   tabs we need to check.

      let tabCenter = tabScreenX + translateX + tabWidth / 2;
      let newIndex = -1;
      let oldIndex = "animDropIndex" in draggedTab._dragData ?
             draggedTab._dragData.animDropIndex : draggedTab._tPos;
      let low = 0;
      let high = tabs.length - 1;
      while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        if (tabs[mid] == draggedTab &&
        ++mid > high)
          break;
        let boxObject = tabs[mid].boxObject;
        let screenX = boxObject.screenX + getTabShift(tabs[mid], oldIndex);
        if (screenX > tabCenter) {
          high = mid - 1;
        } else if (screenX + boxObject.width < tabCenter) {
          low = mid + 1;
        } else {
          newIndex = tabs[mid]._tPos;
          break;
        }
      }
      if (newIndex >= oldIndex)
        newIndex++;
      if (newIndex < 0 || newIndex == oldIndex)
        return;
      draggedTab._dragData.animDropIndex = newIndex;

      // Shift background tabs to leave a gap where the dragged tab
      // would currently be dropped.

      for (let tab of tabs) {
        if (tab != draggedTab) {
          let shift = getTabShift(tab, newIndex);
          tab.style.transform = shift ? "translateX(" + shift + "px)" : "";
        }
      }

      function getTabShift(tab, dropIndex) {
        if (tab._tPos < draggedTab._tPos && tab._tPos >= dropIndex)
          return rtl ? -tabWidth : tabWidth;
        if (tab._tPos > draggedTab._tPos && tab._tPos < dropIndex)
          return rtl ? tabWidth : -tabWidth;
        return 0;
      }
    }
  });

  tabutils.addEventListener(gBrowser.mTabContainer, "drop", function(event) {
    if (!TU_getPref("extensions.tabutils.disableTabMoveAnimation", true))
      return;

    let dt = event.dataTransfer;
    let dropEffect = dt.dropEffect;
    let draggedTab = dt.mozGetDataAt(TAB_DROP_TYPE, 0);

    if (dropEffect == "move" && draggedTab && draggedTab.parentNode == this) {
      draggedTab._dragData.animDropIndex = this._getDropIndex(event);
    }
  }, true);

  TU_hookCode("gBrowser.moveTabTo", "{", function() {
    if (TMP_console.isCallerInList(["onxbldrop", "ondrop"])) {
      if (aTab.pinned) {
        if (aIndex >= this._numPinnedTabs)
          this.pinTab(aTab, false);
      } else {
        if (aIndex < this._numPinnedTabs)
          this.pinTab(aTab, true);
      }
    }
  });

  tabutils.addEventListener(gBrowser.mTabContainer, "dragexit", function(event) {
    //this._tabDropIndicator.collapsed = true;
  }, true);

  tabutils.addEventListener(gBrowser.mTabContainer, "dragend", function(event) {
    //this._tabDropIndicator.collapsed = true;
  }, true);

  tabutils._tabPrefObserver.showAllTabs = function() {
    let showAllTabs = TU_getPref("extensions.tabutils.showAllTabs");
    if (showAllTabs) {
      gBrowser.mTabContainer.setAttribute("showAllTabs", true);
      gBrowser.mTabContainer.enterBlockMode();
    }
    else {
      gBrowser.mTabContainer.removeAttribute("showAllTabs");
      gBrowser.mTabContainer.exitBlockMode();
    }
  };
};
