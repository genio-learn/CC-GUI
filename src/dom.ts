/** Shared DOM helpers. */

/**
 * Turn off the browser/OS writing aids (spellcheck squiggles, autocorrect,
 * auto-capitalisation, autocomplete) for a text input or textarea. Session
 * titles, paths, branches and review comments aren't prose, so these only get
 * in the way.
 */
export function noTextAssist<T extends HTMLInputElement | HTMLTextAreaElement>(el: T): T {
  el.spellcheck = false;
  el.autocapitalize = "off";
  el.autocomplete = "off";
  el.setAttribute("autocorrect", "off");
  return el;
}
