/** Serialize JSON for an inline script without allowing an HTML parser escape. */
export function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    switch (character) {
      case "<": return "\\u003c";
      case ">": return "\\u003e";
      case "&": return "\\u0026";
      case "\u2028": return "\\u2028";
      case "\u2029": return "\\u2029";
      default: return character;
    }
  });
}
