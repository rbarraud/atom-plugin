'use strict';

let Kite, DataLoader, OverlayManager, HoverGesture, TokensList,
  HyperClickMode, OverlayMode, SidebarMode, screenPositionForMouseEvent,
  pixelPositionForMouseEvent, delayPromise, kiteUtils, CompositeDisposable,
  symbolId, CursorMoveGesture, KiteSignature;

class KiteEditor {
  constructor(editor) {
    this.editor = editor;
    this.buffer = editor.getBuffer();
    this.editorElement = atom.views.getView(editor);

    this.subscribeToEditor();
  }

  dispose() {
    this.subscriptions && this.subscriptions.dispose();
    delete this.subscriptions;
    delete this.editorElement;
    delete this.editor;
    delete this.buffer;
  }

  subscribeToEditor() {
    if (!CompositeDisposable) {
      ({CompositeDisposable} = require('atom'));
      ({screenPositionForMouseEvent, pixelPositionForMouseEvent, delayPromise} = require('./utils'));
      HyperClickMode = require('./modes/hyperclick');
      TokensList = require('./tokens-list');
      HoverGesture = require('./gestures/hover');
      CursorMoveGesture = require('./gestures/cursor-move');
      DataLoader = require('./data-loader');
    }

    const editor = this.editor;
    const subs = new CompositeDisposable();

    this.subscriptions = subs;
    this.tokensList = new TokensList(editor);
    this.hyperClickMode = new HyperClickMode(this);

    subs.add(this.tokensList);
    subs.add(this.hyperClickMode);

    subs.add(editor.onDidStopChanging(() => this.updateTokens()));

    this.hoverGesture = new HoverGesture(editor, this.tokensList, {
      ignoredSelector: 'atom-overlay, atom-overlay *',
    });
    this.cursorMoveGesture = new CursorMoveGesture(editor, this.tokensList, {
      checkToken: false,
      noMoveDuringEdit: false,
    });

    subs.add(this.hoverGesture);
    subs.add(this.cursorMoveGesture);

    subs.add(this.hoverGesture.onDidActivate(({range}) => {
      if (atom.config.get('kite.enableHoverUI')) {
        if (!OverlayManager) { OverlayManager = require('./overlay-manager'); }
        OverlayManager.showHoverAtRangeWithDelay(editor, range);
      }
    }));

    subs.add(this.cursorMoveGesture.onDidActivate(() => {
      const position = editor.getCursorBufferPosition();
      const descriptor = editor.scopeDescriptorForBufferPosition(position);

      const charBefore = editor.getTextInRange([
        [
          editor.getCursorBufferPosition().row, editor.getCursorBufferPosition().column - 1,
        ],
        editor.getCursorBufferPosition(),
      ]);

      const charAfter = editor.getTextInRange([
        editor.getCursorBufferPosition(),
        [
          editor.getCursorBufferPosition().row, editor.getCursorBufferPosition().column + 1,
        ],
      ]);

      if (this.isInsideFunctionCall(descriptor, charBefore, charAfter)) {
        this.loadSignature({editor, position});
      } else {
        this.clearSignature();
      }
    }));

    subs.add(this.hoverGesture.onDidDeactivate(() => {
      if (atom.config.get('kite.enableHoverUI')) {
        if (!OverlayManager) { OverlayManager = require('./overlay-manager'); }
        OverlayManager.dismissWithDelay();
      }
    }));

    subs.add(editor.onDidDestroy(() => {
      if (!Kite) { Kite = require('./kite'); }
      Kite.unsubscribeFromEditor(editor);
    }));

    subs.add(atom.config.observe('kite.displayExpandViewAs', (display) => {
      if (this.mode) {
        this.mode.dispose();
        subs.remove(this.mode);
      }

      if (display === 'sidebar') {
        if (!SidebarMode) { SidebarMode = require('./modes/sidebar'); }
        this.mode = new SidebarMode(this);
      } else {
        if (!OverlayMode) { OverlayMode = require('./modes/overlay'); }
        this.mode = new OverlayMode(this);
      }

      subs.add(this.mode);
    }));
  }

  initialize() {
    if (!kiteUtils) {
      ({utils: kiteUtils} = require('kite-installer'));
    }

    return this.editor === atom.workspace.getActivePaneItem()
      ? new Promise((resolve, reject) => {
        return kiteUtils.retryPromise(() => delayPromise(() => this.updateTokens(), 100), 10, 100);
      })
      : Promise.resolve();
  }

  updateTokens() {
    return this.editor
      ? DataLoader.getTokensForEditor(this.editor).then(tokens => {
        this.tokensList.setTokens(tokens.tokens);
      })
      : Promise.reject('Editor was destroyed');
  }

  expandRange(range) {
    return this.mode.expandRange(range);
  }

  expandId(id) {
    return this.mode.expandId(id);
  }

  openInWebAtRange(range) {
    return DataLoader.openInWebAtRange(this.editor, range);
  }

  openTokenDefinition(token) {
    if (!token) { return Promise.resolve(false); }
    if (!symbolId) { ({symbolId} = require('./kite-data-utils')); }

    return DataLoader.getValueReportDataForId(symbolId(token.Symbol))
    .then((data) => this.openDefinition(data.report.definition))
    .catch(() => {
      atom.notifications.addWarning(`Can't find a definition for token \`${token.Symbol.name}\``, {
        dismissable: true,
      });
    });
  }

  openDefinitionForId(id) {
    return DataLoader.getValueReportDataForId(id)
    .then((data) => this.openDefinition(data.report.definition));
  }

  openDefinitionAtRange(range) {
    const token = this.tokensList.tokenAtRange(range);
    return this.openTokenDefinition(token);
  }

  openDefinition(definition) {
    return new Promise((resolve, reject) => {
      if (definition) {
        return atom.workspace.open(definition.filename)
        .then(editor => {
          editor.setCursorBufferPosition([
            definition.line - 1, 0,
          ], {
            autoscroll: true,
          });
          return true;
        });
      }
      return false;
    });
  }

  showHyperClickHighlight(range) {
    this.hyperclickMarker = this.editor.markBufferRange(range, {
      invalidate: 'touch',
    });
    this.editor.decorateMarker(this.hyperclickMarker, {
      type: 'highlight',
      class: 'kite-hyperclick',
    });
  }

  hideHyperClickHighlight() {
    if (this.hyperclickMarker ) {
      this.hyperclickMarker.destroy();
      delete this.hyperclickMarker;
    }
  }

  tokenAtPosition(position) {
    return this.tokensList.tokenAtPosition(position);
  }

  tokenAtScreenPosition(position) {
    return this.tokensList.tokenAtScreenPosition(position);
  }

  tokenForMouseEvent(event) {
    return this.tokensList.tokenForMouseEvent(event);
  }

  screenPositionForMouseEvent(event) {
    return screenPositionForMouseEvent(this.editorElement, event);
  }

  pixelPositionForMouseEvent(event) {
    return pixelPositionForMouseEvent(this.editorElement, event);
  }

  isInsideFunctionCall(scopeDescriptor, charBefore, charAfter) {
    return scopeDescriptor.scopes.some(s =>
      s.indexOf('arguments') !== -1 &&
      charBefore !== ')' &&
      charAfter !== '('
    );
  }

  loadSignature({editor, position}) {
    if (!KiteSignature) {
      KiteSignature = require('./elements/kite-signature');
    }

    const line = editor.getTextInRange([
      [position.row, 0],
      position,
    ]);

    const compact = line.match(/[\(,]\s*$/) == null;

    return DataLoader.getSignaturesAtPosition(editor, position)
    .then(data => {
      if (data) {
        this.signaturePanel = this.signaturePanel || new KiteSignature();
        // this.signaturePanel.setListElement(listElement);

        this.signaturePanel.setData(data, compact);

        const editorElement = atom.views.getView(editor);
        const container = editorElement.querySelector('.lines');

        const scopeRange = editor.bufferRangeForScopeAtCursor('function-call');
        const pos = editorElement.pixelPositionForBufferPosition(scopeRange.start);

        this.signaturePanel.style.top = pos.top + 'px';
        this.signaturePanel.style.left = pos.left + 'px';

        container.appendChild(this.signaturePanel);

        // const listElement = this.getSuggestionsListElement();
        //
        // listElement.maxVisibleSuggestions = compact
        //   ? atom.config.get('autocomplete-plus.maxVisibleSuggestions')
        //   : atom.config.get('kite.maxVisibleSuggestionsAlongSignature');
        //
        // this.signaturePanel = this.signaturePanel || new KiteSignature();
        // this.signaturePanel.setListElement(listElement);
        //
        // this.signaturePanel.setData(data, compact);
        // atom.config.get('kite.hideDocumentationWhenSignatureIsAvailable')
        //   ? this.signaturePanel.setAttribute('no-documentation', '')
        //   : this.signaturePanel.removeAttribute('no-documentation');
        //
        // const element = listElement.element
        //   ? listElement.element
        //   : listElement;
        //
        // element.style.width = null;
        //
        // // metrics.track('signature shown in autocomplete-plus');
      }
    })
    .catch(err => {
      console.error(err);
      // metrics.track('retrieving signature failed', {error: err});
      this.clearSignature();
    });
  }

  clearSignature() {
    if (this.signaturePanel && this.signaturePanel.parentNode) {
      this.signaturePanel.parentNode.removeChild(this.signaturePanel);
    }
  }

  getSuggestionsListElement() {
    if (!atom.packages.getAvailablePackageNames().includes('autocomplete-plus')) {
      return null;
    }

    if (this.suggestionListElement) { return this.suggestionListElement; }

    const pkg = atom.packages.getActivePackage('autocomplete-plus').mainModule;
    const list = pkg.autocompleteManager.suggestionList;
    this.suggestionListElement = list.suggestionListElement
      ? list.suggestionListElement
      : atom.views.getView(pkg.autocompleteManager.suggestionList);

    if (!this.suggestionListElement.ol) {
      this.suggestionListElement.renderList();
    }

    return this.suggestionListElement;
  }

}

module.exports = KiteEditor;
