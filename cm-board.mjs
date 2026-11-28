import {Chessboard, COLOR, BORDER_TYPE, FEN, INPUT_EVENT_TYPE} from './vendor/cm-chessboard/src/Chessboard.js';
import {Markers, MARKER_TYPE} from './vendor/cm-chessboard/src/extensions/markers/Markers.js';

// cm-chessboard is a view. Esca and the application's saved game own every move.
export class ChessSurface {
  constructor(element, {onIntent, onSelection, onInvalid, onBusyChange, onError}) {
    this.element = element;
    this.callbacks = {onIntent, onSelection, onInvalid, onBusyChange, onError};
    this.snapshot = {fen: FEN.empty, enabled: false, legal: [], last: null, token: null};
    this.orientation = COLOR.white;
    this.selected = null;
    this.syncing = false;
    this.intentPending = false;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.board = new Chessboard(element, {
      position: FEN.empty,
      orientation: COLOR.white,
      assetsUrl: new URL('./vendor/cm-chessboard/assets/', import.meta.url).href,
      style: {
        cssClass: 'alfred',
        borderType: BORDER_TYPE.none,
        showCoordinates: true,
        pieces: {file: 'pieces/standard.svg', tileSize: 40},
        animationDuration: this.motion.matches ? 0 : 170,
      },
      extensions: [{class: Markers, props: {autoMarkers: null}}],
    });
    this.board.view.svg.setAttribute('aria-hidden', 'true');
    this.motion.addEventListener('change', () => {
      this.board.props.style.animationDuration = this.motion.matches ? 0 : 170;
    });
    this.inputHandler = event => this.handleInput(event);
  }

  get busy() { return this.syncing; }

  sync(snapshot) {
    const previous = this.snapshot;
    this.snapshot = snapshot || {fen: FEN.empty, enabled: false, legal: [], last: null, token: null};
    const placementChanged = previous.fen.split(' ')[0] !== this.snapshot.fen.split(' ')[0];
    const ownershipChanged = previous.token !== this.snapshot.token;
    if (placementChanged || ownershipChanged || !this.snapshot.enabled) this.stopInput();
    this.element.dataset.fen = this.snapshot.fen;
    this.element.dataset.orientation = this.orientation;
    if (this.board.getPosition() !== this.snapshot.fen.split(' ')[0] ||
        this.board.getOrientation() !== this.orientation || this.syncing) {
      this.flush();
    } else {
      this.drawMarkers();
      this.updateInput();
    }
  }

  stopInput() {
    this.board.cancelMoveInput();
    if (this.board.isMoveInputEnabled()) this.board.disableMoveInput();
    this.selected = null;
    this.element.dataset.inputEnabled = 'false';
  }

  updateInput() {
    const enabled = this.snapshot.enabled && !this.syncing && !this.intentPending;
    if (enabled && !this.board.isMoveInputEnabled()) this.board.enableMoveInput(this.inputHandler, COLOR.white);
    if (!enabled && this.board.isMoveInputEnabled()) this.stopInput();
    this.element.dataset.inputEnabled = String(enabled);
  }

  async flush() {
    if (this.syncing) return;
    this.syncing = true;
    this.stopInput();
    this.callbacks.onBusyChange?.();
    try {
      // A newer saved position can arrive while an animation finishes. Serialize
      // updates and enable input only after the newest position is on screen.
      while (this.board.getPosition() !== this.snapshot.fen.split(' ')[0] ||
             this.board.getOrientation() !== this.orientation) {
        if (this.board.getOrientation() !== this.orientation) {
          await this.board.setOrientation(this.orientation, false);
        }
        const fen = this.snapshot.fen;
        if (this.board.getPosition() !== fen.split(' ')[0]) {
          await this.board.setPosition(fen, !this.motion.matches && document.visibilityState === 'visible');
        }
      }
    } catch (error) {
      this.snapshot = {...this.snapshot, enabled: false};
      this.callbacks.onError?.(error);
    } finally {
      this.syncing = false;
      this.drawMarkers();
      this.updateInput();
      this.callbacks.onBusyChange?.();
    }
  }

  flip() {
    if (this.syncing) return false;
    this.orientation = this.orientation === COLOR.white ? COLOR.black : COLOR.white;
    this.element.dataset.orientation = this.orientation;
    this.stopInput();
    this.flush();
    return true;
  }

  drawMarkers() {
    this.board.removeMarkers();
    if (this.snapshot.last) {
      this.board.addMarker(MARKER_TYPE.square, this.snapshot.last.slice(0, 2));
      this.board.addMarker(MARKER_TYPE.square, this.snapshot.last.slice(2, 4));
    }
    if (this.selected && this.snapshot.enabled && !this.syncing) {
      this.board.addMarker(MARKER_TYPE.framePrimary, this.selected);
      this.board.addLegalMovesMarkers(this.snapshot.legal
        .filter(move => move.uci.startsWith(this.selected))
        .map(move => ({to: move.target, promotion: move.uci.length === 5 ? move.uci.at(-1) : undefined})));
    }
  }

  isOwnPieceReselection(square) {
    // The pinned view validates a same-color click before selecting that piece.
    // A completed click/drag is already in moveDone and must keep its feedback.
    if (this.board.view.visualMoveInput.moveInputState !== 'clickTo') return false;
    const [placement, side] = this.snapshot.fen.split(' ');
    const rank = placement.split('/')[8 - Number(square[1])];
    const piece = rank.replace(/[1-8]/g, n => '.'.repeat(Number(n)))['abcdefgh'.indexOf(square[0])];
    return side === 'w' ? /^[KQRBNP]$/.test(piece) : side === 'b' && /^[kqrbnp]$/.test(piece);
  }

  handleInput(event) {
    if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
      if (!this.snapshot.enabled || this.syncing || this.intentPending ||
          !this.snapshot.legal.some(move => move.uci.startsWith(event.squareFrom))) return false;
      this.selected = event.squareFrom;
      this.drawMarkers();
      this.callbacks.onSelection?.(this.selected);
      return true;
    }
    if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
      const from = event.squareFrom, to = event.squareTo;
      const available = this.snapshot.enabled && !this.syncing && !this.intentPending;
      const legal = available && this.snapshot.legal.some(move => move.uci.startsWith(from) && move.target === to);
      if (legal) {
        const token = this.snapshot.token;
        this.intentPending = true;
        // Always reject the library's own mutation. It resets the transient
        // drag/click synchronously; our callback saves first, then sets the FEN.
        queueMicrotask(() => {
          this.intentPending = false;
          if (token === this.snapshot.token && this.snapshot.enabled) this.callbacks.onIntent(from, to, token);
          this.updateInput();
        });
      } else if (available && !this.isOwnPieceReselection(to)) {
        this.callbacks.onInvalid?.();
      }
      return false;
    }
    if (event.type === INPUT_EVENT_TYPE.moveInputCanceled || event.type === INPUT_EVENT_TYPE.moveInputFinished) {
      this.selected = null;
      this.drawMarkers();
      this.callbacks.onSelection?.(null);
    }
    return true;
  }
}
