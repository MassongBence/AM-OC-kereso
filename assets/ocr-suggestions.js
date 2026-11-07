/** OCR-only suggestions, never used for typed queries or spreadsheets. Original
 * readings remain visible in review. Suffix digits are never guessed/repaired. */
export function suggestOcrText(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  let text = raw;
  // O and zero are visually ambiguous specifically in a J key's numeric part.
  if (/^J[\s-]*[\dO]{1,4}$/i.test(text)) {
    text = text.replace(/^(J[\s-]*)([\dO]+)$/i, (_, prefix, digits) => prefix + digits.replace(/O/gi, '0'));
  }
  // Restrict repairs to the namespace, never the location's numeric identifier.
  text = text.replace(/\bAM\s*-\s*(?:0OC|O0C|0C)\s*-\s*(\d{1,4})(?![A-Z0-9])/gi, 'AM-OC-$1');
  return {text, reasons: text === raw ? [] : [`OCR-javítási javaslat: „${raw}” → „${text}”. Ellenőrizd a karaktereket!`]};
}
