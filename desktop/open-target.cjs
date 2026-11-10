'use strict';

/**
 * A File > Open action may replace only an untouched, untitled document.
 * Even whitespace, a saved empty file, or an unsaved worksheet makes the
 * current document worth preserving in its own window.
 */
function isReusableBlankDocument(entry) {
  return Boolean(entry && entry.name === 'Untitled' && entry.path === null &&
    entry.markdown === '' && entry.dirty === false);
}

module.exports = { isReusableBlankDocument };
