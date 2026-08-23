export function sanitizeTranslationText(value, final = true) {
  let text = String(value || "")
    .replace(/\[\/?(?:block|context):[A-Za-z0-9_-]+\]/g, "")
    .replace(/```[A-Za-z0-9_-]*/g, "");
  text = text.replace(/^\s*(?:\[\]\s*)?(?:"""|''')\s*/, "");
  if (final) text = text.replace(/\s*(?:"""|''')\s*$/, "").trim();
  return text;
}

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

      const closing = this.buffer.match(/\[\/block:([A-Za-z0-9_-]+)\]\s*/);
      const closingIndex = closing?.index ?? -1;
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
        this.buffer = this.buffer.slice(closingIndex + closing[0].length);
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
      const bracketIndex = this.buffer.lastIndexOf("[");
      if (bracketIndex >= 0) {
        const suffix = this.buffer.slice(bracketIndex);
        const markerStarts = ["[block:", "[/block:", "[context:", "[/context:"];
        if (markerStarts.some((marker) => marker.startsWith(suffix) || (suffix.startsWith(marker) && !suffix.includes("]")))) {
          markerPrefixLength = suffix.length;
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
    const text = sanitizeTranslationText(this.currentText, final);
    if (text) this.onUpdate({ id: this.currentId, text, final });
  }
}
