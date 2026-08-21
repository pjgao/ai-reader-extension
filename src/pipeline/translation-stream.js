export class BlockTranslationStream {
  constructor(blockIds, onUpdate) {
    this.allowed = new Set(blockIds);
    this.onUpdate = onUpdate;
    this.buffer = "";
    this.currentId = null;
    this.currentText = "";
  }

  push(delta) {
    if (!delta) return;
    this.buffer += delta;
    this.drain(false);
  }

  finish() {
    this.drain(true);
  }

  drain(finishing) {
    while (true) {
      if (!this.currentId) {
        const opening = this.buffer.match(/\[block:([A-Za-z0-9_-]+)\]\s*/);
        if (!opening) {
          if (this.buffer.length > 256) this.buffer = this.buffer.slice(-256);
          return;
        }
        this.buffer = this.buffer.slice(opening.index + opening[0].length);
        this.currentId = opening[1];
        this.currentText = "";
      }

      const closing = `[/block:${this.currentId}]`;
      const closingIndex = this.buffer.indexOf(closing);
      const nextOpening = this.buffer.match(/\[block:([A-Za-z0-9_-]+)\]\s*/);
      if (nextOpening && (closingIndex < 0 || nextOpening.index < closingIndex)) {
        this.currentText += this.buffer.slice(0, nextOpening.index);
        this.emit(true);
        this.buffer = this.buffer.slice(nextOpening.index);
        this.currentId = null;
        this.currentText = "";
        continue;
      }
      if (closingIndex >= 0) {
        this.currentText += this.buffer.slice(0, closingIndex);
        this.emit(true);
        this.buffer = this.buffer.slice(closingIndex + closing.length);
        this.currentId = null;
        this.currentText = "";
        continue;
      }

      if (finishing) {
        this.currentText += this.buffer;
        this.buffer = "";
        this.emit(true);
        this.currentId = null;
        this.currentText = "";
        return;
      }

      let markerPrefixLength = 0;
      for (const marker of [closing, "[block:"]) {
        const maxPrefixLength = Math.min(this.buffer.length, marker.length - 1);
        for (let length = maxPrefixLength; length > markerPrefixLength; length -= 1) {
          if (marker.startsWith(this.buffer.slice(-length))) {
            markerPrefixLength = length;
            break;
          }
        }
      }
      const safeLength = this.buffer.length - markerPrefixLength;
      if (safeLength > 0) {
        this.currentText += this.buffer.slice(0, safeLength);
        this.buffer = this.buffer.slice(safeLength);
        this.emit(false);
      }
      return;
    }
  }

  emit(final) {
    if (!this.allowed.has(this.currentId)) return;
    const text = final ? this.currentText.trim() : this.currentText;
    if (text) this.onUpdate({ id: this.currentId, text, final });
  }
}
