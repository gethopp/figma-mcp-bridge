const fontCache: { [key: string]: FontName | undefined } = {};

const normalizeName = (str: string) => str.toLowerCase().replace(/[^a-z]/gi, "");

export const defaultFont = { family: "Roboto", style: "Regular" };

let cachedAvailableFonts: Font[] | null = null;

const getAvailableFontNames = async () => {
  if (cachedAvailableFonts) {
    return cachedAvailableFonts;
  } else {
    return (await figma.listAvailableFontsAsync()).filter(
      (font: Font) => font.fontName.style === "Regular"
    );
  }
};

// TODO: keep list of fonts not found
export async function getMatchingFont(fontStr: string) {
  const cached = fontCache[fontStr];
  if (cached) {
    return cached;
  }

  const availableFonts = await getAvailableFontNames();
  const familySplit = fontStr.split(/\s*,\s*/);

  for (const family of familySplit) {
    const normalized = normalizeName(family);
    for (const availableFont of availableFonts) {
      const normalizedAvailable = normalizeName(availableFont.fontName.family);
      if (normalizedAvailable === normalized) {
        const cached = fontCache[normalizedAvailable];
        if (cached) {
          return cached;
        }
        await figma.loadFontAsync(availableFont.fontName);
        fontCache[fontStr] = availableFont.fontName;
        fontCache[normalizedAvailable] = availableFont.fontName;
        return availableFont.fontName;
      }
    }
  }

  return defaultFont;
}
