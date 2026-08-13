const DEFAULT_BRIDGE_PORT = 1994;

export const bridgePortFromEnvironment = (
  value = process.env.FIGMA_BRIDGE_PORT
): number => {
  if (value === undefined || value === "") {
    return DEFAULT_BRIDGE_PORT;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`FIGMA_BRIDGE_PORT must be an integer: ${value}`);
  }

  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new Error(`FIGMA_BRIDGE_PORT must be between 1 and 65535: ${value}`);
  }

  return port;
};
